"""check 审计日志：每个 gate 的原始输出落盘、可复核且失败原因可见。"""
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]
CLI=ROOT/'dairn.sh'

class AuditLogs(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='dairn-audit-')
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

    def evidence(self):
        runs=sorted((self.root/'.dairn/governance/evidence/runs').glob('*/*/run.json'))
        self.assertTrue(runs,'no v1 run evidence written')
        return json.loads(runs[-1].read_text(encoding='utf-8'))

    def resolve(self,relative):
        path=Path(relative)
        return path if path.is_absolute() else self.root/path

    def assert_gate_logs(self,run):
        logs_dir=self.resolve(run['execution']['logs_dir'])
        self.assertTrue(logs_dir.is_dir(),run['execution']['logs_dir'])
        non_empty=[]
        for check in run['checks']:
            for key in ('log','log_sha256','log_truncated'):
                self.assertIn(key,check,check)
            self.assertRegex(check['log_sha256'],r'^[0-9a-f]{64}$')
            log_path=self.resolve(check['log'])
            self.assertTrue(log_path.is_file(),check['log'])
            self.assertTrue(str(log_path).startswith(str(logs_dir)),check['log'])
            content=log_path.read_text(encoding='utf-8',errors='replace')
            self.assertEqual(check['log_sha256'],hashlib.sha256(content.encode('utf-8')).hexdigest(),check['log'])
            if content.strip():non_empty.append(check['id'])
        self.assertTrue(non_empty,'expected at least one non-empty gate log')
        return non_empty

    def test_check_all_writes_one_log_per_gate(self):
        result=self.call('check','--all','--root',self.root)
        self.assertEqual(result.returncode,0,result.stdout+'\n'+result.stderr)
        run=self.evidence()
        self.assertEqual(len(run['checks']),4)
        self.assert_gate_logs(run)

    def test_failed_gate_log_keeps_failure_text(self):
        (self.root/'hello.go').write_text('package hello\n\nfunc Greeting()string{return"hello"}\n')
        result=self.call('check','--all','--root',self.root)
        self.assertEqual(result.returncode,1,result.stdout+'\n'+result.stderr)
        run=self.evidence()
        self.assert_gate_logs(run)
        lint=next(check for check in run['checks'] if check['id']=='lint')
        self.assertNotEqual(lint['status'],'passed')
        content=self.resolve(lint['log']).read_text(encoding='utf-8',errors='replace')
        self.assertTrue(content.strip())
        lowered=content.lower()
        self.assertTrue('gofmt' in lowered or 'unformatted' in lowered,content[:500])

if __name__=='__main__':unittest.main()
