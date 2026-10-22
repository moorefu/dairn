#!/bin/sh
# Dairn portable default, no mutation of the distributed APE.
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
RUNTIME="$HERE/dairn-embedded.com"
if [ "${DAIRN_FAST_RUNTIME:-0}" = "1" ] && command -v sha256sum >/dev/null 2>&1; then
  HASH=$(sha256sum "$RUNTIME" | cut -d ' ' -f1)
  CACHE="${DAIRN_CACHE_HOME:-${XDG_CACHE_HOME:-${HOME:-/tmp}/.cache}/dairn}/native-$HASH"
  mkdir -p "$CACHE"
  chmod 700 "$CACHE"
  OPT="$CACHE/dairn-native"
  if [ ! -f "$OPT" ]; then
    STAGE="$CACHE/dairn-native-$$.tmp"
    cp "$RUNTIME" "$STAGE"
    chmod 700 "$STAGE"
    if "$STAGE" --assimilate >/dev/null 2>&1; then
      mv -n "$STAGE" "$OPT" || true
    fi
    rm -f "$STAGE"
  fi
  if [ -f "$OPT" ] && [ ! -L "$OPT" ]; then
    exec "$OPT" /zip/quickjs/main.mjs "$@"
  fi
fi
exec "$RUNTIME" /zip/quickjs/main.mjs "$@"
