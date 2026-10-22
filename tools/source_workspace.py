"""为构建回归暂存仓库源码，并装入本次发布的运行时。"""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import zipfile


def zip_paths(root):
    return {'dairn.cmd', 'dairn.sh', 'runtime/dairn-embedded.com', 'runtime/runtime-integrity.json'} | {
        p.relative_to(root).as_posix() for p in (root / 'licenses').rglob('*') if p.is_file()}


def runtime_payload(root, archive):
    release = json.loads((root / 'packaging/release.json').read_text(encoding='utf-8'))
    prefix = f'{release["name"]}-{release["version"]}/'
    with zipfile.ZipFile(archive) as zipped:
        expected = {prefix + name for name in zip_paths(root)}
        if set(zipped.namelist()) != expected or len(zipped.namelist()) != len(expected):
            raise ValueError('运行 ZIP 必须只包含启动器、runtime 和许可证，不得夹带源码')
        if zipped.testzip() is not None:
            raise ValueError('运行 ZIP 校验失败')
        binary = zipped.read(prefix + 'runtime/dairn-embedded.com')
        integrity = zipped.read(prefix + 'runtime/runtime-integrity.json')
    if json.loads(integrity)['sha256'] != hashlib.sha256(binary).hexdigest():
        raise ValueError('运行 ZIP 内 APE 校验失败')
    return binary, integrity


def checked_runtime_zip(root, artifacts):
    record = json.loads((artifacts / 'checksums.json').read_text(encoding='utf-8'))
    name, = [name for name in record['artifacts'] if name.endswith('.zip')]
    if Path(name).name != name or '/' in name or '\\' in name:
        raise ValueError('制品文件名越界')
    archive = artifacts / name
    if hashlib.sha256(archive.read_bytes()).hexdigest() != record['artifacts'][name]:
        raise ValueError('发布 ZIP 指纹不匹配')
    binary, _ = runtime_payload(root, archive)
    if hashlib.sha256(binary).hexdigest() != record['ape_sha256']:
        raise ValueError('发布 APE 指纹不匹配')
    return archive


def prepare_workspace(root, destination, archive=None):
    """源码来自 checkout 白名单；APE 来自待测 ZIP，均不修改原件。"""
    root, destination = root.resolve(), destination.resolve()
    release = json.loads((root / 'packaging/release.json').read_text(encoding='utf-8'))
    excluded = {'dist', 'node_modules', '__pycache__', '.git', '.pytest_cache'}
    destination.mkdir(parents=True, exist_ok=False)

    def copy(relative):
        if set(relative.parts) & excluded or relative.suffix in {'.pyc', '.pyo'}:
            return
        source, target = root / relative, destination / relative
        if source.is_symlink() or getattr(source, 'is_junction', lambda: False)():
            raise ValueError('源码暂存拒绝链接：' + str(relative))
        if source.is_dir():
            target.mkdir(parents=True, exist_ok=True)
            for child in sorted(source.iterdir()):
                copy(relative / child.name)
        elif source.is_file():
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
            if os.name != 'nt':
                target.chmod(0o755 if target.suffix in {'.sh', '.com'} or relative.as_posix() == 'bin/dairn.cjs' else 0o644)
        else:
            raise ValueError('缺少构建输入：' + str(relative))

    for name in release['source_paths']:
        relative = PurePosixPath(name)
        if relative.is_absolute() or '..' in relative.parts or '\\' in name or ':' in name:
            raise ValueError('非法源码路径：' + name)
        copy(Path(name))
    if archive is not None:
        binary, integrity = runtime_payload(root, archive)
        (destination / 'dairn-embedded.com').write_bytes(binary)
        (destination / 'runtime-integrity.json').write_bytes(integrity)
        # 原生编译可选择不同 QuickJS 版本，回归必须使用下载的 APE 和内嵌 manifest。
        with zipfile.ZipFile(destination / 'dairn-embedded.com') as zipped:
            (destination / 'quickjs/assets/manifest.json').write_bytes(zipped.read('quickjs/assets/manifest.json'))
    return destination
