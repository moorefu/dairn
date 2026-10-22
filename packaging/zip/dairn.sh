#!/bin/sh
# 从解压目录加载运行时；不依赖 Python 或 Node。
set -eu
DAIRN_DIR=${0%/*}
[ "$DAIRN_DIR" != "$0" ] || DAIRN_DIR=.
DAIRN_ROOT=$(CDPATH= cd -- "$DAIRN_DIR" && pwd)
exec /bin/sh "$DAIRN_ROOT/runtime/dairn-embedded.com" /zip/quickjs/main.mjs "$@"
