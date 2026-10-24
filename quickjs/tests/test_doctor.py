"""doctor 必须以实际工具探测结果判定就绪状态。"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / ('dairn.cmd' if os.name == 'nt' else 'dairn.sh')


class Doctor(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='dairn-doctor-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'project'
        result = self.call('init', '--name', 'doctor_test', '--stack', 'python')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def call(self, *args, env=None):
        return subprocess.run([str(CLI), *args, '--root', str(self.root)],
                              env={**os.environ, **(env or {})}, capture_output=True,
                              encoding='utf-8', errors='replace', timeout=60)

    def test_missing_git_makes_doctor_unready(self):
        # 使用隔离的空 PATH，而不是依赖「解释器目录恰好没有 git」的平台假设。
        empty = Path(self.temp.name) / 'empty-bin'
        empty.mkdir()
        result = self.call('doctor', env={'PATH': str(empty)})
        report = json.loads(result.stdout)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertEqual(report['status'], 'unready')
        self.assertNotEqual(report['tools']['git'], 'available')
        self.assertTrue(any('git' in problem for problem in report['problems']))

    def test_unwritable_capture_directory_makes_doctor_unready(self):
        blocked = Path(self.temp.name) / 'not-a-directory'
        blocked.write_text('阻止将普通文件用作临时目录', encoding='utf-8')
        # APE 加载器也会使用 TMPDIR；在启动后注入，确保检查到宿主捕获路径。
        probe = Path(self.temp.name) / 'blocked-temp.mjs'
        probe.write_text(
            "import * as std from 'std';\n"
            "import {host} from '/zip/quickjs/host/qjs.mjs';\n"
            "import {dispatch} from '/zip/quickjs/core/project.mjs';\n"
            "for (const key of ['TMPDIR','TEMP','TMP']) std.setenv(key, " + json.dumps(str(blocked)) + ");\n"
            "std.exit(dispatch(host, " + json.dumps(['doctor', '--root', str(self.root)]) + "));\n",
            encoding='utf-8')
        runtime = str(ROOT / 'runtime/dairn-embedded.com')
        command = [runtime] if os.name == 'nt' else ['/bin/sh', runtime]
        result = subprocess.run([*command, str(probe)], capture_output=True,
                                encoding='utf-8', errors='replace', timeout=60)
        self.assertTrue(result.stdout.strip(), result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertEqual(report['status'], 'unready')
        self.assertTrue(report['problems'])
        self.assertIn(str(blocked).replace('\\', '/'), json.dumps(report).replace('\\\\', '/'))

    def test_default_temp_failure_uses_project_temp(self):
        blocked = Path(self.temp.name) / 'blocked-system-temp'
        blocked.write_text('模拟系统临时目录不可写', encoding='utf-8')
        result = self.call('doctor', env={'PATH': str(Path(sys.executable).parent),
                                        'TMPDIR': '', 'TEMP': str(blocked), 'TMP': str(blocked)})
        report = json.loads(result.stdout)
        self.assertEqual(report['tools']['python'], 'available', result.stdout + result.stderr)
        self.assertTrue((self.root / '.dairn/tmp').is_dir())
        self.assertNotIn('Cannot open command output', json.dumps(report))

    def test_doctor_probes_configured_python_interpreter(self):
        policy_path = self.root / '.dairn/governance/project.json'
        policy = json.loads(policy_path.read_text(encoding='utf-8'))
        for check in policy['modules'][0]['checks'].values():
            check['argv'] = ['python3', '--version']
        policy_path.write_text(json.dumps(policy), encoding='utf-8')
        result = self.call('doctor')
        report = json.loads(result.stdout)
        self.assertIn('python3', report['tools'])
        self.assertNotIn('python', report['tools'])


if __name__ == '__main__':
    unittest.main()
