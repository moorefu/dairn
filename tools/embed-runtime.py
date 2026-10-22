"""同步源码、嵌入式资源与 npm 校验信息；不下载或编译任何依赖。"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--qjs', type=Path, help='可选：已验证的 QuickJS APE')
args = parser.parse_args()
runtime = ROOT / 'dairn-embedded.com'
base = (args.qjs or runtime).read_bytes()
manifest_path = ROOT / 'quickjs/assets/manifest.json'
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
sources = sorted([ROOT / 'quickjs/main.mjs', *ROOT.glob('quickjs/core/*.mjs'), *ROOT.glob('quickjs/host/*.mjs')])
manifest['engine_sources'] = [
    {'path': p.relative_to(ROOT).as_posix(), 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()}
    for p in sources
]
for asset in manifest['assets']:
    p = ROOT / 'quickjs/assets' / asset['type'] / asset['path']
    asset['sha256'] = hashlib.sha256(p.read_bytes()).hexdigest()
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
files = {p.relative_to(ROOT).as_posix(): p.read_bytes() for p in sources}
files.update({p.relative_to(ROOT).as_posix(): p.read_bytes() for p in (ROOT / 'quickjs/assets').rglob('*') if p.is_file()})
with zipfile.ZipFile(io.BytesIO(base)) as original:
    prefix = min(i.header_offset for i in original.infolist())
    preserved = [(i, original.read(i)) for i in original.infolist() if not i.filename.startswith('quickjs/')]
buffer = io.BytesIO(base[:prefix])
with zipfile.ZipFile(buffer, 'a', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as target:
    for info, data in preserved:
        target.writestr(info, data)
    for name, data in sorted(files.items()):
        info = zipfile.ZipInfo(name, (2026, 10, 22, 0, 0, 0))
        info.external_attr = 0o100644 << 16
        target.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
binary = buffer.getvalue()
with zipfile.ZipFile(io.BytesIO(binary)) as verified:
    assert verified.testzip() is None
    assert len(verified.namelist()) == len(set(verified.namelist()))
    for name, data in files.items():
        assert verified.read(name) == data, name
runtime.write_bytes(binary)
metadata_path = ROOT / 'runtime-integrity.json'
metadata = json.loads(metadata_path.read_text(encoding='utf-8'))
metadata['sha256'] = hashlib.sha256(binary).hexdigest()
metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
print(json.dumps({'ape_sha256': metadata['sha256'], 'runtime_sha256': hashlib.sha256(manifest_path.read_bytes()).hexdigest()}, indent=2))
