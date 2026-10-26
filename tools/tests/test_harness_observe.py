"""CLI 根本没有启动时，独立 Harness 仍能保存尝试失败；不读取会话正文。"""
from concurrent.futures import ThreadPoolExecutor
import datetime
import importlib.util
import json
from pathlib import Path
import tempfile
import subprocess
import sys
import os
import unittest

ROOT = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location('harness_observe', ROOT / 'quickjs/assets/templates/project/hooks/observe-adapter.py')
adapter = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(adapter)


class HarnessObserve(unittest.TestCase):
    def test_safe_task_bindings_are_preserved_without_changing_assurance(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'.dairn').mkdir();(root/'.dairn/lock.json').write_text('{}')
            bindings={'task_id':'same-task','subject_commit':'a'*40,'worktree_snapshot_sha256':'b'*64,'policy_sha256':'c'*64,'plan_sha256':'d'*64,'toolchain_sha256':'e'*64,'runtime_sha256':'f'*64}
            adapter.emit(root,'dsh','failed','inv-task',code=127,bindings=bindings)
            event=json.loads(next((root/'.dairn/observe/events').rglob('*.jsonl')).read_text())
            self.assertEqual(event['correlation']['task_id'],'same-task')
            self.assertEqual(event['correlation']['subject_commit'],'a'*40)
            self.assertEqual(event['runtime']['sha256'],'f'*64)
            self.assertEqual(event['source']['assurance'],'harness-reported')
            for invalid in ({**bindings,'task_id':'/Users/private/task'},{**bindings,'subject_commit':'abc'},{**bindings,'policy_sha256':['c'*64]}):
                with self.assertRaises(ValueError):adapter.emit(root,'dsh','failed','inv-invalid',bindings=invalid)

    def test_retention_preserves_unknown_files_and_recent_events(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            now = datetime.datetime(2026, 10, 25, tzinfo=datetime.timezone.utc)
            old = base / '2026-09-01'
            old.mkdir()
            (old / 'event.jsonl').write_text('{}\n')
            (old / 'team-notes.txt').write_text('保留团队文件')
            recent = base / '2026-10-25'
            recent.mkdir()
            (recent / 'active.part').write_text('{}\n')
            with self.assertRaisesRegex(ValueError, '未知内容'):
                adapter.expire_events(base, now)
            self.assertTrue((old / 'event.jsonl').exists())
            (old / 'team-notes.txt').unlink()
            adapter.expire_events(base, now)
            self.assertFalse(old.exists())
            self.assertTrue((recent / 'active.part').exists())

    def test_entry_failure_without_cli_and_parallel_writers(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / '.dairn').mkdir()
            (root / '.dairn/lock.json').write_text('{}')
            with ThreadPoolExecutor(max_workers=4) as pool:
                results = list(pool.map(lambda n: adapter.emit(root, 'dsh', 'failed', 'inv-' + str(n),
                    code=127, session='private-session', operation='raw-secret-token'), range(12)))
            self.assertEqual(len({r['event_id'] for r in results}), 12)
            files = list((root / '.dairn/observe/events').rglob('*.jsonl'))
            self.assertEqual(len(files), 12)
            for file in files:
                raw = file.read_text()
                event = json.loads(raw)
                self.assertEqual(event['kind'], 'launcher.attempt.failed')
                self.assertEqual(event['outcome']['exit_code'], 127)
                self.assertEqual(event['operation'], 'unknown')
                self.assertNotIn('private-session', raw)
                self.assertNotIn('raw-secret-token', raw)
                self.assertFalse((root / 'dairn').exists())

    @unittest.skipIf(os.name=='nt','POSIX Hook 脚本在 Unix 执行，Windows 留给 Git Bash 实机验收')
    def test_installed_codex_bridge_needs_no_work_and_ignores_prompt(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)/'project'
            cli=ROOT/'dairn'
            env={**os.environ,'DAIRN_RUNTIME':os.environ['DAIRN_TEST_RUNTIME']}
            for args in (['init','--stack','python','--name','hook_fixture'],['hooks','install','--apply']):
                result=subprocess.run([str(cli),*args,'--root',str(root)],cwd=ROOT,env=env,capture_output=True,text=True,timeout=90)
                self.assertEqual(result.returncode,0,result.stdout+result.stderr)
            payload=json.dumps({'thread-id':'private-session','last-assistant-message':'private-prompt'})
            result=subprocess.run(['/bin/sh',str(root/'.dairn/hooks/observe-codex.sh'),payload],cwd=directory,env=env,capture_output=True,text=True,timeout=30)
            self.assertEqual(result.returncode,0,result.stdout+result.stderr)
            self.assertEqual(json.loads(result.stdout)['status'],'recorded')
            records=list((root/'.dairn/observe/events').rglob('*.jsonl'))
            self.assertTrue(any('harness.turn-end' in p.read_text() for p in records))
            self.assertFalse(any('private-prompt' in p.read_text() for p in records))

            report=subprocess.run([str(cli),'observe','report','--json','--root',str(root)],cwd=directory,env=env,capture_output=True,text=True,timeout=30)
            self.assertEqual(report.returncode,0,report.stdout+report.stderr)
            self.assertEqual(json.loads(report.stdout)['coverage']['partial_files'],0)
