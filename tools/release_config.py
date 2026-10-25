"""版本以标签为准；没有标签时按构建时间生成 nightly，并派生 Python 版本及制品名称。"""
import json
from datetime import datetime, timedelta, timezone
import os
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent.parent
BEIJING = timezone(timedelta(hours=8))
VERSION_PATTERN = (r'(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)'
                   r'(?:-(?:(?:alpha|beta|rc)\.(?:0|[1-9][0-9]*)|nightly\.[1-9][0-9]{13}))?')
BASE_PATTERN = r'(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)'


def version_info(version):
    number = r'(?:0|[1-9][0-9]*)'
    if not re.fullmatch(VERSION_PATTERN, version):
        raise ValueError('发布版本必须为三段数字，可附加 -alpha.N、-beta.N、-rc.N 或 -nightly.YYYYMMDDHHMMSS')
    parsed = re.fullmatch(rf'({number}\.{number}\.{number})(?:-(alpha|beta|rc|nightly)\.({number}))?', version)
    if not parsed:
        raise ValueError('发布版本格式无效')
    suffix = {'alpha': 'a', 'beta': 'b', 'rc': 'rc', 'nightly': '.dev'}
    python_version = parsed[1] + (suffix[parsed[2]] + parsed[3] if parsed[2] else '')
    return {'version': version, 'python_version': python_version, 'prerelease': parsed[2] is not None}


def build_instant():
    """解析 DAIRN_BUILD_TIME（ISO 8601 或 epoch 秒），统一换算为北京时间；默认当前时间。

    同一轮构建的多个入口/验收通过该变量共享同一时间戳，保证 nightly 版本一致。
    """
    raw = os.environ.get('DAIRN_BUILD_TIME', '').strip()
    if raw:
        if re.fullmatch(r'[0-9]{9,}(?:\.[0-9]+)?', raw):
            instant = datetime.fromtimestamp(float(raw), tz=timezone.utc)
        else:
            text = raw[:-1] + '+00:00' if raw[-1:] in ('Z', 'z') else raw
            try:
                instant = datetime.fromisoformat(text)
            except ValueError:
                raise ValueError('DAIRN_BUILD_TIME 不是有效时间：' + raw) from None
            if instant.tzinfo is None:
                instant = instant.replace(tzinfo=BEIJING)
    else:
        instant = datetime.now(timezone.utc)
    return instant.astimezone(BEIJING)


def format_instant(instant):
    """把时间格式化为 ISO 8601（北京时间），可直接写入 DAIRN_BUILD_TIME。"""
    return instant.astimezone(BEIJING).isoformat(timespec='seconds')


def nightly_version(version, instant=None):
    """把三段基础版本改写为构建时间 nightly；允许传入带预发布后缀的 package 版本。"""
    version_info(version)
    instant = build_instant() if instant is None else instant.astimezone(BEIJING)
    return version.split('-')[0] + '-nightly.' + instant.strftime('%Y%m%d%H%M%S')


def tag_version(name):
    version = name[1:] if name.startswith('v') else name
    if not re.fullmatch(VERSION_PATTERN, version):
        raise ValueError(f'标签 {name} 不是有效的发布版本')
    return version


def resolve_version(root=ROOT):
    """标签版本优先（DAIRN_VERSION 或 GitHub 标签上下文）；否则按构建时间生成 nightly。

    没有标签时不再读取 package.json 的完整版本：只取其中的三段基础版本，
    时间戳来自构建时间（DAIRN_BUILD_TIME 或当前北京时间），因此同一次构建可复现。
    """
    tag = os.environ.get('DAIRN_VERSION', '').strip()
    if not tag and os.environ.get('GITHUB_REF_TYPE') == 'tag':
        tag = os.environ.get('GITHUB_REF_NAME', '').strip()
    if tag:
        return tag_version(tag)
    package = json.loads((Path(root) / 'package.json').read_text(encoding='utf-8'))
    base = str(package.get('version', '')).split('-')[0]
    if not re.fullmatch(BASE_PATTERN, base):
        raise ValueError('package.json 的 version 必须是三段数字：' + str(package.get('version')))
    return nightly_version(base)


def version_from_archive(root, archive):
    """从运行 ZIP 文件名恢复版本，供已构建制品的验收复用。"""
    config = json.loads((Path(root) / 'tools/release.json').read_text(encoding='utf-8'))
    pattern = re.compile(re.escape(config['name']) + r'-(' + VERSION_PATTERN + r')\.zip')
    name = Path(archive).name
    match = pattern.fullmatch(name)
    if not match:
        raise ValueError('无法从运行 ZIP 文件名判断版本：' + name)
    version = match.group(1)
    version_info(version)
    return version


def version_from_artifacts(root, artifacts):
    """从发布目录唯一的运行 ZIP 恢复版本；多个版本或缺失时失败。"""
    artifacts = Path(artifacts)
    config = json.loads((Path(root) / 'tools/release.json').read_text(encoding='utf-8'))
    pattern = re.compile(re.escape(config['name']) + r'-(' + VERSION_PATTERN + r')\.zip')
    found = []
    for path in sorted(artifacts.glob('*.zip')):
        match = pattern.fullmatch(path.name)
        if match:
            version_info(match.group(1))
            found.append(match.group(1))
    versions = sorted(set(found))
    if not versions:
        raise ValueError('发布目录缺少 ' + config['name'] + '-<版本>.zip：' + str(artifacts))
    if len(versions) > 1:
        raise ValueError('发布目录包含多个版本：' + ', '.join(versions))
    return versions[0]


def npm_filename(npm_name):
    """npm pack 对 scoped 包名使用去掉 @、把 / 换成 - 的文件名。"""
    return npm_name.lstrip('@').replace('/', '-')


def load_release(root=ROOT, version=None):
    root = Path(root)
    config = json.loads((root / 'tools/release.json').read_text(encoding='utf-8'))
    if {'version', 'python_version', 'npm_version'} & config.keys():
        raise ValueError('版本由标签或构建时间生成，release.json 不得定义')
    package = json.loads((root / 'package.json').read_text(encoding='utf-8'))
    npm_name = package.get('name')
    if not isinstance(npm_name, str) or not npm_name.strip():
        raise ValueError('package.json 必须定义 npm 包名 name')
    if version is None:
        version = resolve_version(root)
    else:
        version = version_info(version)['version']
    return {**config, 'npm_name': npm_name, **version_info(version)}


def artifact_names(config):
    info = version_info(config['version'])
    return {'npm': f'{npm_filename(config.get("npm_name", config["name"]))}-{info["version"]}.tgz',
            'wheel': f'{config["python_name"].replace("-", "_")}-{info["python_version"]}-py3-none-any.whl',
            'zip': f'{config["name"]}-{info["version"]}.zip'}
