"""验证 Python 启动器的实际执行、校验门禁及共享快速缓存；先构建运行时。"""
import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]
# 这些变量会让 dairn.sh 拒绝快速缓存；测试基环境统一剥离，负例再显式设置。
PROTECTED_CI_KEYS = ('GITHUB_ACTIONS', 'GITLAB_CI', 'DAIRN_PROTECTED_CI')
CACHE_ENTRIES = ['dairn-native', 'dairn-native.sha256']


@unittest.skipUnless((ROOT / 'runtime/dairn-embedded.com').is_file(), '请先构建运行时')
class PythonLauncherTests(unittest.TestCase):
    def setUp(self):
        temp_parent = ROOT / '.dairn/tmp'
        temp_parent.mkdir(parents=True, exist_ok=True)
        temporary = tempfile.TemporaryDirectory(prefix='dairn Python 启动 ', dir=str(temp_parent))
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.package = self.root / 'package'
        self.package.mkdir()
        shutil.copyfile(ROOT / 'src/dairn/cli.py', self.package / 'cli.py')
        shutil.copyfile(ROOT / 'dairn.sh', self.package / 'dairn.sh')
        shutil.copytree(ROOT / 'runtime', self.package / 'runtime')
        self.binary = self.package / 'runtime/dairn-embedded.com'
        self.checksum = hashlib.sha256(self.binary.read_bytes()).hexdigest()
        # CLI 版本来自内嵌运行时 manifest；标签构建会覆盖 package.json 的兜底版本。
        self.version = json.loads((self.package / 'runtime/runtime-integrity.json').read_text(
            encoding='utf-8'))['engine_version']
        self.cache = self.root / '共享 缓存'
        inherited = {key: value for key, value in os.environ.items() if key not in PROTECTED_CI_KEYS}
        self.env = {**inherited, 'PYTHONDONTWRITEBYTECODE': '1', 'PYTHONUTF8': '1', 'DAIRN_FAST_RUNTIME': '0',
                    'DAIRN_CACHE_HOME': str(self.cache)}

    def run_command(self, command, fast=False, env=None):
        return subprocess.run(list(map(str, command)), cwd=self.root,
                              env={**self.env, 'DAIRN_FAST_RUNTIME': '1' if fast else '0', **(env or {})},
                              capture_output=True, text=True, encoding='utf-8', timeout=60)

    def cli(self, *args, fast=False, env=None):
        return self.run_command([sys.executable, self.package / 'cli.py', *args], fast, env)

    def fast(self, *args, env=None):
        return self.cli(*args, fast=True, env=env)

    def version_fast(self, env=None):
        result = self.fast('version', env=env)
        self.assertEqual(result.returncode, 0, result.stdout + '\n' + result.stderr)
        self.assertTrue(result.stdout.startswith('Dairn ' + self.version + ' —'), result.stdout)
        return result

    @property
    def store(self):
        return self.cache / ('native-' + self.checksum)

    @property
    def native(self):
        return self.store / 'dairn-native'

    @property
    def metadata(self):
        return self.store / 'dairn-native.sha256'

    def mode(self, path):
        return path.stat().st_mode & 0o777

    def assert_cache_complete(self):
        self.assertTrue(self.store.is_dir(), '应存在快速缓存目录')
        self.assertEqual(sorted(path.name for path in self.store.iterdir()), CACHE_ENTRIES)
        self.assertEqual(self.mode(self.native), 0o700)
        self.assertEqual(self.mode(self.metadata), 0o600)
        expected = self.metadata.read_text(encoding='utf-8').strip()
        self.assertRegex(expected, r'^[0-9a-f]{64}$')
        self.assertEqual(hashlib.sha256(self.native.read_bytes()).hexdigest(), expected)
        self.assertFalse(self.native.is_symlink())
        self.assertFalse(self.metadata.is_symlink())

    def build_cache(self):
        self.version_fast()
        self.assert_cache_complete()
        return self.native

    def test_default_launch_and_exit_code_without_private_runtime_copy(self):
        result = self.cli('version')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(result.stdout.startswith('Dairn ' + self.version + ' —'), result.stdout)
        self.assertEqual(self.cli('invalid-command-for-test').returncode, 2)
        self.assertFalse(self.cache.exists(), '默认启动不得创建 Python 专属运行时副本')
        self.assertEqual(hashlib.sha256(self.binary.read_bytes()).hexdigest(), self.checksum)

    @unittest.skipIf(sys.platform == 'win32', 'POSIX 执行位修复验证')
    def test_missing_execute_bit_is_repaired_without_rewriting_content(self):
        self.binary.chmod(0o644)
        result = self.cli('version')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(result.stdout.startswith('Dairn ' + self.version + ' —'), result.stdout)
        self.assertTrue(self.binary.stat().st_mode & 0o111, '启动器必须补齐执行位')
        self.assertEqual(hashlib.sha256(self.binary.read_bytes()).hexdigest(), self.checksum)
        self.assertFalse(self.cache.exists())

    def test_corrupt_and_missing_runtime_are_rejected_before_launch(self):
        self.binary.write_bytes(self.binary.read_bytes() + b'corrupt')
        result = self.cli('version')
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn('运行时校验失败', result.stderr)
        self.binary.unlink()
        result = self.cli('version')
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn('拒绝执行无效运行时', result.stderr)
        self.assertNotIn('Traceback', result.stderr)
        self.assertFalse(self.cache.exists())

    @unittest.skipIf(sys.platform == 'win32', 'POSIX 共享快速运行时验证')
    def test_python_npm_and_shell_reuse_the_same_native_cache(self):
        node = shutil.which('node')
        if not node or not shutil.which('sha256sum'):
            self.skipTest('此项需要 Node 与 sha256sum')
        shutil.copytree(ROOT / 'bin', self.package / 'bin')
        result = self.version_fast()
        native = self.native
        self.assertTrue(native.is_file())
        before = native.read_bytes(), native.stat().st_mtime_ns
        for command in ([node, self.package / 'bin/dairn.cjs', 'version'],
                        ['/bin/sh', ROOT / 'dairn.sh', 'version']):
            with self.subTest(launcher=str(command[1])):
                other = self.run_command(command, fast=True)
                self.assertEqual(other.returncode, 0, other.stderr)
                self.assertEqual(other.stdout, result.stdout)
                self.assertEqual((native.read_bytes(), native.stat().st_mtime_ns), before)
        self.assertEqual(self.cli('invalid-command-for-test', fast=True).returncode, 2)
        self.assertEqual([p.name for p in self.cache.iterdir()], ['native-' + self.checksum])
        self.assertEqual(sorted(p.name for p in native.parent.iterdir()), CACHE_ENTRIES)
        self.assertFalse((native.parent / '.dairn-native.lock').exists())
        self.assertFalse(list(native.parent.glob('*.tmp')))
        self.assertEqual(hashlib.sha256(self.binary.read_bytes()).hexdigest(), self.checksum)

    @unittest.skipIf(sys.platform == 'win32', 'POSIX 快速缓存权限验证')
    def test_fast_cache_layout_and_reuse(self):
        if not shutil.which('sha256sum'):
            self.skipTest('此项需要 sha256sum')
        first = self.version_fast()
        self.assertEqual(self.mode(self.cache), 0o700, 'CACHE_ROOT 必须是 0700')
        self.assertEqual(self.mode(self.store), 0o700, 'CACHE 必须是 0700')
        self.assert_cache_complete()
        self.assertFalse(list(self.cache.glob('*.tmp')))
        before = (self.native.read_bytes(), self.native.stat().st_mtime_ns, self.native.stat().st_ino)
        second = self.version_fast()
        self.assertEqual(second.stdout, first.stdout)
        self.assertEqual((self.native.read_bytes(), self.native.stat().st_mtime_ns, self.native.stat().st_ino),
                         before, '二次启动必须复用缓存而不是重建')
        self.assert_cache_complete()
        # 快速路径同样必须透传 CLI 退出码。
        self.assertEqual(self.fast('invalid-command-for-test').returncode, 2)
        self.assert_cache_complete()
        self.assertEqual(hashlib.sha256(self.binary.read_bytes()).hexdigest(), self.checksum)

    @unittest.skipIf(sys.platform == 'win32', 'POSIX 快速缓存符号链接拒绝验证')
    def test_symlinked_cache_directories_are_refused(self):
        if not shutil.which('sha256sum'):
            self.skipTest('此项需要 sha256sum')
        # CACHE_ROOT 本身是符号链接时不得向其目标写入。
        evil_root = self.root / 'evil-cache-root'
        evil_root.mkdir()
        linked_root = self.root / 'linked-cache-root'
        linked_root.symlink_to(evil_root)
        self.version_fast(env={'DAIRN_CACHE_HOME': str(linked_root)})
        self.assertEqual(list(evil_root.iterdir()), [], 'CACHE_ROOT 符号链接的目标不得被写入')
        # CACHE 目录（native-<sha256>）是符号链接时同样回退源 APE。
        cache_root = self.root / 'real-cache-root'
        cache_root.mkdir()
        evil_cache = self.root / 'evil-cache-dir'
        evil_cache.mkdir()
        linked_cache = cache_root / ('native-' + self.checksum)
        linked_cache.symlink_to(evil_cache)
        self.version_fast(env={'DAIRN_CACHE_HOME': str(cache_root)})
        self.assertTrue(linked_cache.is_symlink(), '不得删除或跟随 CACHE 符号链接')
        self.assertEqual(list(evil_cache.iterdir()), [], 'CACHE 符号链接的目标不得被写入')
        self.assertEqual(hashlib.sha256(self.binary.read_bytes()).hexdigest(), self.checksum)

    @unittest.skipIf(sys.platform == 'win32', 'POSIX 快速缓存自愈验证')
    def test_tampered_native_is_rebuilt_and_never_executed(self):
        if not shutil.which('sha256sum'):
            self.skipTest('此项需要 sha256sum')
        self.build_cache()
        marker = self.root / '应由篡改文件写入 的标记'
        self.native.write_text('#!/bin/sh\ntouch ' + shlex.quote(str(marker)) + '\nexit 42\n', encoding='utf-8')
        self.native.chmod(0o700)
        self.version_fast()
        self.assertFalse(marker.exists(), '不得执行摘要校验失败的缓存文件')
        self.assert_cache_complete()
        self.assertEqual(self.mode(self.native), 0o700)
        self.assertFalse((self.store / '.dairn-native.lock').exists())
        self.assertFalse(list(self.store.glob('*.tmp')))
        self.assertEqual(hashlib.sha256(self.binary.read_bytes()).hexdigest(), self.checksum)

    @unittest.skipIf(sys.platform == 'win32', 'POSIX 快速缓存自愈验证')
    def test_tampered_metadata_is_rebuilt(self):
        if not shutil.which('sha256sum'):
            self.skipTest('此项需要 sha256sum')
        self.build_cache()
        self.metadata.write_text('0' * 64 + '\n', encoding='utf-8')
        self.metadata.chmod(0o600)
        self.version_fast()
        self.assert_cache_complete()
        self.assertNotEqual(hashlib.sha256(self.native.read_bytes()).hexdigest(), '0' * 64)

    @unittest.skipIf(sys.platform == 'win32', 'POSIX 符号链接攻击面验证')
    def test_symlinked_cache_entries_are_not_followed(self):
        if not shutil.which('sha256sum'):
            self.skipTest('此项需要 sha256sum')
        marker = self.root / '符号链接目标被执行的标记'
        evil = self.root / 'evil-native'
        evil.write_text('#!/bin/sh\ntouch ' + shlex.quote(str(marker)) + '\nexit 42\n', encoding='utf-8')
        evil.chmod(0o700)
        self.build_cache()
        self.native.unlink()
        self.native.symlink_to(evil)
        self.version_fast()
        self.assertFalse(marker.exists(), '不得执行符号链接指向的文件')
        self.assertTrue(evil.is_file(), '不得跟随符号链接删除其目标')
        self.assertFalse(self.native.is_symlink())
        self.assert_cache_complete()
        # META 被替换为符号链接时必须重建，且不得改写链接目标。
        evil_meta = self.root / 'evil-meta'
        evil_meta.write_text('1' * 64 + '\n', encoding='utf-8')
        self.metadata.unlink()
        self.metadata.symlink_to(evil_meta)
        self.version_fast()
        self.assertFalse(self.metadata.is_symlink())
        self.assertEqual(evil_meta.read_text(encoding='utf-8'), '1' * 64 + '\n')
        self.assert_cache_complete()

    @unittest.skipIf(sys.platform == 'win32', 'POSIX 陈旧锁恢复验证')
    def test_stale_lock_is_recovered(self):
        if not shutil.which('sha256sum'):
            self.skipTest('此项需要 sha256sum')
        self.store.mkdir(parents=True)
        lock = self.store / '.dairn-native.lock'
        lock.mkdir()
        old = time.time() - 15 * 60
        os.utime(lock, (old, old))
        self.version_fast()
        self.assert_cache_complete()
        self.assertFalse(lock.exists(), '陈旧锁必须被清理')

    @unittest.skipIf(sys.platform == 'win32', 'POSIX 活锁回退验证')
    def test_live_lock_falls_back_to_source_runtime(self):
        if not shutil.which('sha256sum'):
            self.skipTest('此项需要 sha256sum')
        self.store.mkdir(parents=True)
        lock = self.store / '.dairn-native.lock'
        lock.mkdir()
        self.version_fast()
        self.assertTrue(lock.is_dir(), '不得删除其他进程持有的新鲜锁')
        self.assertFalse(self.native.exists(), '活锁期间不得抢建缓存，应回退源 APE')
        self.assertEqual(hashlib.sha256(self.binary.read_bytes()).hexdigest(), self.checksum)
        lock.rmdir()
        self.version_fast()
        self.assert_cache_complete()

    @unittest.skipIf(sys.platform == 'win32', 'POSIX 并发快速启动验证')
    def test_concurrent_fast_launches_produce_one_valid_cache(self):
        if not shutil.which('sha256sum'):
            self.skipTest('此项需要 sha256sum')
        command = [sys.executable, str(self.package / 'cli.py'), 'version']
        env = {**self.env, 'DAIRN_FAST_RUNTIME': '1'}
        processes = [subprocess.Popen(command, cwd=self.root, env=env, stdout=subprocess.PIPE,
                                      stderr=subprocess.PIPE, text=True, encoding='utf-8') for _ in range(2)]
        results = [process.communicate(timeout=60) for process in processes]
        for process, (stdout, stderr) in zip(processes, results):
            self.assertEqual(process.returncode, 0, stdout + '\n' + stderr)
            self.assertTrue(stdout.startswith('Dairn ' + self.version + ' —'), stdout)
        self.assertEqual(results[0][0], results[1][0])
        self.assert_cache_complete()
        self.assertFalse((self.store / '.dairn-native.lock').exists(), '并发后不得残留锁')
        self.assertFalse(list(self.store.glob('*.tmp')), '并发后不得残留临时文件')
        self.assertEqual(hashlib.sha256(self.binary.read_bytes()).hexdigest(), self.checksum)

    @unittest.skipIf(sys.platform == 'win32', 'POSIX 受保护 CI 语义验证')
    def test_protected_ci_disables_fast_cache(self):
        if not shutil.which('sha256sum'):
            self.skipTest('此项需要 sha256sum')
        cases = {'GitHub Actions': {'GITHUB_ACTIONS': 'true'},
                 'GitHub Actions=1': {'GITHUB_ACTIONS': '1'},
                 'GitLab CI': {'GITLAB_CI': 'true'},
                 '显式保护': {'DAIRN_PROTECTED_CI': '1'}}
        for name, overrides in cases.items():
            with self.subTest(name):
                cache = self.root / ('受保护缓存 ' + name)
                self.version_fast(env={**overrides, 'DAIRN_CACHE_HOME': str(cache)})
                self.assertFalse(cache.exists(), name + ' 下不得创建快速缓存')
        # 即使本地已有缓存，受保护 CI 也不得使用或改动它。
        self.build_cache()
        marker = self.root / '受保护 CI 执行了本地缓存'
        tampered = '#!/bin/sh\ntouch ' + shlex.quote(str(marker)) + '\nexit 42\n'
        self.native.write_text(tampered, encoding='utf-8')
        self.native.chmod(0o700)
        self.version_fast(env={'GITHUB_ACTIONS': 'true'})
        self.assertFalse(marker.exists(), '受保护 CI 不得执行快速缓存')
        self.assertEqual(self.native.read_text(encoding='utf-8'), tampered, '受保护 CI 不得修复/改动本地缓存')
        self.assertEqual(hashlib.sha256(self.binary.read_bytes()).hexdigest(), self.checksum)

    @unittest.skipIf(sys.platform == 'win32', 'POSIX 普通 CI 变量语义验证')
    def test_plain_ci_true_keeps_fast_cache(self):
        if not shutil.which('sha256sum'):
            self.skipTest('此项需要 sha256sum')
        self.version_fast(env={'CI': 'true'})
        self.assertGreater(self.native.stat().st_size, 0)
        self.assert_cache_complete()


if __name__ == '__main__':
    unittest.main()
