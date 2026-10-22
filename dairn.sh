#!/bin/sh
# 仓库、npm、Wheel 和 ZIP 共用此启动器，不修改分发运行时。
set -eu
DAIRN_DIR=${0%/*}
[ "$DAIRN_DIR" != "$0" ] || DAIRN_DIR=.
HERE=$(CDPATH= cd -- "$DAIRN_DIR" && pwd)
RUNTIME="$HERE/runtime/dairn-embedded.com"
[ -f "$RUNTIME" ] || { echo "未找到 Dairn 运行时：$RUNTIME" >&2; exit 2; }
if [ "${DAIRN_FAST_RUNTIME:-0}" = "1" ] && command -v sha256sum >/dev/null 2>&1; then
  HASH=$(sha256sum "$RUNTIME" | cut -d ' ' -f1)
  CACHE="${DAIRN_CACHE_HOME:-${XDG_CACHE_HOME:-${HOME:-/tmp}/.cache}/dairn}/native-$HASH"
  mkdir -p "$CACHE"
  chmod 700 "$CACHE"
  OPT="$CACHE/dairn-native"
  if [ ! -f "$OPT" ]; then
    STAGE="$CACHE/dairn-native-$$.tmp"
    cp "$RUNTIME" "$STAGE"
    chmod 700 "$STAGE"
    if /bin/sh "$STAGE" --assimilate >/dev/null 2>&1; then
      mv -n "$STAGE" "$OPT" || true
    fi
    rm -f "$STAGE"
  fi
  if [ -f "$OPT" ] && [ ! -L "$OPT" ]; then
    exec "$OPT" /zip/quickjs/main.mjs "$@"
  fi
fi
exec /bin/sh "$RUNTIME" /zip/quickjs/main.mjs "$@"
