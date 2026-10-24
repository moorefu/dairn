#!/bin/sh
# Dairn 启动器：源码仓库、npm、Wheel 与 ZIP 共用唯一入口。
#
# 运行时有明确分工，不要混用：
#   - 治理运行时快照：项目内 `.dairn/runtime/`（vendor 的固定 APE），
#     由本启动器直接执行，是日常命令的实际执行者，不需要先构建；
#   - 构建产物：仓库根 `runtime/`（python tools/build.py 输出），只用于构建、
#     打包和显式验证新源码（通过 DAIRN_RUNTIME 指定），不参与日常解析；
#   - 源码：`quickjs/` 是本仓库事实源；只有需要让治理运行时采用新构建、
#     发布或验证内核改动时才构建，不要求每轮都执行 vendor/upgrade 全套流程。
#
# 解析顺序：
#   DAIRN_RUNTIME（显式覆盖，构建/验证流程用）
#   -> 项目内 `.dairn/runtime/dairn-embedded.com`（治理运行时快照）
#   -> 随包分发的 `runtime/`（安装后的发行包）
set -eu
DAIRN_DIR=${0%/*}
[ "$DAIRN_DIR" != "$0" ] || DAIRN_DIR=.
HERE=$(CDPATH= cd -- "$DAIRN_DIR" && pwd)
if [ -n "${DAIRN_RUNTIME:-}" ]; then
  case "$DAIRN_RUNTIME" in
    /*) RUNTIME="$DAIRN_RUNTIME" ;;
    *) RUNTIME="$HERE/$DAIRN_RUNTIME" ;;
  esac
  [ -f "$RUNTIME" ] || { echo "Dairn 运行时不存在：$DAIRN_RUNTIME（DAIRN_RUNTIME 覆盖路径）" >&2; exit 2; }
  DAIRN_RUNTIME_SOURCE=external
  export DAIRN_RUNTIME_SOURCE
elif [ -f "$HERE/.dairn/runtime/dairn-embedded.com" ]; then
  RUNTIME="$HERE/.dairn/runtime/dairn-embedded.com"
  DAIRN_RUNTIME_SOURCE=vendored
  export DAIRN_RUNTIME_SOURCE
else
  RUNTIME="$HERE/runtime/dairn-embedded.com"
  [ -f "$RUNTIME" ] || { echo "未找到 Dairn 运行时：$HERE/.dairn/runtime/dairn-embedded.com（治理运行时快照）与 $RUNTIME（随包运行时）均不存在。源码仓库请保留 .dairn/runtime，或仅在需要时运行 python tools/build.py 并更新快照；安装包请重新安装" >&2; exit 2; }
  DAIRN_RUNTIME_SOURCE=packaged
  export DAIRN_RUNTIME_SOURCE
fi
# APE 的 sh 加载器用 command -v "$0" 定位自身；bash（macOS 的 /bin/sh）对没有
# 执行位的路径返回失败，dd 会读到空输入并让 gzip 报 EOF。这里只补元数据。
if [ ! -x "$RUNTIME" ]; then
  chmod u+x "$RUNTIME" 2>/dev/null || true
fi
# 快速模式只在本地显式开启；任何校验失败都回退不可变源 APE。
# 锁与临时文件在 fast path 中赋值，这里先初始化为空，保证 trap 在 set -u 下安全。
CACHE= OPT= META= LOCK= STAGE= META_STAGE=
cache_cleanup() {
  [ -z "$STAGE" ] || rm -f "$STAGE" 2>/dev/null || true
  [ -z "$META_STAGE" ] || rm -f "$META_STAGE" 2>/dev/null || true
  [ -z "$LOCK" ] || rmdir "$LOCK" 2>/dev/null || true
}
# 进程崩溃或被中断时清理半成品与锁目录；只有成功持有锁后才会设置 LOCK，
# 因此不会误删其他进程的活锁。
trap cache_cleanup 0
trap 'cache_cleanup; exit 130' INT
trap 'cache_cleanup; exit 143' TERM
trap 'cache_cleanup; exit 129' HUP
owner_of() { stat -c %u "$1" 2>/dev/null || stat -f %u "$1" 2>/dev/null || true; }
mode_of() { stat -c %a "$1" 2>/dev/null || stat -f %Lp "$1" 2>/dev/null || true; }
private_dir() {
  [ -d "$1" ] && [ ! -L "$1" ] || return 1
  chmod 700 "$1" 2>/dev/null || return 1
  owner=$(owner_of "$1"); [ -n "$owner" ] && [ "$owner" = "$(id -u)" ] || return 1
  mode=$(mode_of "$1"); [ "$mode" = 700 ] || [ "$mode" = 0700 ] || return 1
}
private_exec() {
  [ -f "$1" ] && [ ! -L "$1" ] || return 1
  owner=$(owner_of "$1"); [ -n "$owner" ] && [ "$owner" = "$(id -u)" ] || return 1
  mode=$(mode_of "$1"); [ "$mode" = 700 ] || [ "$mode" = 0700 ] || return 1
}
private_metadata() {
  [ -f "$1" ] && [ ! -L "$1" ] || return 1
  owner=$(owner_of "$1"); [ -n "$owner" ] && [ "$owner" = "$(id -u)" ] || return 1
  mode=$(mode_of "$1"); [ "$mode" = 600 ] || [ "$mode" = 0600 ] || return 1
}
truthy() {
  case "${1:-}" in 1|true|True|TRUE) return 0 ;; esac
  return 1
}
protected_ci() {
  # 只认真正的受保护 CI 平台：GitHub Actions / GitLab CI。普通 CI=true（很多
  # 本地与跨 CI 工具链都会设置）不能触发保护，否则 Linux 集成回归里依赖快速
  # 缓存的用例会被误伤。DAIRN_PROTECTED_CI=1 允许调用方显式声明。
  truthy "${DAIRN_PROTECTED_CI:-}" && return 0
  truthy "${GITHUB_ACTIONS:-}" && return 0
  truthy "${GITLAB_CI:-}" && return 0
  return 1
}
cache_valid() {
  private_exec "$OPT" && private_metadata "$META" || return 1
  expected=$(cat "$META" 2>/dev/null || true)
  case "$expected" in *[!0-9a-f]*|'') return 1 ;; esac
  [ "${#expected}" -eq 64 ] || return 1
  actual=$(sha256sum "$OPT" 2>/dev/null | cut -d ' ' -f1) || actual=
  [ "$actual" = "$expected" ]
}
# 受限尝试取锁；进程崩溃遗留超过 10 分钟的陈旧锁在 rmdir 后重试一次。
# 返回非零表示存在其他活进程的锁或无法安全区分，调用方回退源 APE。
lock_acquire() {
  lock_path=$1
  mkdir "$lock_path" 2>/dev/null && return 0
  [ -d "$lock_path" ] && [ ! -L "$lock_path" ] || return 1
  [ "$(owner_of "$lock_path")" = "$(id -u)" ] || return 1
  command -v find >/dev/null 2>&1 || return 1
  # POSIX/BSD find 都没有 -maxdepth；锁目录为空，直接匹配目录本身即可。
  stale=$(find "$lock_path" -mmin +10 2>/dev/null || true)
  [ -n "$stale" ] || return 1
  rmdir "$lock_path" 2>/dev/null || return 1
  mkdir "$lock_path" 2>/dev/null
}
# 仅在持有锁时调用：从源 APE 复制、同化到 0700 临时文件，先落 OPT 再落
# META，两次 mv 都是原子发布，期间其他进程只会回退源 APE。
cache_rebuild() {
  STAGE="$CACHE/dairn-native-$$.tmp"
  META_STAGE="$CACHE/dairn-native.sha256-$$.tmp"
  rm -f "$STAGE" "$META_STAGE" 2>/dev/null || true
  cp "$RUNTIME" "$STAGE" 2>/dev/null || return 1
  chmod 700 "$STAGE" 2>/dev/null || return 1
  /bin/sh "$STAGE" --assimilate >/dev/null 2>&1 || return 1
  chmod 700 "$STAGE" 2>/dev/null || return 1
  NEW_HASH=$(sha256sum "$STAGE" 2>/dev/null | cut -d ' ' -f1) || NEW_HASH=
  case "$NEW_HASH" in *[!0-9a-f]*|'') return 1 ;; esac
  [ "${#NEW_HASH}" -eq 64 ] || return 1
  printf '%s\n' "$NEW_HASH" > "$META_STAGE" 2>/dev/null || return 1
  chmod 600 "$META_STAGE" 2>/dev/null || return 1
  mv "$STAGE" "$OPT" 2>/dev/null || return 1
  STAGE=
  rm -f "$META" 2>/dev/null || true
  mv "$META_STAGE" "$META" 2>/dev/null || return 1
  META_STAGE=
  return 0
}
if [ "${DAIRN_FAST_RUNTIME:-0}" = "1" ] && ! protected_ci && command -v sha256sum >/dev/null 2>&1; then
  RUNTIME_HASH=$(sha256sum "$RUNTIME" 2>/dev/null | cut -d ' ' -f1) || RUNTIME_HASH=
  case "$RUNTIME_HASH" in *[!0-9a-f]*|'') RUNTIME_HASH= ;; esac
  if [ "${#RUNTIME_HASH}" -eq 64 ]; then
    CACHE_ROOT="${DAIRN_CACHE_HOME:-${XDG_CACHE_HOME:-${HOME:-/tmp}/.cache}/dairn}"
    CACHE="$CACHE_ROOT/native-$RUNTIME_HASH"
    # Fast mode is an opt-in local optimization. Refuse shared or symlinked
    # directories and fall back to the immutable source APE if validation fails.
    if [ ! -e "$CACHE_ROOT" ]; then mkdir -p "$CACHE_ROOT" 2>/dev/null || true; fi
    if private_dir "$CACHE_ROOT"; then
      if [ ! -e "$CACHE" ]; then mkdir "$CACHE" 2>/dev/null || true; fi
      if private_dir "$CACHE"; then
        OPT="$CACHE/dairn-native"
        META="$CACHE/dairn-native.sha256"
        lock_path="$CACHE/.dairn-native.lock"
        if ! cache_valid && lock_acquire "$lock_path"; then
          # 已持有锁：损坏/被篡改的 OPT/META 不跟随地移除（rm -f 对符号链接
          # 只删除链接本身），随后清理崩溃残留的临时文件并原子重建。
          LOCK="$lock_path"
          # 等待锁期间可能已有其他进程完成有效重建，二次确认后再决定是否修复。
          if ! cache_valid; then
            if [ -L "$OPT" ] || [ -f "$OPT" ]; then rm -f "$OPT" 2>/dev/null || true; fi
            if [ -L "$META" ] || [ -f "$META" ]; then rm -f "$META" 2>/dev/null || true; fi
            if [ ! -e "$OPT" ] && [ ! -L "$OPT" ]; then
              rm -f "$CACHE"/dairn-native-*.tmp "$CACHE"/dairn-native.sha256-*.tmp 2>/dev/null || true
              cache_rebuild || true
            fi
          fi
          [ -z "$STAGE" ] || rm -f "$STAGE" 2>/dev/null || true
          [ -z "$META_STAGE" ] || rm -f "$META_STAGE" 2>/dev/null || true
          STAGE= META_STAGE=
          rmdir "$LOCK" 2>/dev/null || true
          LOCK=
        fi
        # 只有通过所有权/权限/摘要校验的缓存才会被执行；否则回退源 APE。
        if cache_valid; then exec "$OPT" /zip/quickjs/main.mjs "$@"; fi
      fi
    fi
  fi
fi
exec /bin/sh "$RUNTIME" /zip/quickjs/main.mjs "$@"
