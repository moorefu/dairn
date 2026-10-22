#!/bin/sh
# 兼容旧入口；构建逻辑位于根目录 npm 工程。
set -eu
BUILD_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$BUILD_ROOT"
exec npm run build -- "$@"
