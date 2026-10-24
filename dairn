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
# The APE sh loader also needs the executable bit; restoring it is harmless.
if [ ! -x "$DAIRN_RUNTIME_FILE" ]; then chmod u+x "$DAIRN_RUNTIME_FILE" 2>/dev/null || true; fi
exec /bin/sh "$DAIRN_RUNTIME_FILE" /zip/quickjs/main.mjs "$@"
