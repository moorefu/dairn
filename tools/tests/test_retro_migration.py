"""真实旧草案迁移不继承批准或验证声明，也不覆盖输入与已有输出。"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]


class RetroMigration(unittest.TestCase):
    def test_legacy_draft_migrates_to_insufficient_evidence_without_authority(self):
        with tempfile.TemporaryDirectory() as directory:
            source=Path(directory)/'legacy.json';output=Path(directory)/'retro.json'
            source.write_text(json.dumps({'schema':1,'task_id':'legacy-task','observed':['真实旧草案记录'],'resolution':{'kind':'check','check':'unit','verified_red':True},'decision':{'status':'accepted','actor':'human'},'verification':{'passed':True}}),encoding='utf-8')
            original=source.read_bytes()
            argv=[sys.executable,str(ROOT/'tools/migrate-retro-draft.py'),str(source),'--out',str(output),'--repository','org/repo','--base','a'*40,'--head','b'*40]
            # 在所有宿主重现 Windows 管道的非 UTF-8 环境，工具仍应输出可读 UTF-8。
            env={**os.environ,'PYTHONUTF8':'0','PYTHONIOENCODING':'cp1252:strict'}
            migrated=subprocess.run(argv,capture_output=True,text=True,encoding='utf-8',env=env)
            self.assertEqual(migrated.returncode,0,migrated.stdout+migrated.stderr)
            self.assertIn('已迁移为证据不足记录',migrated.stdout)
            doc=json.loads(output.read_text(encoding='utf-8'))
            self.assertEqual(doc['schema'],'dairn.retro.v1')
            self.assertEqual(doc['status'],'insufficient-evidence')
            self.assertEqual(doc['findings'],[])
            self.assertEqual(doc['extensions']['legacy_sha256'],hashlib.sha256(original).hexdigest())
            self.assertNotIn('decision',doc);self.assertNotIn('verification',doc)
            self.assertNotIn('verified_red',output.read_text(encoding='utf-8').split('migration_reason')[0])
            self.assertEqual(source.read_bytes(),original)
            saved=output.read_bytes()
            repeated=subprocess.run(argv,capture_output=True,text=True,encoding='utf-8',env=env)
            self.assertNotEqual(repeated.returncode,0)
            self.assertEqual(output.read_bytes(),saved)
            self.assertEqual(source.read_bytes(),original)


if __name__=='__main__':unittest.main()
