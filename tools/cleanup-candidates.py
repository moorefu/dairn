"""按所有权、进程存活与 TTL 显式回收一个延后清理的候选，默认只预览。"""
import argparse
import json
import os
from pathlib import Path
import re
import sys
import time
from runtime_context import remove_owned_candidate

ROOT = Path(__file__).resolve().parents[1]


def alive(pid):
    if not isinstance(pid, int) or pid <= 0:
        return None
    if os.name == 'posix':
        try:
            os.kill(pid, 0)
            return True
        except ProcessLookupError:
            return False
        except OSError:
            return None
    return None  # Windows 未可靠查询 Job/进程状态时拒绝回收，不能猜测进程已结束。


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('id')
    parser.add_argument('--ttl-seconds', type=int, default=3600)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    try:
        if not re.fullmatch(r'[0-9]+-[A-Za-z0-9_-]+', args.id) or args.ttl_seconds < 60:
            raise ValueError('候选 ID 无效或 TTL 小于安全下限')
        runs = ROOT / '.build/runs'
        run = runs / args.id
        if runs.resolve() != ROOT.resolve() / '.build/runs' or run.is_symlink() or run.resolve().parent != runs.resolve():
            raise ValueError('候选路径越界')
        marker = run / 'owner.json'
        if marker.is_symlink():
            raise ValueError('所有权标记是链接')
        owner = json.loads(marker.read_text())
        if owner.get('id') != args.id or time.time() - owner['created_at'] < args.ttl_seconds:
            raise ValueError('所有权或 TTL 条件不满足')
        if alive(owner.get('pid')) is not False:
            raise ValueError('所有者活动或状态未知')
        if owner.get('launch_pending') is not False:
            raise ValueError('子进程启动状态未知')
        children = owner.get('child_pids')
        if not isinstance(children, list):
            raise ValueError('缺少完整子进程记录')
        for child in children:
            if not isinstance(child, int) or isinstance(child, bool) or child <= 0:
                raise ValueError('子进程记录无效')
            if alive(child) is not False:
                raise ValueError('子进程活动或状态未知')
            if os.name == 'posix':
                try:
                    os.killpg(child, 0)
                except ProcessLookupError:
                    pass
                else:
                    raise ValueError('进程组仍有活动进程')
        if args.apply:
            remove_owned_candidate(run, owner)
        print(json.dumps({'status': 'cleaned' if args.apply else 'eligible', 'id': args.id}))
        return 0
    except Exception as error:
        print(json.dumps({'status': 'cleanup-deferred', 'error_type': type(error).__name__}))
        return 3


if __name__ == '__main__':
    sys.exit(main())
