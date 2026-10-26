"""Python 安装启动器：校验包内 QuickJS，POSIX 共用包根 dairn 启动器。"""
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
    runtime_dir = base / '.dairn/runtime'
    binary = runtime_dir / 'dairn-embedded.com'
    try:
        if not stat.S_ISREG(binary.lstat().st_mode):
            raise ValueError('runtime is not a regular file')
        expected = json.loads((runtime_dir / 'runtime-integrity.json').read_text(encoding='utf-8'))['sha256']
        if hashlib.sha256(binary.read_bytes()).hexdigest() != expected:
            raise ValueError('bundled runtime checksum mismatch')
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f'[dairn] refusing to execute invalid runtime: {error}', file=sys.stderr)
        return 2

    # 让内核拿到分发包自带的运行时载荷目录（init/adopt/upgrade 据此复制运行时）。
    env = {**os.environ, 'DAIRN_RUNTIME':str(binary),'DAIRN_RUNTIME_DIR': str(runtime_dir), 'DAIRN_RUNTIME_SOURCE': 'packaged', 'DAIRN_RUNTIME_ROLE':'installed-source', 'DAIRN_INSTALLED_ENTRY_SHA256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    try:
        if sys.platform == 'win32':
            # 直接传递 argv，保持调用方工作目录和包内运行时原样。
            return subprocess.call([str(binary), '/zip/quickjs/main.mjs', *sys.argv[1:]], env=env)
        # 替换当前进程，参数、退出码和信号交给共用启动器处理。
        os.execve('/bin/sh', ['/bin/sh', str(base / 'dairn'), *sys.argv[1:]], env)
    except OSError as error:
        print(f'[dairn] launch failed: {error}', file=sys.stderr)
        return 127 if error.errno == errno.ENOENT else 1


if __name__ == '__main__':
    sys.exit(main())
