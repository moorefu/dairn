"""在 Windows 上验收原生运行时、离线安装包及实际 Go 门禁，保存可复核日志。

没有 Go 工具链时可用 --skip-go：跳过 go-env/go-init/go-checks，其余 CLI、
launcher、npm、wheel、native 检查照常执行并参与总体验收。
默认 Go 结果独立记录（-race 依赖 CGO/C 编译器）；提供 --cc-bin（如
E:\\msys64\\mingw64\\bin）并加 --require-go-checks 时，Go 门禁纳入总体验收。
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tempfile
from release_config import artifact_names, load_release

ROOT = Path(__file__).resolve().parent.parent
NAMES = artifact_names(load_release(ROOT))
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--go-bin', type=Path, default=Path(r'C:\Program Files\Go\bin'))
parser.add_argument('--skip-go', action='store_true',
                    help='没有 Go 工具链时跳过 Go 相关步骤（其余验收照常执行）')
parser.add_argument('--cc-bin', type=Path, default=None,
                    help='C 编译器目录（如 E:\\msys64\\mingw64\\bin），用于 CGO/Go -race')
parser.add_argument('--require-go-checks', action='store_true',
                    help='要求 go-checks（含 -race）通过并纳入总体验收')
parser.add_argument('--artifacts', type=Path, default=None,
                    help='复用已构建的发布制品目录（含 wheel/tgz）；跳过 npm run build，'
                         '与 Linux 集成回归从 CI artifact 提取运行时的方式一致')
args = parser.parse_args()
if os.name != 'nt':
    parser.error('此脚本必须在 Windows 原生环境运行')
if args.skip_go and args.require_go_checks:
    parser.error('--skip-go 与 --require-go-checks 不能同时使用')
if args.cc_bin:
    gcc = args.cc_bin / 'gcc.exe'
    if not gcc.is_file():
        parser.error('--cc-bin 下未找到 gcc.exe：' + str(gcc))
    args.cc_bin = args.cc_bin.resolve()
if args.artifacts:
    if not args.artifacts.is_dir():
        parser.error('--artifacts 目录不存在：' + str(args.artifacts))
    args.artifacts = args.artifacts.resolve()
    (ROOT / 'dist').mkdir(parents=True, exist_ok=True)
    for pattern in ('*.whl', '*.tgz', '*.zip', 'checksums.json'):
        for source in sorted(args.artifacts.glob(pattern)):
            shutil.copyfile(source, ROOT / 'dist' / source.name)
OUT = ROOT / 'validation/windows'
OUT.mkdir(parents=True, exist_ok=True)
# 集成测试必须像本地开发者一样运行：清除 CI 平台注入的环境变量，
# 否则 dairn check 会进入 CI 保护模式并要求 DAIRN_EXPECTED_POLICY_SHA256。
for _key in ('GITHUB_ACTIONS','GITHUB_EVENT_NAME','GITHUB_EVENT_PATH','GITHUB_REF','GITHUB_SHA',
             'GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','GITHUB_JOB','GITHUB_REPOSITORY','GITHUB_WORKFLOW',
             'GITLAB_CI','CI_PIPELINE_SOURCE','CI_MERGE_REQUEST_DIFF_BASE_SHA','CI_MERGE_REQUEST_LABELS'):
    os.environ.pop(_key, None)
APE = ROOT / 'runtime/dairn-embedded.com'
# host 契约测试要求真正的 QuickJS 解释器作为子进程；构建缓存里有 qjs 时优先使用。
_QJS_CANDIDATES = sorted((ROOT / '.build/quickjs').glob('qjs-*.com')) if (ROOT / '.build/quickjs').is_dir() else []
HOST_QJS = _QJS_CANDIDATES[0] if _QJS_CANDIDATES else APE
digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
env = {**os.environ, 'PYTHONDONTWRITEBYTECODE': '1', 'DAIRN_QJS_BIN': str(HOST_QJS),
       'PATH': str(args.go_bin) + os.pathsep + os.environ['PATH']}
required = ['node', 'git', 'npm.cmd', 'npx.cmd'] + ([] if args.skip_go else ['go'])
for tool in required:
    if not shutil.which(tool, path=env['PATH']):
        hint = '；无 Go 环境可加 --skip-go 只跑非 Go 验收' if tool == 'go' else ''
        parser.error('缺少验收依赖：' + tool + hint)
summary = {'platform': platform.platform(), 'ape_sha256': digest(APE),
           'go_skipped': args.skip_go,
           'go_checks_required': bool(args.require_go_checks and not args.skip_go),
           'cc_bin': str(args.cc_bin) if args.cc_bin else None,
           'artifacts_source': str(args.artifacts) if args.artifacts else None,
           'artifacts_reused': bool(args.artifacts),
           'ci_env_cleared': True,
           'tests': {}}


def run(name, argv, expected=0, cwd=ROOT, timeout=180, run_env=None):
    command = list(map(str, argv))
    process_env = run_env or env
    # CreateProcess 查找可执行文件时不会使用传入 env 的 PATH，必须先解析路径。
    command[0] = shutil.which(command[0], path=process_env['PATH']) or command[0]
    result = subprocess.run(command, cwd=cwd, env=process_env,
                            capture_output=True, timeout=timeout)
    with (OUT / (name + '.log')).open('ab') as stream:
        stream.write(result.stdout + result.stderr)
    summary['tests'][name] = {'returncode': result.returncode, 'expected': expected,
                              'passed': result.returncode == expected}
    print(name, result.returncode, flush=True)
    return result


names = ['cli', 'host', 'policy', 'npm', 'wheel-install', 'wheel']
if not args.artifacts:
    names += ['npm-pack']
names += ['npm-install', 'npm-installed']
if not args.skip_go:
    names += ['go-env', 'go-init', 'go-checks']
for name in names:
    (OUT / (name + '.log')).write_bytes(b'')
run('cli', [sys.executable, '-B', '-X', 'utf8', '-m', 'unittest',
            'quickjs.tests.test_windows', '-v'])
run('host', [HOST_QJS, ROOT / 'quickjs/tests/test_host_native.mjs'])
run('policy', [APE, ROOT / 'quickjs/tests/test_native.mjs'])
run('npm', ['node', '--test', 'tools/tests/npm-distribution.test.cjs'])
# 安装/Wheel/npm 下仍使用中文+空格路径做兼容性验证；临时根目录自身保持 ASCII，
# 因为 MSYS2/gcc 等原生工具链对非 ASCII GOTMPDIR/GOCACHE 路径支持不稳定。
with tempfile.TemporaryDirectory(prefix='dairn-win-') as temp:
    tmp = Path(temp)
    isolated = {**env, 'DAIRN_CACHE_HOME': str(tmp / 'runtime-cache'),
                'npm_config_cache': str(tmp / 'npm-cache')}
    venv = tmp / 'venv'
    subprocess.run([sys.executable, '-m', 'venv', str(venv)], check=True, env=env)
    wheel = ROOT / 'dist' / NAMES['wheel']
    summary['wheel_sha256'] = digest(wheel)
    run('wheel-install', [venv / 'Scripts/python.exe', '-m', 'pip', 'install',
                          '--no-index', '--disable-pip-version-check', wheel], run_env=isolated)
    wheel_cases = []
    target = tmp / 'Wheel 示例'
    for command, extra, expected in [
        ('version', [], 0), ('invalid-command', [], 2),
        ('init', ['--root', target, '--name', 'wheel_demo', '--stack', 'go', '--sample'], 0),
        ('validate', ['--root', target], 0),
    ]:
        result = run('wheel', [venv / 'Scripts/dairn.exe', command, *extra],
                     expected=expected, run_env=isolated)
        wheel_cases.append({'command': command, 'returncode': result.returncode,
                            'passed': result.returncode == expected})
    summary['tests']['wheel']['passed'] = all(c['passed'] for c in wheel_cases)
    (OUT / 'wheel.json').write_text(json.dumps(wheel_cases, indent=2) + '\n', encoding='utf-8')
    if not args.artifacts:
        run('npm-pack', ['npm.cmd', 'run', 'build'], run_env=isolated)
    tgz = ROOT / 'dist' / NAMES['npm']
    summary['npm_tarball_sha256'] = digest(tgz)
    install = tmp / 'npm 项目'
    install.mkdir()
    (install / 'package.json').write_text('{"name":"dairn-acceptance","private":true}', encoding='utf-8')
    run('npm-install', ['npm.cmd', 'install', '--offline', '--ignore-scripts', '--no-audit',
                        '--no-fund', tgz], cwd=install, run_env=isolated)
    npm_cases = []
    for command, expected in [('version', 0), ('invalid-command', 2)]:
        result = run('npm-installed', ['npx.cmd', '--offline', '--no-install', 'dairn', command],
                     expected=expected, cwd=install, run_env=isolated)
        npm_cases.append(result.returncode == expected)
    summary['tests']['npm-installed']['passed'] = all(npm_cases)
    if not args.skip_go:
        # Go 全局默认缓存位于 %LOCALAPPDATA%\go-build，部分受限/审计环境的
        # ACL 会拒绝写入；Go 验收使用临时独占缓存，避免受宿主缓存状态影响。
        go_env = {**env,
                  'GOCACHE': str(tmp / 'go-build'),
                  'GOTMPDIR': str(tmp / 'go-tmp'),
                  'GOMODCACHE': str(tmp / 'go-mod')}
        for name in ('go-build', 'go-tmp', 'go-mod'):
            (tmp / name).mkdir(exist_ok=True)
        if args.cc_bin:
            # MSYS2/MinGW-w64：gcc 自身依赖同目录 DLL，必须把其 bin 放在 PATH 最前。
            go_env['PATH'] = str(args.cc_bin) + os.pathsep + go_env['PATH']
            go_env['CC'] = 'gcc'
            go_env['CGO_ENABLED'] = '1'
        go_env_result = run('go-env', ['go', 'env', '-json', 'GOVERSION', 'GOOS', 'GOARCH',
                                       'CGO_ENABLED', 'CC'], run_env=go_env)
        try:
            summary['go_env'] = json.loads(go_env_result.stdout)
        except (ValueError, TypeError):
            summary['go_env'] = {'raw': go_env_result.stdout.decode('utf-8', 'replace')}
        project = tmp / 'Go 示例'
        run('go-init', [ROOT / 'dairn.cmd', 'init', '--root', project,
                        '--name', 'go_demo', '--stack', 'go', '--sample'], run_env=go_env)
        run('go-checks', [ROOT / 'dairn.cmd', 'check', '--all', '--root', project],
            run_env=go_env)
        evidence = project / '.dairn/governance/evidence/all-qjs-checks.json'
        if evidence.exists():
            shutil.copyfile(evidence, OUT / 'go-checks.json')
            checks = json.loads(evidence.read_text(encoding='utf-8'))['checks']
            summary['go_checks'] = [{k: c.get(k) for k in ['gate', 'status', 'returncode']} for c in checks]
summary['original_unchanged'] = digest(APE) == summary['ape_sha256']
# 默认 Go 门禁结果独立记录（-race 需要 CGO/C 编译器），不参与总体验收；
# 显式提供 --cc-bin --require-go-checks 时，go-checks 与其他套件一样必须通过。
summary['acceptance_passed'] = summary['original_unchanged'] and all(
    v['passed'] for k, v in summary['tests'].items() if k != 'go-checks')
if summary['go_checks_required']:
    go_result = summary['tests'].get('go-checks', {})
    summary['acceptance_passed'] = summary['acceptance_passed'] and bool(go_result.get('passed'))
(OUT / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(summary, ensure_ascii=False, indent=2))
sys.exit(0 if summary['acceptance_passed'] else 1)
