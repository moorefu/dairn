#!/bin/sh
# 获取上游 QuickJS，再由它完成自举。
set -eu
BUILD_DIR=${0%/*}
[ "$BUILD_DIR" != "$0" ] || BUILD_DIR=.
BUILD_ROOT=$(CDPATH= cd -- "$BUILD_DIR" && pwd)
exec /bin/sh "$BUILD_ROOT/tools/bootstrap.sh" "$@"
