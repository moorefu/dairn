"""Python 安装启动器；所有治理规则由包内 Cosmopolitan QuickJS 执行。"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from importlib import resources


def main():
    package = resources.files('dairn').joinpath('runtime')
    binary = package.joinpath('dairn-embedded.com').read_bytes()
    checksum = hashlib.sha256(binary).hexdigest()
    expected = json.loads(package.joinpath('runtime-integrity.json').read_text(encoding='utf-8'))['sha256']
    if checksum != expected:
        print('Dairn ERROR: 安装包中的运行时校验失败', file=sys.stderr)
        return 2
    base = Path(os.environ.get('DAIRN_CACHE_HOME', Path.home() / '.cache' / 'dairn')) / ('cosmo-' + checksum[:16])
    path = base / 'dairn-embedded.com'
    # 不修改安装包；使用缓存前先校验已有运行时。
    if path.exists():
        if hashlib.sha256(path.read_bytes()).hexdigest() != checksum:
            print('Dairn ERROR: corrupted runtime cache: ' + str(path), file=sys.stderr)
            return 2
    else:
        base.mkdir(parents=True, exist_ok=True)
        staging = base / ('runtime-' + str(os.getpid()) + '.tmp')
        try:
            staging.write_bytes(binary)
            staging.chmod(0o755)
            os.replace(staging, path)
        finally:
            if staging.exists():
                staging.unlink()
    path.chmod(0o755)
    if os.environ.get('DAIRN_FAST_RUNTIME') == '1' and sys.platform.startswith('linux'):
        native = base / 'dairn-native'
        if not native.exists():
            staging_native = base / ('native-' + str(os.getpid()) + '.tmp')
            try:
                shutil.copyfile(path, staging_native)
                staging_native.chmod(0o700)
                result = subprocess.run(['/bin/sh', '-c', 'exec "$1" --assimilate', 'dairn', str(staging_native)],capture_output=True)
                if result.returncode == 0:
                    try:
                        os.link(staging_native, native)
                    except FileExistsError:
                        pass
            finally:
                if staging_native.exists(): staging_native.unlink()
        if native.is_file() and not native.is_symlink():
            return subprocess.call([str(native), '/zip/quickjs/main.mjs', *sys.argv[1:]])
    if sys.platform == 'win32':
        # 直接传递 argv；不经过 cmd，避免路径和参数中的特殊字符被解释。
        return subprocess.call([str(path), '/zip/quickjs/main.mjs', *sys.argv[1:]])
    # 由 shell 读取 APE 引导部分；参数直接传递，不拼接命令文本。
    return subprocess.call(['/bin/sh', str(path), '/zip/quickjs/main.mjs', *sys.argv[1:]])


if __name__ == '__main__':
    sys.exit(main())
