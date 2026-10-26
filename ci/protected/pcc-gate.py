"""固定管理员配置与本地 Git 身份，调用固定 Runtime 核对机器保障；不访问 SCM API。"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

HEX = re.compile(r'^(?:[0-9a-f]{40}|[0-9a-f]{64})$')
REPOSITORY = re.compile(r'^(?!\.{1,2}/)[A-Za-z0-9_.-]+/(?!\.{1,2}$)[A-Za-z0-9_.-]+$')


def digest_file(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def external_file(path, root):
    path = Path(path)
    if not path.is_absolute() or path.is_symlink() or path.resolve().is_relative_to(root) or not path.is_file():
        raise ValueError('受信文件必须是 checkout 外的绝对普通文件')
    return path.resolve()


def load_admin(root, path, expected):
    path = external_file(path, root)
    raw=path.read_bytes()
    if not re.fullmatch(r'[0-9a-f]{64}', expected) or hashlib.sha256(raw).hexdigest() != expected:
        raise ValueError('POLICY_UNTRUSTED: 管理员配置摘要不符')
    admin = json.loads(raw)
    if admin.get('schema') != 'dairn.pcc-admin.v1' or not REPOSITORY.fullmatch(admin.get('repository', '')):
        raise ValueError('管理员配置协议或仓库无效')
    if any(key in admin for key in ('requirements', 'min_approvals')):
        raise ValueError('旧在线核验配置不再受支持；审批改由 SCM 执行')
    jobs=admin.get('expected_jobs')
    if jobs is not None and (not isinstance(jobs,list) or not jobs or any(not isinstance(j,str) or not j for j in jobs) or len(set(jobs))!=len(jobs)):
        raise ValueError('预期作业必须是预先固定的非空唯一集合')
    for key in ('runtime', 'launcher', 'verifier'):
        candidate = external_file(admin[key], root)
        if digest_file(candidate) != admin.get(key + '_sha256'):
            raise ValueError('受信入口 pin 不匹配')
    if Path(admin['verifier']).resolve() != Path(__file__).resolve():
        raise ValueError('核验入口与固定配置不符')
    return admin


def verify(args):
    if not 1<=args.timeout<=3600:
        raise ValueError('超时必须在 1 到 3600 秒内')
    root = args.root.resolve()
    admin = load_admin(root, args.admin_config, args.admin_sha256)
    if args.repository != admin['repository'] or not HEX.fullmatch(args.base) or not HEX.fullmatch(args.head):
        raise ValueError('SUBJECT_MISMATCH: 仓库或不可变 Base/Head 无效')
    def git(*argv):
        return subprocess.check_output(['git', *argv], cwd=root, text=True, timeout=30).strip()
    if git('rev-parse', 'HEAD') != args.head or git('rev-parse', args.base + '^{commit}') != args.base:
        raise ValueError('SUBJECT_MISMATCH: checkout 身份不符')
    subject = {'schema': 'dairn.subject.v1', 'repository': args.repository, 'kind': 'git-commit',
               'source_commit': args.head, 'tree_sha': git('rev-parse', 'HEAD^{tree}'),
               'base_commit': args.base, 'comparison': 'base-to-source', 'stage': 'pre-merge'}
    runtime = admin['runtime']
    invocation = [admin['launcher']]
    # Publisher 调用此入口时不执行项目检查；子进程也不继承发布凭据或签名密钥路径。
    env = {key: value for key, value in os.environ.items() if key not in
           ('DAIRN_GITHUB_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN', 'DAIRN_SIGNING_PRIVATE_KEY_PATH',
            '_COSMO_FDS', '_COSMO_FDS_V2')}
    env.update(DAIRN_CI_REPOSITORY=args.repository,DAIRN_RUNTIME=runtime,DAIRN_RUNTIME_DIR=str(Path(runtime).parent))
    with tempfile.TemporaryDirectory(prefix='dairn-pcc-input-') as directory:
        directory = Path(directory)
        if os.name!='nt' and not env.get('DAIRN_CACHE_HOME'):
            env['DAIRN_CACHE_HOME']=str(directory/'ape-cache')
        context = directory / 'context.json'
        context.write_text(json.dumps({'subject': subject, 'authority': {
            'source': 'git-base+admin-pin', 'protected_base_commit': args.base,
            'verifier_sha256': admin['runtime_sha256'], 'admin_policy_sha256': args.admin_sha256}}), encoding='utf-8')
        common = ['--base', args.base, '--context', str(context), '--root', str(root), '--json']
        if admin.get('organization_policy'):
            floor = directory / 'floor.json'
            floor.write_text(json.dumps(admin['organization_policy']), encoding='utf-8')
            common += ['--organization-policy', str(floor)]
        def invoke(argv):
            result = subprocess.run(invocation + argv, cwd=root, env=env, capture_output=True,
                                    text=True, encoding='utf-8', timeout=args.timeout)
            if not result.stdout.strip():
                raise ValueError('固定 Runtime 未返回机器裁决')
            return result.returncode, json.loads(result.stdout)
        if args.execute:
            if args.needs or len(admin.get('expected_jobs',[]))>1:
                raise ValueError('分片执行应由各作业显式执行 Requirement；聚合入口只核对结果')
            code, verdict = invoke(['governance', 'execute', *common, '--assurance', '--timeout', str(args.timeout)])
        else:
            command = ['gate', 'evaluate', *common]
            if args.check:
                command += ['--check', args.check]
            elif args.runs:
                command += ['--runs', str(args.runs)]
            else:
                raise ValueError('缺少本轮直接 Run 输入')
            if admin.get('expected_jobs'):
                if not args.needs or not args.runs:
                    raise ValueError('固定预期作业需要 needs 与逐作业 Run 清单')
                jobs = directory / 'jobs.json'
                jobs.write_text(json.dumps(admin['expected_jobs']), encoding='utf-8')
                command += ['--jobs', str(jobs), '--needs', str(args.needs)]
            elif args.needs:
                raise ValueError('预期作业集合必须由管理员预先固定')
            code, verdict = invoke(command)
        if (verdict.get('scope') != 'machine-assurance' or verdict.get('human_approval') != 'delegated-to-scm'
                or verdict.get('merge_eligibility') != 'not-evaluated' or verdict.get('subject') != subject
                or verdict.get('status') not in ('PASS', 'FAIL', 'INDETERMINATE')):
            raise ValueError('固定 Runtime 返回的裁决范围或 Subject 无效')
        if code != {'PASS': 0, 'FAIL': 1, 'INDETERMINATE': 3}[verdict['status']]:
            raise ValueError('进程退出码与机器裁决不符')
        return verdict


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument('--root', type=Path, default=Path.cwd())
    result.add_argument('--admin-config', type=Path, required=True)
    result.add_argument('--admin-sha256', required=True)
    result.add_argument('--repository', required=True)
    result.add_argument('--base', required=True)
    result.add_argument('--head', required=True)
    choice = result.add_mutually_exclusive_group(required=True)
    choice.add_argument('--check')
    choice.add_argument('--runs', type=Path)
    choice.add_argument('--execute', action='store_true')
    result.add_argument('--needs', type=Path)
    result.add_argument('--timeout', type=int, default=3600)
    return result


def unavailable(error):
    # 不输出凭据、命令、响应体或私有文件内容。
    return {'schema': 'dairn.gate-verdict.v1', 'scope': 'machine-assurance', 'status': 'INDETERMINATE',
            'machine_assurance': 'INDETERMINATE', 'human_approval': 'delegated-to-scm',
            'merge_eligibility': 'not-evaluated', 'assurance': 'local-observed',
            'reasons': ['VERIFICATION_UNAVAILABLE'], 'error_type': type(error).__name__}


def main():
    args = parser().parse_args()
    try:
        verdict = verify(args)
    except Exception as error:
        verdict = unavailable(error)
    print(json.dumps(verdict, ensure_ascii=False, indent=2))
    return {'PASS': 0, 'FAIL': 1, 'INDETERMINATE': 3}[verdict['status']]


if __name__ == '__main__':
    sys.exit(main())
