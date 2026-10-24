"""根启动器只做适配：治理运行时快照优先、DAIRN_RUNTIME 覆盖、缺失时清晰失败。

运行时有明确分工：日常命令由根目录 `dairn.sh`/`dairn.cmd` 直接执行项目内
`.dairn/runtime/` 的 vendored 快照；仓库根 `runtime/` 是构建产物，只能通过
DAIRN_RUNTIME 显式交给构建/验证流程。本测试不假设调用者先构建过 runtime/：
需要真实 APE 的分支会从 ROOT/runtime 复制。
"""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
APE = ROOT / 'runtime/dairn-embedded.com'
VENDORED = Path('.dairn/runtime/dairn-embedded.com')


def run(argv, env=None, cwd=None):
    # 门禁可能为验证新构建而设置 DAIRN_RUNTIME；这里默认隔离，只有用例显式覆盖时才生效。
    clean = {k: v for k, v in os.environ.items() if not k.startswith('DAIRN_RUNTIME')}
    clean.update(env or {})
    return subprocess.run(argv, cwd=cwd or ROOT, env=clean,
                          capture_output=True, encoding='utf-8', errors='replace', timeout=120)


class RootLauncher(unittest.TestCase):
    def setUp(self):
        self.temp = Path(tempfile.mkdtemp(prefix='dairn-root-launcher-'))
        self.addCleanup(shutil.rmtree, self.temp, ignore_errors=True)

    def _copy_launcher(self):
        source = ROOT / ('dairn.cmd' if os.name == 'nt' else 'dairn.sh')
        target = self.temp / source.name
        shutil.copyfile(source, target)
        target.chmod(0o755)
        return target

    def _write(self, relative, text):
        target = self.temp / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding='utf-8', newline='\n')
        target.chmod(0o755)
        return target

    def _vendored(self):
        target = self.temp / VENDORED
        target.parent.mkdir(parents=True, exist_ok=True)
        return target

    def test_uses_vendored_governance_runtime(self):
        # 唯一 launcher 直接执行治理运行时快照，不经过 .dairn/bin/dairn 第二层。
        launcher = self._copy_launcher()
        if os.name == 'nt':
            shutil.copyfile(APE, self._vendored())
            result = run(['cmd', '/c', str(launcher), 'version'])
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn('Dairn', result.stdout)
        else:
            self._vendored().write_text(
                "#!/bin/sh\necho \"VENDORED $DAIRN_RUNTIME_SOURCE $*\"\n", encoding='utf-8', newline='\n')
            result = run(['/bin/sh', str(launcher), 'version', '--json'])
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(result.stdout.strip(), 'VENDORED vendored version --json')

    def test_vendored_runtime_wins_over_packaged(self):
        # 源码仓库同时存在构建产物时，日常命令仍使用治理运行时快照。
        launcher = self._copy_launcher()
        if os.name == 'nt':
            shutil.copyfile(APE, self._vendored())
            packaged = self.temp / 'runtime/dairn-embedded.com'
            packaged.parent.mkdir(parents=True)
            shutil.copyfile(APE, packaged)
            result = run(['cmd', '/c', str(launcher), 'version'])
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn('Dairn', result.stdout)
        else:
            self._vendored().write_text("#!/bin/sh\necho VENDORED\n", encoding='utf-8', newline='\n')
            packaged = self._write('runtime/dairn-embedded.com', "#!/bin/sh\necho PACKAGED\n")
            self.assertTrue(packaged.is_file())
            result = run(['/bin/sh', str(launcher), 'doctor'])
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(result.stdout.strip(), 'VENDORED')

    def test_dairn_runtime_override_wins(self):
        launcher = self._copy_launcher()
        if os.name == 'nt':
            runtime = self.temp / 'override' / 'dairn-embedded.com'
            runtime.parent.mkdir()
            shutil.copyfile(APE, runtime)
            result = run(['cmd', '/c', str(launcher), 'version'],
                         env={'DAIRN_RUNTIME': str(runtime)})
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn('Dairn', result.stdout)
        else:
            runtime = self._write('override-runtime.com', '#!/bin/sh\necho "EXTERNAL $*"\n')
            result = run(['/bin/sh', str(launcher), 'doctor'],
                         env={'DAIRN_RUNTIME': str(runtime)})
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(result.stdout.strip(), 'EXTERNAL doctor')

    def test_packaged_runtime_fallback(self):
        launcher = self._copy_launcher()
        runtime = self.temp / 'runtime' / 'dairn-embedded.com'
        runtime.parent.mkdir()
        if os.name == 'nt':
            shutil.copyfile(APE, runtime)
            result = run(['cmd', '/c', str(launcher), 'version'])
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn('Dairn', result.stdout)
        else:
            runtime.write_text('#!/bin/sh\necho "PACKAGED $*"\n', encoding='utf-8', newline='\n')
            runtime.chmod(0o755)
            result = run(['/bin/sh', str(launcher), 'history'])
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(result.stdout.strip(), 'PACKAGED history')

    def test_missing_runtime_is_clear(self):
        launcher = self._copy_launcher()
        if os.name == 'nt':
            result = run(['cmd', '/c', str(launcher), 'version'])
        else:
            result = run(['/bin/sh', str(launcher), 'version'])
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn('.dairn', result.stderr)
        self.assertIn('dairn-embedded.com', result.stderr)


if __name__ == '__main__':
    unittest.main()
