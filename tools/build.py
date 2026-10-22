"""Python 构建入口：生成跨平台 Wheel 和运行 ZIP，不需要 Node。"""
import argparse
from pathlib import Path
import tempfile
from dairn_build_backend import ROOT, native_zip, source_files, wheel_from_files

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--out', type=Path, default=ROOT / 'dist')
args = parser.parse_args()
out = args.out.resolve()
with tempfile.TemporaryDirectory(prefix='dairn-build-') as temp:
    stage = Path(temp) / 'source'
    archive = native_zip(out, stage)
    print(out / wheel_from_files(source_files(stage), out))
    print(archive)
