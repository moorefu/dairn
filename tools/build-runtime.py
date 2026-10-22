"""从官方源码下载、校验、打补丁并构建跨平台 APE；在 Linux/WSL 内执行。"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent.parent
LOCK = json.loads((ROOT / 'packaging/quickjs-sources.json').read_text(encoding='utf-8'))


def sha(path):
    with path.open('rb') as stream:
        digest = hashlib.sha256()
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
        return digest.hexdigest()


def download(url, path, expected, offline=False, fallback=None):
    if path.exists():
        if sha(path) != expected:
            raise ValueError('缓存校验失败，请删除该文件后重试：' + str(path))
        return path
    if offline:
        raise FileNotFoundError('离线缓存缺少：' + str(path))
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_suffix(path.suffix + '.part')
    for candidate in [url, fallback]:
        if not candidate:
            continue
        try:
            print('下载：' + candidate, flush=True)
            request = urllib.request.Request(candidate, headers={
                'User-Agent': 'Dairn-build', 'Accept': 'application/octet-stream'})
            with urllib.request.urlopen(request, timeout=120) as response, partial.open('wb') as out:
                shutil.copyfileobj(response, out)
            if sha(partial) != expected:
                raise ValueError('下载 SHA256 不匹配：' + candidate)
            partial.replace(path)
            return path
        except (OSError, ValueError) as error:
            partial.unlink(missing_ok=True)
            last_error = error
    raise last_error


def inside(base, name):
    target = (base / name).resolve()
    if not target.is_relative_to(base.resolve()):
        raise ValueError('归档路径越界：' + name)
    return target


def extract_toolchain(archive, destination):
    # zipfile.extractall 不恢复 Unix 符号链接，会使 GCC 找不到 cc1。
    with zipfile.ZipFile(archive) as zipped:
        links = []
        for entry in zipped.infolist():
            target = inside(destination, entry.filename)
            mode = entry.external_attr >> 16
            if stat.S_ISLNK(mode):
                links.append((target, zipped.read(entry).decode('utf-8')))
            elif entry.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(zipped.read(entry))
                target.chmod((mode & 0o777) or 0o644)
        for target, link in links:
            inside(destination, str(target.parent.relative_to(destination) / link))
            target.parent.mkdir(parents=True, exist_ok=True)
            target.symlink_to(link)
    # 仅转换私有工具链副本；避免 WSLInterop 将 MZ 编译器作为 Windows 程序执行。
    for directory in ['bin', 'libexec']:
        for path in sorted((destination / directory).rglob('*')):
            if path.is_symlink() or not path.is_file():
                continue
            with path.open('rb') as stream:
                magic = stream.read(8)
            if magic.startswith(b'MZqFpD'):
                subprocess.run(['/bin/sh', str(path), '--assimilate'], check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--quickjs-version', default=LOCK['quickjs_version'])
    parser.add_argument('--source-url', help='默认使用 Bellard 对应版本的 tar.xz')
    parser.add_argument('--source-sha256', help='锁文件之外的版本必须显式指定 SHA256')
    parser.add_argument('--cosmocc-version', default=LOCK['cosmocc_version'])
    parser.add_argument('--patch-profile', choices=['windows-cosmo-v1'], default=LOCK['patch_profile'])
    parser.add_argument('--cache', type=Path, default=ROOT / '.build/downloads')
    parser.add_argument('--work', type=Path, default=ROOT / '.build/native')
    parser.add_argument('--offline', action='store_true')
    args = parser.parse_args()
    if sys.platform != 'linux':
        parser.error('原生编译请在 Linux、WSL 或 Linux 容器内运行；打包和使用支持 Windows/macOS')
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', args.quickjs_version):
        parser.error('QuickJS 版本须为 YYYY-MM-DD')
    if args.cosmocc_version != '4.0.2':
        parser.error('windows-cosmo-v1 依赖 cosmocc 4.0.2 内部句柄布局；其他版本需新增补丁配置')
    source = dict(LOCK['quickjs'].get(args.quickjs_version, {}))
    source['url'] = args.source_url or source.get('url') or f'https://bellard.org/quickjs/quickjs-{args.quickjs_version}.tar.xz'
    source['sha256'] = args.source_sha256 or source.get('sha256')
    if not re.fullmatch('[a-fA-F0-9]{64}', source['sha256'] or ''):
        parser.error('此版本没有可信下载校验值，请指定 --source-sha256')
    source['sha256'] = source['sha256'].lower()
    compiler = LOCK['cosmocc'][args.cosmocc_version]
    cache, work = args.cache.resolve(), args.work.resolve()
    work.mkdir(parents=True, exist_ok=True)
    source_file = download(source['url'], cache / f'quickjs-{args.quickjs_version}.tar.xz', source['sha256'], args.offline)
    compiler_file = download(compiler['url'], cache / f'cosmocc-{args.cosmocc_version}.zip', compiler['sha256'], args.offline, compiler.get('asset_api'))
    with tempfile.TemporaryDirectory(prefix='build-', dir=work) as temp:
        base = Path(temp)
        with tarfile.open(source_file, 'r:xz') as archive:
            for entry in archive.getmembers():
                inside(base, entry.name)
                if not entry.isfile() and not entry.isdir():
                    raise ValueError('源码归档包含非普通文件：' + entry.name)
            archive.extractall(base)
        src = base / ('quickjs-' + args.quickjs_version)
        if (src / 'VERSION').read_text().strip() != args.quickjs_version:
            raise ValueError('源码 VERSION 与请求版本不一致')
        toolchain = base / 'cosmocc'
        extract_toolchain(compiler_file, toolchain)
        subprocess.run([sys.executable, str(ROOT / 'tools/patch-quickjs-windows.py'), str(src)], check=True)
        subprocess.run(['/bin/sh', str(ROOT / 'tools/build-quickjs-cosmo.sh'), str(src), str(toolchain)], check=True)
        for test in ['test_language.js', 'test_builtin.js', 'test_loop.js', 'test_std.js']:
            subprocess.run(['/bin/sh', str(src / 'qjs'), '--std', str(src / 'tests' / test)], cwd=src, check=True, timeout=120)
        subprocess.run([sys.executable, str(ROOT / 'tools/embed-runtime.py'), '--qjs', str(src / 'qjs')], check=True)
        (ROOT / 'dairn-embedded.com').chmod(0o755)
        inputs = ['tools/build-runtime.py', 'tools/patch-quickjs-windows.py',
                  'tools/quickjs-windows-redirect.h', 'tools/build-quickjs-cosmo.sh',
                  'tools/embed-runtime.py', 'packaging/quickjs-sources.json']
        record = {
            '说明': '官方源码校验、Windows 补丁、Cosmopolitan 双架构 APE 编译和资源嵌入记录。',
            'quickjs': {'version': args.quickjs_version, **source},
            'cosmocc': {'version': args.cosmocc_version, **compiler},
            'patch_profile': args.patch_profile,
            'build_environment': platform.platform(),
            'inputs': {p: sha(ROOT / p) for p in inputs},
            'patched_quickjs_libc_sha256': sha(src / 'quickjs-libc.c'),
            'qjs_ape_sha256': sha(src / 'qjs'),
            'dairn_ape_sha256': sha(ROOT / 'dairn-embedded.com'),
            'manifest_sha256': sha(ROOT / 'quickjs/assets/manifest.json'),
            'upstream_tests': ['test_language.js', 'test_builtin.js', 'test_loop.js', 'test_std.js'],
        }
        (ROOT / 'packaging/quickjs-build.json').write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(json.dumps(record, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
