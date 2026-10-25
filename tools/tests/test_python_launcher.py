"""Python 安装适配层回归：校验包内运行时、版本透传、POSIX 共用根启动器、错误退出码。"""
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
SOURCE_RUNTIME = ROOT / 'runtime/dairn-embedded.com'
SOURCE_INTEGRITY = ROOT / 'runtime/runtime-integrity.json'
SOURCE_LAUNCHER = ROOT / 'dairn'
POSIX = os.name == 'posix'


@unittest.skipUnless(SOURCE_RUNTIME.is_file() and SOURCE_INTEGRITY.is_file(),
                     '需要先构建仓库根 runtime/dairn-embedded.com（python tools/build.py）')
class PythonLauncherTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.package = Path(self.temp.name) / 'package'
        self._install_package(self.package)

    def _install_package(self, target):
        dist = target / 'dairn'
        (dist / '.dairn' / 'runtime').mkdir(parents=True)
        shutil.copy2(ROOT / 'src/dairn/cli.py', dist / 'cli.py')
        shutil.copy2(SOURCE_INTEGRITY, dist / '.dairn' / 'runtime/runtime-integrity.json')
        shutil.copy2(SOURCE_RUNTIME, dist / '.dairn' / 'runtime/dairn-embedded.com')
        shutil.copy2(SOURCE_LAUNCHER, dist / 'dairn')
        os.chmod(dist / '.dairn' / 'runtime/dairn-embedded.com', 0o755)
        os.chmod(dist / 'dairn', 0o755)

    @property
    def cli(self):
        return self.package / 'dairn/cli.py'

    @property
    def launcher(self):
        return self.package / 'dairn/dairn'

    @property
    def runtime(self):
        return self.package / 'dairn/.dairn/runtime/dairn-embedded.com'

    @property
    def engine_version(self):
        return json.loads(SOURCE_INTEGRITY.read_text(encoding='utf-8'))['engine_version']

    def run_cli(self, *args):
        return subprocess.run([sys.executable, str(self.cli), *args], capture_output=True, text=True,
                              encoding='utf-8', errors='replace', timeout=180)

    def run_shell_launcher(self, *args):
        return subprocess.run(['/bin/sh', str(self.launcher), *args], capture_output=True, text=True,
                              encoding='utf-8', errors='replace', timeout=180)

    def test_version(self):
        result = self.run_cli('--version')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(result.stdout.startswith(f'Dairn {self.engine_version}'), result.stdout)

    def test_unknown_command_exit_code(self):
        result = self.run_cli('definitely-not-a-command')
        self.assertEqual(result.returncode, 2)

    def test_corrupt_runtime_rejected(self):
        self.runtime.write_bytes(b'not a runtime')
        result = self.run_cli('--version')
        self.assertEqual(result.returncode, 2)
        self.assertIn('refusing to execute invalid runtime', result.stderr)

    def test_missing_runtime_rejected(self):
        self.runtime.unlink()
        result = self.run_cli('--version')
        self.assertEqual(result.returncode, 2)
        self.assertIn('refusing to execute invalid runtime', result.stderr)

    def test_missing_integrity_rejected(self):
        (self.package / 'dairn/.dairn/runtime/runtime-integrity.json').unlink()
        result = self.run_cli('--version')
        self.assertEqual(result.returncode, 2)
        self.assertIn('refusing to execute invalid runtime', result.stderr)

    def test_install_path_with_spaces(self):
        spaced = Path(self.temp.name) / 'with spaces'
        shutil.copytree(self.package, spaced / 'package')
        cli = spaced / 'package/dairn/cli.py'
        result = subprocess.run([sys.executable, str(cli), '--version'], capture_output=True, text=True,
                                encoding='utf-8', errors='replace', timeout=180)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(f'Dairn {self.engine_version}', result.stdout)

    @unittest.skipUnless(POSIX, 'POSIX 共用启动器语义')
    def test_posix_cli_delegates_to_root_launcher(self):
        self.launcher.unlink()
        result = self.run_cli('--version')
        self.assertNotEqual(result.returncode, 0)

    @unittest.skipUnless(POSIX, 'POSIX 共用启动器语义')
    def test_posix_cli_and_launcher_share_runtime(self):
        launcher = self.run_shell_launcher('--version')
        cli = self.run_cli('--version')
        self.assertEqual(launcher.returncode, 0, launcher.stderr)
        self.assertEqual(cli.returncode, 0, cli.stderr)
        self.assertEqual(cli.stdout, launcher.stdout)

    @unittest.skipUnless(POSIX, 'POSIX 共用启动器语义')
    def test_posix_launcher_restores_executable_bit(self):
        os.chmod(self.runtime, 0o644)
        result = self.run_cli('--version')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(os.stat(self.runtime).st_mode & 0o111)

    @unittest.skipUnless(POSIX, 'POSIX 共用启动器语义')
    def test_posix_symlink_runtime_rejected(self):
        self.runtime.unlink()
        os.symlink(SOURCE_RUNTIME, self.runtime)
        result = self.run_cli('--version')
        self.assertEqual(result.returncode, 2)
        self.assertIn('refusing to execute invalid runtime', result.stderr)


if __name__ == '__main__':
    unittest.main()
