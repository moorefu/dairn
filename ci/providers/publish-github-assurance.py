"""可选隔离 Publisher：调用固定离线核验器，只发布一个机器保障 Check，不枚举 SCM 状态。"""
import hashlib
import types
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.request

CHECK_NAME = 'Dairn / Required Assurance'


def external_pin(path, expected, root):
    path = Path(path)
    if (not path.is_absolute() or path.is_symlink() or path.resolve().is_relative_to(root)
            or not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != expected):
        raise ValueError('Publisher 入口/配置 pin 无效')
    return path.resolve()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError('Publisher 禁止 HTTP 重定向')


def post(repository, payload, token):
    if not re.fullmatch(r'(?!\.{1,2}/)[A-Za-z0-9_.-]+/(?!\.{1,2}$)[A-Za-z0-9_.-]+',repository):
        raise ValueError('Publisher 仓库路径无效')
    if not token:
        raise ValueError('独立 Publisher 缺少发布凭据')
    request = urllib.request.Request('https://api.github.com/repos/' + repository + '/check-runs',
        data=json.dumps(payload).encode('utf-8'), method='POST', headers={
        'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28'})
    with urllib.request.build_opener(NoRedirect()).open(request, timeout=30) as response:
        raw = response.read(1024*1024+1)
        if len(raw) > 1024*1024:
            raise ValueError('Publisher 响应超过上限')
        data = json.loads(raw)
        if data.get('head_sha') != payload['head_sha'] or data.get('name') != CHECK_NAME:
            raise ValueError('Publisher 响应身份不符')
        return data['id']


def publish(verifier, args, send=post):
    if args.execute:
        raise ValueError('Publisher 不能执行项目测试')
    admin = verifier.load_admin(args.root.resolve(), args.admin_config, args.admin_sha256)
    if not admin.get('expected_jobs') or not args.needs or not args.runs or args.check:
        raise ValueError('Publisher 只消费固定直接依赖及其摘要绑定的 Run 清单')
    verifier.external_file(args.needs,args.root.resolve())
    external_pin(admin['publisher'], admin['publisher_sha256'], args.root.resolve())
    if Path(admin['publisher']).resolve() != Path(__file__).resolve():
        raise ValueError('Publisher 与固定配置不符')
    if args.repository != admin['repository'] or not verifier.HEX.fullmatch(args.head):
        raise ValueError('Publisher Subject 无效')
    head = subprocess.check_output(['git','rev-parse','HEAD'], cwd=args.root, text=True, timeout=30).strip()
    if head != args.head:
        raise ValueError('Publisher checkout Head 不符')
    try:
        verdict = verifier.verify(args)
    except Exception as error:
        verdict = verifier.unavailable(error)
    status = verdict['status']
    payload = {'name': CHECK_NAME, 'head_sha': args.head, 'status': 'completed',
               'conclusion': 'success' if status == 'PASS' else 'failure',
               'external_id': 'pcc:machine:' + str(verdict.get('plan_sha256') or 'unknown') + ':' + args.head,
               'output': {'title': 'Machine assurance: ' + status,
                          'summary': 'Human approval: delegated to SCM\nMerge eligibility: not evaluated locally'}}
    check_id = send(args.repository, payload, os.environ.get('DAIRN_GITHUB_TOKEN'))
    return {'check_run_id': check_id, 'status': status, 'scope': 'machine-assurance',
            'human_approval': 'delegated-to-scm', 'merge_eligibility': 'not-evaluated'}


def main():
    try:
        # 配置与 verifier 都在 checkout 外固定，先核对摘要才加载 Python 代码。
        import argparse
        bootstrap = argparse.ArgumentParser(add_help=False)
        bootstrap.add_argument('--root', type=Path, default=Path.cwd())
        bootstrap.add_argument('--admin-config', type=Path, required=True)
        bootstrap.add_argument('--admin-sha256', required=True)
        known, _ = bootstrap.parse_known_args()
        config = external_pin(known.admin_config, known.admin_sha256, known.root.resolve())
        raw=config.read_bytes()
        if hashlib.sha256(raw).hexdigest()!=known.admin_sha256:
            raise ValueError('Publisher 配置在读取时改变')
        admin = json.loads(raw)
        path = external_pin(admin['verifier'], admin['verifier_sha256'], known.root.resolve())
        source=path.read_bytes()
        if hashlib.sha256(source).hexdigest()!=admin['verifier_sha256']:
            raise ValueError('Verifier 在读取时改变')
        verifier=types.ModuleType('dairn_fixed_pcc')
        verifier.__file__=str(path)
        # 只执行刚刚核对摘要的源码，不读取独立的、未绑定 pin 的 pyc 缓存。
        exec(compile(source,str(path),'exec'),verifier.__dict__)
        args = verifier.parser().parse_args()
        result = publish(verifier, args)
    except Exception as error:
        print(json.dumps({'status':'INDETERMINATE','scope':'machine-assurance',
                          'error_type':type(error).__name__}))
        return 3
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result['status'] == 'PASS' else 1


if __name__ == '__main__':
    sys.exit(main())
