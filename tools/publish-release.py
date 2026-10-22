"""将已通过矩阵验证的 npm、Wheel、ZIP 发布到 GitHub Release。"""
import argparse
import hashlib
import html
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from urllib.parse import quote
from release_config import artifact_names, load_release, version_info

ROOT = Path(__file__).resolve().parent.parent


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def plan_release(artifacts, config, commit, ref_type='', ref_name=''):
    version = config['version']
    info = version_info(version)
    if not re.fullmatch(r'[0-9a-f]{40}', commit):
        raise ValueError('发布必须绑定本次验证的完整提交 SHA')
    tag = 'v' + version
    if ref_type == 'tag' and ref_name != tag:
        raise ValueError(f'触发标签 {ref_name} 与发布版本 {tag} 不一致')
    names = set(artifact_names(config).values())
    checksums = json.loads((artifacts / 'checksums.json').read_text(encoding='utf-8'))
    if set(checksums['artifacts']) != names or {p.name for p in artifacts.iterdir()} != names | {'checksums.json'}:
        raise ValueError('发布目录必须且只能包含三类制品与 checksums.json')
    for name, expected in checksums['artifacts'].items():
        if not (artifacts / name).is_file() or sha(artifacts / name) != expected:
            raise ValueError('发布制品校验失败：' + name)
    return {'tag': tag, 'title': 'Dairn ' + version, 'commit': commit, 'version': version, 'name': config['name'],
            'prerelease': info['prerelease'],
            'files': {name: sha(artifacts / name) for name in sorted(names | {'checksums.json'})}}


def gh(*args):
    subprocess.run(['gh', *map(str, args)], check=True)


def api(repo, endpoint):
    result = subprocess.run(['gh', 'api', f'repos/{repo}/{endpoint}'], capture_output=True, text=True)
    if result.returncode:
        if '(HTTP 404)' in result.stderr:
            return None
        raise RuntimeError(result.stderr.strip())
    return json.loads(result.stdout)


def find_release(repo, tag):
    published = api(repo, 'releases/tags/' + quote(tag, safe=''))
    if published:
        return published
    # 按标签查询可能不返回未公开草稿；写权限可从列表中找到它，以便继续上传。
    page = 1
    while True:
        releases = api(repo, f'releases?per_page=100&page={page}')
        if releases is None:
            raise RuntimeError('无法读取仓库 Release 列表')
        for item in releases:
            if item['tag_name'] == tag:
                return item
        if len(releases) < 100:
            return None
        page += 1


def prepare_latest(plan, artifacts, repo, destination):
    """别名只复制已验证字节；Wheel 保留合法版本文件名，索引链接到不可变版本。"""
    destination.mkdir(parents=True, exist_ok=True)
    aliases = {}
    for name in plan['files']:
        suffix = Path(name).suffix
        if suffix in {'.tgz', '.zip', '.whl'}:
            alias = name if suffix == '.whl' else plan['name'] + '-latest' + suffix
            shutil.copyfile(artifacts / name, destination / alias)
            if sha(destination / alias) != plan['files'][name]:
                raise ValueError('latest 制品与已验证版本不一致：' + name)
            aliases[alias] = plan['files'][name]
    wheel, = [name for name in aliases if name.endswith('.whl')]
    wheel_url = f'https://github.com/{repo}/releases/download/{quote(plan["tag"], safe="")}/{quote(wheel, safe="")}'
    index = ('<!doctype html>\n<html lang="zh-CN"><meta charset="utf-8"><title>Dairn latest</title>\n'
             f'<a href="{html.escape(wheel_url)}#sha256={aliases[wheel]}">{html.escape(wheel)}</a>\n</html>\n')
    (destination / 'wheels.html').write_text(index, encoding='utf-8', newline='\n')
    checksums = json.loads((artifacts / 'checksums.json').read_text(encoding='utf-8'))
    checksums.update(version=plan['version'], source_tag=plan['tag'], commit=plan['commit'], artifacts=aliases)
    (destination / 'checksums.json').write_text(json.dumps(checksums, indent=2) + '\n', encoding='utf-8', newline='\n')
    return {**plan, 'tag': 'latest', 'title': f'Dairn latest（{plan["version"]}）', 'source_tag': plan['tag'],
            'files': {name: sha(destination / name) for name in sorted([*aliases, 'wheels.html', 'checksums.json'])}}


def ref_commit(repo, ref):
    if not ref:
        return None
    obj = ref['object']
    while obj['type'] == 'tag':
        obj = api(repo, 'git/tags/' + obj['sha'])['object']
    if obj['type'] != 'commit':
        raise ValueError('发布标签必须指向提交')
    return obj['sha']


def publish_latest(plan, artifacts, repo):
    previous = ref_commit(repo, api(repo, 'git/ref/tags/latest'))
    release = find_release(repo, 'latest')
    if previous and previous != plan['commit']:
        comparison = api(repo, f'compare/{previous}...{plan["commit"]}')
        if comparison and comparison['status'] == 'behind':
            print('latest 已指向更新提交，本次旧版本重跑不回退它。')
            return
        if not comparison or comparison['status'] != 'ahead':
            raise ValueError('latest 与本次提交不在同一前进历史中，请先检查发布分支')
    existing = {asset['name'] for asset in release['assets']} if release else set()
    managed_wheel = re.compile(re.escape(plan['name'].replace('-', '_')) + r'-[A-Za-z0-9_.+]+-py3-none-any\.whl')
    stale = existing - set(plan['files'])
    if any(not managed_wheel.fullmatch(name) for name in stale):
        raise ValueError('latest 含有非托管附件，请先检查 Release')

    with tempfile.TemporaryDirectory(prefix='dairn-latest-') as temp:
        temporary = Path(temp)
        if release and not release['draft'] and previous == plan['commit'] and existing == set(plan['files']):
            gh('release', 'download', 'latest', '--repo', repo, '--dir', temporary)
            if all(sha(temporary / name) == expected for name, expected in plan['files'].items()):
                print('latest 已是该提交和制品，无需更新。')
                return
        notes = temporary / 'notes.md'
        notes.write_text(f'{plan["title"]}\n\n滚动发布入口，包含最新通过全部 18 项冒烟验证的制品（可能为预发布）。\n\n'
                         f'对应版本：[{plan["source_tag"]}](https://github.com/{repo}/releases/tag/{plan["source_tag"]})\n\n'
                         f'提交：`{plan["commit"]}`\n\n别名文件与对应版本的制品字节一致，摘要见 `checksums.json`。\n', encoding='utf-8')
        if not release:
            gh('release', 'create', 'latest', '--repo', repo, '--target', plan['commit'],
               '--title', plan['title'], '--notes-file', notes, '--draft')
        elif not release['draft']:
            gh('release', 'edit', 'latest', '--repo', repo, '--draft=true', '--latest=false')
        gh('release', 'upload', 'latest', *[artifacts / name for name in plan['files']], '--repo', repo, '--clobber')
        for name in sorted(stale):
            gh('release', 'delete-asset', 'latest', name, '--repo', repo, '--yes')
        # 附件齐全后再移动标签；失败时保留草稿，版本 Release 始终可下载。
        current = ref_commit(repo, api(repo, 'git/ref/tags/latest'))
        if current not in {None, previous, plan['commit']}:
            raise ValueError('latest 标签在发布过程中发生变化，请重跑')
        if current != plan['commit']:
            if current:
                gh('api', '--method', 'PATCH', f'repos/{repo}/git/refs/tags/latest',
                   '-f', 'sha=' + plan['commit'], '-F', 'force=true')
            else:
                gh('api', '--method', 'POST', f'repos/{repo}/git/refs',
                   '-f', 'ref=refs/tags/latest', '-f', 'sha=' + plan['commit'])
        gh('release', 'edit', 'latest', '--repo', repo, '--target', plan['commit'],
           '--title', plan['title'], '--notes-file', notes, '--draft=false',
           '--prerelease=' + str(plan['prerelease']).lower(), '--latest=' + str(not plan['prerelease']).lower())
        print('已更新：https://github.com/' + repo + '/releases/tag/latest')


def publish(plan, artifacts, repo):
    tag = plan['tag']
    encoded = quote(tag, safe='')
    ref = api(repo, 'git/ref/tags/' + encoded)
    if ref:
        obj = ref['object']
        while obj['type'] == 'tag':
            obj = api(repo, 'git/tags/' + obj['sha'])['object']
        if obj['type'] != 'commit' or obj['sha'] != plan['commit']:
            raise ValueError('版本标签已指向其他提交，请更新发布版本号')
    release = find_release(repo, tag)
    if release and not ref and release.get('target_commitish') != plan['commit']:
        raise ValueError('已有 Release 的目标提交不同，请更新发布版本号')

    with tempfile.TemporaryDirectory(prefix='dairn-release-') as temp:
        temporary = Path(temp)
        if release and not release['draft']:
            if {asset['name'] for asset in release['assets']} != set(plan['files']):
                raise ValueError('已发布版本的附件不一致，请更新版本号后发布')
            gh('release', 'download', tag, '--repo', repo, '--dir', temporary)
            if any(sha(temporary / name) != expected for name, expected in plan['files'].items()):
                raise ValueError('同版本已发布不同制品，请更新版本号后发布')
            print('该提交及制品已发布，重跑无需修改 Release。')
            return

        notes = temporary / 'notes.md'
        notes.write_text(f'{plan["title"]}\n\n提交：`{plan["commit"]}`\n\n'
                         'npm、Wheel、ZIP 已通过 Windows、Linux、macOS 的 x64/ARM64 共 18 项冒烟验证。\n'
                         '附件为矩阵验证使用的同一套制品，SHA256 见 `checksums.json`。\n', encoding='utf-8')
        if not release:
            gh('release', 'create', tag, '--repo', repo, '--target', plan['commit'],
               '--title', plan['title'], '--notes-file', notes, '--draft')
        elif {asset['name'] for asset in release['assets']} - set(plan['files']):
            raise ValueError('已有发布草稿包含其他附件，请先检查草稿')
        # 上传失败时保留草稿；只有四个附件全部上传成功后才公开。
        gh('release', 'upload', tag, *[artifacts / name for name in plan['files']], '--repo', repo, '--clobber')
        gh('release', 'edit', tag, '--repo', repo, '--title', plan['title'], '--notes-file', notes,
           '--draft=false', '--prerelease=' + str(plan['prerelease']).lower(),
           '--latest=' + str(not plan['prerelease']).lower())
        print('已发布：https://github.com/' + repo + '/releases/tag/' + tag)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifacts', type=Path, required=True)
    parser.add_argument('--dry-run', action='store_true', help='只校验本地制品并显示发布计划，不访问 GitHub')
    parser.add_argument('--commit', default=os.environ.get('GITHUB_SHA', ''))
    parser.add_argument('--repo', default=os.environ.get('GITHUB_REPOSITORY', ''), help='GitHub 仓库，默认 GITHUB_REPOSITORY')
    args = parser.parse_args()
    config = load_release(ROOT)
    plan = plan_release(args.artifacts.resolve(), config, args.commit,
                        os.environ.get('GITHUB_REF_TYPE', ''), os.environ.get('GITHUB_REF_NAME', ''))
    repo = args.repo
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repo):
        raise ValueError('缺少有效的 GITHUB_REPOSITORY')
    with tempfile.TemporaryDirectory(prefix='dairn-latest-assets-') as temp:
        latest_dir = Path(temp)
        latest = prepare_latest(plan, args.artifacts.resolve(), repo, latest_dir)
        if args.dry_run:
            print(json.dumps({'versioned': plan, 'latest': latest}, ensure_ascii=False, indent=2))
            return
        publish(plan, args.artifacts.resolve(), repo)
        publish_latest(latest, latest_dir, repo)


if __name__ == '__main__':
    main()
