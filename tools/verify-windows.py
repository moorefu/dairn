"""在 Windows 上验收原生运行时、离线安装包及实际 Go 门禁，保存可复核日志。"""
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
args = parser.parse_args()
if os.name != 'nt':
    parser.error('此脚本必须在 Windows 原生环境运行')
OUT = ROOT / 'validation/windows'
OUT.mkdir(parents=True, exist_ok=True)
APE = ROOT / 'runtime/dairn-embedded.com'
digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
env = {**os.environ, 'PYTHONDONTWRITEBYTECODE': '1', 'DAIRN_QJS_BIN': str(APE),
       'PATH': str(args.go_bin) + os.pathsep + os.environ['PATH']}
for tool in ['node', 'git', 'npm.cmd', 'npx.cmd', 'go']:
    if not shutil.which(tool, path=env['PATH']):
        parser.error('缺少验收依赖：' + tool)
summary = {'platform': platform.platform(), 'ape_sha256': digest(APE), 'tests': {}}


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


names = ['cli', 'host', 'policy', 'npm', 'wheel-install', 'wheel', 'npm-pack',
         'npm-install', 'npm-installed', 'go-env', 'go-init', 'go-checks']
for name in names:
    (OUT / (name + '.log')).write_bytes(b'')
run('cli', [sys.executable, '-B', '-X', 'utf8', '-m', 'unittest',
            'quickjs.tests.test_windows', '-v'])
run('host', [APE, ROOT / 'quickjs/tests/test_host_native.mjs'])
run('policy', [APE, ROOT / 'quickjs/tests/test_native.mjs'])
run('npm', ['node', '--test', 'tools/tests/npm-distribution.test.cjs'])
with tempfile.TemporaryDirectory(prefix='dairn Windows 安装 ') as temp:
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
    run('go-env', ['go', 'env', '-json', 'GOVERSION', 'GOOS', 'GOARCH', 'CGO_ENABLED', 'CC'])
    project = tmp / 'Go 示例'
    run('go-init', [ROOT / 'dairn.cmd', 'init', '--root', project,
                    '--name', 'go_demo', '--stack', 'go', '--sample'])
    result = run('go-checks', [ROOT / 'dairn.cmd', 'check', '--all', '--root', project])
    evidence = project / '.dairn/governance/evidence/all-qjs-checks.json'
    if evidence.exists():
        shutil.copyfile(evidence, OUT / 'go-checks.json')
        checks = json.loads(evidence.read_text(encoding='utf-8'))['checks']
        summary['go_checks'] = [{k: c.get(k) for k in ['gate', 'status', 'returncode']} for c in checks]
summary['original_unchanged'] = digest(APE) == summary['ape_sha256']
# Go 的结果独立记录；缺少 CGO/C 编译器时不能把 race 检查记为通过。
summary['acceptance_passed'] = summary['original_unchanged'] and all(
    v['passed'] for k, v in summary['tests'].items() if k != 'go-checks')
(OUT / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(summary, ensure_ascii=False, indent=2))
sys.exit(0 if summary['acceptance_passed'] else 1)
