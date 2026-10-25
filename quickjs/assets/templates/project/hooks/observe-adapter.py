"""可选 Harness 事件桥；不调用模型，不要求 Work，不保存工具参数或会话原文。"""
import argparse
import datetime
import hashlib
import json
import os
import re
from pathlib import Path
import sys
import uuid

OPERATIONS = {'doctor', 'check', 'docs', 'context', 'analyze', 'runtime', 'upgrade', 'gate', 'validate', 'observe'}
PHASES = {'started': 'launcher.attempt.started', 'failed': 'launcher.attempt.failed',
          'succeeded': 'launcher.attempt.succeeded', 'session-start': 'harness.session-start',
          'turn-end': 'harness.turn-end'}
BINDINGS = ('task_id', 'subject_commit', 'worktree_snapshot_sha256', 'policy_sha256',
            'plan_sha256', 'toolchain_sha256', 'runtime_sha256')


def expire_events(base, now):
    """只清理超过保留期且完全由已知事件文件组成的日期目录。"""
    cutoff = now.date() - datetime.timedelta(days=30)
    for day in base.iterdir():
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', day.name):
            continue
        try:
            expired = datetime.date.fromisoformat(day.name) < cutoff
        except ValueError:
            continue
        if not expired:
            continue
        if day.is_symlink() or not day.is_dir():
            raise ValueError('拒绝清理异常事件目录')
        files = list(day.iterdir())
        if any(p.is_symlink() or not p.is_file() or
               not re.fullmatch(r'[A-Za-z0-9._-]+\.(?:jsonl|part)', p.name) for p in files):
            raise ValueError('旧事件目录有未知内容，拒绝清理')
        for path in files:
            path.unlink()
        day.rmdir()


def emit(root, provider, phase, invocation, code=None, session=None, operation='unknown', coverage='partial', bindings=None):
    root = Path(root).resolve()
    if not (root / '.dairn/lock.json').is_file():
        raise ValueError('项目未初始化')
    config = root / '.dairn/observe/config.json'
    if (root/'.dairn').is_symlink() or (root/'.dairn/observe').is_symlink():
        raise ValueError('拒绝配置目录链接')
    if config.is_symlink():
        raise ValueError('拒绝配置链接')
    if config.exists() and json.loads(config.read_text(encoding='utf-8')).get('mode') == 'disabled':
        return {'status': 'disabled'}
    if provider not in ('codex', 'dsh', 'claude') or phase not in PHASES:
        raise ValueError('未知宿主或事件阶段')
    if not isinstance(invocation, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}', invocation):
        raise ValueError('invocation 无效')
    bindings = bindings or {}
    if not isinstance(bindings, dict) or any(key not in BINDINGS for key in bindings):
        raise ValueError('关联字段不在白名单内')
    for key, value in bindings.items():
        pattern = r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}' if key == 'task_id' else r'(?:[0-9a-f]{40}|[0-9a-f]{64})' if key == 'subject_commit' else r'[0-9a-f]{64}'
        if value is not None and (not isinstance(value, str) or not re.fullmatch(pattern, value)):
            raise ValueError('关联 ID 或 SHA 无效')
    moment = datetime.datetime.now(datetime.timezone.utc)
    now = moment.isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    directory = root
    for part in ('.dairn', 'observe', 'events', now[:10]):
        directory = directory / part
        if directory.is_symlink():
            raise ValueError('拒绝事件目录链接')
        directory.mkdir(exist_ok=True, mode=0o700)
    expire_events(directory.parent, moment)
    ignore=root/'.dairn/observe/.gitignore'
    if ignore.is_symlink():
        raise ValueError('拒绝忽略文件链接')
    try:
        with ignore.open('x',encoding='utf-8') as stream:
            stream.write('*\n')
    except FileExistsError:
        pass
    if len(list(directory.iterdir())) >= 512:
        raise ValueError('事件额度耗尽')
    identifier = 'obs-' + uuid.uuid4().hex
    event = {'schema': 'dairn.observation-event.v1', 'event_id': identifier,
             'occurred_at': now, 'kind': PHASES[phase],
             'source': {'type': 'harness', 'provider': provider, 'assurance': 'harness-reported'},
             'correlation': {'invocation_id': invocation,
                             'session_ref_hash': hashlib.sha256((root.as_posix() + '\n' + session).encode()).hexdigest() if session else None,
                             'task_id': None, 'subject_commit': None,
                             **{key: value for key, value in bindings.items() if key != 'runtime_sha256'}},
             'runtime': {'role': 'unknown', 'version': None, 'sha256': bindings['runtime_sha256']} if bindings.get('runtime_sha256') else None,
             'operation': operation if operation in OPERATIONS else 'unknown',
             'outcome': {'status': 'failed' if phase == 'failed' else 'passed' if phase == 'succeeded' else 'started' if phase == 'started' else 'unknown',
                         'exit_code': code, 'duration_ms': None, 'diagnostic_codes': []},
             'coverage': {'cli_execution': 'unknown', 'harness_attempt': coverage if coverage in ('unknown','partial','complete') else 'partial'}}
    pending = directory / (identifier + '.part')
    descriptor = os.open(pending, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w', encoding='utf-8', newline='\n') as stream:
        json.dump(event, stream, ensure_ascii=False)
        stream.write('\n')
    pending.rename(pending.with_suffix('.jsonl'))
    return {'status': 'recorded', 'event_id': identifier, 'assurance': 'harness-reported'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path.cwd())
    parser.add_argument('--provider', choices=['codex', 'dsh', 'claude'], required=True)
    parser.add_argument('--phase', choices=list(PHASES), required=True)
    parser.add_argument('--invocation')
    parser.add_argument('--exit-code', type=int)
    parser.add_argument('--operation', default='unknown')
    parser.add_argument('--coverage', choices=['unknown','partial','complete'], default='partial')
    for key in BINDINGS:
        parser.add_argument('--task' if key == 'task_id' else '--' + key.replace('_', '-'), dest=key)
    parser.add_argument('--stdin', action='store_true')
    args = parser.parse_args()
    try:
        payload = {}
        if args.stdin:
            raw = sys.stdin.read(8193)
            if len(raw) > 8192:
                raise ValueError('宿主载荷超过上限')
            payload = json.loads(raw) if raw.strip() else {}
            if not isinstance(payload, dict):
                raise ValueError('载荷不是对象')
        session = payload.get('session_id') or payload.get('thread-id') or os.environ.get({'codex': 'CODEX_SESSION_ID', 'dsh': 'DSH_SESSION_ID', 'claude': 'CLAUDE_SESSION_ID'}[args.provider])
        bindings = {key: getattr(args, key) if getattr(args, key) is not None else payload.get(key) for key in BINDINGS}
        result = emit(args.root, args.provider, args.phase,
                      args.invocation or os.environ.get('DAIRN_INVOCATION_ID') or 'inv-' + uuid.uuid4().hex,
                      args.exit_code, session if isinstance(session, str) and len(session) <= 256 else None,
                      args.operation, args.coverage, bindings)
    except Exception as error:
        result = {'status': 'collection-gap', 'error_type': type(error).__name__}
    print(json.dumps(result, ensure_ascii=False))
    # Hook 采集异常不阻断编辑会话或更改工具原退出码。
    return 0


if __name__ == '__main__':
    sys.exit(main())
