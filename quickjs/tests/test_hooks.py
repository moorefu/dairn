"""Agent hooks：安装、turn-end 会话锚点与 pre-push 本地门禁。"""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]
CLI=ROOT/'dairn.sh'

class Hooks(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='dairn-hooks-')
        self.addCleanup(self.tmp.cleanup)
        self.work=Path(self.tmp.name)
        self.root=self.work/'project'
        self.ok('init','--path',self.root,'--stack','go','--sample')
        self.git('init','-q')
        self.git('config','user.email','test@example.com')
        self.git('config','user.name','Tester')
        self.git('add','.')
        self.git('commit','-qm','baseline')

    def call(self,*args):
        return subprocess.run([str(CLI),*map(str,args)],cwd=self.work,capture_output=True,text=True,timeout=180)

    def ok(self,*args):
        result=self.call(*args)
        self.assertEqual(result.returncode,0,result.stdout+'\n'+result.stderr)
        return result

    def obj(self,*args):return json.loads(self.ok(*args).stdout)

    def git(self,*args):
        return subprocess.run(['git',*args],cwd=self.root,capture_output=True,text=True,check=True).stdout.strip()

    def advance_to_implement(self):
        (self.root/'grill.json').write_text(json.dumps({'schema':1,'task_id':'auth','questions':[
            {'id':'q1','prompt':'Which token lifetime fits the threat model?',
             'recommendation':'Short-lived signed token','status':'resolved',
             'decision':'Short-lived signed token, rotated on login'}]})+'\n')
        self.ok('work','start','Implement authentication feature','--id','auth','--root',self.root)
        for path,kind in [('README.md','note'),('grill.json','grill'),('README.md','spec'),('README.md','note')]:
            self.ok('work','record','auth',path,'--kind',kind,'--root',self.root)
            self.ok('work','advance','auth','--root',self.root)
        self.assertEqual(self.obj('work','next','auth','--root',self.root)['current_stage'],'implement')

    def test_hooks_install_turn_end_and_early_pre_push(self):
        plan=self.obj('hooks','install','--root',self.root)
        self.assertFalse(plan['apply'])
        self.assertEqual(plan['applied'],0)
        self.assertFalse((self.root/'.dairn/hooks/pre-push').exists())
        applied=self.obj('hooks','install','--apply','--root',self.root)
        self.assertGreaterEqual(applied['applied'],4)
        for name in ('pre-push','turn-end.sh','turn-end-codex.sh','turn-end-dsh.sh','README.md'):
            self.assertTrue((self.root/'.dairn/hooks'/name).is_file(),name)
        installed=self.obj('hooks','install','--apply','--git','--root',self.root)
        self.assertIn('.git/hooks/pre-push',[action['path'] for action in installed['actions']])
        self.assertTrue((self.root/'.git/hooks/pre-push').is_file())
        self.assertIn('.dairn/hooks/pre-push',(self.root/'.git/hooks/pre-push').read_text())
        self.ok('work','start','Implement authentication feature','--id','auth','--root',self.root)
        anchor=self.obj('hook','turn-end','--task','auth','--provider','claude',
                        '--session','test-session-1','--root',self.root)
        self.assertEqual(anchor['task'],'auth')
        self.assertEqual(anchor['provider'],'claude')
        self.assertEqual(anchor['session_id'],'test-session-1')
        self.assertEqual(anchor['head'],self.git('rev-parse','HEAD'))
        self.assertTrue((self.root/anchor['anchor']).is_file())
        ledger=json.loads((self.root/'.dairn/work/auth.json').read_text())
        self.assertEqual(len(ledger['session_anchors']),1)
        verify=self.obj('work','verify','auth','--root',self.root)
        self.assertEqual(verify['session_anchors'],1)
        self.assertEqual(verify['evidence_errors'],[])
        strict=self.obj('work','verify','auth','--require-session-anchor','--root',self.root)
        self.assertTrue(strict['session_anchor_required'])
        early=self.ok('hook','pre-push','--no-check','--base',self.git('rev-parse','HEAD'),'--root',self.root)
        self.assertIn('pre-push PASS',early.stdout)

    def test_pre_push_runs_real_checks_after_task_check(self):
        self.advance_to_implement()
        base=self.git('rev-parse','HEAD')
        hello=self.root/'hello.go'
        hello.write_text(hello.read_text()+'\nfunc TokenValid(token string) bool {\n\treturn len(token) > 0\n}\n')
        self.git('add','hello.go')
        self.git('commit','-qm','add token validation')
        self.ok('check','--root',self.root,'--base',base,'--task','auth')
        prepush=self.ok('hook','pre-push','--base',base,'--root',self.root)
        self.assertIn('pre-push PASS',prepush.stdout)

if __name__=='__main__':unittest.main()
