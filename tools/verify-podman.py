"""使用本地 Podman 镜像进行无网络 Linux 回归；兼容无法挂载 Windows 盘符的环境。"""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from source_workspace import checked_runtime_zip, prepare_workspace

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--image', default='docker.io/library/golang:1.27.3-bookworm')
parser.add_argument('--runtime-zip', type=Path, help='从运行 ZIP 装入待测 APE；测试源码来自仓库')
parser.add_argument('--packages', action='store_true', help='使用含 pip/venv 的 Python 镜像验收打包与自举')
parser.add_argument('--artifacts', type=Path, help='在含 Python/npm 的镜像中验收同一套已构建制品')
parser.add_argument('--package', choices=['all', 'npm', 'wheel', 'zip'], default='all')
parser.add_argument('--smoke', action='store_true', help='与 Actions 一致，只执行制品冒烟验证')
parser.add_argument('--out', type=Path, default=root / 'validation/windows')
args = parser.parse_args()
if args.smoke and not args.artifacts:
    parser.error('--smoke 需要 --artifacts')
image = json.loads(subprocess.check_output(['podman', 'image', 'inspect', args.image]))[0]
runner = 'python3 tools/verify-packages.py --skip-npm --out /results' if args.packages else 'python3 tools/verify-linux.py /results'
if args.artifacts:
    runner = 'python3 tools/verify-packages.py --artifacts /artifacts --package ' + args.package + ' --out /results'
    if args.smoke:
        runner += ' --smoke'
    args.runtime_zip = checked_runtime_zip(root, args.artifacts)
cid = subprocess.check_output([
    'podman', 'create', '--network', 'none', '--entrypoint', '/bin/sh', args.image,
    '-c', 'cd /work && chmod +x dairn build.sh && if [ -f runtime/dairn-embedded.com ]; then chmod +x runtime/dairn-embedded.com; fi && if [ -f .dairn/runtime/dairn-embedded.com ]; then chmod +x .dairn/runtime/dairn-embedded.com; fi && ' + runner,
], text=True).strip()
try:
    if args.artifacts:
        subprocess.run(['podman', 'cp', str(args.artifacts.resolve()) + '/.', cid + ':/artifacts'], check=True)
    with tempfile.TemporaryDirectory(prefix='dairn-podman-source-') as temp:
        source = prepare_workspace(root, Path(temp) / 'source', args.runtime_zip)
        subprocess.run(['podman', 'cp', str(source) + '/.', cid + ':/work'], check=True)
    result = subprocess.run(['podman', 'start', '--attach', cid], timeout=600)
    code = int(subprocess.check_output(['podman', 'inspect', '--format', '{{.State.ExitCode}}', cid]))
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    subprocess.run(['podman', 'cp', cid + ':/results/.', str(out)], check=True)
    (out / 'podman.json').write_text(json.dumps({
        'image': args.image, 'image_id': image['Id'], 'repo_digests': image.get('RepoDigests', []),
        'network': 'none', 'returncode': code,
    }, indent=2) + '\n', encoding='utf-8')
finally:
    subprocess.run(['podman', 'rm', '--force', cid], check=True)
sys.exit(code or result.returncode)
