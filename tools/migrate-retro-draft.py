"""一次性迁移旧 Retro 草案，保留摘要并明确证据不足，不复制旧批准或 verified_red 声明。"""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import re


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--repository', required=True)
    parser.add_argument('--base', required=True)
    parser.add_argument('--head', required=True)
    args = parser.parse_args()
    if args.out.exists() or args.input.is_symlink():
        parser.error('不覆盖已有记录、不读取链接输入')
    if any(not re.fullmatch(r'(?:[0-9a-f]{40}|[0-9a-f]{64})', value) for value in (args.base, args.head)):
        parser.error('base/head 必须是完整 SHA')
    raw = args.input.read_bytes()
    if len(raw) > 65536:
        parser.error('旧草案超过大小上限')
    old = json.loads(raw)
    if old.get('schema') != 1 or not isinstance(old.get('observed'), list):
        parser.error('只接受明确的旧 schema 1 草案')
    now = datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z')
    value = {'schema': 'dairn.retro.v1', 'retro_id': 'retro-migrated-' + hashlib.sha256(raw).hexdigest()[:16],
             'task_id': old.get('task_id'), 'scope': {'repository': args.repository, 'base_commit': args.base,
             'head_commit': args.head, 'window': {'start': now, 'end': now},
             'coverage': {'cli': 'unknown', 'harness': 'unknown', 'ci': 'unknown'}},
             'status': 'insufficient-evidence', 'findings': [],
             'extensions': {'legacy_sha256': hashlib.sha256(raw).hexdigest(),
                            'migration_reason': '旧自由文本和 verified_red 布尔声明不足以证明 Episode、批准、回放或效果；人工核对来源后另建 Findings。'}}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open('x', encoding='utf-8') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
    print('已迁移为证据不足记录；没有继承批准或验证声明。')


if __name__ == '__main__':
    main()
