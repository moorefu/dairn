"""真实离线 PCC 入口与单一 Publisher；组件模拟不声称平台已部署。"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[2]


def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module


class PCCGate(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='dairn-offline-pcc-')
        self.addCleanup(self.temp.cleanup)
        self.folder=Path(self.temp.name);self.root=self.folder/'project';self.root.mkdir()
        self.trusted=self.folder/'trusted';self.trusted.mkdir()
        self.runtime=self.trusted/'dairn-embedded.com'
        source=Path(os.environ['DAIRN_TEST_RUNTIME'])
        shutil.copyfile(source,self.runtime);self.runtime.chmod(0o700)
        shutil.copyfile(source.with_name('runtime-integrity.json'),self.trusted/'runtime-integrity.json')
        self.launcher=self.trusted/('dairn.cmd' if os.name=='nt' else 'dairn')
        shutil.copyfile(ROOT/self.launcher.name,self.launcher);self.launcher.chmod(0o755)
        self.verifier_path=self.trusted/'pcc-gate.py';shutil.copyfile(ROOT/'ci/protected/pcc-gate.py',self.verifier_path)
        self.publisher_path=self.trusted/'publish-github-assurance.py';shutil.copyfile(ROOT/'ci/providers/publish-github-assurance.py',self.publisher_path)
        self.verifier=load('pcc_fixture',self.verifier_path);self.publisher=load('publisher_fixture',self.publisher_path)
        config=self.root/'.dairn/governance/project.json';config.parent.mkdir(parents=True)
        self.policy={'schema_version':1,'project':'fixture','required_checks':{k:['lint','unit'] for k in ['L0','L1','L2']},
                     'modules':[{'name':'app','path':'.','checks':{k:{'argv':[sys.executable,'-B','-c','print("真实检查")']} for k in ['lint','unit']}}]}
        config.write_text(json.dumps(self.policy),encoding='utf-8')
        (self.root/'.gitignore').write_text('.dairn/governance/evidence/\n',encoding='utf-8')
        self.git('init','-q');self.git('config','user.name','测试');self.git('config','user.email','test@example.invalid')
        self.git('remote','add','origin','https://github.com/org/repo.git');self.git('add','.');self.git('commit','-qm','Base 机器策略')
        self.base=self.git('rev-parse','HEAD')
        (self.root/'app.py').write_text('value = 1\n',encoding='utf-8');self.git('add','.');self.git('commit','-qm','实现变更')
        self.head=self.git('rev-parse','HEAD')
        self.admin={'schema':'dairn.pcc-admin.v1','repository':'org/repo','runtime':str(self.runtime),
                    'runtime_sha256':self.sha(self.runtime),'launcher':str(self.launcher),'launcher_sha256':self.sha(self.launcher),'verifier':str(self.verifier_path),'verifier_sha256':self.sha(self.verifier_path),
                    'publisher':str(self.publisher_path),'publisher_sha256':self.sha(self.publisher_path)}
        self.admin_path=self.trusted/'admin.json';self.save_admin()
        self.env={k:v for k,v in os.environ.items() if k not in ('GITHUB_TOKEN','DAIRN_GITHUB_TOKEN','GH_TOKEN')}
        blocker=self.folder/'no-http';blocker.mkdir()
        (blocker/'sitecustomize.py').write_text('''import sys,importlib.abc,socket
class NoHTTP(importlib.abc.MetaPathFinder):
 def find_spec(self,fullname,path=None,target=None):
  if fullname.split('.')[0] in ('urllib','http'):raise ImportError('本次环境没有 HTTP 客户端')
sys.meta_path.insert(0,NoHTTP())
def refuse(*a,**k):raise AssertionError('离线 PCC 不得联网')
socket.create_connection=refuse
''',encoding='utf-8')
        self.env['PYTHONPATH']=str(blocker)
        self.env.update(PYTHONUTF8='1',PYTHONIOENCODING='utf-8',DAIRN_CACHE_HOME=str(self.folder/'cache'))

    @staticmethod
    def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()

    def save_admin(self):
        self.admin_path.write_text(json.dumps(self.admin),encoding='utf-8');self.admin_sha=self.sha(self.admin_path)

    def git(self,*args):
        return subprocess.check_output(['git','-c','commit.gpgSign=false',*args],cwd=self.root,text=True,stderr=subprocess.STDOUT).strip()

    def arguments(self,*selection):
        return ['--root',str(self.root),'--admin-config',str(self.admin_path),'--admin-sha256',self.admin_sha,
                '--repository','org/repo','--base',self.base,'--head',self.head,*selection]

    def call(self,*selection):
        result=subprocess.run([sys.executable,'-B',str(self.verifier_path),*self.arguments(*selection)],env=self.env,
                              capture_output=True,text=True,encoding='utf-8',timeout=90)
        self.assertTrue(result.stdout.strip(),result.stderr)
        return result,json.loads(result.stdout)

    def execute(self):
        result,data=self.call('--execute');self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertEqual(data['scope'],'machine-assurance');self.assertEqual(data['human_approval'],'delegated-to-scm')
        self.assertEqual(data['merge_eligibility'],'not-evaluated');return data

    def test_plan_execute_and_verify_without_token_or_http_client(self):
        data=self.execute()
        result,verified=self.call('--check',data['evidence_ref']['path'])
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertEqual(verified['status'],'PASS')
        self.assertFalse(hasattr(self.verifier,'GitHub'))

    def test_head_cannot_remove_base_requirement(self):
        del self.policy['modules'][0]['checks']['unit'];self.policy['required_checks']={k:['lint'] for k in ['L0','L1','L2']}
        (self.root/'.dairn/governance/project.json').write_text(json.dumps(self.policy),encoding='utf-8')
        self.git('add','.');self.git('commit','-qm','Head 试图删除必需单测');self.head=self.git('rev-parse','HEAD')
        self.assertEqual({r['id'] for r in self.execute()['coverage']},{'app.lint','app.unit'})

    def test_admin_pin_and_legacy_online_config_fail_closed(self):
        self.admin_sha='0'*64
        result,data=self.call('--execute');self.assertEqual(result.returncode,3);self.assertNotEqual(data['status'],'PASS')
        self.admin['requirements']={'app.unit':{'app_id':1}};self.save_admin()
        result,data=self.call('--execute');self.assertEqual(result.returncode,3)

    def test_input_drift_or_tampered_run_is_rejected(self):
        data=self.execute();path=data['evidence_ref']['path'];raw=(self.root/path).read_bytes()
        (self.root/'app.py').write_text('value = 2\n',encoding='utf-8')
        result,data=self.call('--check',path);self.assertNotEqual(result.returncode,0);self.assertIn('CURRENT_INPUT_SNAPSHOT_MISMATCH',str(data))
        (self.root/'app.py').write_text('value = 1\n',encoding='utf-8')
        run=json.loads(raw);run['checks'][0]['status']='skipped';(self.root/path).write_text(json.dumps(run),encoding='utf-8')
        result,data=self.call('--check',path);self.assertNotEqual(result.returncode,0)

    def test_subject_or_runtime_pin_mismatch_cannot_pass(self):
        self.head='9'*40
        result,data=self.call('--execute');self.assertNotEqual(result.returncode,0)
        self.head=self.git('rev-parse','HEAD');self.admin['runtime_sha256']='0'*64;self.save_admin()
        result,data=self.call('--execute');self.assertNotEqual(result.returncode,0)

    def publication_inputs(self):
        self.admin['expected_jobs']=['quality'];self.save_admin()
        data=self.execute();path=data['evidence_ref']['path'];sha=self.sha(self.root/path)
        manifest=self.root/'.dairn/governance/evidence/manifest.json'
        manifest.write_text(json.dumps([{'path':path,'sha256':sha,'job_id':'quality'}]),encoding='utf-8')
        needs=self.trusted/'needs.json';needs.write_text(json.dumps({'quality':{'result':'success','outputs':{'run_sha256':sha}}}),encoding='utf-8')
        return self.verifier.parser().parse_args(self.arguments('--runs',str(manifest),'--needs',str(needs))),needs

    def test_publisher_posts_one_aggregate_without_reading_scm(self):
        args,needs=self.publication_inputs();calls=[]
        result=self.publisher.publish(self.verifier,args,send=lambda repo,payload,token:calls.append((repo,payload)) or 7)
        self.assertEqual(result['status'],'PASS');self.assertEqual(len(calls),1)
        self.assertEqual(calls[0][1]['name'],'Dairn / Required Assurance');self.assertEqual(calls[0][1]['head_sha'],self.head)
        self.assertEqual(calls[0][1]['conclusion'],'success')
        needs.write_text(json.dumps({'quality':{'result':'skipped'}}),encoding='utf-8')
        result=self.publisher.publish(self.verifier,args,send=lambda repo,payload,token:calls.append((repo,payload)) or 8)
        self.assertNotEqual(result['status'],'PASS');self.assertEqual(calls[-1][1]['conclusion'],'failure')

    def test_publisher_refuses_execution_and_bare_local_verdicts(self):
        args=self.verifier.parser().parse_args(self.arguments('--execute'))
        with self.assertRaises(ValueError):self.publisher.publish(self.verifier,args,send=lambda *a:self.fail('不应发布'))
        data=self.execute();args=self.verifier.parser().parse_args(self.arguments('--check',data['evidence_ref']['path']))
        with self.assertRaises(ValueError):self.publisher.publish(self.verifier,args,send=lambda *a:self.fail('不应发布'))

    def test_direct_job_or_artifact_digest_mismatch_is_rejected(self):
        args,needs=self.publication_inputs()
        needs.write_text(json.dumps({'quality':{'result':'success','outputs':{'run_sha256':'0'*64}}}),encoding='utf-8')
        with self.assertRaises(ValueError):self.verifier.verify(args)

    def test_partial_runs_require_both_fixed_jobs_and_complete_requirements(self):
        self.admin['expected_jobs']=['lint-job','unit-job'];self.save_admin()
        subject={'schema':'dairn.subject.v1','repository':'org/repo','kind':'git-commit',
                 'source_commit':self.head,'tree_sha':self.git('rev-parse','HEAD^{tree}'),
                 'base_commit':self.base,'comparison':'base-to-source','stage':'pre-merge'}
        context=self.trusted/'context.json'
        context.write_text(json.dumps({'subject':subject,'authority':{
            'source':'git-base+admin-pin','protected_base_commit':self.base,
            'verifier_sha256':self.admin['runtime_sha256'],'admin_policy_sha256':self.admin_sha}}),encoding='utf-8')
        env={**self.env,'DAIRN_RUNTIME':str(self.runtime),'DAIRN_CI_REPOSITORY':'org/repo'}
        manifest=[];needs={}
        for requirement,job in [('app.lint','lint-job'),('app.unit','unit-job')]:
            result=subprocess.run([str(self.launcher),'governance','execute','--base',self.base,
                '--context',str(context),'--root',str(self.root),'--requirements',requirement,'--json'],
                env=env,capture_output=True,text=True,encoding='utf-8',timeout=90)
            self.assertEqual(result.returncode,0,result.stdout+result.stderr)
            run=json.loads(result.stdout);self.assertEqual(run['execution']['scope'],'partial-plan')
            path=run['evidence_ref']['path'];sha=self.sha(self.root/path)
            manifest.append({'path':path,'sha256':sha,'job_id':job})
            needs[job]={'result':'success','outputs':{'run_sha256':sha}}
        manifest_path=self.root/'.dairn/governance/evidence/manifest.json'
        manifest_path.write_text(json.dumps(manifest),encoding='utf-8')
        needs_path=self.trusted/'needs.json';needs_path.write_text(json.dumps(needs),encoding='utf-8')
        result,data=self.call('--runs',str(manifest_path),'--needs',str(needs_path))
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertEqual(len(data['coverage']),2)
        jobs=self.trusted/'jobs.json';jobs.write_text(json.dumps(self.admin['expected_jobs']),encoding='utf-8')
        unbound=subprocess.run([str(self.launcher),'gate','evaluate','--base',self.base,
            '--root',str(self.root),'--check',manifest[0]['path'],'--jobs',str(jobs),'--needs',str(needs_path),'--json'],
            env=env,capture_output=True,text=True,encoding='utf-8',timeout=90)
        self.assertNotEqual(unbound.returncode,0)
        self.assertIn('逐作业证据',unbound.stderr+unbound.stdout)
        del needs['unit-job'];needs_path.write_text(json.dumps(needs),encoding='utf-8')
        result,data=self.call('--runs',str(manifest_path),'--needs',str(needs_path))
        self.assertNotEqual(result.returncode,0)

    def test_execution_does_not_inherit_publish_or_signing_credentials(self):
        for config in self.policy['modules'][0]['checks'].values():
            config['argv']=[sys.executable,'-B','-c',
                'import os; assert all(not os.getenv(k) for k in ["GITHUB_TOKEN","GH_TOKEN","DAIRN_GITHUB_TOKEN","DAIRN_SIGNING_PRIVATE_KEY_PATH"])']
        (self.root/'.dairn/governance/project.json').write_text(json.dumps(self.policy),encoding='utf-8')
        self.git('add','.');self.git('commit','-qm','无凭据执行契约');self.base=self.git('rev-parse','HEAD')
        (self.root/'app.py').write_text('value = 2\n',encoding='utf-8');self.git('add','.');self.git('commit','-qm','待验源码')
        self.head=self.git('rev-parse','HEAD')
        for key in ['GITHUB_TOKEN','GH_TOKEN','DAIRN_GITHUB_TOKEN','DAIRN_SIGNING_PRIVATE_KEY_PATH']:
            self.env[key]='fixture-not-a-real-credential'
        self.assertEqual(self.execute()['status'],'PASS')


class PublisherTransport(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.publisher=load('publisher_transport',ROOT/'ci/providers/publish-github-assurance.py')

    def test_missing_credential_or_invalid_repository_never_sends_request(self):
        with patch.object(self.publisher.urllib.request,'build_opener') as opener:
            for repository,token in [('org/repo',None),('../outside','fixture-not-a-real-credential')]:
                with self.assertRaises(ValueError):self.publisher.post(repository,{},token)
            opener.assert_not_called()

    def test_redirect_is_refused_without_forwarding_credential(self):
        with self.assertRaises(ValueError):self.publisher.NoRedirect().redirect_request()

    def test_single_post_checks_response_head_and_name(self):
        payload={'name':self.publisher.CHECK_NAME,'head_sha':'a'*40}
        with patch.object(self.publisher.urllib.request,'build_opener') as opener:
            response=opener.return_value.open.return_value.__enter__.return_value
            response.read.return_value=json.dumps({**payload,'id':8}).encode()
            self.assertEqual(self.publisher.post('org/repo',payload,'fixture-not-a-real-credential'),8)
            opener.return_value.open.assert_called_once()
            request=opener.return_value.open.call_args.args[0]
            self.assertEqual(request.get_method(),'POST')
            self.assertEqual(request.full_url,'https://api.github.com/repos/org/repo/check-runs')
            response.read.return_value=json.dumps({**payload,'head_sha':'b'*40,'id':9}).encode()
            with self.assertRaises(ValueError):self.publisher.post('org/repo',payload,'fixture-not-a-real-credential')
