"""grill 阶段门禁：open 问题阻止 advance；resolved 后进入 implement 并跑真实 check --task。"""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]
CLI=ROOT/'dairn.sh'

class GrillWorkflow(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='dairn-grill-')
        self.addCleanup(self.tmp.cleanup)
        self.work=Path(self.tmp.name)
        self.root=self.work/'project'
        self.ok('init','--path',self.root,'--stack','go','--sample')

    def call(self,*args):
        return subprocess.run([str(CLI),*map(str,args)],cwd=self.work,capture_output=True,text=True,timeout=180)

    def ok(self,*args):
        result=self.call(*args)
        self.assertEqual(result.returncode,0,result.stdout+'\n'+result.stderr)
        return result

    def obj(self,*args):return json.loads(self.ok(*args).stdout)

    def git(self,*args):
        return subprocess.run(['git',*args],cwd=self.root,capture_output=True,text=True,check=True).stdout.strip()

    def write_grill(self,status):
        question={'id':'q1','prompt':'How should the authentication token be persisted?',
                  'recommendation':'Use a short-lived signed token.','status':status}
        if status=='resolved':question['decision']='Short-lived signed token, no server-side session.'
        (self.root/'grill.json').write_text(json.dumps({'schema':1,'task_id':'auth','questions':[question]})+'\n')

    def advance_to_implement(self):
        self.write_grill('resolved')
        self.ok('work','start','Implement authentication feature','--id','auth','--root',self.root)
        for path,kind in [('README.md','note'),('grill.json','grill'),('README.md','spec'),('README.md','note')]:
            self.ok('work','record','auth',path,'--kind',kind,'--root',self.root)
            self.ok('work','advance','auth','--root',self.root)
        self.assertEqual(self.obj('work','next','auth','--root',self.root)['current_stage'],'implement')

    def test_recommend_change_routes_grill_before_specify(self):
        report=json.loads(self.ok('workflow','recommend','实现登录记住我功能').stdout)
        self.assertEqual(report['classification'],'change')
        stage_ids=[stage['id'] for stage in report['stages']]
        skills=[stage['skill'] for stage in report['stages']]
        self.assertIn('grill',stage_ids)
        self.assertIn('specify',stage_ids)
        self.assertLess(stage_ids.index('grill'),stage_ids.index('specify'))
        self.assertIn('dairn-grill',skills)
        self.assertLess(skills.index('dairn-grill'),skills.index('dairn-change-plan'))

    def test_open_grill_blocks_advance_then_resolved_unblocks(self):
        self.ok('work','start','Implement authentication feature','--id','auth','--root',self.root)
        self.ok('work','record','auth','README.md','--kind','note','--root',self.root)
        self.ok('work','advance','auth','--root',self.root)
        self.write_grill('open')
        self.ok('work','record','auth','grill.json','--kind','grill','--root',self.root)
        blocked=self.call('work','advance','auth','--root',self.root)
        self.assertNotEqual(blocked.returncode,0)
        self.assertIn('open questions',blocked.stderr)
        self.write_grill('resolved')
        self.ok('work','record','auth','grill.json','--kind','grill','--root',self.root)
        advanced=self.obj('work','advance','auth','--root',self.root)
        self.assertEqual(advanced['next']['id'],'specify')

    def test_skip_grill_advances_to_specify_with_reason(self):
        self.ok('work','start','Implement authentication feature','--id','auth','--root',self.root)
        self.ok('work','record','auth','README.md','--kind','note','--root',self.root)
        self.ok('work','advance','auth','--root',self.root)
        skipped=self.obj('work','skip','auth','--reason','Mechanical L0 change with no design decisions','--root',self.root)
        self.assertEqual(skipped['stage'],'grill')
        self.assertEqual(skipped['next']['id'],'specify')
        ledger=json.loads((self.root/'.dairn/work/auth.json').read_text())
        self.assertEqual(ledger['skips'][0]['stage'],'grill')
        self.assertEqual(ledger['stages'][1]['status'],'skipped')

    def test_implement_check_task_attaches_passing_run(self):
        self.advance_to_implement()
        self.git('init','-q')
        self.git('config','user.email','test@example.com')
        self.git('config','user.name','Tester')
        self.git('add','.')
        self.git('commit','-qm','baseline')
        base=self.git('rev-parse','HEAD')
        hello=self.root/'hello.go'
        hello.write_text(hello.read_text()+'\nfunc TokenValid(token string) bool {\n\treturn len(token) > 0\n}\n')
        self.git('add','hello.go')
        self.git('commit','-qm','add token validation')
        result=self.ok('check','--root',self.root,'--base',base,'--task','auth')
        self.assertIn('Attached task run',result.stdout)
        task=json.loads((self.root/'.dairn/work/auth.json').read_text())
        runs=task['stages'][4]['machine_runs']
        self.assertEqual([run['status'] for run in runs],['passed'])
        verified=self.obj('work','verify','auth','--require-machine-gates','--root',self.root)
        self.assertTrue(verified['machine_gates_required'])
        self.assertEqual(verified['evidence_errors'],[])
        advanced=self.obj('work','advance','auth','--root',self.root)
        self.assertEqual(advanced['next']['id'],'review')

if __name__=='__main__':unittest.main()
