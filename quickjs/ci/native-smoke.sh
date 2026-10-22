#!/bin/sh
# 使用预置 qjs 的 Unix runner 验证入口。
set -eu
QJS=${QJS:-qjs}
"$QJS" quickjs/tests/test_native.mjs
"$QJS" quickjs/main.mjs validate-core --root "${DAIRN_TEST_PROJECT:-.}"
