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
[ -f "$HERE/runtime/dairn-embedded.com" ] && [ -f "$HERE/dairn.sh" ] || { echo '请先执行 sh build.sh 构建运行时。' >&2; exit 2; }
DEST=$PREFIX/lib/dairn
BIN=$PREFIX/bin/dairn
if [ -e "$BIN" ] || [ -L "$BIN" ]; then
  echo "Refusing to overwrite existing command: $BIN" >&2;exit 2
fi
mkdir -p "$DEST/runtime" "$PREFIX/bin"
cp "$HERE/runtime/dairn-embedded.com" "$DEST/runtime/dairn-embedded.com"
cp "$HERE/runtime/runtime-integrity.json" "$DEST/runtime/runtime-integrity.json"
cp "$HERE/dairn.sh" "$DEST/dairn.sh"
chmod +x "$DEST/runtime/dairn-embedded.com" "$DEST/dairn.sh"
# A symlink straight to dairn.sh would break its self-relative runtime lookup.
# Quote the absolute install path as one shell token.
QDEST=$(printf %s "$DEST" | sed "s/'/'\\\\''/g")
{ printf '#!/bin/sh\n'; printf "exec '%s/dairn.sh' \"\$@\"\n" "$QDEST"; } > "$BIN"
chmod +x "$BIN"
printf 'Dairn installed: %s\nAdd %s/bin to PATH\n' "$BIN" "$PREFIX"
