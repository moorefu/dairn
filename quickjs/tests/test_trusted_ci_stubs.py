"""Integration tests against original Cosmo APE and real subprocesses.
CI provider variables are SIMULATED here; this cannot establish actual runner trust.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / 'dairn.sh'

class TrustedCIAndPortableStub(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='dairn-v13-')
        self.addCleanup(self.temp.cleanup)
        self.work = Path(self.temp.name)
        self.project = self.work/'project'
        self.exec(CLI,'init','--path',self.project,'--stack','go','--sample',cwd=self.work)
        self.git('init','-q')
        self.git('config','user.name','Dairn Test')
        self.git('config','user.email','dairn@example.test')

    def exec(self,*args,env=None,cwd=None,pass_required=True):
        got = subprocess.run([str(a) for a in args],cwd=cwd or self.project,
            env={**os.environ,**(env or {})},capture_output=True,text=True,timeout=160)
        if pass_required:self.assertEqual(got.returncode,0,got.stdout+'\n'+got.stderr)
        return got

    def dairn(self,*args,env=None,pass_required=True):
        return self.exec(CLI,*args,'--root',self.project,env=env,pass_required=pass_required)

    def obj(self,*args,env=None):
        return json.loads(self.dairn(*args,env=env).stdout)

    def git(self,*args):
        return self.exec('git',*args).stdout.strip()

    def commit(self,message='baseline'):
        self.git('add','.')
        self.git('commit','-qm',message)
        return self.git('rev-parse','HEAD')

    def test_stub_plan_is_readonly_and_duplicates_fail(self):
        manifest = self.project/'.dairn/stubs.json'
        original=manifest.read_bytes()
        plan=self.obj('stubs','init','--template','go','--id','surface')
        self.assertFalse(plan['applied'])
        self.assertFalse((self.project/'tools/dairn/stubs/go/main.go').exists())
        self.assertEqual(original,manifest.read_bytes())
        self.obj('stubs','init','--template','go','--id','surface','--apply')
        self.assertTrue((self.project/'tools/dairn/stubs/go/main.go').exists())
        self.assertEqual(self.obj('stubs','doctor')['tools'][0]['status'],'available')
        self.assertNotEqual(self.dairn('stubs','init','--template','go','--id','surface','--apply',pass_required=False).returncode,0)

    def test_python_template_surface_and_dirty_cache(self):
        self.obj('stubs','init','--template','python','--id','py','--apply')
        base=self.commit()
        (self.project/'domain.py').write_text('def api(name: str) -> str:\n    return name\n')
        self.commit('new-python-module')
        a=self.obj('guide','impact','--base',base,'--precision','py')['stub_analysis']
        self.assertEqual(a['source'],'project-stub')
        self.assertTrue(any(x['symbol']=='func:api' for x in a['changes']))
        b=self.obj('guide','impact','--base',base,'--precision','py')['stub_analysis']
        self.assertEqual(b['source'],'local-cache')
        (self.project/'README.md').write_text('uncommitted change\n')
        c=self.obj('guide','impact','--base',base,'--precision','py')['stub_analysis']
        self.assertEqual(c['source'],'project-stub')

    def test_symlinked_template_target_is_refused(self):
        outside=self.work/'external';outside.mkdir()
        (self.project/'tools').symlink_to(outside,target_is_directory=True)
        result=self.dairn('stubs','init','--template','go','--apply',pass_required=False)
        self.assertNotEqual(result.returncode,0)
        self.assertFalse((outside/'dairn').exists())

    def test_split_protected_signing_and_wrong_scope(self):
        self.dairn('work','start','Implement authentication feature','--id','auth')
        (self.project/'grill.json').write_text(json.dumps({'schema':1,'task_id':'auth','questions':[
            {'id':'q1','prompt':'Which token lifetime fits the threat model?',
             'recommendation':'Short-lived signed token','status':'resolved',
             'decision':'Short-lived signed token, rotated on login'}]}))
        for path,kind in [('README.md','note'),('grill.json','grill'),('README.md','spec'),('README.md','note')]:
            self.dairn('work','record','auth',path,'--kind',kind)
            self.dairn('work','advance','auth')
        base=self.commit()
        (self.project/'auth.go').write_text('package hello\nfunc VerifyToken(s string) bool {return len(s)>0}\n')
        self.exec('gofmt','-w','auth.go')
        head=self.commit('auth change')
        external=self.work/'external-keys';external.mkdir()
        priv=external/'key.pem';pub=external/'pub.pem'
        self.exec('openssl','genpkey','-algorithm','ED25519','-out',priv)
        self.exec('openssl','pkey','-in',priv,'-pubout','-out',pub)
        env={
            'GITLAB_CI':'true','CI_PIPELINE_SOURCE':'push','CI_COMMIT_REF_PROTECTED':'true',
            'CI_COMMIT_BRANCH':'main','CI_DEFAULT_BRANCH':'main','CI_COMMIT_SHA':head,
            'CI_JOB_ID':'100','CI_PIPELINE_ID':'200','CI_PROJECT_PATH':'sample/project',
            'DAIRN_CI_BIN':str(CLI),'DAIRN_CI_APE_PATH':str(ROOT/'runtime/dairn-embedded.com'),
            'DAIRN_EXPECTED_APE_SHA256':hashlib.sha256((ROOT/'runtime/dairn-embedded.com').read_bytes()).hexdigest(),
            'DAIRN_EXPECTED_RUNTIME_SHA256':json.loads((self.project/'.dairn/lock.json').read_text())['runtime_sha256'],
            'DAIRN_EXPECTED_POLICY_SHA256':hashlib.sha256((self.project/'.dairn/governance/project.json').read_bytes()).hexdigest(),
            'DAIRN_SIGNING_PRIVATE_KEY_PATH':str(priv),'DAIRN_TRUSTED_CI_PUBLIC_KEY':str(pub),
        }
        build=ROOT/'ci/protected/build-protected.sh'
        sign=ROOT/'ci/protected/sign-protected.sh'
        # Signer refuses running without same-pipeline evidence.
        self.assertNotEqual(self.exec(sign,'auth',base,env=env,pass_required=False).returncode,0)
        self.assertNotEqual(self.exec(sign,'auth',base,env={**env,'CI_PIPELINE_SOURCE':'merge_request_event'},pass_required=False).returncode,0)
        self.assertNotEqual(self.exec(sign,'auth',base,env={**env,'DAIRN_EXPECTED_APE_SHA256':'0'*64},pass_required=False).returncode,0)
        keyless={k:v for k,v in env.items() if k not in ('DAIRN_SIGNING_PRIVATE_KEY_PATH','DAIRN_TRUSTED_CI_PUBLIC_KEY')}
        self.exec(build,'auth',base,env=keyless)
        origin=self.project/'.dairn/governance/evidence/ci-build-origin.json'
        saved=origin.read_text()
        bad=json.loads(saved);bad['pipeline_id']='wrong'
        origin.write_text(json.dumps(bad))
        self.assertNotEqual(self.exec(sign,'auth',base,env=env,pass_required=False).returncode,0)
        origin.write_text(saved)
        # Remove project language toolchain PATH from signer: it must not run Go tests.
        self.exec(sign,'auth',base,env={**env,'PATH':'/usr/bin:/bin'})
        trust={'DAIRN_TRUSTED_CI_PUBLIC_KEY':str(pub),'DAIRN_TRUSTED_CI_PROVIDER':'gitlab',
            'DAIRN_TRUSTED_CI_REPOSITORY':'sample/project','DAIRN_TRUSTED_CI_REF':'refs/heads/main',
            'DAIRN_TRUSTED_CI_WORKFLOW':'200/dairn:sign','DAIRN_TRUSTED_CI_BUILD_JOB_ID':'100',
            'DAIRN_TRUSTED_CI_PIPELINE_ID':'200','DAIRN_REQUIRE_CI_CONTEXT':'true'}
        self.dairn('work','verify','auth','--require-ci-attestation',env=trust)
        wrong={**trust,'DAIRN_TRUSTED_CI_REPOSITORY':'evil/project'}
        self.assertNotEqual(self.dairn('work','verify','auth','--require-ci-attestation',env=wrong,pass_required=False).returncode,0)
        ledger=json.loads((self.project/'.dairn/work/auth.json').read_text())
        self.assertEqual(ledger['stages'][4]['machine_runs'][-1]['status'],'passed')
        self.assertEqual(len(ledger['ci_attestations']),1)
        self.assertNotIn('check --task',sign.read_text())

if __name__=='__main__':
    unittest.main(verbosity=2)
