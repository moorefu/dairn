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
        # Windows 索引器/杀软可能短暂持有刚删除的项目目录；teardown 失败不应
        # 把功能测试记为失败（临时目录位于 ci/temp，最终由验收脚本统一清理）。
        self.temp = tempfile.TemporaryDirectory(prefix='dairn Windows 中文 ',
                                                ignore_cleanup_errors=True)
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
        # Non-Git projects have no attestable subject, so check writes an
        # execution audit record instead of a dairn.check-run.v1 run.
        records = sorted((self.root / '.dairn/governance/evidence').glob('execution-*.json'))
        self.assertTrue(records, 'no execution record written')
        return json.loads(records[-1].read_text(encoding='utf-8'))

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

    def test_nonzero_gate_is_recorded(self):
        self.configure('process.exit(13)')
        result = self.run_cli('check', '--all', '--root', self.root, '--timeout', '5')
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertEqual([x['exit_code'] for x in self.evidence()['checks']], [13] * 4)

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
        self.assertTrue(all(x['timed_out'] and x['exit_code'] is None for x in self.evidence()['checks']))

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

    def run_launcher(self, *args, env=None, cwd=None):
        launcher = (cwd or self.root) / '.dairn/bin/dairn.cmd'
        command = ['cmd.exe', '/d', '/c', str(launcher), *map(str, args)]
        return subprocess.run(command, cwd=cwd or self.root, env=env or os.environ,
                              capture_output=True, encoding='utf-8', errors='replace', timeout=90)

    def system_path_env(self):
        env = {**os.environ, 'PATH': str(Path(os.environ['SystemRoot']) / 'System32')}
        env.pop('DAIRN_BIN', None)
        return env

    def test_project_launcher_files_doctor_and_vendored_offline_run(self):
        runtime = ROOT / 'runtime/dairn-embedded.com'
        integrity = ROOT / 'runtime/runtime-integrity.json'
        if not runtime.exists() or not integrity.exists():
            self.skipTest('build runtime/ first (python tools/build.py)')
        self.init()
        for relative in ['.dairn/bin/dairn', '.dairn/bin/dairn.cmd', '.dairn/launcher.json', '.dairn/.gitattributes']:
            self.assertTrue((self.root / relative).is_file(), relative)
        config = json.loads((self.root / '.dairn/launcher.json').read_text(encoding='utf-8'))
        self.assertEqual(config['mode'], 'external')
        self.assertIsNone(config['runtime'])
        doctor = self.run_cli('doctor', '--root', self.root)
        self.assertEqual(doctor.returncode, 0, doctor.stdout + doctor.stderr)
        report = json.loads(doctor.stdout)
        self.assertEqual(report['status'], 'ready')
        self.assertIn('.dairn/bin/dairn', report['launcher']['resolved'])
        self.assertEqual(report['launcher']['mode'], 'external')
        self.assertIn('doctor', report['invocation'])
        # DAIRN_BIN 覆盖解析顺序（指向可执行 CLI，而不是裸 APE）。
        overridden = self.run_launcher('version', env={**os.environ, 'DAIRN_BIN': str(CLI)})
        self.assertEqual(overridden.returncode, 0, overridden.stdout + overridden.stderr)
        self.assertIn('Dairn ', overridden.stdout)
        # 注册 vendored 运行时后，PATH 中没有 dairn 也能离线执行。
        target = self.root / '.dairn/runtime'
        target.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(runtime, target / 'dairn-embedded.com')
        shutil.copyfile(integrity, target / 'runtime-integrity.json')
        registered = self.run_cli('upgrade', '--vendor-runtime', '.dairn/runtime', '--apply', '--root', self.root)
        self.assertEqual(registered.returncode, 0, registered.stdout + registered.stderr)
        config = json.loads((self.root / '.dairn/launcher.json').read_text(encoding='utf-8'))
        self.assertEqual(config['mode'], 'vendored')
        self.assertEqual(config['runtime']['path'], '.dairn/runtime/dairn-embedded.com')
        declared = json.loads(integrity.read_text(encoding='utf-8'))['sha256']
        self.assertEqual(config['runtime']['sha256'], declared)
        offline = self.run_launcher('version', env=self.system_path_env())
        self.assertEqual(offline.returncode, 0, offline.stdout + offline.stderr)
        self.assertIn('Dairn ', offline.stdout)
        doctor = self.run_cli('doctor', '--root', self.root)
        self.assertEqual(doctor.returncode, 0, doctor.stdout + doctor.stderr)
        report = json.loads(doctor.stdout)
        self.assertEqual(report['launcher']['mode'], 'vendored')
        self.assertEqual(report['launcher']['runtime']['path'], '.dairn/runtime/dairn-embedded.com')

    def test_project_launcher_missing_runtime_reports_dairn_not_found(self):
        self.init()
        result = self.run_launcher('version', env=self.system_path_env())
        self.assertEqual(result.returncode, 127, result.stdout + result.stderr)
        self.assertIn('dairn not found', result.stderr.lower())
        self.assertIn('DAIRN_NOT_AVAILABLE', result.stderr)

    def test_launcher_managed_hashes_survive_autocrlf_clone(self):
        self.init()
        for args in [('init', '-q'), ('config', 'user.name', 'Dairn Test'),
                     ('config', 'user.email', 'dairn-test@example.invalid'),
                     ('add', '.'), ('commit', '-qm', 'baseline')]:
            subprocess.run(['git', *args], cwd=self.root, capture_output=True, check=True)
        clone = Path(self.temp.name) / '克隆 项目'
        subprocess.run(['git', '-c', 'core.autocrlf=true', 'clone', '-q', str(self.root), str(clone)],
                       capture_output=True, check=True)
        self.assertIn(b'\r\n', (clone / '.dairn/bin/dairn.cmd').read_bytes())
        result = self.run_cli('validate', '--root', clone)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
