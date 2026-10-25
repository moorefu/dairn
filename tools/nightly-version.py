"""预览构建入口会生成的 nightly 版本与构建时间；版本由构建按同一规则自动生成。"""
import argparse
import json
from release_config import ROOT, build_instant, format_instant, nightly_version


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--instant', action='store_true',
                        help='输出构建时间（ISO 8601，北京时间），可直接写入 DAIRN_BUILD_TIME')
    args = parser.parse_args()
    instant = build_instant()
    if args.instant:
        print(format_instant(instant))
        return
    package = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))
    print(nightly_version(package['version'], instant))


if __name__ == '__main__':
    main()
