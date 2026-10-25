"""根启动器只做适配：治理运行时快照优先、DAIRN_RUNTIME 覆盖、缺失时清晰失败。

运行时有明确分工：日常命令由根目录 `dairn`/`dairn.cmd` 直接执行同目录
`.dairn/runtime/` 的 vendored 快照；仓库根 `runtime/` 是构建产物，只能通过
DAIRN_RUNTIME 显式交给构建/验证流程。启动器同时导出 DAIRN_RUNTIME_SOURCE
与 DAIRN_RUNTIME_DIR，供 doctor 观察和 init/adopt/upgrade 复制载荷。
本测试不假设调用者先构建过 runtime/：需要真实 APE 的分支会从 ROOT/runtime 复制。
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
    # 门禁可能为验证新构建而设置 DAIRN_RUNTIME*；这里默认隔离，只有用例显式覆盖时才生效。
    clean = {k: v for k, v in os.environ.items() if not k.startswith('DAIRN_RUNTIME')}
    clean.update(env or {})
    return subprocess.run(argv, cwd=cwd or ROOT, env=clean,
                          capture_output=True, encoding='utf-8', errors='replace', timeout=120)


class RootLauncher(unittest.TestCase):
    def setUp(self):
        self.temp = Path(tempfile.mkdtemp(prefix='dairn-root-launcher-'))
        self.addCleanup(shutil.rmtree, self.temp, ignore_errors=True)

    def _copy_launcher(self):
        source = ROOT / ('dairn.cmd' if os.name == 'nt' else 'dairn')
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
            # 根启动器把 /zip/quickjs/main.mjs 作为首个参数交给内嵌运行时。
            self.assertEqual(result.stdout.strip(), 'VENDORED vendored /zip/quickjs/main.mjs version --json')

    def test_launcher_exports_runtime_dir_for_payload_copy(self):
        launcher = self._copy_launcher()
        if os.name == 'nt':
            shutil.copyfile(APE, self._vendored())
            result = run(['cmd', '/c', str(launcher), 'version'])
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn('Dairn', result.stdout)
        else:
            self._vendored().write_text(
                "#!/bin/sh\necho \"SOURCE=$DAIRN_RUNTIME_SOURCE DIR=$DAIRN_RUNTIME_DIR\"\n",
                encoding='utf-8', newline='\n')
            result = run(['/bin/sh', str(launcher), 'version'])
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(result.stdout.strip(),
                             'SOURCE=vendored DIR=' + str((self.temp / '.dairn/runtime').resolve()))

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
            runtime = self._write('override-runtime.com', '#!/bin/sh\necho "EXTERNAL $DAIRN_RUNTIME_SOURCE $*"\n')
            result = run(['/bin/sh', str(launcher), 'doctor'],
                         env={'DAIRN_RUNTIME': str(runtime)})
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(result.stdout.strip(), 'EXTERNAL external /zip/quickjs/main.mjs doctor')

    def test_relative_dairn_runtime_resolves_from_launcher_directory(self):
        launcher = self._copy_launcher()
        self._write('runtime/dairn-embedded.com', '#!/bin/sh\necho RELATIVE\n')
        if os.name == 'nt':
            shutil.copyfile(APE, self.temp / 'runtime/dairn-embedded.com')
            result = run(['cmd', '/c', str(launcher), 'version'],
                         env={'DAIRN_RUNTIME': 'runtime/dairn-embedded.com'})
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn('Dairn', result.stdout)
        else:
            result = run(['/bin/sh', str(launcher), 'version'],
                         env={'DAIRN_RUNTIME': 'runtime/dairn-embedded.com'})
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(result.stdout.strip(), 'RELATIVE')

    @unittest.skipUnless(APE.is_file(), 'requires build/runtime APE')
    def test_extracted_release_layout_can_init_in_place(self):
        # 发行 ZIP 解压目录不是空目录：dairn/dairn.cmd、LICENSE、.dairn/runtime 属于
        # 发行包自带布局，必须允许直接 init 展开治理文件（回归：曾误报 Nonempty directory）。
        release = self.temp / 'release'
        runtime = release / VENDORED
        runtime.parent.mkdir(parents=True)
        integrity_source = APE.parent / 'runtime-integrity.json'
        shutil.copyfile(APE, runtime)
        shutil.copyfile(integrity_source, runtime.parent / 'runtime-integrity.json')
        (release / 'LICENSE').write_text('license\n', encoding='utf-8')
        launcher = release / ('dairn.cmd' if os.name == 'nt' else 'dairn')
        shutil.copyfile(ROOT / launcher.name, launcher)
        launcher.chmod(0o755)
        argv = (['cmd', '/c', str(launcher)] if os.name == 'nt' else ['/bin/sh', str(launcher)])
        result = run(argv + ['init', '--name', 'release_demo', '--stack', 'python',
                             '--ci', 'none'], cwd=release)
        self.assertEqual(result.returncode, 0, result.stdout + '\n' + result.stderr)
        self.assertTrue((release / '.dairn/launcher.json').is_file())
        self.assertTrue((release / 'AGENTS.md').is_file())
        self.assertTrue((runtime.parent / 'runtime-integrity.json').is_file())

    def test_missing_dairn_runtime_file_is_clear(self):
        launcher = self._copy_launcher()
        cmd = ['cmd', '/c', str(launcher), 'version'] if os.name == 'nt' else ['/bin/sh', str(launcher), 'version']
        result = run(cmd, env={'DAIRN_RUNTIME': 'missing/dairn-embedded.com'})
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn('DAIRN_RUNTIME', result.stderr)

    def test_missing_runtime_is_clear(self):
        launcher = self._copy_launcher()
        if os.name == 'nt':
            result = run(['cmd', '/c', str(launcher), 'version'])
        else:
            result = run(['/bin/sh', str(launcher), 'version'])
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn('DAIRN_NOT_AVAILABLE', result.stderr)
        self.assertIn('.dairn', result.stderr)
        self.assertIn('dairn-embedded.com', result.stderr)


if __name__ == '__main__':
    unittest.main()
