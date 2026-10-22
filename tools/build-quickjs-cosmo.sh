#!/bin/sh
# 输入已应用补丁的 QuickJS 源码和匹配的 cosmocc 目录。
# 只在指定源码目录内构建，不安装系统依赖，不修改已发布的二进制。
set -eu
cd "$1"
CC="$2/bin/cosmocc"
VERSION=$(cat VERSION)
mkdir -p .dairn-obj
for name in quickjs dtoa libregexp libunicode cutils quickjs-libc qjsc qjs; do
  rm -f ".dairn-obj/$name.o"
  "$CC" -Os -fwrapv -D_GNU_SOURCE "-DCONFIG_VERSION=\"$VERSION\"" \
    '-DCONFIG_CC="cosmocc"' '-DCONFIG_PREFIX="/usr/local"' \
    -c "$name.c" -o ".dairn-obj/$name.o"
  test -s ".dairn-obj/$name.o"
done
set -- .dairn-obj/quickjs.o .dairn-obj/dtoa.o .dairn-obj/libregexp.o \
  .dairn-obj/libunicode.o .dairn-obj/cutils.o .dairn-obj/quickjs-libc.o
rm -f qjsc
"$CC" -s -o qjsc .dairn-obj/qjsc.o "$@" -lm -lpthread -ldl
test -s qjsc
sh ./qjsc -s -c -o repl.c -m repl.js
rm -f .dairn-obj/repl.o qjs
"$CC" -Os -c repl.c -o .dairn-obj/repl.o
test -s .dairn-obj/repl.o
"$CC" -s -o qjs .dairn-obj/qjs.o .dairn-obj/repl.o "$@" -lm -lpthread -ldl
test -s qjs
sh ./qjs --std -e 'print("QuickJS 构建完成：" + os.platform)'
