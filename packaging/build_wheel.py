"""兼容原有入口；统一构建 py3-none-any Wheel。"""
import argparse
from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))
from dairn_build_backend import build_wheel
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--out', type=Path, default=ROOT / 'dist')
args = parser.parse_args()
print(args.out / build_wheel(args.out))
