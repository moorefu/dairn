"""使用本地 Podman 镜像进行无网络 Linux 回归；兼容无法挂载 Windows 盘符的环境。"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
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
parser.add_argument('--out', type=Path, default=root / 'validation/podman')
parser.add_argument('--timeout',type=int,default=3600,help='完整套件的容器执行超时秒数')
parser.add_argument('--test-user',help='镜像内已有的非 root 测试用户，启用权限负向场景')
parser.add_argument('--quickjs-cache',type=Path,default=Path(os.environ.get('DAIRN_QUICKJS_CACHE',root/'.build/quickjs')),
                    help='预置已由 quickjs.lock.json 固定的本地缓存，不联网下载')
args = parser.parse_args()
if not 60<=args.timeout<=7200:
    parser.error('--timeout 必须为 60..7200 秒')
if args.test_user and not re.fullmatch('[a-z_][a-z0-9_-]*',args.test_user):
    parser.error('--test-user 必须为镜像内已有的安全用户名称')
if args.smoke and not args.artifacts:
    parser.error('--smoke 需要 --artifacts')
image = json.loads(subprocess.check_output(['podman', 'image', 'inspect', args.image]))[0]
runner = 'python3 tools/verify-packages.py --skip-npm --out /results' if args.packages else 'python3 tools/with-built-runtime.py --from-zip /candidate.zip -- python3 tools/verify-linux.py /results'
if args.artifacts:
    runner = 'python3 tools/verify-packages.py --artifacts /artifacts --package ' + args.package + ' --out /results'
    if args.smoke:
        runner += ' --smoke'
    args.runtime_zip = checked_runtime_zip(root, args.artifacts)
if not args.packages and not args.artifacts and not args.runtime_zip:
    parser.error('Linux 回归需要 --runtime-zip，避免依赖固定构建槽')
remote_archive='/'+args.runtime_zip.name if args.runtime_zip else None
if not args.packages and not args.artifacts:
    runner='python3 tools/with-built-runtime.py --from-zip '+shlex.quote(remote_archive)+' -- python3 tools/verify-linux.py /results'
lock=json.loads((root/'quickjs.lock.json').read_text())
bootstrap=args.quickjs_cache/('qjs-'+lock['binary_sha256']+'.com')
if bootstrap.is_symlink() or not bootstrap.is_file() or hashlib.sha256(bootstrap.read_bytes()).hexdigest()!=lock['binary_sha256']:
    parser.error('离线回归需要 quickjs.lock.json 对应的已校验 QuickJS 缓存')
setup='cd /work && mkdir -p /results && chmod +x dairn && '
if args.test_user:
    setup+='chown -R '+shlex.quote(args.test_user)+': /work /results && exec runuser -u '+shlex.quote(args.test_user)+' -- /bin/sh -c '+shlex.quote(runner)
else:
    setup+='exec /bin/sh -c '+shlex.quote(runner)
out=args.out.resolve()
out.mkdir(parents=True,exist_ok=True)
with tempfile.TemporaryFile(dir=out):
    pass
cid = subprocess.check_output([
    'podman', 'create', '--init', '--network', 'none', '--env','DAIRN_OFFLINE=1',
    '--env','DAIRN_CACHE_HOME=/work/.build/ape-cache','--entrypoint', '/bin/sh', args.image,
    '-c', setup,
], text=True).strip()
code=1
result=None
timed_out=False
copy_results=[]
try:
    if args.runtime_zip:
        subprocess.run(['podman', 'cp', str(args.runtime_zip.resolve()), cid + ':'+remote_archive], check=True)
    if args.artifacts:
        subprocess.run(['podman', 'cp', str(args.artifacts.resolve()) + '/.', cid + ':/artifacts'], check=True)
    with tempfile.TemporaryDirectory(prefix='dairn-podman-source-') as temp:
        source = prepare_workspace(root, Path(temp) / 'source', args.runtime_zip)
        cache=source/'.build/quickjs'
        cache.mkdir(parents=True)
        shutil.copyfile(bootstrap,cache/bootstrap.name)
        (cache/bootstrap.name).chmod(0o755)
        subprocess.run(['podman', 'cp', str(source) + '/.', cid + ':/work'], check=True)
    result = subprocess.run(['podman', 'start', '--attach', cid], timeout=args.timeout)
    code = int(subprocess.check_output(['podman', 'inspect', '--format', '{{.State.ExitCode}}', cid]))
except subprocess.TimeoutExpired:
    timed_out=True
    code=124
    print('Podman Linux 套件超时，停止本容器并保留已产生的诊断。',file=sys.stderr)
finally:
    try:
        if timed_out:
            subprocess.run(['podman','stop','--time','5',cid],capture_output=True)
        for source,destination in [('/results/.',out),
                ('/work/validation/source-checks/.',out/'source-checks'),
                ('/work/validation/runtime-builds/.',out/'runtime-builds')]:
            destination.mkdir(parents=True,exist_ok=True)
            copied=subprocess.run(['podman','cp',cid+':'+source,str(destination)],capture_output=True)
            copy_results.append({'path':source,'returncode':copied.returncode})
            if source=='/results/.' and copied.returncode and not code:
                code=1
        with (out/'container.log').open('wb') as stream:
            subprocess.run(['podman','logs',cid],stdout=stream,stderr=subprocess.STDOUT)
        (out / 'podman.json').write_text(json.dumps({
            'image': args.image, 'image_id': image['Id'], 'repo_digests': image.get('RepoDigests', []),
            'network': 'none', 'returncode': code,'timeout_seconds':args.timeout,'test_user':args.test_user,
            'timed_out':timed_out,'diagnostic_copy':copy_results,'quickjs_sha256':lock['binary_sha256'],
        }, indent=2) + '\n', encoding='utf-8')
    finally:
        subprocess.run(['podman', 'rm', '--force', cid], check=True)
sys.exit(code or (result.returncode if result is not None else 1))
