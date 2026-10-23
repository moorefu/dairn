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
        # v1 subject 的 repository 从 remote 推导，须与 CI_PROJECT_PATH 一致。
        self.git('remote','add','origin','https://gitlab.com/sample/project.git')
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
            'DAIRN_EVIDENCE_DIR':str(self.project/'.dairn/governance/evidence'),
        }
        build=ROOT/'ci/protected/build-protected.sh'
        sign=ROOT/'ci/protected/sign-protected.sh'
        # Signer refuses running without same-pipeline evidence.
        self.assertNotEqual(self.exec(sign,env=env,pass_required=False).returncode,0)
        self.assertNotEqual(self.exec(sign,env={**env,'CI_PIPELINE_SOURCE':'merge_request_event'},pass_required=False).returncode,0)
        self.assertNotEqual(self.exec(sign,env={**env,'DAIRN_EXPECTED_APE_SHA256':'0'*64},pass_required=False).returncode,0)
        keyless={k:v for k,v in env.items() if k not in ('DAIRN_SIGNING_PRIVATE_KEY_PATH','DAIRN_TRUSTED_CI_PUBLIC_KEY')}
        self.exec(build,base,env=keyless)
        origin=self.project/'.dairn/governance/evidence/ci-build-origin.json'
        saved=origin.read_text()
        bad=json.loads(saved);bad['pipeline_id']='wrong'
        origin.write_text(json.dumps(bad))
        self.assertNotEqual(self.exec(sign,env=env,pass_required=False).returncode,0)
        origin.write_text(saved)
        # Remove project language toolchain PATH from signer: it must not run Go tests.
        self.exec(sign,env={**env,'PATH':'/usr/bin:/bin'})
        # The signed statement verifies against the external public key and binds
        # the same-pipeline context; a foreign scope is refused.
        statement=self.project/'.dairn/governance/evidence/statement.json'
        self.assertTrue(statement.is_file())
        context=self.project/'.dairn/governance/evidence/ci-context.json'
        context.write_text(json.dumps({'provider':'gitlab','repository':'sample/project','workflow_ref':'refs/heads/main',
            'pipeline_id':'200','build_job_id':'100','source_commit':head,'event':'push'}))
        def attest_verify(ctx, pass_required=False):
            # 预期拒绝的场合（foreign context）由调用方的 assertNotEqual 判定，
            # exec 内不得先按 returncode==0 断言。
            return self.dairn('attest','verify','--statement','.dairn/governance/evidence/statement.json',
                '--signature','.dairn/governance/evidence/statement.json.sig','--key',str(pub),
                '--context',str(ctx) if str(ctx).startswith('/') else '.dairn/governance/evidence/'+str(ctx),
                pass_required=pass_required)
        self.assertEqual(attest_verify(context,pass_required=True).returncode,0)
        foreign=self.project/'.dairn/governance/evidence/foreign-context.json'
        foreign.write_text(json.dumps({'provider':'gitlab','repository':'evil/project','workflow_ref':'refs/heads/main',
            'pipeline_id':'200','build_job_id':'100','source_commit':head,'event':'push'}))
        self.assertNotEqual(attest_verify(foreign).returncode,0)
        ledger=json.loads((self.project/'.dairn/work/auth.json').read_text())
        self.assertEqual(ledger['stages'][4]['machine_runs'],[])
        self.assertNotIn('check --task',sign.read_text())
        self.assertNotIn('work verify',build.read_text())

    def test_publisher_real_verification_and_evidence_ref_append(self):
        # T38/T39: the keyless publisher must perform real Ed25519 verification,
        # bind the bundle subject to the checkout HEAD and the CI origin, refuse
        # unsafe member paths, append fast-forward only, and read back.
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
            'DAIRN_EVIDENCE_DIR':str(self.project/'.dairn/governance/evidence'),
        }
        keyless={k:v for k,v in env.items() if k not in ('DAIRN_SIGNING_PRIVATE_KEY_PATH','DAIRN_TRUSTED_CI_PUBLIC_KEY')}
        self.exec(ROOT/'ci/protected/build-protected.sh',base,env=keyless)
        self.exec(ROOT/'ci/protected/sign-protected.sh',env=env)
        # Stand-in protected evidence ref: a local bare repository.
        bare=self.work/'evidence-origin.git'
        self.exec('git','init','--bare','-q',str(bare),cwd=self.work)
        seed=self.work/'evidence-seed'
        self.exec('git','clone','-q',str(bare),str(seed),cwd=self.work)
        self.exec('git','checkout','-q','-b','dairn-evidence',cwd=seed)
        self.exec('git','config','user.name','seed',cwd=seed)
        self.exec('git','config','user.email','seed@example.test',cwd=seed)
        self.exec('git','commit','-q','--allow-empty','-m','seed',cwd=seed)
        self.exec('git','push','-q','origin','dairn-evidence',cwd=seed)
        # The signed statement/origin were minted under the https remote; only
        # the publisher-facing transport switches to the local evidence ref.
        self.git('remote','set-url','origin',str(bare))
        publish=ROOT/'ci/protected/publish-evidence.sh'
        pub_env={k:v for k,v in env.items() if k!='DAIRN_SIGNING_PRIVATE_KEY_PATH'}
        statement=self.project/'.dairn/governance/evidence/statement.json'
        saved_statement=statement.read_text()
        bundle=self.project/'.dairn/governance/evidence/bundle.json'
        saved_bundle=bundle.read_text()
        # T38 negative 1: tampered statement bytes fail real Ed25519 verification.
        statement.write_text(saved_statement.replace('"pipeline_id":"200"','"pipeline_id":"999"'))
        self.assertNotEqual(self.exec(publish,env=pub_env,pass_required=False).returncode,0)
        statement.write_text(saved_statement)
        # T38 negative 2: bundle minted for another commit is refused before signing input matters.
        forged=json.loads(saved_bundle)
        forged['run']['subject']['source_commit']='9'*40
        bundle.write_text(json.dumps(forged))
        self.assertNotEqual(self.exec(publish,env=pub_env,pass_required=False).returncode,0)
        # T38 negative 3: an origin recorded for a different commit refuses to publish.
        origin=self.project/'.dairn/governance/evidence/ci-build-origin.json'
        saved_origin=origin.read_text()
        bad_origin=json.loads(saved_origin);bad_origin['source_commit']='9'*40
        origin.write_text(json.dumps(bad_origin))
        self.assertNotEqual(self.exec(publish,env=pub_env,pass_required=False).returncode,0)
        origin.write_text(saved_origin)
        # T39 negative: traversal member path is refused by evidence verification.
        evil=json.loads(saved_bundle)
        evil['files']['escape']={'path':'../outside.txt','sha256':'0'*64}
        bundle.write_text(json.dumps(evil))
        self.assertNotEqual(self.exec(publish,env=pub_env,pass_required=False).returncode,0)
        # T39 negative: a member path with spaces exists and hashes correctly,
        # but the publisher's strict POSIX whitelist must still refuse it
        # (word splitting must never decide which files get published).
        spaced_file=self.project/'.dairn/governance/evidence/with space.txt'
        spaced_file.write_text('x\n')
        spaced=json.loads(saved_bundle)
        spaced['files']['spaced']={'path':'.dairn/governance/evidence/with space.txt',
            'sha256':hashlib.sha256(b'x\n').hexdigest()}
        bundle.write_text(json.dumps(spaced))
        self.assertNotEqual(self.exec(publish,env=pub_env,pass_required=False).returncode,0)
        bundle.write_text(saved_bundle)
        # Success path: append to the protected ref and read back the signature.
        self.exec(publish,env=pub_env)
        listing=self.exec('git','ls-tree','-r','--name-only','origin/dairn-evidence').stdout
        self.assertIn('statement.sig',listing)
        run_id=json.loads(saved_bundle)['run']['run_id']
        self.assertIn(f'evidence/runs/{head}/{run_id}/statement.sig',listing)
        # Re-publishing the same run must be refused (append-only, no overwrite).
        self.assertNotEqual(self.exec(publish,env=pub_env,pass_required=False).returncode,0)

if __name__=='__main__':
    unittest.main(verbosity=2)
