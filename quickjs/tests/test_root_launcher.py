"""根启动器只做适配：治理运行时快照优先、DAIRN_RUNTIME 覆盖、缺失时清晰失败。

运行时有明确分工：日常命令由根目录 `dairn`/`dairn.cmd` 直接执行同目录
`.dairn/runtime/` 的 vendored 快照；仓库根 `runtime/` 是构建产物，只能通过
DAIRN_RUNTIME 显式交给构建/验证流程。启动器同时导出 DAIRN_RUNTIME_SOURCE
与 DAIRN_RUNTIME_DIR，供 doctor 观察和 init/adopt/upgrade 复制载荷。
本测试不假设调用者先构建过 runtime/：需要真实 APE 的分支会从 ROOT/runtime 复制。
"""
import os
import concurrent.futures
from pathlib import Path
import shutil
import subprocess
import signal
import shlex
import sys
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
        self.temp = Path(tempfile.mkdtemp(prefix='dairn-root-launcher-')).resolve()
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

    @unittest.skipUnless(os.name == 'posix', 'POSIX APE 加载器自修改回归')
    def test_runtime_self_modification_is_isolated_and_copies_are_cleaned(self):
        launcher = self._copy_launcher()
        scratch = self.temp / '临时 目录'
        scratch.mkdir()
        for external in (False, True):
            with self.subTest(external=external):
                runtime = self._vendored() if not external else self.temp / 'external.com'
                runtime.write_text('#!/bin/sh\nprintf "# changed\\n" >> "$0"\n'
                                   'printf "%s\\n" "$0" "$DAIRN_RUNTIME_DIR" "$PWD" "$@"\n'
                                   'echo runtime-error >&2\nexit 37\n', encoding='utf-8')
                runtime.chmod(0o444)
                original = runtime.read_bytes()
                env = {'TMPDIR': str(scratch)}
                if external:
                    env['DAIRN_RUNTIME'] = str(runtime)
                def invoke(_):
                    return run(['/bin/sh', str(launcher), '含 空格', '*', ''], env=env, cwd=self.temp)
                with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
                    results = list(pool.map(invoke, range(3)))
                paths = []
                for result in results:
                    self.assertEqual(result.returncode, 37, result.stderr)
                    lines = result.stdout.splitlines()
                    paths.append(lines[0])
                    self.assertNotEqual(Path(lines[0]), runtime)
                    self.assertEqual(lines[1:], [str(runtime.parent), str(self.temp),
                                              '/zip/quickjs/main.mjs', '含 空格', '*', ''])
                    self.assertEqual(result.stderr, 'runtime-error\n')
                self.assertEqual(len(set(paths)), 3)
                self.assertEqual(runtime.read_bytes(), original)
                self.assertEqual(runtime.stat().st_mode & 0o777, 0o444)
                self.assertEqual(list(scratch.iterdir()), [])

    @unittest.skipUnless(os.name == 'posix', 'POSIX 临时副本创建失败')
    def test_unusable_tmpdir_fails_without_executing_original(self):
        launcher = self._copy_launcher()
        runtime = self._vendored()
        runtime.write_text('#!/bin/sh\necho EXECUTED\n', encoding='utf-8')
        result = run(['/bin/sh', str(launcher), 'version'],
                     env={'TMPDIR': str(self.temp / 'missing')})
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertNotIn('EXECUTED', result.stdout)
        self.assertIn('runtime copy', result.stderr)

    @unittest.skipUnless(os.name == 'posix', 'POSIX 输入与终止信号')
    def test_stdin_and_termination_clean_up_private_copy(self):
        launcher = self._copy_launcher()
        runtime = self._vendored()
        scratch = self.temp / 'scratch'
        scratch.mkdir()
        runtime.write_text('#!/bin/sh\nread -r value\nprintf "%s\\n" "$value"\n')
        env = {**os.environ, 'TMPDIR': str(scratch)}
        env.pop('DAIRN_RUNTIME', None)
        result = subprocess.run(['/bin/sh', str(launcher)], input='input with spaces\n',
                                capture_output=True, text=True, env=env, timeout=10)
        self.assertEqual((result.returncode, result.stdout), (0, 'input with spaces\n'))
        for sig, code in ((signal.SIGINT, 130), (signal.SIGTERM, 143), (signal.SIGHUP, 129)):
            with self.subTest(signal=sig):
                program = "import time; print('ready',flush=True); time.sleep(60)"
                runtime.write_text('#!/bin/sh\nexec ' + shlex.quote(sys.executable) +
                                   ' -c ' + shlex.quote(program) + '\n')
                process = subprocess.Popen(['/bin/sh', str(launcher)], stdout=subprocess.PIPE,
                                           stderr=subprocess.PIPE, text=True, env=env)
                try:
                    self.assertEqual(process.stdout.readline().strip(), 'ready')
                    process.send_signal(sig)
                    process.communicate(timeout=5)
                    self.assertEqual(process.returncode, code)
                    self.assertEqual(list(scratch.iterdir()), [])
                finally:
                    if process.poll() is None:
                        process.kill()
                        process.communicate(timeout=5)

    @unittest.skipUnless(os.name == 'posix' and APE.is_file(), '需要真实 APE')
    def test_real_ape_preserves_original_bytes_and_mode(self):
        launcher = self._copy_launcher()
        runtime = self._vendored()
        shutil.copyfile(APE, runtime)
        runtime.chmod(0o444)
        original = runtime.read_bytes()
        for _ in range(2):
            result = run(['/bin/sh', str(launcher), 'version'])
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('Dairn', result.stdout)
            self.assertEqual(runtime.read_bytes(), original)
            self.assertEqual(runtime.stat().st_mode & 0o777, 0o444)

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
