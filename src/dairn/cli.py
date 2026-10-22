"""Python 安装启动器：校验包内 QuickJS，POSIX 共用 dairn.sh。"""
import errno
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys


def main():
    base = Path(__file__).resolve().parent
    binary = base / 'runtime/dairn-embedded.com'
    try:
        if not stat.S_ISREG(binary.lstat().st_mode):
            raise ValueError('运行时必须是普通文件')
        expected = json.loads((base / 'runtime/runtime-integrity.json').read_text(encoding='utf-8'))['sha256']
        if hashlib.sha256(binary.read_bytes()).hexdigest() != expected:
            raise ValueError('安装包中的运行时校验失败')
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f'[dairn] 拒绝执行无效运行时：{error}', file=sys.stderr)
        return 2

    try:
        if sys.platform == 'win32':
            # 直接传递 argv，保持调用方工作目录和包内运行时原样。
            return subprocess.call([str(binary), '/zip/quickjs/main.mjs', *sys.argv[1:]])
        # 替换当前进程，参数、退出码和信号交给共用启动器处理。
        os.execv('/bin/sh', ['/bin/sh', str(base / 'dairn.sh'), *sys.argv[1:]])
    except OSError as error:
        print(f'[dairn] 启动失败：{error}', file=sys.stderr)
        return 127 if error.errno == errno.ENOENT else 1


if __name__ == '__main__':
    sys.exit(main())
