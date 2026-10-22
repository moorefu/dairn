"""为 npm、Wheel、ZIP 三种发布制品写入 SHA256 清单，供各 runner 验收。"""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile
from release_config import artifact_names, load_release

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--dist', type=Path, default=root / 'dist')
args = parser.parse_args()
names = artifact_names(load_release(root))
unexpected = {p.name for p in args.dist.iterdir() if p.is_file()} - set(names.values()) - {'checksums.json'}
if unexpected:
    raise SystemExit('发布目录含有额外制品，请先清理：' + ', '.join(sorted(unexpected)))
hashes = {name: hashlib.sha256((args.dist / name).read_bytes()).hexdigest() for name in names.values()}
with zipfile.ZipFile(args.dist / names['wheel']) as archive:
    ape = hashlib.sha256(archive.read('dairn/runtime/dairn-embedded.com')).hexdigest()
record = {'artifacts': hashes, 'ape_sha256': ape}
(args.dist / 'checksums.json').write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
print(json.dumps(record, indent=2))
