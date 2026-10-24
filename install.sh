#!/bin/sh
# 安装 Dairn 启动器及其 QuickJS 运行时。
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PREFIX=${HOME:?}/.local
if [ "${1:-}" = '--prefix' ]; then
  [ "$#" -eq 2 ] || { echo 'Usage: install.sh [--prefix DIR]' >&2; exit 2; }
  PREFIX=$2
elif [ "$#" -ne 0 ]; then
  echo 'Usage: install.sh [--prefix DIR]' >&2; exit 2
fi
case "$PREFIX" in /*) ;; *) echo 'Install prefix must be absolute' >&2; exit 2;; esac
[ -f "$HERE/.dairn/runtime/dairn-embedded.com" ] && [ -f "$HERE/.dairn/runtime/runtime-integrity.json" ] && [ -f "$HERE/dairn" ] \
  || { echo '请先执行 sh build.sh 构建运行时。' >&2; exit 2; }
DEST=$PREFIX/lib/dairn
BIN=$PREFIX/bin/dairn
if [ -e "$BIN" ] || [ -L "$BIN" ]; then
  echo "Refusing to overwrite existing command: $BIN" >&2;exit 2
fi
mkdir -p "$DEST/.dairn/runtime" "$PREFIX/bin"
cp "$HERE/.dairn/runtime/dairn-embedded.com" "$DEST/.dairn/runtime/dairn-embedded.com"
cp "$HERE/.dairn/runtime/runtime-integrity.json" "$DEST/.dairn/runtime/runtime-integrity.json"
cp "$HERE/dairn" "$DEST/dairn"
chmod +x "$DEST/.dairn/runtime/dairn-embedded.com" "$DEST/dairn"
# 包装层导出 DAIRN_RUNTIME_DIR，让 init/adopt/upgrade 复制安装包自带的运行时；
# 启动器自身按 vendored 语义解析 $DEST/.dairn/runtime。
# Quote the absolute install path as one shell token.
QDEST=$(printf %s "$DEST" | sed "s/'/'\\\\''/g")
{ printf '#!/bin/sh\n'; printf "DAIRN_RUNTIME_DIR='%s/.dairn/runtime'; export DAIRN_RUNTIME_DIR\n" "$QDEST"; printf "exec '%s/dairn' \"\$@\"\n" "$QDEST"; } > "$BIN"
chmod +x "$BIN"
printf 'Dairn installed: %s\nAdd %s/bin to PATH\n' "$BIN" "$PREFIX"
