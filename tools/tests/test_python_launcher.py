"""验证 Python 启动器的实际执行、校验门禁及共享缓存；先构建运行时。"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


@unittest.skipUnless((ROOT / 'runtime/dairn-embedded.com').is_file(), '请先构建运行时')
class PythonLauncherTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='dairn Python 启动 ')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.package = self.root / 'package'
        self.package.mkdir()
        shutil.copyfile(ROOT / 'src/dairn/cli.py', self.package / 'cli.py')
        shutil.copyfile(ROOT / 'dairn.sh', self.package / 'dairn.sh')
        shutil.copytree(ROOT / 'runtime', self.package / 'runtime')
        self.binary = self.package / 'runtime/dairn-embedded.com'
        self.checksum = hashlib.sha256(self.binary.read_bytes()).hexdigest()
        self.version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
        self.cache = self.root / '共享 缓存'
        self.env = {**os.environ, 'PYTHONDONTWRITEBYTECODE': '1', 'PYTHONUTF8': '1', 'DAIRN_FAST_RUNTIME': '0',
                    'DAIRN_CACHE_HOME': str(self.cache)}

    def run_command(self, command, fast=False):
        return subprocess.run(list(map(str, command)), cwd=self.root,
                              env={**self.env, 'DAIRN_FAST_RUNTIME': '1' if fast else '0'},
                              capture_output=True, text=True, encoding='utf-8', timeout=30)

    def cli(self, *args, fast=False):
        return self.run_command([sys.executable, self.package / 'cli.py', *args], fast)

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
        result = self.cli('version', fast=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        native = self.cache / ('native-' + self.checksum) / 'dairn-native'
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
        self.assertEqual([p.name for p in native.parent.iterdir()], ['dairn-native'])
        self.assertEqual(hashlib.sha256(self.binary.read_bytes()).hexdigest(), self.checksum)


if __name__ == '__main__':
    unittest.main()
