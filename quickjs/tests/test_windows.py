"""Windows 原生入口和门禁回归；Go 工具链测试另行记录。"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / 'dairn.cmd'
QJS = os.environ.get('DAIRN_QJS_BIN') or str(ROOT / 'runtime/dairn-embedded.com')


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
                              env={**os.environ, 'GIT_CEILING_DIRECTORIES': self.temp.name},
                              encoding='utf-8', errors='replace', timeout=45)

    def init(self):
        result = self.run_cli('init', '--root', self.root, '--name', 'windows_test', '--stack', 'go', '--sample')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def configure(self, script):
        self.init()
        config = self.root / '.dairn/governance/project.json'
        data = json.loads(config.read_text(encoding='utf-8'))
        for check in data['modules'][0]['checks'].values():
            check['argv'] = [QJS, '-m', '-e', script]
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
        self.configure("import * as os from 'os'; import * as std from 'std'; if(os.stat('go.mod')[1]!==0)throw Error('go.mod 不存在'); print('实际子进程执行成功'); std.exit(0)")
        result = self.run_cli('check', '--all', '--root', self.root, '--timeout', '5')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual([x['status'] for x in self.evidence()['checks']], ['passed'] * 4)

    def test_nonzero_gate_is_recorded(self):
        self.configure("import * as std from 'std'; std.exit(13)")
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
        self.configure("import * as os from 'os'; os.sleep(10000)")
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
                check.update(argv=[QJS, '-m', '-e', "import * as std from 'std'; std.exit(0)"], cwd='linked/child')
            config.write_text(json.dumps(data), encoding='utf-8')
            result = self.run_cli('check', '--all', '--root', self.root, '--timeout', '5')
            self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertTrue(all('目录联接或符号链接' in x.get('reason', '') for x in self.evidence()['checks']))
        finally:
            junction.rmdir()

    def run_launcher(self, *args, env=None, cwd=None):
        # 唯一启动器在项目根：dairn.cmd（Windows），不再有 .dairn/bin 第二层。
        launcher = (cwd or self.root) / 'dairn.cmd'
        command = ['cmd.exe', '/d', '/c', str(launcher), *map(str, args)]
        clean = {key: value for key, value in os.environ.items() if not key.startswith('DAIRN_RUNTIME')}
        clean.update(env or {})
        return subprocess.run(command, cwd=cwd or self.root, env=clean,
                              capture_output=True, encoding='utf-8', errors='replace', timeout=90)

    def system_path_env(self):
        env = {**os.environ, 'PATH': str(Path(os.environ['SystemRoot']) / 'System32')}
        for key in list(env):
            if key.startswith('DAIRN_RUNTIME') or key == 'DAIRN_BIN':
                env.pop(key, None)
        return env

    def test_project_launcher_vendored_doctor_and_offline_run(self):
        runtime = ROOT / 'runtime/dairn-embedded.com'
        integrity = ROOT / 'runtime/runtime-integrity.json'
        if not runtime.exists() or not integrity.exists():
            self.skipTest('build runtime/ first (python tools/build.py)')
        self.init()
        # 唯一启动器在项目根；init 从当前运行载荷（DAIRN_RUNTIME_DIR）复制 vendored 运行时。
        for relative in ['dairn', 'dairn.cmd', '.dairn/launcher.json', '.dairn/.gitattributes',
                         '.dairn/runtime/dairn-embedded.com', '.dairn/runtime/runtime-integrity.json']:
            self.assertTrue((self.root / relative).is_file(), relative)
        self.assertFalse((self.root / '.dairn/bin/dairn').exists())
        self.assertFalse((self.root / '.dairn/bin/dairn.cmd').exists())
        config = json.loads((self.root / '.dairn/launcher.json').read_text(encoding='utf-8'))
        self.assertEqual(config['mode'], 'vendored')
        self.assertEqual(config['launcher'], 'dairn')
        self.assertEqual(config['windows_launcher'], 'dairn.cmd')
        self.assertEqual(config['runtime']['path'], '.dairn/runtime/dairn-embedded.com')
        declared = json.loads((self.root / '.dairn/runtime/runtime-integrity.json').read_text(encoding='utf-8'))['sha256']
        self.assertEqual(config['runtime']['sha256'], declared)
        doctor = self.run_cli('doctor', '--root', self.root)
        self.assertEqual(doctor.returncode, 0, doctor.stdout + doctor.stderr)
        report = json.loads(doctor.stdout)
        self.assertEqual(report['status'], 'ready')
        self.assertEqual(report['launcher']['resolved'], 'dairn')
        self.assertEqual(report['launcher']['mode'], 'vendored')
        self.assertIn('doctor', report['invocation'])
        # PATH 中没有 dairn 时也能离线执行项目自带运行时。
        offline = self.run_launcher('version', env=self.system_path_env())
        self.assertEqual(offline.returncode, 0, offline.stdout + offline.stderr)
        self.assertIn('Dairn ', offline.stdout)
        # DAIRN_RUNTIME 覆盖解析顺序（指向构建产物，而不是项目快照）。
        overridden = self.run_launcher('version', env={'DAIRN_RUNTIME': str(runtime)})
        self.assertEqual(overridden.returncode, 0, overridden.stdout + overridden.stderr)
        self.assertIn('Dairn ', overridden.stdout)

    def test_project_launcher_missing_runtime_reports_clear_error(self):
        self.init()
        first = self.run_launcher('version', env=self.system_path_env())
        self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
        for name in ('dairn-embedded.com', 'runtime-integrity.json'):
            (self.root / '.dairn/runtime' / name).unlink()
        missing = self.run_launcher('version', env=self.system_path_env())
        self.assertEqual(missing.returncode, 2, missing.stdout + missing.stderr)
        self.assertIn('DAIRN_NOT_AVAILABLE', missing.stderr)
        self.assertIn('.dairn', missing.stderr)
        self.assertIn('dairn-embedded.com', missing.stderr)

    def test_vendored_launcher_preserves_nonzero_exit(self):
        self.init()
        result = self.run_launcher('invalid-command', env=self.system_path_env())
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)

    def test_launcher_managed_hashes_survive_autocrlf_clone(self):
        self.init()
        for args in [('init', '-q'), ('config', 'user.name', 'Dairn Test'),
                     ('config', 'user.email', 'dairn-test@example.invalid'),
                     ('add', '.'), ('commit', '-qm', 'baseline')]:
            subprocess.run(['git', *args], cwd=self.root, capture_output=True, check=True)
        clone = Path(self.temp.name) / '克隆 项目'
        subprocess.run(['git', '-c', 'core.autocrlf=true', 'clone', '-q', str(self.root), str(clone)],
                       capture_output=True, check=True)
        # 受管启动器在项目根：POSIX 版 LF，Windows 版 CRLF；二进制运行时不受换行转换影响。
        self.assertNotIn(b'\r\n', (clone / 'dairn').read_bytes())
        self.assertIn(b'\r\n', (clone / 'dairn.cmd').read_bytes())
        result = self.run_cli('validate', '--root', clone)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
