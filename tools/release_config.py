"""从 package.json 读取唯一发布版本，派生 Python 版本及制品名称。"""
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent.parent


def version_info(version):
    number = r'(?:0|[1-9][0-9]*)'
    parsed = re.fullmatch(rf'({number}\.{number}\.{number})(?:-(alpha|beta|rc)\.({number}))?', version)
    if not parsed:
        raise ValueError('发布版本必须为三段数字，可附加 -alpha.N、-beta.N 或 -rc.N')
    suffix = {'alpha': 'a', 'beta': 'b', 'rc': 'rc'}
    python_version = parsed[1] + (suffix[parsed[2]] + parsed[3] if parsed[2] else '')
    return {'version': version, 'python_version': python_version, 'prerelease': parsed[2] is not None}


def load_release(root=ROOT):
    root = Path(root)
    config = json.loads((root / 'tools/release.json').read_text(encoding='utf-8'))
    if {'version', 'python_version', 'npm_version'} & config.keys():
        raise ValueError('版本只允许定义在 package.json 的 version 字段')
    package = json.loads((root / 'package.json').read_text(encoding='utf-8'))
    return {**config, **version_info(package['version'])}


def artifact_names(config):
    info = version_info(config['version'])
    return {'npm': f'{config["name"]}-{info["version"]}.tgz',
            'wheel': f'{config["python_name"].replace("-", "_")}-{info["python_version"]}-py3-none-any.whl',
            'zip': f'{config["name"]}-{info["version"]}.zip'}
