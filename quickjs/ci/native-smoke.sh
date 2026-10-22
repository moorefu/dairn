#!/bin/sh
# Portable verifier entry for Unix runners with pre-provisioned official qjs.
# BusyBox is NOT required (ordinary system shell is used only by this test helper).
set -eu
QJS=${QJS:-qjs}
"$QJS" quickjs/tests/test_native.mjs
"$QJS" quickjs/main.mjs validate-core --root "${DAIRN_TEST_PROJECT:-.}"
