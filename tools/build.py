"""Python 构建入口：由 QuickJS 自举生成运行 ZIP，并打包跨平台 Wheel。"""
import argparse
from pathlib import Path
import tempfile
from dairn_build_backend import ROOT, native_zip, source_files, wheel_from_files

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--out', type=Path, default=ROOT / 'dist')
parser.add_argument('--runtime-out', type=Path, help='写入尚不存在的独占候选目录；由调用方清理')
args = parser.parse_args()
out = args.out.resolve()
(ROOT / '.build/runs').mkdir(parents=True,exist_ok=True)
with tempfile.TemporaryDirectory(prefix='package-python-',dir=ROOT / '.build/runs') as temp:
    stage = Path(temp) / 'source'
    archive = native_zip(out, stage, args.runtime_out)
    print(out / wheel_from_files(source_files(stage), out))
    print(archive)
