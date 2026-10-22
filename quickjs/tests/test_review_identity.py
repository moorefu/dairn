"""Review 证据的 self-asserted actor 与 --require-review-actor 门禁。"""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]
CLI=ROOT/'dairn.sh'

class ReviewIdentity(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='dairn-review-identity-')
        self.addCleanup(self.tmp.cleanup)
        self.work=Path(self.tmp.name)
        self.root=self.work/'project'
        self.ok('init','--path',self.root,'--stack','go','--sample')
        self.ok('work','start','Review login change','--id','auth','--root',self.root)
        self.ok('work','record','auth','README.md','--kind','note','--root',self.root)
        self.ok('work','advance','auth','--root',self.root)
        self.git('init','-q')
        self.git('config','user.email','test@example.com')
        self.git('config','user.name','Tester')
        self.git('add','.')
        self.git('commit','-qm','baseline')
        self.head=self.git('rev-parse','HEAD')

    def call(self,*args,env=None):
        return subprocess.run([str(CLI),*map(str,args)],cwd=self.work,
                              env={**os.environ,**(env or {})},capture_output=True,text=True,timeout=120)

    def ok(self,*args,env=None):
        result=self.call(*args,env=env)
        self.assertEqual(result.returncode,0,result.stdout+'\n'+result.stderr)
        return result

    def obj(self,*args,env=None):
        return json.loads(self.ok(*args,env=env).stdout)

    def git(self,*args):
        return subprocess.run(['git',*args],cwd=self.root,capture_output=True,text=True,check=True).stdout.strip()

    def verify(self,*extra,env=None):
        return self.call('work','verify','auth','--json',*extra,'--root',self.root,env=env)

    def write_review(self,name,**extra):
        data={'standards':'pass','spec_fidelity':'not-applicable','head':self.head}
        data.update(extra)
        (self.root/name).write_text(json.dumps(data)+'\n')
        return name

    def test_review_actor_is_recorded_and_reported(self):
        self.write_review('review-alice.json',actor='alice')
        self.ok('work','record','auth','review-alice.json','--kind','review','--root',self.root)
        verify=self.obj('work','verify','auth','--json','--root',self.root)
        self.assertIsNotNone(verify['review'])
        self.assertEqual(verify['review']['actor'],'alice')
        self.assertIn('self-asserted',verify['review']['assurance'])
        self.assertFalse(verify['review_actor_required'])
        self.assertEqual(verify['evidence_errors'],[])

    def test_require_review_actor_fails_without_actor_and_env_actor_is_used(self):
        self.write_review('review-noactor.json')
        self.ok('work','record','auth','review-noactor.json','--kind','review','--root',self.root)
        missing=self.verify('--require-review-actor')
        self.assertNotEqual(missing.returncode,0)
        missing_report=json.loads(missing.stdout)
        self.assertTrue(any('actor' in error for error in missing_report['evidence_errors']),
                        missing_report['evidence_errors'])
        self.write_review('review-bob.json')
        self.ok('work','record','auth','review-bob.json','--kind','review','--root',self.root,
                env={'DAIRN_ACTOR':'bob'})
        verified=self.obj('work','verify','auth','--json','--require-review-actor','--root',self.root)
        self.assertTrue(verified['review_actor_required'])
        self.assertEqual(verified['review']['actor'],'bob')
        self.assertEqual(verified['evidence_errors'],[])

if __name__=='__main__':unittest.main()
