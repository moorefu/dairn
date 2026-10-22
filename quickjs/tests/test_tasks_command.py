"""任务切片账本：`dairn tasks check|ready` 的 DAG、写域重叠与 validate 复用。"""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]
CLI=ROOT/'dairn.sh'

class TasksCommand(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='dairn-tasks-')
        self.addCleanup(self.tmp.cleanup)
        self.work=Path(self.tmp.name)
        self.root=self.work/'project'
        self.ok('init','--path',self.root,'--stack','go','--sample')
        self.dir=self.root/'.dairn/governance/tasks'

    def call(self,*args):
        return subprocess.run([str(CLI),*map(str,args)],cwd=self.work,capture_output=True,text=True,timeout=120)

    def ok(self,*args):
        result=self.call(*args)
        self.assertEqual(result.returncode,0,result.stdout+'\n'+result.stderr)
        return result

    def obj(self,*args):return json.loads(self.ok(*args).stdout)

    def write_task(self,task_id,**extra):
        data={'id':task_id,'title':'Slice '+task_id,'acceptance':'User-visible behavior is verified.',
              'status':'ready','blocked_by':[]}
        data.update(extra)
        (self.dir/(task_id+'.json')).write_text(json.dumps(data)+'\n')

    def test_cycle_fails_tasks_check_and_validate(self):
        self.write_task('TASK-a',blocked_by=['TASK-b'])
        self.write_task('TASK-b',blocked_by=['TASK-a'])
        result=self.call('tasks','check','--json','--root',self.root)
        self.assertEqual(result.returncode,2,result.stdout+'\n'+result.stderr)
        report=json.loads(result.stdout)
        self.assertEqual(report['schema'],1)
        self.assertTrue(any('cycle' in error for error in report['errors']),report['errors'])
        validated=self.call('validate','--root',self.root)
        self.assertNotEqual(validated.returncode,0)
        self.assertIn('cycle',validated.stderr)

    def test_overlap_and_missing_metadata_are_warnings(self):
        self.write_task('TASK-a',status='in-progress',write_scopes=['src/auth'],test_seams=['auth login'])
        self.write_task('TASK-b',status='in-progress',write_scopes=['src/auth/token.go'],test_seams=['token rotates'])
        self.write_task('TASK-c')
        result=self.call('tasks','check','--json','--root',self.root)
        self.assertEqual(result.returncode,0,result.stdout+'\n'+result.stderr)
        report=json.loads(result.stdout)
        self.assertEqual(report['errors'],[])
        self.assertTrue(any('write scope overlap' in warning for warning in report['warnings']),report['warnings'])
        self.assertTrue(any('missing test_seams' in warning for warning in report['warnings']),report['warnings'])
        self.assertTrue(report['overlaps'])
        strict=self.call('tasks','check','--strict','--root',self.root)
        self.assertEqual(strict.returncode,2,strict.stdout+'\n'+strict.stderr)

    def test_ready_frontier_unblocks_after_predecessor_done(self):
        self.write_task('TASK-a',status='in-progress')
        self.write_task('TASK-b',blocked_by=['TASK-a'])
        report=self.obj('tasks','ready','--json','--root',self.root)
        self.assertEqual(report['ready'],[])
        self.assertEqual([item['id'] for item in report['blocked']],['TASK-b'])
        self.assertEqual(report['blocked'][0]['waiting_on'],['TASK-a'])
        self.write_task('TASK-a',status='done')
        report=self.obj('tasks','ready','--json','--root',self.root)
        self.assertEqual(report['ready'],['TASK-b'])
        self.assertEqual(report['blocked'],[])
        self.ok('validate','--root',self.root)

if __name__=='__main__':unittest.main()
