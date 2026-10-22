"""发布版本以标签为准，没有标签时回退 package.json；派生 Python 版本及制品名称。"""
import json
import os
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent.parent
VERSION_PATTERN = (r'(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)'
                   r'(?:-(?:alpha|beta|rc)\.(?:0|[1-9][0-9]*))?')


def version_info(version):
    number = r'(?:0|[1-9][0-9]*)'
    parsed = re.fullmatch(rf'({number}\.{number}\.{number})(?:-(alpha|beta|rc)\.({number}))?', version)
    if not parsed:
        raise ValueError('发布版本必须为三段数字，可附加 -alpha.N、-beta.N 或 -rc.N')
    suffix = {'alpha': 'a', 'beta': 'b', 'rc': 'rc'}
    python_version = parsed[1] + (suffix[parsed[2]] + parsed[3] if parsed[2] else '')
    return {'version': version, 'python_version': python_version, 'prerelease': parsed[2] is not None}


def tag_version(name):
    version = name[1:] if name.startswith('v') else name
    if not re.fullmatch(VERSION_PATTERN, version):
        raise ValueError(f'标签 {name} 不是有效的发布版本')
    return version


def resolve_version(root=ROOT):
    """标签版本优先；没有标签上下文（分支、PR、本地构建）时使用 package.json。"""
    tag = os.environ.get('DAIRN_VERSION', '').strip()
    if not tag and os.environ.get('GITHUB_REF_TYPE') == 'tag':
        tag = os.environ.get('GITHUB_REF_NAME', '').strip()
    if tag:
        return tag_version(tag)
    return json.loads((Path(root) / 'package.json').read_text(encoding='utf-8'))['version']


def npm_filename(npm_name):
    """npm pack 对 scoped 包名使用去掉 @、把 / 换成 - 的文件名。"""
    return npm_name.lstrip('@').replace('/', '-')


def load_release(root=ROOT):
    root = Path(root)
    config = json.loads((root / 'tools/release.json').read_text(encoding='utf-8'))
    if {'version', 'python_version', 'npm_version'} & config.keys():
        raise ValueError('版本只由标签或 package.json 的 version 决定，release.json 不得定义')
    package = json.loads((root / 'package.json').read_text(encoding='utf-8'))
    npm_name = package.get('name')
    if not isinstance(npm_name, str) or not npm_name.strip():
        raise ValueError('package.json 必须定义 npm 包名 name')
    return {**config, 'npm_name': npm_name, **version_info(resolve_version(root))}


def artifact_names(config):
    info = version_info(config['version'])
    return {'npm': f'{npm_filename(config.get("npm_name", config["name"]))}-{info["version"]}.tgz',
            'wheel': f'{config["python_name"].replace("-", "_")}-{info["python_version"]}-py3-none-any.whl',
            'zip': f'{config["name"]}-{info["version"]}.zip'}
