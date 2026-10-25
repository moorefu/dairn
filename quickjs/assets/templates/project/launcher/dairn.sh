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
# APE may rewrite its own header. Execute a private copy; never chmod the payload.
DAIRN_EXEC_DIR=$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/dairn-runtime.XXXXXXXXXX") || {
  echo "dairn: cannot create runtime copy directory" >&2
  exit 2
}
trap '/bin/rm -f -- "$DAIRN_EXEC_DIR/dairn-embedded.com"; /bin/rmdir -- "$DAIRN_EXEC_DIR"' 0
if ! /bin/cp -- "$DAIRN_RUNTIME_FILE" "$DAIRN_EXEC_DIR/dairn-embedded.com" ||
   ! /bin/chmod u+wx "$DAIRN_EXEC_DIR/dairn-embedded.com"; then
  echo "dairn: cannot prepare runtime copy" >&2
  exit 2
fi
# Retain stdin and forward termination while the parent owns copy cleanup.
dairn_terminate() {
  trap '' HUP INT TERM
  # POSIX background children inherit ignored INT. Use TERM for cancellation,
  # while preserving the launcher's conventional interrupt exit status (130).
  kill -s "$1" "$DAIRN_CHILD" 2>/dev/null || true
  wait "$DAIRN_CHILD" 2>/dev/null || true
  exit "$2"
}
trap 'dairn_terminate HUP 129' HUP
trap 'dairn_terminate TERM 130' INT
trap 'dairn_terminate TERM 143' TERM
/bin/sh "$DAIRN_EXEC_DIR/dairn-embedded.com" /zip/quickjs/main.mjs "$@" <&0 &
DAIRN_CHILD=$!
DAIRN_EXIT=0
wait "$DAIRN_CHILD" || DAIRN_EXIT=$?
exit "$DAIRN_EXIT"
