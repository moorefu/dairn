"""为 npm、Wheel、ZIP 三种发布制品写入 SHA256 清单，供各 runner 验收。"""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--dist', type=Path, default=root / 'dist')
args = parser.parse_args()
release = json.loads((root / 'packaging/release.json').read_text(encoding='utf-8'))
version = release['version']
names = [f'dairn-{version}-py3-none-any.whl',
         f'dairn-{version}.zip', f'dairn-{release["npm_version"]}.tgz']
unexpected = {p.name for p in args.dist.iterdir() if p.is_file()} - set(names) - {'checksums.json'}
if unexpected:
    raise SystemExit('发布目录含有额外制品，请先清理：' + ', '.join(sorted(unexpected)))
hashes = {name: hashlib.sha256((args.dist / name).read_bytes()).hexdigest() for name in names}
with zipfile.ZipFile(args.dist / names[0]) as archive:
    ape = hashlib.sha256(archive.read('dairn/runtime/dairn-embedded.com')).hexdigest()
record = {'artifacts': hashes, 'ape_sha256': ape}
(args.dist / 'checksums.json').write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
print(json.dumps(record, indent=2))
