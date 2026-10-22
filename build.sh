#!/bin/sh
# 仅使用仓库自带 QuickJS；不需要 Python、Node 或外部 zip 工具。
set -eu
BUILD_DIR=${0%/*}
[ "$BUILD_DIR" != "$0" ] || BUILD_DIR=.
BUILD_ROOT=$(CDPATH= cd -- "$BUILD_DIR" && pwd)
exec /bin/sh \
  "$BUILD_ROOT/dairn-embedded.com" "$BUILD_ROOT/tools/build-zip.mjs" --root "$BUILD_ROOT" "$@"
