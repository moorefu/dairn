"""独立或联合验收 npm、Wheel、ZIP；各平台使用同一套发布制品。"""
import argparse
import base64
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tarfile
import tempfile
import venv
import zipfile
from source_workspace import prepare_workspace, runtime_payload, zip_paths
from release_config import (artifact_names, build_instant, format_instant, load_release,
                            version_from_artifacts)

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--artifacts', type=Path, help='验收已有发布制品，不重新生成被安装的包')
parser.add_argument('--package', choices=['all', 'npm', 'wheel', 'zip'], default='all')
parser.add_argument('--smoke', action='store_true', help='仅验收安装、版本、初始化和结构校验；不运行源码或工具链回归')
parser.add_argument('--skip-npm', action='store_true', help='仅供本地 Python 环境，CI 不使用此选项')
parser.add_argument('--out', type=Path, default=ROOT / 'validation/build')
args = parser.parse_args()
if args.package != 'all' and not args.artifacts:
    parser.error('独立制品验收需要 --artifacts，确保验证同一套构建产物')
if args.smoke and not args.artifacts:
    parser.error('冒烟验证需要 --artifacts，不在 runner 上重建制品')
if args.skip_npm and args.package != 'all':
    parser.error('--skip-npm 不能与独立制品验收合用')
if args.artifacts:
    if not args.artifacts.is_dir():
        parser.error('--artifacts 目录不存在：' + str(args.artifacts))
    args.artifacts = args.artifacts.resolve()
    # 复用已构建制品时版本必须从制品文件名恢复；重新取构建时间会得到不同 nightly。
    VERSION = version_from_artifacts(ROOT, args.artifacts)
    RELEASE = load_release(ROOT, version=VERSION)
else:
    # Python 与 npm 两个构建入口必须共用一个构建时间戳，否则 ZIP 与 tarball 版本不一致。
    os.environ.setdefault('DAIRN_BUILD_TIME', format_instant(build_instant()))
    RELEASE = load_release(ROOT)
VERSION = RELEASE['version']
WHEEL_VERSION = RELEASE['python_version']
NAMES = artifact_names(RELEASE)
selected = set(NAMES) if args.package == 'all' else {args.package}
if args.skip_npm:
    selected.remove('npm')
OUT = args.out.resolve()
OUT.mkdir(parents=True, exist_ok=True)
summary = {'platform': platform.platform(), 'machine': platform.machine(), 'steps': {},
           'selected_packages': sorted(selected), 'artifact_mode': bool(args.artifacts),
           'mode': 'smoke' if args.smoke else 'full'}
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
runtime_path = ROOT / 'runtime/dairn-embedded.com'
before = sha(runtime_path) if runtime_path.exists() else None


def extract_zip(archive, destination):
    with zipfile.ZipFile(archive) as zipped:
        assert zipped.testzip() is None
        for entry in zipped.infolist():
            target = (destination / entry.filename).resolve()
            assert target.is_relative_to(destination.resolve())
            zipped.extract(entry, destination)
            if os.name != 'nt':
                target.chmod((entry.external_attr >> 16) & 0o777)
    return destination / ('dairn-' + VERSION)


def verify():
    with tempfile.TemporaryDirectory(prefix='dairn 构建验收 ') as temp:
        tmp = Path(temp)
        env = {**os.environ, 'PYTHONDONTWRITEBYTECODE': '1', 'PIP_NO_INDEX': '1',
               'PIP_DISABLE_PIP_VERSION_CHECK': '1', 'PIP_CACHE_DIR': str(tmp / 'pip-cache'),
               'npm_config_cache': str(tmp / 'npm-cache'), 'DAIRN_CACHE_HOME': str(tmp / 'runtime-cache')}
        env['DAIRN_QUICKJS_CACHE'] = os.environ.get('DAIRN_QUICKJS_CACHE', str(ROOT / '.build/quickjs'))
        if os.name != 'nt':
            loader_cache = tmp / 'ape-loader'
            loader_cache.mkdir()
            env['TMPDIR'] = str(loader_cache)

        def run(name, command, cwd=ROOT, expected=0, override=None, timeout=240):
            result = subprocess.run(list(map(str, command)), cwd=cwd, env=override or env,
                                    capture_output=True, timeout=timeout)
            (OUT / (name + '.log')).write_bytes(result.stdout + result.stderr)
            summary['steps'][name] = {'returncode': result.returncode, 'expected': expected}
            print(name, result.returncode, flush=True)
            assert result.returncode == expected, (name, (result.stdout + result.stderr).decode('utf-8', errors='replace')[-3000:])
            return result

        def cli_cases(kind, command):
            result = run(kind + '-version', [*command, 'version'], cwd=tmp)
            assert ('Dairn ' + VERSION).encode() in result.stdout
            if not args.smoke:
                run(kind + '-failure', [*command, 'invalid-command'], expected=2, cwd=tmp)
            project = tmp / ('中文 ' + kind + ' 项目')
            scaffold = ['--stack', 'python', '--ci', 'none'] if args.smoke else ['--stack', 'go', '--sample']
            run(kind + '-init', [*command, 'init', '--root', project, '--name', 'package_test', *scaffold], cwd=tmp)
            assert (project / 'AGENTS.md').is_file()
            assert json.loads((project / '.dairn/lock.json').read_text(encoding='utf-8'))['version'] == VERSION
            run(kind + '-validate', [*command, 'validate', '--root', project], cwd=tmp)
            # 分发资产 lint 不依赖语言工具链，因此 smoke 与 full 模式都执行。
            docs = run(kind + '-docs-check', [*command, 'docs', 'check'], cwd=tmp)
            assert b'PASS' in docs.stdout

        built = tmp / 'artifacts'
        if args.artifacts:
            built.mkdir()
            checksums = json.loads((args.artifacts / 'checksums.json').read_text(encoding='utf-8'))
            assert set(checksums['artifacts']) == set(NAMES.values()), '发布清单必须且只能包含 npm、Wheel、ZIP'
            for name, expected in checksums['artifacts'].items():
                artifact = args.artifacts / name
                assert sha(artifact) == expected, name + ' 校验失败'
                shutil.copyfile(artifact, built / name)
            summary['input_checksums'] = checksums
        else:
            run('python-build', [sys.executable, '-B', ROOT / 'tools/build.py', '--out', built])
        archive = built / NAMES['zip']
        original_zip_hash = sha(archive)
        if 'npm' in selected:
            npm = shutil.which('npm.cmd' if os.name == 'nt' else 'npm')
            node = shutil.which('node')
            assert npm and node, 'npm 或 Node 未安装'
            if not args.artifacts:
                run('npm-build', [npm, 'run', 'build', '--', '--out', built])
                assert sha(archive) == original_zip_hash, 'Python/npm 生成的 ZIP 不一致'
        runtime_payload(ROOT, archive, VERSION)
        summary['zip_files'] = sorted(zip_paths(ROOT))
        extracted = extract_zip(archive, tmp / 'extracted')
        runtime = extracted / '.dairn/runtime/dairn-embedded.com'
        runtime_hash = sha(runtime)
        if args.artifacts:
            assert runtime_hash == checksums['ape_sha256']
        assert json.loads((extracted / '.dairn/runtime/runtime-integrity.json').read_text(encoding='utf-8'))['sha256'] == runtime_hash
        if not args.smoke:
            with zipfile.ZipFile(runtime) as zipped:
                assert zipped.testzip() is None
                assert len(zipped.namelist()) == len(set(zipped.namelist()))
                for name in zipped.namelist():
                    if name.startswith('quickjs/') and name != 'quickjs/assets/manifest.json':
                        assert zipped.read(name) == (ROOT / name).read_bytes(), name
                manifest = json.loads(zipped.read('quickjs/assets/manifest.json'))
                for entry in manifest['engine_sources']:
                    assert hashlib.sha256(zipped.read(entry['path'])).hexdigest() == entry['sha256']
                for entry in manifest['assets']:
                    name = 'quickjs/assets/' + entry['type'] + '/' + entry['path']
                    assert hashlib.sha256(zipped.read(name)).hexdigest() == entry['sha256']
        if not args.smoke and selected & {'wheel', 'zip'}:
            source = prepare_workspace(ROOT, tmp / 'source', archive, VERSION)

        if 'npm' in selected:
            with tarfile.open(built / NAMES['npm']) as tar:
                package_meta = json.load(tar.extractfile('package/package.json'))
                assert package_meta['version'] == VERSION
                assert package_meta['name'] == RELEASE['npm_name'], 'npm tarball 包名必须与 package.json 一致'
                ape_member = tar.getmember('package/.dairn/runtime/dairn-embedded.com')
                if os.name != 'nt':
                    assert ape_member.mode & 0o111, 'npm 包内运行时必须带执行位，否则 bash 无法执行 APE 加载器'
                assert tar.extractfile(ape_member).read() == runtime.read_bytes()
                assert tar.extractfile('package/dairn').read() == (ROOT / 'dairn').read_bytes()
                assert tar.extractfile('package/LICENSE').read() == (ROOT / 'LICENSE').read_bytes()
                assert package_meta.get('license') == 'MIT', 'npm 包许可证元数据必须是 MIT'
                allowed = {'package/package.json', 'package/README.md', 'package/LICENSE', 'package/bin/dairn.cjs', 'package/dairn',
                           'package/.dairn/runtime/dairn-embedded.com', 'package/.dairn/runtime/runtime-integrity.json'}
                assert all(e.name in allowed or e.name.startswith('package/licenses/') for e in tar.getmembers())
            installed = tmp / 'npm-installed'
            installed.mkdir()
            (installed / 'package.json').write_text('{"private":true,"name":"dairn-test"}')
            run('npm-install', [npm, 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
                                built / NAMES['npm']], cwd=installed)
            package = installed / 'node_modules' / package_meta['name']
            cli_cases('npm', [node, package / 'bin/dairn.cjs'])
            if not args.smoke:
                run('npm-tests', [node, '--test', ROOT / 'tools/tests/npm-distribution.test.cjs'],
                    override={**env, 'DAIRN_NPM_PACKAGE': str(package)})

        if 'wheel' in selected:
            wheel = built / NAMES['wheel']
            with zipfile.ZipFile(wheel) as zipped:
                assert all(name.startswith(('dairn/', f'dairn-{WHEEL_VERSION}.dist-info/')) for name in zipped.namelist())
                assert {n for n in zipped.namelist() if n.startswith('dairn/')} == {
                    'dairn/__init__.py', 'dairn/cli.py', 'dairn/dairn',
                    'dairn/.dairn/runtime/dairn-embedded.com', 'dairn/.dairn/runtime/runtime-integrity.json'}
                assert zipped.read('dairn/dairn') == (ROOT / 'dairn').read_bytes()
                assert zipped.read('dairn/.dairn/runtime/dairn-embedded.com') == runtime.read_bytes()
                assert b'Tag: py3-none-any' in zipped.read(f'dairn-{WHEEL_VERSION}.dist-info/WHEEL')
                assert zipped.read(f'dairn-{WHEEL_VERSION}.dist-info/licenses/LICENSE') == (ROOT / 'LICENSE').read_bytes()
                metadata = zipped.read(f'dairn-{WHEEL_VERSION}.dist-info/METADATA').decode()
                assert f'Version: {WHEEL_VERSION}' in metadata.splitlines()
                assert 'License: MIT' in metadata.splitlines(), 'Wheel METADATA 必须声明 MIT 许可证'
                assert 'Author: moorefu' in metadata.splitlines(), 'Wheel METADATA 必须声明作者'
                assert 'Author-email: chengmu.fu@gmail.com' in metadata.splitlines(), 'Wheel METADATA 必须声明作者邮箱'
                for name, digest, length in csv.reader(io.StringIO(zipped.read(f'dairn-{WHEEL_VERSION}.dist-info/RECORD').decode())):
                    if digest:
                        data = zipped.read(name)
                        assert len(data) == int(length)
                        assert digest == 'sha256=' + base64.urlsafe_b64encode(hashlib.sha256(data).digest()).decode().rstrip('=')
            virtual = tmp / 'venv'
            venv.EnvBuilder(with_pip=True).create(virtual)
            scripts = virtual / ('Scripts' if os.name == 'nt' else 'bin')
            python = scripts / ('python.exe' if os.name == 'nt' else 'python')
            cli = scripts / ('dairn.exe' if os.name == 'nt' else 'dairn')
            run('wheel-install', [python, '-m', 'pip', 'install', '--no-index', wheel])
            run('wheel-metadata', [python, '-c',
                f'import dairn; assert dairn.__version__ == {WHEEL_VERSION!r}, dairn.__version__'])
            cli_cases('wheel', [cli])
            if not args.smoke:
                destination = tmp / 'pep517'
                run('pep517-checkout-source', [python, '-m', 'pip', 'wheel', '--no-deps', '--no-index', '--wheel-dir', destination, source])
                assert sha(destination / wheel.name) == sha(wheel), '从仓库源码和发布 APE 重建的 Wheel 不一致'
                summary['pep517_reproducible'] = True

        if 'zip' in selected:
            assert (extracted / 'LICENSE').read_bytes() == (ROOT / 'LICENSE').read_bytes(), 'ZIP 必须携带 MIT LICENSE'
            cli = [extracted / 'dairn.cmd'] if os.name == 'nt' else ['/bin/sh', extracted / 'dairn']
            cli_cases('zip', cli)
            summary['zip_source_free'] = True

        if 'zip' in selected and not args.smoke:
            qjs = [str(runtime)] if os.name == 'nt' else ['/bin/sh', str(runtime)]
            # 启动器已在独立空缓存完成首次启动，再验证空 PATH 自举。
            from dairn_build_backend import native_zip
            # 先走正常获取入口填充缓存；再直接用已校验解释器在空 PATH 下自举。
            native_zip(tmp / 'warmup')
            lock = json.loads((ROOT / 'quickjs.lock.json').read_text(encoding='utf-8'))
            bootstrap = Path(env['DAIRN_QUICKJS_CACHE']) / ('qjs-' + lock['binary_sha256'] + '.com')
            command = ([bootstrap] if os.name == 'nt' else ['/bin/sh', bootstrap]) + [
                source / 'tools/build-zip.mjs', '--root', source, '--qjs', bootstrap, '--version', VERSION]
            bare = {**env, 'PATH': ''}
            run('zip-no-language-tools', [*cli, 'version'], cwd=tmp, override=bare)
            native_out = tmp / 'native'
            run('native-bootstrap', [*command, '--out', native_out], cwd=source, override=bare)
            assert sha(native_out / archive.name) == original_zip_hash, '自举 ZIP 字节不一致'
            run('native-policy', [*qjs, source / 'quickjs/tests/test_native.mjs'], cwd=source)
            run('native-host', [*qjs, source / 'quickjs/tests/test_host_native.mjs'], cwd=source,
                override={**env, 'DAIRN_QJS_BIN': str(runtime)})
            engine = source / 'quickjs/core/engine.mjs'
            engine.write_bytes(engine.read_bytes() + '\n// 源码重建验收标记\n'.encode('utf-8'))
            changed = tmp / 'changed'
            run('source-rebuild', [*command, '--out', changed], cwd=source, override=bare)
            runtime_payload(ROOT, changed / archive.name, VERSION)
            changed_root = extract_zip(changed / archive.name, tmp / 'changed-extracted')
            assert sha(changed_root / '.dairn/runtime/dairn-embedded.com') != runtime_hash
            with zipfile.ZipFile(changed_root / '.dairn/runtime/dairn-embedded.com') as zipped:
                assert zipped.read('quickjs/core/engine.mjs') == engine.read_bytes()
            summary.update(identical_zip=True, source_rebuilt=True)

        assert sha(runtime) == runtime_hash, '验收不得修改分发 APE'
        summary['artifacts'] = {p.name: sha(p) for p in built.iterdir() if p.is_file()}
        if not args.artifacts:
            dist = ROOT / 'dist'
            dist.mkdir(exist_ok=True)
            for name in summary['artifacts']:
                shutil.copyfile(built / name, dist / name)
        summary.update(ape_sha256=runtime_hash, packages={name: 'passed' for name in sorted(selected)})
        if args.artifacts and args.smoke:
            summary['checkout_runtime_unchanged'] = (sha(runtime_path) if runtime_path.exists() else None) == before
            assert summary['checkout_runtime_unchanged']


try:
    verify()
    summary['status'] = 'passed'
except Exception as error:
    summary.update(status='failed', error=str(error))
    raise
finally:
    (OUT / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(summary, ensure_ascii=False, indent=2))
