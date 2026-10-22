#!/bin/sh
# 获取上游 QuickJS，校验后由它完成自举打包。
set -eu
BOOTSTRAP_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
LOCK="$BOOTSTRAP_ROOT/quickjs.lock.json"
# 锁文件采用单层 JSON；只提取固定键，绝不作为 shell 代码执行。
field() { sed -n "s/^[[:space:]]*\"$1\":[[:space:]]*\"\([^\"]*\)\"[,]*[[:space:]]*$/\1/p" "$LOCK"; }
URL=$(field url)
ARCHIVE_HASH=$(field archive_sha256)
BINARY_HASH=$(field binary_sha256)
MEMBER=$(field member)
case "$URL" in https://*) ;; *) echo 'QuickJS 下载地址必须使用 HTTPS' >&2; exit 2;; esac
for HASH in "$ARCHIVE_HASH" "$BINARY_HASH"; do
    case "$HASH" in *[!a-f0-9]*|'') echo 'QuickJS SHA256 配置无效' >&2; exit 2;; esac
    [ "${#HASH}" -eq 64 ] || exit 2
done
CACHE=${DAIRN_QUICKJS_CACHE:-"$BOOTSTRAP_ROOT/.build/quickjs"}
mkdir -p "$CACHE"
CACHE=$(CDPATH= cd -- "$CACHE" && pwd)
BINARY="$CACHE/qjs-$BINARY_HASH.com"
ARCHIVE="$CACHE/quickjs-$ARCHIVE_HASH.zip"
digest() {
    if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d ' ' -f1
    else shasum -a 256 "$1" | cut -d ' ' -f1; fi
}
check() { [ "$(digest "$1")" = "$2" ] || { echo "SHA256 校验失败：$1" >&2; exit 2; }; }
if [ -f "$BINARY" ]; then
    check "$BINARY" "$BINARY_HASH"
else
    PART=$(mktemp "$CACHE/download.XXXXXX")
    trap 'rm -f "$PART"' EXIT HUP INT TERM
    if [ ! -f "$ARCHIVE" ]; then
        [ "${DAIRN_OFFLINE:-0}" != 1 ] || { echo "离线缓存缺少 QuickJS：$ARCHIVE" >&2; exit 2; }
        echo "下载 QuickJS：$URL" >&2
        curl --fail --location --retry 3 --connect-timeout 30 --max-time 180 --proto '=https' --proto-redir '=https' --output "$PART" "$URL"
        check "$PART" "$ARCHIVE_HASH"
        mv -f "$PART" "$ARCHIVE"
    fi
    check "$ARCHIVE" "$ARCHIVE_HASH"
    unzip -p "$ARCHIVE" "$MEMBER" > "$PART"
    check "$PART" "$BINARY_HASH"
    chmod 755 "$PART"
    mv -f "$PART" "$BINARY"
    trap - EXIT HUP INT TERM
fi
if [ "${1:-}" = '--fetch-only' ]; then printf '%s\n' "$BINARY"; exit 0; fi
exec /bin/sh "$BINARY" "$BOOTSTRAP_ROOT/tools/build-zip.mjs" --root "$BOOTSTRAP_ROOT" --qjs "$BINARY" "$@"
