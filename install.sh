#!/bin/sh
# Opt-in shell installer. Does not install Python, Node, BusyBox or alter system packages.
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
[ -f "$HERE/dairn-embedded.com" ] && [ -f "$HERE/dairn.sh" ] || { echo 'Runtime files missing' >&2; exit 2; }
DEST=$PREFIX/lib/dairn
BIN=$PREFIX/bin/dairn
if [ -e "$BIN" ] || [ -L "$BIN" ]; then
  echo "Refusing to overwrite existing command: $BIN" >&2;exit 2
fi
mkdir -p "$DEST" "$PREFIX/bin"
cp "$HERE/dairn-embedded.com" "$DEST/dairn-embedded.com"
cp "$HERE/dairn.sh" "$DEST/dairn.sh"
chmod +x "$DEST/dairn-embedded.com" "$DEST/dairn.sh"
# A symlink straight to dairn.sh would break its self-relative runtime lookup.
# Quote the absolute install path as one shell token.
QDEST=$(printf %s "$DEST" | sed "s/'/'\\\\''/g")
{ printf '#!/bin/sh\n'; printf "exec '%s/dairn.sh' \"\$@\"\n" "$QDEST"; } > "$BIN"
chmod +x "$BIN"
printf 'Dairn installed: %s\nAdd %s/bin to PATH\n' "$BIN" "$PREFIX"
