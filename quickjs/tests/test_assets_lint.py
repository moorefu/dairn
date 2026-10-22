"""分发资产 lint：`dairn docs check` 发布门禁与 docs 检索回归。"""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]
CLI=[str(ROOT/'dairn.sh')] if sys.platform=='win32' else ['/bin/sh',str(ROOT/'dairn.sh')]

class AssetsLint(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='dairn-assets-lint-')
        self.addCleanup(self.tmp.cleanup)
        self.work=Path(self.tmp.name)

    def call(self,*args):
        return subprocess.run([*CLI,*map(str,args)],cwd=self.work,capture_output=True,text=True,timeout=120)

    def test_docs_check_reports_clean_embedded_assets(self):
        result=self.call('docs','check','--json')
        self.assertEqual(result.returncode,0,result.stdout+'\n'+result.stderr)
        report=json.loads(result.stdout)
        self.assertEqual(report['schema'],1)
        self.assertGreaterEqual(report['stats']['specs'],20,report['stats'])
        self.assertGreaterEqual(report['stats']['skills'],8,report['stats'])
        self.assertEqual(report['errors'],[],report['errors'])
        human=self.call('docs','check')
        self.assertEqual(human.returncode,0,human.stdout+'\n'+human.stderr)
        self.assertIn('PASS',human.stdout)

    def test_docs_find_resolves_authoritative_spec_id(self):
        result=self.call('docs','find','risk')
        self.assertEqual(result.returncode,0,result.stdout+'\n'+result.stderr)
        self.assertIn('dairn.governance.risk',result.stdout)

if __name__=='__main__':unittest.main()
