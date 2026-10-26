"""PEP 517 后端；获取上游 QuickJS 后自举打包。"""
import base64
import gzip
import hashlib
import io
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import zipfile
from release_config import load_release

ROOT = Path(__file__).resolve().parent.parent
RELEASE = load_release(ROOT)
VERSION = RELEASE['python_version']
DIST = RELEASE['python_name'].replace('-', '_')
META = f'{DIST}-{VERSION}.dist-info'
TAG = 'py3-none-any'

def get_requires_for_build_wheel(config_settings=None):
    return []

def get_requires_for_build_sdist(config_settings=None):
    return []

def native_zip(destination, stage=None, runtime_out=None):
    destination = Path(destination).resolve()
    fetch = (['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
              str(ROOT / 'tools/bootstrap.ps1'), '-FetchOnly'] if sys.platform == 'win32'
             else ['/bin/sh', str(ROOT / 'tools/bootstrap.sh'), '--fetch-only'])
    binary = subprocess.check_output(fetch, cwd=ROOT, text=True, encoding='utf-8').strip()
    args = [str(ROOT / 'tools/build-zip.mjs'), '--root', str(ROOT), '--qjs', binary,
            '--out', str(destination), '--version', RELEASE['version']]
    if runtime_out is not None:
        args.extend(['--runtime-out', str(Path(runtime_out).absolute())])
    if stage is not None:
        args.extend(['--stage', str(Path(stage).resolve())])
    if sys.platform == 'win32':
        command = [str(binary), *args]
    else:
        command = ['/bin/sh', str(binary), *args]
    subprocess.run(command, cwd=ROOT, check=True)
    return destination / f"{RELEASE['name']}-{RELEASE['version']}.zip"

def source_files(stage):
    """读取 QuickJS 的内部源码暂存区，发布 ZIP 不参与源码传递。"""
    stage = Path(stage)
    return {p.relative_to(stage).as_posix(): p.read_bytes() for p in stage.rglob('*') if p.is_file()}

def metadata():
    return (f'Metadata-Version: 2.1\nName: {RELEASE["python_name"]}\nVersion: {VERSION}\n'
            'Summary: 基于原生 QuickJS 的开发治理内核\nRequires-Python: >=3.10\n'
            'License: MIT\n'
            'Classifier: License :: OSI Approved :: MIT License\n'
            'Author: moorefu\nAuthor-email: chengmu.fu@gmail.com\n'
            'Description-Content-Type: text/markdown\n\n' + (ROOT / 'README.md').read_text(encoding='utf-8')).encode('utf-8')

def wheel_from_files(files, destination):
    entries = {
        f'{DIST}/__init__.py': files['src/dairn/__init__.py'],
        f'{DIST}/cli.py': files['src/dairn/cli.py'],
        f'{DIST}/dairn': files['dairn'],
        f'{DIST}/.dairn/runtime/dairn-embedded.com': files['dairn-embedded.com'],
        f'{DIST}/.dairn/runtime/runtime-integrity.json': files['runtime-integrity.json'],
        f'{META}/licenses/LICENSE': files['LICENSE'],
        f'{META}/METADATA': metadata(),
        f'{META}/WHEEL': f'Wheel-Version: 1.0\nGenerator: Dairn\nRoot-Is-Purelib: true\nTag: {TAG}\n'.encode(),
        f'{META}/entry_points.txt': b'[console_scripts]\ndairn = dairn.cli:main\n',
        f'{META}/top_level.txt': (DIST + '\n').encode(),
    }
    entries.update({f'{META}/licenses/{Path(p).name}': data for p, data in files.items() if p.startswith('licenses/')})
    records = []
    for name, data in sorted(entries.items()):
        digest = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).decode().rstrip('=')
        records.append(f'{name},sha256={digest},{len(data)}')
    records.append(f'{META}/RECORD,,')
    entries[f'{META}/RECORD'] = ('\n'.join(records) + '\n').encode()
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    name = f'{DIST}-{VERSION}-{TAG}.whl'
    with zipfile.ZipFile(destination / name, 'w') as zipped:
        for path, data in sorted(entries.items()):
            info = zipfile.ZipInfo(path, (2026, 10, 22, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (0o100755 if path.endswith('.com') or path == f'{DIST}/dairn' else 0o100644) << 16
            zipped.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    return name

def sdist_from_files(files, destination):
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    stem = f'{DIST}-{VERSION}'
    name = stem + '.tar.gz'
    entries = {**files, 'PKG-INFO': metadata()}
    with (destination / name).open('wb') as stream, gzip.GzipFile(filename='', fileobj=stream, mode='wb', mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode='w', format=tarfile.PAX_FORMAT) as tar:
            for path, data in sorted(entries.items()):
                info = tarfile.TarInfo(stem + '/' + path)
                info.size = len(data)
                info.mode = 0o755 if path.endswith(('.sh', '.com')) or path in {'bin/dairn.cjs', 'dairn'} else 0o644
                info.mtime = 1792627200
                tar.addfile(info, io.BytesIO(data))
    return name

def build_wheel(wheel_directory, config_settings=None, metadata_directory=None):
    (ROOT / '.build/runs').mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='package-wheel-',dir=ROOT / '.build/runs') as temp:
        stage = Path(temp) / 'source'
        native_zip(temp, stage)
        return wheel_from_files(source_files(stage), wheel_directory)

def build_sdist(sdist_directory, config_settings=None):
    (ROOT / '.build/runs').mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='package-sdist-',dir=ROOT / '.build/runs') as temp:
        stage = Path(temp) / 'source'
        native_zip(temp, stage)
        return sdist_from_files(source_files(stage), sdist_directory)
