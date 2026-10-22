"""用仓库测试源码和已校验的发布 APE 准备独立回归目录。"""
import argparse
from pathlib import Path
from source_workspace import checked_runtime_zip, prepare_workspace

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('artifacts', type=Path)
parser.add_argument('--out', type=Path, required=True)
args = parser.parse_args()
archive = checked_runtime_zip(root, args.artifacts)
print(prepare_workspace(root, args.out, archive))
