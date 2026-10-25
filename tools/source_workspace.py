"""为构建回归暂存仓库源码，并装入本次发布的运行时。"""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import zipfile
from release_config import load_release, version_from_archive, version_from_artifacts


def zip_paths(root):
    return {'LICENSE', 'dairn', 'dairn.cmd', '.dairn/runtime/dairn-embedded.com',
            '.dairn/runtime/runtime-integrity.json'} | {
        p.relative_to(root).as_posix() for p in (root / 'licenses').rglob('*') if p.is_file()}


def runtime_payload(root, archive, version=None):
    # 已构建制品的版本从运行 ZIP 文件名恢复；显式传入时以调用方为准。
    if version is None:
        version = version_from_archive(root, archive)
    release = load_release(root, version=version)
    prefix = f'{release["name"]}-{release["version"]}/'
    with zipfile.ZipFile(archive) as zipped:
        expected = {prefix + name for name in zip_paths(root)}
        if set(zipped.namelist()) != expected or len(zipped.namelist()) != len(expected):
            raise ValueError('运行 ZIP 必须只包含启动器、runtime 和许可证，不得夹带源码')
        if zipped.testzip() is not None:
            raise ValueError('运行 ZIP 校验失败')
        for launcher in ('dairn', 'dairn.cmd'):
            if zipped.read(prefix + launcher) != (root / launcher).read_bytes():
                raise ValueError('ZIP 启动器必须与仓库唯一来源一致：' + launcher)
        binary = zipped.read(prefix + '.dairn/runtime/dairn-embedded.com')
        integrity = zipped.read(prefix + '.dairn/runtime/runtime-integrity.json')
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
    binary, _ = runtime_payload(root, archive, version_from_artifacts(root, artifacts))
    if hashlib.sha256(binary).hexdigest() != record['ape_sha256']:
        raise ValueError('发布 APE 指纹不匹配')
    return archive


def prepare_workspace(root, destination, archive=None, version=None):
    """源码来自 checkout 白名单；APE 来自待测 ZIP，均不修改原件。"""
    root, destination = root.resolve(), destination.resolve()
    # 复用已构建制品时，版本必须随 ZIP 文件名走，不能重新按当前时间生成 nightly。
    if version is None and archive is not None:
        version = version_from_archive(root, archive)
    release = load_release(root, version=version)
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
                target.chmod(0o755 if target.suffix in {'.sh', '.com'} or relative.as_posix() in {'bin/dairn.cjs', 'dairn'} else 0o644)
        else:
            raise ValueError('缺少构建输入：' + str(relative))

    for name in release['source_paths']:
        relative = PurePosixPath(name)
        if relative.is_absolute() or '..' in relative.parts or '\\' in name or ':' in name:
            raise ValueError('非法源码路径：' + name)
        copy(Path(name))
    if archive is not None:
        binary, integrity = runtime_payload(root, archive, release['version'])
        # 仓库根 runtime/ 是 verify-linux 的 DAIRN_RUNTIME 构建槽；.dairn/runtime
        # 是根启动器实际执行的治理运行时，回归必须使用待测 ZIP 的载荷。
        for relative in ('runtime', '.dairn/runtime'):
            target = destination / relative
            target.mkdir(parents=True, exist_ok=True)
            (target / 'dairn-embedded.com').write_bytes(binary)
            (target / 'dairn-embedded.com').chmod(0o755)
            (target / 'runtime-integrity.json').write_bytes(integrity)
        # 回归使用本次发布的运行时及其内嵌 manifest。
        with zipfile.ZipFile(destination / 'runtime/dairn-embedded.com') as zipped:
            (destination / 'quickjs/assets/manifest.json').write_bytes(zipped.read('quickjs/assets/manifest.json'))
    return destination
