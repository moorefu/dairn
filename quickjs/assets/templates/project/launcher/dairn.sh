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
DAIRN_IMAGE_HOME=${DAIRN_CACHE_HOME:-${XDG_CACHE_HOME:-${HOME:?HOME or DAIRN_CACHE_HOME required}/.cache}/dairn}
case "$DAIRN_IMAGE_HOME" in /*) ;; *) echo "dairn: runtime image cache must be absolute" >&2; exit 2 ;; esac
DAIRN_IMAGE_DIR=$DAIRN_IMAGE_HOME/runtime-images-v1
if [ ! -d "$DAIRN_IMAGE_DIR" ]; then
  (umask 077; /bin/mkdir -p -- "$DAIRN_IMAGE_DIR") || exit 2
fi
# Resolve intermediate links, then require a trusted path to the private cache.
dairn_stat() {
  /usr/bin/stat -c '%a:%u' "$1" 2>/dev/null || /usr/bin/stat -f '%Lp:%u' "$1"
}
if [ -L "$DAIRN_IMAGE_DIR" ] || [ ! -O "$DAIRN_IMAGE_DIR" ]; then
  echo "dairn: unsafe runtime image cache directory" >&2; exit 2
fi
DAIRN_IMAGE_DIR=$(CDPATH= cd -P -- "$DAIRN_IMAGE_DIR" && pwd) || exit 2
DAIRN_CACHE_PARENT=$DAIRN_IMAGE_DIR
while :; do
  DAIRN_IMAGE_META=$(dairn_stat "$DAIRN_CACHE_PARENT") || exit 2
  DAIRN_IMAGE_MODE=${DAIRN_IMAGE_META%%:*}
  DAIRN_IMAGE_OWNER=${DAIRN_IMAGE_META#*:}
  if [ "$DAIRN_IMAGE_OWNER" != 0 ] && [ ! -O "$DAIRN_CACHE_PARENT" ]; then
    echo "dairn: unsafe runtime image cache parent owner" >&2; exit 2
  fi
  if [ "$DAIRN_CACHE_PARENT" = "$DAIRN_IMAGE_DIR" ]; then
    if [ "$DAIRN_IMAGE_MODE" != 700 ]; then
      echo "dairn: runtime image cache directory must have mode 700" >&2; exit 2
    fi
  elif [ "$((0$DAIRN_IMAGE_MODE & 0022))" -ne 0 ] && [ "$((0$DAIRN_IMAGE_MODE & 01000))" -eq 0 ]; then
    echo "dairn: unsafe writable runtime image cache parent" >&2; exit 2
  fi
  [ "$DAIRN_CACHE_PARENT" != / ] || break
  DAIRN_CACHE_PARENT=${DAIRN_CACHE_PARENT%/*}
  DAIRN_CACHE_PARENT=${DAIRN_CACHE_PARENT:-/}
done
DAIRN_IMAGE=$DAIRN_IMAGE_DIR/$DAIRN_DIGEST.com
if [ -L "$DAIRN_IMAGE" ] || { [ -e "$DAIRN_IMAGE" ] && [ ! -f "$DAIRN_IMAGE" ]; }; then
  echo "dairn: unsafe runtime image cache entry" >&2; exit 2
fi
if [ ! -f "$DAIRN_IMAGE" ]; then
  DAIRN_IMAGE_TEMP=$(/usr/bin/mktemp "$DAIRN_IMAGE_DIR/.prepare.XXXXXXXXXX") || exit 2
  trap '/bin/rm -f -- "$DAIRN_IMAGE_TEMP"' 0
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
  if ! /bin/cp -- "$DAIRN_RUNTIME_FILE" "$DAIRN_IMAGE_TEMP" || ! /bin/chmod 700 "$DAIRN_IMAGE_TEMP"; then
    echo "dairn: cannot prepare runtime image" >&2; exit 2
  fi
  DAIRN_COPY_DIGEST=$(dairn_digest "$DAIRN_IMAGE_TEMP") || exit 2
  if [ "${DAIRN_COPY_DIGEST%% *}" != "$DAIRN_DIGEST" ]; then
    echo "dairn: runtime changed while preparing image" >&2; exit 2
  fi
  # Concurrent creators publish identical bytes by atomic rename, never in place.
  /bin/mv -f -- "$DAIRN_IMAGE_TEMP" "$DAIRN_IMAGE" || exit 2
  trap - 0 HUP INT TERM
fi
DAIRN_IMAGE_DIGEST=$(dairn_digest "$DAIRN_IMAGE") || exit 2
DAIRN_IMAGE_META=$(dairn_stat "$DAIRN_IMAGE") || exit 2
if [ "${DAIRN_IMAGE_DIGEST%% *}" != "$DAIRN_DIGEST" ] || [ ! -O "$DAIRN_IMAGE" ] ||
   [ "${DAIRN_IMAGE_META%%:*}" != 700 ]; then
  echo "dairn: runtime image checksum or permissions mismatch: $DAIRN_IMAGE" >&2
  exit 2
fi
exec /bin/sh "$DAIRN_IMAGE" /zip/quickjs/main.mjs "$@"
