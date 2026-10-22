#!/bin/sh
# 仓库、npm、Wheel 和 ZIP 共用此启动器；只补执行位，不改写分发运行时。
set -eu
DAIRN_DIR=${0%/*}
[ "$DAIRN_DIR" != "$0" ] || DAIRN_DIR=.
HERE=$(CDPATH= cd -- "$DAIRN_DIR" && pwd)
RUNTIME="$HERE/runtime/dairn-embedded.com"
[ -f "$RUNTIME" ] || { echo "未找到 Dairn 运行时：$RUNTIME" >&2; exit 2; }
# APE 的 sh 加载器用 command -v "$0" 定位自身；bash（macOS 的 /bin/sh）对没有
# 执行位的路径返回失败，dd 会读到空输入并让 gzip 报 EOF。这里只补元数据。
if [ ! -x "$RUNTIME" ]; then
  chmod u+x "$RUNTIME" 2>/dev/null || true
fi
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
