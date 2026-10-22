"""Windows 原生入口和门禁回归；需要 Node，Go 工具链测试另行记录。"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / 'dairn.cmd'
NODE = shutil.which('node')


@unittest.skipUnless(os.name == 'nt', '仅适用于 Windows')
class WindowsAcceptance(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='dairn Windows 中文 ')
        self.root = Path(self.temp.name) / '项目 空格'

    def tearDown(self):
        self.temp.cleanup()

    def run_cli(self, *args):
        return subprocess.run([str(CLI), *map(str, args)], capture_output=True,
                              encoding='utf-8', errors='replace', timeout=45)

    def init(self):
        result = self.run_cli('init', '--root', self.root, '--name', 'windows_test', '--stack', 'go', '--sample')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def configure(self, script):
        self.init()
        config = self.root / '.dairn/governance/project.json'
        data = json.loads(config.read_text(encoding='utf-8'))
        for check in data['modules'][0]['checks'].values():
            check['argv'] = [NODE, '-e', script]
        config.write_text(json.dumps(data), encoding='utf-8')

    def evidence(self):
        return json.loads((self.root / '.dairn/governance/evidence/all-qjs-checks.json').read_text(encoding='utf-8'))

    def test_exit_status(self):
        self.assertEqual(self.run_cli('version').returncode, 0)
        self.assertEqual(self.run_cli('invalid-command').returncode, 2)

    def test_unicode_spaces_and_project_lifecycle(self):
        self.init()
        for command in ['validate', 'detect', 'doctor']:
            result = self.run_cli(command, '--root', self.root)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        for file in ['AGENTS.md', '.dairn/lock.json']:
            self.assertTrue((self.root / file).exists())

    def test_real_subprocess_gates(self):
        self.configure("require('node:assert/strict').ok(require('node:fs').existsSync('go.mod')); console.log('实际子进程执行成功')")
        result = self.run_cli('check', '--all', '--root', self.root, '--timeout', '5')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual([x['status'] for x in self.evidence()['checks']], ['passed'] * 4)
        self.assertEqual(self.evidence()['assurance'], 'technical-checks-only')

    def test_nonzero_gate_is_recorded(self):
        self.configure('process.exit(13)')
        result = self.run_cli('check', '--all', '--root', self.root, '--timeout', '5')
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertEqual([x['returncode'] for x in self.evidence()['checks']], [13] * 4)

    def test_git_scope_uses_windows_path_lookup(self):
        self.init()
        for args in [('init', '-q'), ('config', 'user.name', 'Dairn Test'),
                     ('config', 'user.email', 'dairn-test@example.invalid'),
                     ('add', '.'), ('commit', '-qm', 'baseline')]:
            subprocess.run(['git', *args], cwd=self.root, capture_output=True, check=True)
        base = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=self.root, text=True).strip()
        result = self.run_cli('scope', '--base', base, '--root', self.root)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(json.loads(result.stdout)['paths'], [])

    def test_timeout_is_recorded(self):
        self.configure('setTimeout(()=>{}, 10000)')
        result = self.run_cli('check', '--all', '--root', self.root, '--timeout', '1')
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertTrue(all(x['timed_out'] and x['returncode'] is None for x in self.evidence()['checks']))

    def test_junction_cannot_escape_project(self):
        self.init()
        outside = Path(self.temp.name) / 'outside'
        outside.mkdir()
        (outside / 'child').mkdir()
        junction = self.root / 'linked'
        made = subprocess.run(['cmd.exe', '/d', '/c', 'mklink', '/J', str(junction), str(outside)], capture_output=True)
        self.assertEqual(made.returncode, 0, made.stderr)
        try:
            config = self.root / '.dairn/governance/project.json'
            data = json.loads(config.read_text(encoding='utf-8'))
            for check in data['modules'][0]['checks'].values():
                check.update(argv=[NODE, '-e', 'process.exit(0)'], cwd='linked/child')
            config.write_text(json.dumps(data), encoding='utf-8')
            result = self.run_cli('check', '--all', '--root', self.root, '--timeout', '5')
            self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertTrue(all('目录联接或符号链接' in x.get('reason', '') for x in self.evidence()['checks']))
        finally:
            junction.rmdir()


if __name__ == '__main__':
    unittest.main()
