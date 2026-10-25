"""受信 GitHub PCC 核验组件。由隔离部署和独立 GitHub App 发布必需状态。"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request

HEX = re.compile(r'^(?:[0-9a-f]{40}|[0-9a-f]{64})$')


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


class GitHub:
    def __init__(self, token):
        if not token:
            raise ValueError('需要受信 Job 的只读 GitHub Token')
        self.token = token

    def get(self, path):
        if not path.startswith('/repos/') or '..' in path:
            raise ValueError('API 路径无效')
        request = urllib.request.Request('https://api.github.com' + path, headers={
            'Authorization': 'Bearer ' + self.token, 'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28'})
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read(4 * 1024 * 1024 + 1)
            if len(raw) > 4 * 1024 * 1024:
                raise ValueError('API 返回超过上限')
            return json.loads(raw)

    def pages(self, path, key=None):
        values = []
        for page in range(1, 101):
            data = self.get(path + ('&' if '?' in path else '?') + f'per_page=100&page={page}')
            batch = data[key] if key else data
            if not isinstance(batch, list):
                raise ValueError('分页返回结构无效')
            values.extend(batch)
            if len(batch) < 100:
                return values
        raise ValueError('分页不完整')


def evaluate(scm, repository, number, envelope, admin):
    """只消费当前进程从认证 API 取得的原始数据；不接受本地 verified 布尔标记。"""
    reasons, coverage = [], []
    prefix = '/repos/' + repository
    pr = scm.get(prefix + '/pulls/' + str(number))
    subject = envelope['plan']['subject']
    if pr['state'] != 'open' or pr.get('merged'):
        return {'status': 'INDETERMINATE', 'reasons': ['CHANGE_NOT_OPEN']}
    head, base = pr['head']['sha'], pr['base']['sha']
    branch = scm.get(prefix + '/branches/' + urllib.parse.quote(pr['base']['ref'], safe=''))
    if branch.get('protected') is not True:
        return {'status': 'INDETERMINATE', 'reasons': ['POLICY_UNTRUSTED']}
    if (subject.get('repository') != repository or subject.get('source_commit') != head
            or subject.get('base_commit') != base or subject.get('change', {}).get('number') != number
            or subject.get('stage') != 'pre-merge'):
        return {'status': 'FAIL', 'reasons': ['SUBJECT_MISMATCH']}
    tree = scm.get(prefix + '/git/commits/' + head)['tree']['sha']
    if subject.get('tree_sha') != tree:
        return {'status': 'FAIL', 'reasons': ['SUBJECT_MISMATCH']}
    plan = envelope['plan']
    calculated = digest('dairn.governance-plan.v1\n' + canonical(plan))
    if envelope.get('plan_sha256') != calculated:
        return {'status': 'FAIL', 'reasons': ['PLAN_OR_POLICY_MISMATCH']}
    if plan.get('gaps'):
        return {'status': 'INDETERMINATE', 'reasons': ['REQUIRED_EXECUTOR_MISSING']}
    requirements = [r for r in plan['requirements'] if r.get('required')]
    if not requirements:
        return {'status': 'INDETERMINATE', 'reasons': ['REQUIRED_CHECK_MISSING']}
    requirement_ids = [requirement['id'] for requirement in requirements]
    if len(set(requirement_ids)) != len(requirement_ids):
        return {'status': 'FAIL', 'reasons': ['REQUIREMENT_ID_CONFLICT']}
    checks = scm.pages(prefix + '/commits/' + head + '/check-runs', 'check_runs')
    for requirement in requirements:
        key = requirement['id']
        executors = [e for e in plan.get('executors', []) if e.get('requirement_id') == key]
        if len(executors) > 1:
            coverage.append({'id': key, 'status': 'FAIL', 'reason': 'REQUIREMENT_ID_CONFLICT'})
            continue
        executor = executors[0] if executors else None
        if not executor or not executor.get('argv'):
            coverage.append({'id':key,'status':'INDETERMINATE','reason':'REQUIRED_EXECUTOR_MISSING'})
            continue
        source = admin['requirements'].get(key)
        if not source:
            coverage.append({'id': key, 'status': 'INDETERMINATE', 'reason': 'REQUIRED_EXECUTOR_MISSING'})
            continue
        # GitHub Actions 的共享 App 不能区分 PR 自造的同名 job。必须使用隔离的专用 App。
        app_id = source.get('app_id')
        if not isinstance(app_id, int) or app_id <= 0 or app_id == 15368:
            coverage.append({'id': key, 'status': 'INDETERMINATE', 'reason': 'SCM_ORIGIN_UNVERIFIED'})
            continue
        matches = [c for c in checks if c.get('name') == source['check_name'] and c.get('app', {}).get('id') == app_id]
        if not matches:
            coverage.append({'id': key, 'status': 'INDETERMINATE', 'reason': 'REQUIRED_CHECK_MISSING'})
            continue
        latest = max(matches, key=lambda c: c['id'])
        binding = 'pcc:' + calculated + ':' + digest(key) + ':' + head
        if latest.get('head_sha') != head or latest.get('external_id') != binding:
            result, reason = 'FAIL', 'PLAN_OR_POLICY_MISMATCH'
        elif latest.get('status') != 'completed':
            result, reason = 'INDETERMINATE', 'REQUIRED_CHECK_PENDING'
        elif latest.get('conclusion') != 'success':
            result, reason = 'FAIL', 'REQUIRED_CHECK_FAILED'
        else:
            result, reason = 'PASS', 'AUTHENTICATED_SCM_CHECK'
        coverage.append({'id': key, 'status': result, 'reason': reason, 'check_run_id': latest['id']})
    reviews = scm.pages(prefix + '/pulls/' + str(number) + '/reviews')
    latest_reviews = {}
    for review in sorted(reviews, key=lambda r: r['id']):
        if review.get('state') == 'COMMENTED':
            continue
        login = review.get('user', {}).get('login', '').lower()
        if login:
            latest_reviews[login] = review
    author = pr['user']['login'].lower()
    approved = set()
    for login, review in latest_reviews.items():
        if login == author or review.get('user', {}).get('type') != 'User':
            continue
        if review.get('state') not in ('APPROVED', 'CHANGES_REQUESTED'):
            continue
        permission = scm.get(prefix + '/collaborators/' + urllib.parse.quote(login, safe='') + '/permission')
        if permission.get('permission') not in ('write', 'maintain', 'admin'):
            continue
        if review.get('state') == 'CHANGES_REQUESTED':
            reasons.append('APPROVAL_CHANGES_REQUESTED')
        if review.get('state') == 'APPROVED' and review.get('commit_id') == head:
            approved.add(login)
    required_count = max([admin.get('min_approvals', 0)] + [max(1, a.get('min_count', 1))
                         for a in plan.get('approvals', []) if a.get('required')])
    if len(approved) < required_count:
        reasons.append('APPROVAL_PENDING')
    # 查询期间 Head/Base 移动同样不能放行。
    current = scm.get(prefix + '/pulls/' + str(number))
    if current['head']['sha'] != head or current['base']['sha'] != base:
        reasons.append('SUBJECT_CHANGED_DURING_VERIFICATION')
    failed = any(c['status'] == 'FAIL' for c in coverage) or 'APPROVAL_CHANGES_REQUESTED' in reasons
    pending = any(c['status'] == 'INDETERMINATE' for c in coverage) or bool(reasons)
    return {'schema': 'dairn.pcc-verdict.v1', 'status': 'FAIL' if failed else 'INDETERMINATE' if pending else 'PASS',
            'subject': subject, 'plan_sha256': calculated, 'coverage': coverage,
            'reasons': reasons, 'approval_count': len(approved), 'source': 'authenticated-github-api'}


def trusted_plan(root, admin, scm, repository, number, admin_hash=None):
    pr = scm.get('/repos/' + repository + '/pulls/' + str(number))
    head, base = pr['head']['sha'], pr['base']['sha']
    if not HEX.fullmatch(head) or not HEX.fullmatch(base):
        raise ValueError('SCM Subject SHA 无效')
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
    if commit != head:
        raise ValueError('SUBJECT_MISMATCH: checkout 不是当前 PR Head')
    runtime = Path(admin['runtime'])
    if not runtime.is_absolute() or runtime.is_symlink() or runtime.resolve().is_relative_to(root):
        raise ValueError('Verifier 必须位于 checkout 之外')
    if hashlib.sha256(runtime.read_bytes()).hexdigest() != admin['runtime_sha256']:
        raise ValueError('Verifier pin 不匹配')
    command = [str(runtime)] if os.name == 'nt' else ['/bin/sh', str(runtime)]
    # 解释器默认进入嵌入 CLI，策略/契约由固定 Base 读取，不执行 PR Verifier。
    with tempfile.TemporaryDirectory(prefix='dairn-pcc-policy-') as directory:
        options=[]
        if admin.get('organization_policy'):
            floor=Path(directory)/'floor.json'
            floor.write_text(json.dumps(admin['organization_policy']),encoding='utf-8')
            options=['--organization-policy',str(floor)]
        raw = subprocess.check_output(command + ['governance', 'plan', '--base', base, '--root', str(root), '--json', *options],
                                      cwd=root, timeout=120, text=True)
    envelope = json.loads(raw)
    plan = envelope['plan']
    plan['subject'].update(stage='pre-merge', change={'number': number})
    plan['authority'].update(source='protected-base+admin-pin', protected_base_commit=base,
                             verifier_sha256=admin['runtime_sha256'],admin_policy_sha256=admin_hash)
    for requirement in plan['requirements']:
        requirement['subject_binding']=digest(canonical(plan['subject']))
        requirement['authority']={'kind':'effective-protected-contract' if requirement.get('scope',{}).get('kind')=='contract' else 'protected-base+organization-floor','ref':base}
    envelope['plan_sha256'] = digest('dairn.governance-plan.v1\n' + canonical(plan))
    return envelope


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path.cwd())
    parser.add_argument('--admin-config', type=Path, required=True)
    parser.add_argument('--admin-sha256', required=True)
    parser.add_argument('--repository', required=True)
    parser.add_argument('--pull-request', type=int, required=True)
    args = parser.parse_args()
    try:
        root = args.root.resolve()
        admin_path = args.admin_config.resolve()
        if admin_path.is_relative_to(root) or args.admin_config.is_symlink():
            raise ValueError('管理员配置必须在 checkout 之外')
        raw = admin_path.read_text(encoding='utf-8')
        if digest(raw) != args.admin_sha256:
            raise ValueError('POLICY_UNTRUSTED: 管理员配置摘要不匹配')
        admin = json.loads(raw)
        if admin.get('schema') != 'dairn.pcc-admin.v1' or not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', args.repository) or args.pull_request <= 0:
            raise ValueError('管理员协议或 SCM 标识无效')
        scm = GitHub(os.environ.get('DAIRN_GITHUB_TOKEN'))
        envelope = trusted_plan(root, admin, scm, args.repository, args.pull_request,args.admin_sha256)
        verdict = evaluate(scm, args.repository, args.pull_request, envelope, admin)
    except Exception as error:
        # 不输出 Token、HTTP body、原始命令或私人文件内容。
        verdict = {'schema': 'dairn.pcc-verdict.v1', 'status': 'INDETERMINATE',
                   'reasons': ['VERIFICATION_UNAVAILABLE'], 'error_type': type(error).__name__}
    print(json.dumps(verdict, ensure_ascii=False, indent=2))
    return 0 if verdict['status'] == 'PASS' else 1 if verdict['status'] == 'FAIL' else 3


if __name__ == '__main__':
    sys.exit(main())
