"""项目根 launcher 与 vendored runtime：init 载荷复制、doctor 报告、缺失运行时与迁移。

新契约：项目根 `dairn`/`dairn.cmd` 是唯一受管启动器，解析顺序为
DAIRN_RUNTIME -> 启动器同目录 `.dairn/runtime/dairn-embedded.com` -> exit 2。
init/adopt/upgrade 通过 DAIRN_RUNTIME_DIR 载荷把运行时复制到项目，旧
`.dairn/bin/dairn*` 受管启动器在 upgrade --apply 时退役。
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / 'dairn'

CLEAN_ENV = ('DAIRN_RUNTIME', 'DAIRN_RUNTIME_SOURCE', 'DAIRN_RUNTIME_DIR')


def clean_env(extra=None):
    env = {key: value for key, value in os.environ.items() if key not in CLEAN_ENV}
    env.update(extra or {})
    return env


class ProjectLauncher(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='dairn-launcher-')
        self.addCleanup(self.tmp.cleanup)
        self.work = Path(self.tmp.name)
        self.root = self.work / 'project'
        self.ok('init', '--path', self.root, '--name', 'launcher_test', '--stack', 'python', '--ci', 'none')

    def call(self, *args, env=None):
        return subprocess.run([str(CLI), *map(str, args)], cwd=self.work,
                              env=clean_env(env), capture_output=True, text=True,
                              encoding='utf-8', errors='replace', timeout=180)

    def ok(self, *args, env=None):
        result = self.call(*args, env=env)
        self.assertEqual(result.returncode, 0, result.stdout + '\n' + result.stderr)
        return result

    def obj(self, *args, env=None):
        return json.loads(self.ok(*args, env=env).stdout)

    def launcher_config(self):
        return json.loads((self.root / '.dairn/launcher.json').read_text(encoding='utf-8'))

    def project_launcher_version(self, path='', env=None, cwd=None):
        # 项目根 `dairn` 是 /bin/sh 脚本；PATH 传空串时启动器会恢复内置最小系统 PATH，
        # 以支持 APE 的 sh 加载器（且不会依赖全局安装的 dairn）。
        return subprocess.run(['/bin/sh', 'dairn', 'version'], cwd=cwd or self.root,
                              env=clean_env({'PATH': path, **(env or {})}),
                              capture_output=True, text=True, encoding='utf-8', errors='replace',
                              timeout=120)

    def install_payload(self):
        """把构建运行时放进可复用的载荷目录，并返回其路径。inspectRuntimePayload 只读。"""
        source = ROOT / 'runtime/dairn-embedded.com'
        integrity_source = ROOT / 'runtime/runtime-integrity.json'
        self.assertTrue(source.is_file(), 'missing build runtime: ' + str(source))
        self.assertTrue(integrity_source.is_file(), 'missing runtime integrity: ' + str(integrity_source))
        payload = self.work / 'payload'
        payload.mkdir()
        shutil.copyfile(source, payload / 'dairn-embedded.com')
        shutil.copyfile(integrity_source, payload / 'runtime-integrity.json')
        os.chmod(payload / 'dairn-embedded.com', 0o755)
        return payload

    def test_init_writes_root_project_launcher_and_vendors_payload_runtime(self):
        # 从仓库根启动器 init：载荷（仓库 .dairn/runtime 快照）被复制进新项目。
        self.assertTrue((self.root / 'dairn').is_file())
        self.assertTrue((self.root / 'dairn.cmd').is_file())
        self.assertFalse((self.root / '.dairn/bin/dairn').exists())
        self.assertTrue((self.root / '.dairn/runtime/dairn-embedded.com').is_file())
        self.assertTrue((self.root / '.dairn/runtime/runtime-integrity.json').is_file())
        config = self.launcher_config()
        self.assertEqual(config['mode'], 'vendored')
        self.assertEqual(config['runtime']['path'], '.dairn/runtime/dairn-embedded.com')
        self.assertEqual(config['launcher'], 'dairn')
        self.assertEqual(config['windows_launcher'], 'dairn.cmd')
        declared = json.loads((self.root / '.dairn/runtime/runtime-integrity.json')
                              .read_text(encoding='utf-8'))['sha256']
        self.assertEqual(config['runtime']['sha256'], declared)
        doctor = self.obj('doctor', '--json', '--root', self.root)
        self.assertEqual(doctor['status'], 'ready', doctor.get('problems'))
        self.assertEqual(doctor['launcher']['resolved'], 'dairn')
        self.assertEqual(doctor['launcher']['mode'], 'vendored')
        self.assertTrue(doctor['invocation'])
        self.assertIn('doctor', doctor['invocation'])
        version = self.project_launcher_version('')
        self.assertEqual(version.returncode, 0, version.stdout + '\n' + version.stderr)
        self.assertIn('Dairn ', version.stdout)

    def test_missing_runtime_reports_dairn_not_available(self):
        shutil.rmtree(self.root / '.dairn/runtime')
        result = self.project_launcher_version('/nonexistent')
        self.assertEqual(result.returncode, 2, result.stdout + '\n' + result.stderr)
        self.assertIn('DAIRN_NOT_AVAILABLE', result.stderr)
        self.assertIn('.dairn/runtime/dairn-embedded.com', result.stderr)

    def test_vendor_runtime_registers_and_executes_offline(self):
        payload = self.install_payload()
        runtime_dir = self.root / '.dairn/runtime'
        shutil.rmtree(runtime_dir)
        runtime_dir.mkdir()
        binary = runtime_dir / 'dairn-embedded.com'
        integrity = runtime_dir / 'runtime-integrity.json'
        shutil.copyfile(payload / 'dairn-embedded.com', binary)
        shutil.copyfile(payload / 'runtime-integrity.json', integrity)
        os.chmod(binary, 0o755)
        self.ok('upgrade', '--vendor-runtime', '.dairn/runtime', '--apply', '--root', self.root)
        config = self.launcher_config()
        self.assertEqual(config['mode'], 'vendored')
        declared = json.loads(integrity.read_text(encoding='utf-8'))['sha256']
        self.assertEqual(config['runtime']['sha256'], declared)
        self.assertEqual(config['runtime']['path'], '.dairn/runtime/dairn-embedded.com')
        doctor = self.obj('doctor', '--json', '--root', self.root)
        self.assertEqual(doctor['status'], 'ready', doctor.get('problems'))
        self.assertEqual(doctor['launcher']['mode'], 'vendored')
        result = self.project_launcher_version('')
        self.assertEqual(result.returncode, 0, result.stdout + '\n' + result.stderr)
        self.assertIn('Dairn ', result.stdout)
        # 篡改 vendored 二进制后，doctor 必须发现摘要不符并非零退出。
        data = bytearray(binary.read_bytes())
        data[len(data) // 2] ^= 0xff
        binary.write_bytes(bytes(data))
        broken = self.call('doctor', '--json', '--root', self.root)
        self.assertNotEqual(broken.returncode, 0, broken.stdout + '\n' + broken.stderr)
        combined = (broken.stdout + broken.stderr).lower()
        self.assertTrue('sha256' in combined or 'mismatch' in combined, broken.stdout + '\n' + broken.stderr)

    def test_init_inside_extracted_release_reuses_payload_without_copy(self):
        """ZIP 解压目录（dairn、dairn.cmd、LICENSE、.dairn/runtime）可直接 init 展开治理文件。"""
        payload = self.install_payload()
        release = self.work / 'release'
        runtime_dir = release / '.dairn/runtime'
        runtime_dir.mkdir(parents=True)
        shutil.copyfile(payload / 'dairn-embedded.com', runtime_dir / 'dairn-embedded.com')
        shutil.copyfile(payload / 'runtime-integrity.json', runtime_dir / 'runtime-integrity.json')
        os.chmod(runtime_dir / 'dairn-embedded.com', 0o755)
        shutil.copyfile(ROOT / 'dairn', release / 'dairn')
        shutil.copyfile(ROOT / 'dairn.cmd', release / 'dairn.cmd')
        shutil.copyfile(ROOT / 'LICENSE', release / 'LICENSE')
        binary_before = (runtime_dir / 'dairn-embedded.com').read_bytes()
        result = subprocess.run([str(release / 'dairn'), 'init', '--name', 'release_demo',
                                 '--stack', 'python', '--ci', 'none'],
                                cwd=release, env=clean_env({'PATH': ''}),
                                capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=180)
        self.assertEqual(result.returncode, 0, result.stdout + '\n' + result.stderr)
        config = json.loads((release / '.dairn/launcher.json').read_text(encoding='utf-8'))
        self.assertEqual(config['mode'], 'vendored')
        self.assertEqual((runtime_dir / 'dairn-embedded.com').read_bytes(), binary_before)
        self.assertTrue((release / '.dairn/runtime/runtime-integrity.json').is_file())
        self.assertTrue((release / 'AGENTS.md').is_file())
        version = subprocess.run(['/bin/sh', 'dairn', 'version'], cwd=release, env=clean_env({'PATH': ''}),
                                 capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=120)
        self.assertEqual(version.returncode, 0, version.stdout + '\n' + version.stderr)

    def test_init_refuses_nonempty_project_directory(self):
        target = self.work / 'existing'
        target.mkdir()
        (target / 'main.go').write_text('package main\n', encoding='utf-8')
        result = self.call('init', '--path', target, '--name', 'existing_demo', '--stack', 'python', '--ci', 'none')
        self.assertNotEqual(result.returncode, 0, result.stdout + '\n' + result.stderr)
        self.assertIn('adopt', (result.stdout + result.stderr).lower())

    def test_upgrade_retires_legacy_managed_launchers(self):
        # 模拟旧布局项目：受管启动器在 .dairn/bin/ 下，launcher.json 记录旧文件名。
        legacy = self.root / '.dairn/bin'
        legacy.mkdir()
        posix = b'#!/bin/sh\necho legacy\n'
        win = b'@echo off\r\necho legacy\r\n'
        (legacy / 'dairn').write_bytes(posix)
        (legacy / 'dairn.cmd').write_bytes(win)
        lock_path = self.root / '.dairn/lock.json'
        lock = json.loads(lock_path.read_text(encoding='utf-8'))
        lock['managed']['.dairn/bin/dairn'] = hashlib.sha256(posix).hexdigest()
        lock['managed']['.dairn/bin/dairn.cmd'] = hashlib.sha256(win).hexdigest()
        lock_path.write_text(json.dumps(lock, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
        config_path = self.root / '.dairn/launcher.json'
        config = json.loads(config_path.read_text(encoding='utf-8'))
        config['launcher'] = '.dairn/bin/dairn'
        config['windows_launcher'] = '.dairn/bin/dairn.cmd'
        config_path.write_text(json.dumps(config, indent=2) + '\n', encoding='utf-8')
        plan = self.obj('upgrade', '--plan', '--root', self.root)
        removed = {action['path'] for action in plan['actions'] if action['status'] == 'remove'}
        self.assertEqual(removed, {'.dairn/bin/dairn', '.dairn/bin/dairn.cmd'})
        self.ok('upgrade', '--apply', '--root', self.root)
        self.assertFalse((legacy / 'dairn').exists())
        self.assertFalse((legacy / 'dairn.cmd').exists())
        config = self.launcher_config()
        self.assertEqual(config['launcher'], 'dairn')
        self.assertEqual(config['windows_launcher'], 'dairn.cmd')
        result = self.project_launcher_version('')
        self.assertEqual(result.returncode, 0, result.stdout + '\n' + result.stderr)


if __name__ == '__main__':
    unittest.main()
