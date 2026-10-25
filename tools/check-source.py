"""执行 Dairn 源码仓库的真实门禁，不安装工具或依赖。"""
from concurrent.futures import ThreadPoolExecutor
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

from release_config import build_instant, format_instant
from runtime_context import test_runtime
from check_catalog import NATIVE_UNIT, PYTHON_INTEGRATION, coverage, required_ids

# Windows 上 Cosmopolitan 用 _COSMO_FDS_V2 向子进程传递 fd 表；原生工具
# （Python/Node 等）再启动 APE 孙进程时，该变量指向未经继承的句柄，表现为
# stdout 丢失或 0xC0000005。源码门禁的全部子进程必须运行在干净环境里。
if os.name == 'nt':
    for _name in ('_COSMO_FDS_V2', '_COSMO_FDS'):
        os.environ.pop(_name, None)

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'validation/source-checks'
PYTHON = [sys.executable, '-B', '-X', 'utf8']
CLI = ROOT / ('dairn.cmd' if os.name == 'nt' else 'dairn')

# Windows PowerShell 可能以 GBK 连接 stdout；门禁日志包含中文路径和原始
# QuickJS 错误时，报告器自身不能因为编码异常遮蔽真正的退出码。
for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, 'reconfigure'):
        stream.reconfigure(encoding='utf-8', errors='replace')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('stage', choices=('lint', 'unit', 'integration', 'build'))
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    temp = OUT / 'tmp'
    temp.mkdir(exist_ok=True)
    env = {**os.environ, 'PYTHONDONTWRITEBYTECODE': '1',
           'TMPDIR': str(temp), 'TEMP': str(temp), 'TMP': str(temp)}
    if not os.environ.get('DAIRN_TEST_RUNTIME'):
        return subprocess.call([sys.executable, '-B', str(ROOT / 'tools/with-built-runtime.py'),
                                '--', sys.executable, '-B', str(Path(__file__).resolve()), args.stage], cwd=ROOT)
    runtime = test_runtime()
    env['DAIRN_QJS_BIN'] = str(runtime)
    # 门禁必须验证本次构建，而不是 .dairn/runtime 里可能较旧的 vendored 快照。
    env['DAIRN_RUNTIME'] = str(runtime)
    native = [str(runtime)] if os.name == 'nt' else ['/bin/sh', str(runtime)]
    artifact_dir = None
    if args.stage == 'lint':
        commands = [[str(CLI), 'docs', 'check'],
                    PYTHON + ['-m', 'unittest', 'quickjs.tests.test_assets_lint', '-v']]
    elif args.stage == 'unit':
        commands = [native + [str(ROOT / 'quickjs/tests' / name)] for name in NATIVE_UNIT]
        commands += [PYTHON + ['-m', 'unittest', 'discover', '-s', 'tools/tests', '-p', 'test_*.py', '-v']]
    elif args.stage == 'integration':
        # 各模块互不依赖、各自在独立临时目录里启动 CLI 子进程，可以并行执行；
        # 串行时这一阶段约 340s，耗时集中在 Python 模块上，拆分后由最慢者决定。
        commands = [native + [str(ROOT / 'quickjs/tests/test_host_native.mjs')]]
        commands += [PYTHON + ['-m', 'unittest', module, '-v'] for module in PYTHON_INTEGRATION]
    else:
        npm = shutil.which('npm.cmd' if os.name == 'nt' else 'npm')
        if not npm:
            parser.error('缺少 npm；构建门禁不会自动安装工具')
        node = shutil.which('node')
        if not node:
            parser.error('缺少 node；无法校验根启动器与脚本常量一致')
        artifact_dir = Path(tempfile.mkdtemp(prefix='build-', dir=OUT))
        commands = [[node, 'tools/render-launchers.mjs', '--check'],
                    PYTHON + ['tools/build.py', '--out', str(artifact_dir)],
                    [npm, 'run', 'build', '--', '--out', str(artifact_dir)],
                    PYTHON + ['tools/checksums.py', '--dist', str(artifact_dir)]]
        # ZIP、npm tarball、Wheel 与校验清单必须共用同一构建时间戳，
        # 否则各子进程分别取当前时间会得到不同 nightly 版本。
        if not env.get('DAIRN_BUILD_TIME', '').strip():
            env['DAIRN_BUILD_TIME'] = format_instant(build_instant())
    def run_one(index, command):
        log = OUT / (args.stage + '-' + str(index) + '.log')
        command_env = dict(env)
        # 每个命令使用独立临时目录，避免并行时 APE/Python 临时文件互相干扰。
        command_temp = temp / (args.stage + '-' + str(index))
        command_temp.mkdir(parents=True, exist_ok=True)
        command_env.update(TMPDIR=str(command_temp), TEMP=str(command_temp), TMP=str(command_temp))
        # 原生测试也只执行私有副本；构建产物可为 0644，APE 不得改写它。
        native_copy = command_temp / 'dairn-embedded.com'
        shutil.copyfile(runtime, native_copy)
        shutil.copyfile(runtime.parent / 'runtime-integrity.json', command_temp / 'runtime-integrity.json')
        native_copy.chmod(0o700)
        command_env['DAIRN_QJS_BIN'] = str(native_copy)
        command = [str(native_copy) if part == str(runtime) else part for part in command]
        if args.stage == 'integration':
            evidence = OUT / 'integration' / str(index)
            evidence.mkdir(parents=True, exist_ok=True)
            command_env['DAIRN_TEST_EVIDENCE_DIR'] = str(evidence)
        try:
            with log.open('wb') as stream:
                result = subprocess.run(command, cwd=ROOT, env=command_env, stdout=stream,
                                        stderr=subprocess.STDOUT, timeout=3000)
            code = result.returncode
            error = None
        except (OSError, subprocess.TimeoutExpired) as exc:
            code, error = 1, str(exc)
        return {'check_id': required_ids(args.stage)[index - 1],
                'argv': command, 'exit_code': code, 'log': str(log.relative_to(ROOT)), 'error': error}

    if args.stage == 'integration':
        # 集成阶段并行执行；thread pool 只负责等待子进程，真正的负载在子进程里。
        with ThreadPoolExecutor(max_workers=len(commands)) as pool:
            results = list(pool.map(run_one, range(1, len(commands) + 1), commands))
        for index, item in enumerate(results, 1):
            print(args.stage, index, '退出码', item['exit_code'], '日志', item['log'], flush=True)
        for item in results:
            if item['exit_code']:
                print(item['error'] or (ROOT / item['log']).read_text(encoding='utf-8', errors='replace')[-6000:], flush=True)
    else:
        results = []
        for index, command in enumerate(commands, 1):
            item = run_one(index, command)
            results.append(item)
            print(args.stage, index, '退出码', item['exit_code'], '日志', item['log'], flush=True)
            if item['exit_code']:
                print(item['error'] or (ROOT / item['log']).read_text(encoding='utf-8', errors='replace')[-6000:], flush=True)
                break
    check_coverage = coverage(args.stage, results)
    passed = check_coverage['complete']
    (OUT / (args.stage + '.json')).write_text(json.dumps(
        {'schema': 1, 'stage': args.stage, 'passed': passed,
         'artifact_dir': str(artifact_dir.relative_to(ROOT)) if artifact_dir else None,
         'coverage': check_coverage, 'results': results},
        ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return 0 if passed else 1


if __name__ == '__main__':
    sys.exit(main())
