"""验证 Linux 编排的执行覆盖与失败传播，不启动完整平台回归。"""
from collections import Counter
from contextlib import redirect_stdout
import io
import json
import os
from pathlib import Path
import runpy
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from check_catalog import required_ids


class LinuxVerification(unittest.TestCase):
    def exercise(self, failed_stage=None, regression_outcome=None, evidence=True):
        executed = []
        script = Path(__file__).resolve().parents[1] / 'verify-linux.py'
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'tools').mkdir()
            candidate=root/'.build/runs/fixture/runtime'
            candidate.mkdir(parents=True)
            payload = candidate/'dairn-embedded.com'
            payload.write_bytes('测试载荷'.encode())
            import hashlib
            (candidate/'runtime-integrity.json').write_text(json.dumps({
                'binary': payload.name, 'sha256': hashlib.sha256(payload.read_bytes()).hexdigest()}))
            target = root / 'tools/verify-linux.py'
            shutil.copyfile(script, target)
            out = root / 'out'

            def run(argv, **kwargs):
                code, stdout = 0, b'{}'
                if 'tools/check-source.py' in argv:
                    stage = argv[-1]
                    executed.extend(required_ids(stage))
                    code = int(stage == failed_stage)
                elif str(argv[-1]).endswith('.mjs'):
                    executed.append('native.' + Path(argv[-1]).stem)
                return subprocess.CompletedProcess(argv, code, stdout, b'')

            def load(names):
                executed.extend('python.assets-lint' if name.endswith('.test_assets_lint')
                                else name for name in names)
                if evidence:
                    (out / 'linux-python-checks.json').write_text('{"checks": []}')

                def regression():
                    if regression_outcome == 'fail':
                        self.fail('注入专项回归失败')
                    if regression_outcome == 'skip':
                        raise unittest.SkipTest('注入专项回归跳过')

                return unittest.TestSuite([unittest.FunctionTestCase(regression)])

            with patch.dict(os.environ, {'DAIRN_TEST_RUNTIME': str(payload)}), patch.object(sys, 'argv', [str(target), str(out)]), \
                    patch.object(sys, 'path', list(sys.path)), \
                    patch('subprocess.run', side_effect=run), \
                    patch('shutil.which', return_value='/工具'), \
                    patch.object(unittest.defaultTestLoader, 'loadTestsFromNames', side_effect=load), \
                    redirect_stdout(io.StringIO()), self.assertRaises(SystemExit) as result:
                runpy.run_path(str(target), run_name='__main__')
            summary = json.loads((out / 'linux-summary.json').read_text())
        return executed, result.exception.code, summary

    def test_each_check_executes_once_without_losing_linux_extras(self):
        executed, code, summary = self.exercise()
        self.assertEqual(code, 0)
        self.assertEqual([key for key, count in Counter(executed).items() if count > 1], [])
        extras = {
            'test_project_guidance', 'test_workflow_facts', 'test_work_intelligence',
            'test_grill_workflow', 'test_tasks_command', 'test_hooks', 'test_notes_seal',
            'test_launcher', 'test_audit_logs', 'test_review_identity', 'test_agent_protocol',
            'test_analyzer_ci_review', 'test_trusted_ci_analyzers', 'test_project_lifecycle',
            'test_handoff', 'test_governance_cli',
        }
        shared = {key for stage in ('lint', 'unit', 'integration') for key in required_ids(stage)}
        self.assertEqual(set(executed), shared | {'quickjs.tests.' + name for name in extras})
        self.assertIn('native.test_launcher_native', executed)
        self.assertTrue(summary['original_unchanged'])

    def test_shared_gate_failure_fails_linux_verification(self):
        for stage in ('lint', 'unit', 'integration'):
            with self.subTest(stage=stage):
                _, code, _ = self.exercise(failed_stage=stage)
                self.assertEqual(code, 1)

    def test_failed_skipped_or_missing_linux_evidence_cannot_pass(self):
        for options in ({'regression_outcome': 'fail'}, {'regression_outcome': 'skip'},
                        {'evidence': False}):
            with self.subTest(options=options):
                _, code, _ = self.exercise(**options)
                self.assertEqual(code, 1)
