"""按北京时间生成 nightly 版本；显式应用后，各构建入口共用固定版本。"""
import argparse
import json
from release_config import ROOT, nightly_version


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='更新 package.json；默认仅显示下一版本')
    args = parser.parse_args()
    path = ROOT / 'package.json'
    package = json.loads(path.read_text(encoding='utf-8'))
    version = nightly_version(package['version'])
    if args.apply:
        package['version'] = version
        path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(version)


if __name__ == '__main__':
    main()
