#!/bin/sh
# Dairn launcher (generated from quickjs/core/launcher-scripts.mjs; do not edit).
# Runtime resolution: DAIRN_RUNTIME, then ./.dairn/runtime/dairn-embedded.com.
set -eu
# The APE sh loader needs base system tools (dd/gzip) even when a harness clears PATH.
if [ -z "${PATH:-}" ]; then PATH=/usr/local/bin:/usr/bin:/bin; export PATH; fi
case "$0" in */*) DAIRN_DIR=${0%/*} ;; *) DAIRN_DIR=. ;; esac
DAIRN_HOME=$(CDPATH= cd -- "$DAIRN_DIR" && pwd)
if [ -n "${DAIRN_RUNTIME:-}" ]; then
  case "$DAIRN_RUNTIME" in
    /*) DAIRN_RUNTIME_FILE=$DAIRN_RUNTIME ;;
    *) DAIRN_RUNTIME_FILE=$DAIRN_HOME/$DAIRN_RUNTIME ;;
  esac
  if [ ! -f "$DAIRN_RUNTIME_FILE" ]; then
    echo "dairn: DAIRN_RUNTIME is not a file: $DAIRN_RUNTIME_FILE" >&2
    exit 2
  fi
  DAIRN_RUNTIME_SOURCE=external; export DAIRN_RUNTIME_SOURCE
else
  DAIRN_RUNTIME_FILE=$DAIRN_HOME/.dairn/runtime/dairn-embedded.com
  if [ ! -f "$DAIRN_RUNTIME_FILE" ]; then
    echo "dairn: governance runtime not found (DAIRN_NOT_AVAILABLE)" >&2
    echo "  expected: $DAIRN_HOME/.dairn/runtime/dairn-embedded.com" >&2
    echo "  run this launcher from an extracted release or a project created with dairn init/adopt," >&2
    echo "  or in the Dairn source repository set DAIRN_RUNTIME=<repo>/runtime/dairn-embedded.com" >&2
    exit 2
  fi
  DAIRN_RUNTIME_SOURCE=vendored; export DAIRN_RUNTIME_SOURCE
fi
DAIRN_RUNTIME_DIR=${DAIRN_RUNTIME_FILE%/*}; export DAIRN_RUNTIME_DIR
# Reuse a private content-addressed image. Only cache misses copy the payload.
dairn_digest() {
  if [ -x /usr/bin/sha256sum ]; then
    /usr/bin/sha256sum < "$1"
  elif [ -x /usr/bin/shasum ]; then
    /usr/bin/shasum -a 256 < "$1"
  else
    echo "dairn: SHA256 tool unavailable for runtime image verification" >&2
    return 2
  fi
}
DAIRN_DIGEST=$(dairn_digest "$DAIRN_RUNTIME_FILE") || exit 2
DAIRN_DIGEST=${DAIRN_DIGEST%% *}
case "$DAIRN_DIGEST" in *[!a-f0-9]*|'') exit 2 ;; esac
[ "${#DAIRN_DIGEST}" -eq 64 ] || exit 2
dairn_stat() {
  /usr/bin/stat -c '%a:%u' "$1" 2>/dev/null || /usr/bin/stat -f '%Lp:%u' "$1"
}
# Return 2 for unsafe state, 3 for an unavailable safe candidate. Never mask risk.
dairn_check_parents() {
  DAIRN_CACHE_PARENT=$1
  while :; do
    DAIRN_IMAGE_META=$(dairn_stat "$DAIRN_CACHE_PARENT") || return 3
    DAIRN_IMAGE_MODE=${DAIRN_IMAGE_META%%:*}
    DAIRN_IMAGE_OWNER=${DAIRN_IMAGE_META#*:}
    if [ "$DAIRN_IMAGE_OWNER" != 0 ] && [ ! -O "$DAIRN_CACHE_PARENT" ]; then
      echo "dairn: unsafe runtime image cache parent owner" >&2; return 2
    fi
    if [ "$((0$DAIRN_IMAGE_MODE & 0022))" -ne 0 ] && [ "$((0$DAIRN_IMAGE_MODE & 01000))" -eq 0 ]; then
      echo "dairn: unsafe writable runtime image cache parent" >&2; return 2
    fi
    [ "$DAIRN_CACHE_PARENT" != / ] || break
    DAIRN_CACHE_PARENT=${DAIRN_CACHE_PARENT%/*}
    DAIRN_CACHE_PARENT=${DAIRN_CACHE_PARENT:-/}
  done
}
dairn_prepare_image() {
  DAIRN_IMAGE_DIR=$1
  case "$DAIRN_IMAGE_DIR" in /*) ;; *) echo "dairn: runtime image cache must be absolute" >&2; return 2 ;; esac
  # Check every existing logical ancestor before mkdir, then the physical path.
  DAIRN_CACHE_PROBE=$DAIRN_IMAGE_DIR
  while :; do
    if [ -L "$DAIRN_CACHE_PROBE" ]; then
      DAIRN_CACHE_REAL=$(CDPATH= cd -P -- "$DAIRN_CACHE_PROBE" 2>/dev/null && pwd) || { echo "dairn: unsafe runtime image cache symlink" >&2; return 2; }
      dairn_check_parents "$DAIRN_CACHE_REAL" || return $?
      # macOS system aliases are root-owned; user-controlled links are refused.
      case "$DAIRN_CACHE_PROBE:$(dairn_stat "$DAIRN_CACHE_PROBE")" in
        /tmp:*:0|/var:*:0) ;;
        *) echo "dairn: unsafe runtime image cache symlink" >&2; return 2 ;;
      esac
    elif [ -e "$DAIRN_CACHE_PROBE" ]; then
      [ -d "$DAIRN_CACHE_PROBE" ] || { echo "dairn: unsafe runtime image cache path type" >&2; return 2; }
      DAIRN_CACHE_REAL=$(CDPATH= cd -P -- "$DAIRN_CACHE_PROBE" 2>/dev/null && pwd) || return 3
      dairn_check_parents "$DAIRN_CACHE_REAL" || return $?
      break
    fi
    [ "$DAIRN_CACHE_PROBE" != / ] || break
    DAIRN_CACHE_PROBE=${DAIRN_CACHE_PROBE%/*}
    DAIRN_CACHE_PROBE=${DAIRN_CACHE_PROBE:-/}
  done
  # Also reject links above the nearest existing ancestor.
  DAIRN_CACHE_PROBE=$DAIRN_IMAGE_DIR
  while [ "$DAIRN_CACHE_PROBE" != / ]; do
    if [ -L "$DAIRN_CACHE_PROBE" ]; then
      case "$DAIRN_CACHE_PROBE:$(dairn_stat "$DAIRN_CACHE_PROBE")" in /tmp:*:0|/var:*:0) ;; *) echo "dairn: unsafe runtime image cache symlink" >&2; return 2 ;; esac
    fi
    DAIRN_CACHE_PROBE=${DAIRN_CACHE_PROBE%/*}; DAIRN_CACHE_PROBE=${DAIRN_CACHE_PROBE:-/}
  done
  DAIRN_CACHE_CREATED=0
  if [ ! -d "$DAIRN_IMAGE_DIR" ]; then
    (umask 077; /bin/mkdir -p -- "$DAIRN_IMAGE_DIR") 2>/dev/null || return 3
    DAIRN_CACHE_CREATED=1
  fi
  if [ -L "$DAIRN_IMAGE_DIR" ] || [ ! -O "$DAIRN_IMAGE_DIR" ]; then
    echo "dairn: unsafe runtime image cache directory" >&2; return 2
  fi
  DAIRN_IMAGE_DIR=$(CDPATH= cd -P -- "$DAIRN_IMAGE_DIR" && pwd) || return 3
  if [ "$DAIRN_CACHE_CREATED" = 1 ]; then dairn_check_parents "$DAIRN_IMAGE_DIR" || return $?; fi
  DAIRN_IMAGE_META=$(dairn_stat "$DAIRN_IMAGE_DIR") || return 3
  if [ "${DAIRN_IMAGE_META%%:*}" != 700 ]; then
    echo "dairn: runtime image cache directory must have mode 700" >&2; return 2
  fi
  DAIRN_IMAGE=$DAIRN_IMAGE_DIR/$DAIRN_DIGEST.com
  if [ -L "$DAIRN_IMAGE" ] || { [ -e "$DAIRN_IMAGE" ] && [ ! -f "$DAIRN_IMAGE" ]; }; then
    echo "dairn: unsafe runtime image cache entry" >&2; return 2
  fi
  if [ -f "$DAIRN_IMAGE" ]; then
    dairn_verify_image
    return $?
  fi
  DAIRN_IMAGE_TEMP=$(/usr/bin/mktemp "$DAIRN_IMAGE_DIR/.prepare.XXXXXXXXXX" 2>/dev/null) || return 3
  trap '/bin/rm -f -- "$DAIRN_IMAGE_TEMP"' 0
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
  if ! /bin/cp -- "$DAIRN_RUNTIME_FILE" "$DAIRN_IMAGE_TEMP" || ! /bin/chmod 700 "$DAIRN_IMAGE_TEMP"; then
    /bin/rm -f -- "$DAIRN_IMAGE_TEMP"; trap - 0 HUP INT TERM; return 3
  fi
  DAIRN_COPY_DIGEST=$(dairn_digest "$DAIRN_IMAGE_TEMP") || return 2
  if [ "${DAIRN_COPY_DIGEST%% *}" != "$DAIRN_DIGEST" ]; then
    echo "dairn: runtime changed while preparing image" >&2; return 2
  fi
  # Concurrent creators publish identical bytes by atomic rename, never in place.
  if ! /bin/mv -f -- "$DAIRN_IMAGE_TEMP" "$DAIRN_IMAGE"; then
    /bin/rm -f -- "$DAIRN_IMAGE_TEMP"; trap - 0 HUP INT TERM; return 3
  fi
  trap - 0 HUP INT TERM
  dairn_verify_image
}
dairn_verify_image() {
  DAIRN_IMAGE_DIGEST=$(dairn_digest "$DAIRN_IMAGE") || return 2
  DAIRN_IMAGE_META=$(dairn_stat "$DAIRN_IMAGE") || return 2
  if [ "${DAIRN_IMAGE_DIGEST%% *}" != "$DAIRN_DIGEST" ] || [ ! -O "$DAIRN_IMAGE" ] || [ "${DAIRN_IMAGE_META%%:*}" != 700 ]; then
    echo "dairn: runtime image checksum or permissions mismatch: $DAIRN_IMAGE" >&2; return 2
  fi
}
dairn_cache_unavailable() {
  echo "DAIRN_RUNTIME_CACHE_UNAVAILABLE" >&2
  echo >&2
  echo "Default runtime image cache is not writable." >&2
  echo "No safe fallback cache directory is available." >&2
  echo >&2
  echo "Set DAIRN_CACHE_HOME to an absolute," >&2
  echo "private, writable directory." >&2
  exit 2
}
if [ "${DAIRN_CACHE_HOME+x}" = x ]; then
  case "$DAIRN_CACHE_HOME" in /*) ;; *) echo "dairn: DAIRN_CACHE_HOME must be absolute and nonempty" >&2; exit 2 ;; esac
  if dairn_prepare_image "$DAIRN_CACHE_HOME/runtime-images-v1"; then :; else
    DAIRN_CACHE_STATUS=$?; [ "$DAIRN_CACHE_STATUS" = 3 ] || exit 2
    echo "dairn: explicit DAIRN_CACHE_HOME unavailable; fallback disabled" >&2
    dairn_cache_unavailable
  fi
else
  DAIRN_CACHE_STATUS=3
  DAIRN_DEFAULT_HOME=${XDG_CACHE_HOME:-${HOME:+$HOME/.cache}}
  if [ -n "$DAIRN_DEFAULT_HOME" ]; then
    if dairn_prepare_image "$DAIRN_DEFAULT_HOME/dairn/runtime-images-v1"; then DAIRN_CACHE_STATUS=0; else DAIRN_CACHE_STATUS=$?; fi
  fi
  if [ "$DAIRN_CACHE_STATUS" != 0 ]; then
    [ "$DAIRN_CACHE_STATUS" = 3 ] || exit 2
    DAIRN_PROJECT_ROOT=$DAIRN_HOME
    if [ ! -f "$DAIRN_PROJECT_ROOT/.dairn/lock.json" ]; then
      DAIRN_PROJECT_ROOT=$(pwd -P)
      while [ ! -f "$DAIRN_PROJECT_ROOT/.dairn/lock.json" ] && [ "$DAIRN_PROJECT_ROOT" != / ]; do
        DAIRN_PROJECT_ROOT=${DAIRN_PROJECT_ROOT%/*}; DAIRN_PROJECT_ROOT=${DAIRN_PROJECT_ROOT:-/}
      done
    fi
    if [ -f "$DAIRN_PROJECT_ROOT/.dairn/lock.json" ]; then
      if [ -L "$DAIRN_PROJECT_ROOT/.dairn" ] || [ -L "$DAIRN_PROJECT_ROOT/.dairn/lock.json" ]; then
        echo "dairn: unsafe project cache marker" >&2; exit 2
      fi
      if dairn_prepare_image "$DAIRN_PROJECT_ROOT/.dairn/cache/ape-exec"; then DAIRN_CACHE_STATUS=0; else DAIRN_CACHE_STATUS=$?; fi
      [ "$DAIRN_CACHE_STATUS" != 2 ] || exit 2
    fi
    [ "$DAIRN_CACHE_STATUS" = 0 ] || dairn_cache_unavailable
  fi
fi
exec /bin/sh "$DAIRN_IMAGE" /zip/quickjs/main.mjs "$@"
