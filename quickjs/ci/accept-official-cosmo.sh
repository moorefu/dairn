#!/bin/sh
# Independent native QuickJS acceptance. No Python, Node.js or BusyBox required.
# The shell, curl/unzip and sha256sum are bootstrap tools only and are not used by Dairn JS gates.
set -eu

usage() {
  cat <<'HELP'
Usage: accept-official-cosmo.sh [--zip PATH | --download | --qjs PATH]
  [--url HTTPS_URL] [--expect-sha256 HEX] [--allow-unpinned]
  [--project PATH [--base GIT_COMMIT]] [--out DIRECTORY]

An expected SHA256 (archive for --zip/--download, executable for --qjs)
  is REQUIRED by default. --allow-unpinned permits a non-trusted *exploratory*
  run only; it must not be used as a protected CI merge gate.

--download fetches official 2026-06-04 Cosmo ZIP via curl.
--url sets an alternate HTTPS mirror URL for --download (default: official source).
--zip uses a previously downloaded copy (best choice for air-gapped CI).
--qjs uses an already-extracted official binary (no curl/unzip required).
--project additionally runs validate-core, check --all, and check --base
  if --base is supplied, against an initialized Dairn project repository.
HELP
}
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$HERE/../.." && pwd)
URL=${DAIRN_QJS_DOWNLOAD_URL:-https://bellard.org/quickjs/binary_releases/quickjs-cosmo-2026-06-04.zip}
ARCHIVE=''; BIN=''; PROJECT=''; BASE=''; OUT=''; EXPECT=''; UNPINNED=0; DOWNLOAD=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --download) DOWNLOAD=1; shift;;
    --zip|--qjs|--project|--base|--out|--expect-sha256|--url)
      [ "$#" -ge 2 ] || { usage >&2; exit 2; }
      case "$1" in
        --zip) ARCHIVE=$2;; --qjs) BIN=$2;; --project) PROJECT=$2;;
        --base) BASE=$2;; --out) OUT=$2;; --expect-sha256) EXPECT=$2;;
        --url) URL=$2;;
      esac; shift 2;;
    --allow-unpinned) UNPINNED=1; shift;;
    -h|--help) usage; exit 0;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2;;
  esac
done
[ $((DOWNLOAD + $( [ -n "$ARCHIVE" ] && echo 1 || echo 0 ) + $( [ -n "$BIN" ] && echo 1 || echo 0 ))) -eq 1 ] || { echo 'Choose exactly one of --download, --zip, --qjs' >&2; exit 2; }
[ -z "$BASE" ] || [ -n "$PROJECT" ] || { echo '--base requires --project' >&2; exit 2; }
case "$URL" in https://*) : ;; *) echo '--url must be HTTPS' >&2; exit 2;; esac
if [ -z "$EXPECT" ] && [ "$UNPINNED" -ne 1 ]; then
  echo 'Refusing unpinned QuickJS binary. Supply --expect-sha256 or --allow-unpinned for exploratory testing.' >&2; exit 3
fi
case "$EXPECT" in '' ) :;; * )
  case "$EXPECT" in *[!0123456789abcdef]* ) echo 'Expected SHA must be lowercase hexadecimal' >&2; exit 2;; esac
  [ "${#EXPECT}" -eq 64 ] || { echo 'Expected SHA must have 64 characters' >&2; exit 2; };; esac
command -v sha256sum >/dev/null || { echo 'sha256sum required for bootstrapping' >&2; exit 3; }
[ -n "$OUT" ] || OUT=$(mktemp -d "${TMPDIR:-/tmp}/dairn-qjs-accept.XXXXXXXX")
mkdir -p "$OUT"
OUT=$(CDPATH= cd -- "$OUT" && pwd)
LOG=$OUT/acceptance.log
: > "$LOG"
echo "archive_source=$([ "$DOWNLOAD" -eq 1 ] && echo "$URL" || echo local-file)" >> "$LOG"
pass=0; fail=0
record() { # $1 name, $2 success(0)/failure(other), $3 log file
  if [ "$2" -eq 0 ]; then
    pass=$((pass+1)); printf 'PASS %s\n' "$1" | tee -a "$LOG"
  else
    fail=$((fail+1)); printf 'FAIL %s\n' "$1" | tee -a "$LOG"
  fi
  cat "$3" >> "$LOG"
}
if [ "$DOWNLOAD" -eq 1 ]; then
  command -v curl >/dev/null || { echo 'curl required for --download' >&2; exit 3; }
  ARCHIVE=$OUT/quickjs-cosmo-2026-06-04.zip
  if ! curl --fail --location --retry 1 --connect-timeout 8 --max-time 90 --output "$ARCHIVE" "$URL"; then
    echo "DOWNLOAD FAILED; see $URL. Supply --zip from a reachable machine." | tee -a "$LOG" >&2
    exit 4
  fi
fi
if [ -n "$ARCHIVE" ]; then
  command -v unzip >/dev/null || { echo 'unzip required for ZIP import' >&2; exit 3; }
  [ -f "$ARCHIVE" ] || { echo "Missing ZIP: $ARCHIVE" >&2; exit 3; }
  HASH=$(sha256sum "$ARCHIVE" | cut -d' ' -f1)
  echo "archive_sha256=$HASH" | tee -a "$LOG"
  if [ -n "$EXPECT" ] && [ "$HASH" != "$EXPECT" ]; then
    echo 'ZIP hash mismatch; refusing to extract or run' | tee -a "$LOG" >&2; exit 5
  fi
  # Archive is a fixed, publicly documented file. Disallow path traversal.
  if unzip -Z1 "$ARCHIVE" | grep -E '(^/|(^|/)\.\.(/|$)|\\)' >/dev/null; then
    echo 'Unsafe ZIP archive entries' | tee -a "$LOG" >&2; exit 5
  fi
  unzip -tq "$ARCHIVE" > "$OUT/zip-integrity.log" || { echo 'ZIP integrity failed' | tee -a "$LOG" >&2; exit 5; }
  mkdir -p "$OUT/extracted"
  unzip -q "$ARCHIVE" -d "$OUT/extracted"
  BIN=$OUT/extracted/qjs
  [ -f "$BIN" ] || { echo 'Official archive missing qjs at ZIP root' >&2; exit 5; }
  chmod 755 "$BIN"
else
  [ -f "$BIN" ] || { echo "Missing interpreter: $BIN" >&2; exit 3; }
  HASH=$(sha256sum "$BIN" | cut -d' ' -f1)
  if [ -n "$EXPECT" ] && [ "$HASH" != "$EXPECT" ]; then
    echo 'Binary hash mismatch; refusing execution' | tee -a "$LOG" >&2; exit 5
  fi
fi
BIN=$(CDPATH= cd -- "$(dirname "$BIN")" && pwd)/$(basename "$BIN")
BINSHA=$(sha256sum "$BIN" | cut -d' ' -f1)
echo "binary_sha256=$BINSHA" | tee -a "$LOG"
[ -x "$BIN" ] || { echo 'Interpreter not executable' >&2; exit 5; }
export DAIRN_QJS_BIN=$BIN
run_test() {
  name=$1; shift
  file=$OUT/"$name".log
  set +e
  "$@" > "$file" 2>&1
  code=$?
  set -e
  # Require a textual test marker, not only a zero exit status.
  if [ "$code" -eq 0 ]; then
    case "$name" in
      policy) grep -q 'PASS: QuickJS native portable policy cases' "$file" || code=1;;
      host) grep -q 'DAIRN_NATIVE_HOST_RESULT.*"failed":0' "$file" || code=1;;
      validate) grep -q 'PASS: QuickJS core structural checks' "$file" || code=1;;
      *) :;;
    esac
  fi
  record "$name" "$code" "$file"
}
run_test policy "$BIN" "$ROOT/quickjs/tests/test_native.mjs"
run_test host "$BIN" "$ROOT/quickjs/tests/test_host_native.mjs"
if [ -n "$PROJECT" ]; then
  PROJECT=$(CDPATH= cd -- "$PROJECT" && pwd)
  run_test validate "$BIN" "$ROOT/quickjs/main.mjs" validate-core --root "$PROJECT"
  run_test baseline "$BIN" "$ROOT/quickjs/main.mjs" check --root "$PROJECT" --all --timeout 120
  if [ -n "$BASE" ]; then
    run_test scoped-gate "$BIN" "$ROOT/quickjs/main.mjs" check --root "$PROJECT" --base "$BASE" --timeout 120
  fi
fi
assurance=sha256-pinned
[ "$UNPINNED" -eq 0 ] || [ -n "$EXPECT" ] || assurance=untrusted-exploratory
printf '{"kind":"Dairn-QuickJS-Cosmo-native-acceptance","qjs_release":"2026-06-04","binary_sha256":"%s","supply_assurance":"%s","passed":%s,"failed":%s,"native_contract_passed":%s}\n' "$BINSHA" "$assurance" "$pass" "$fail" "$( [ "$fail" -eq 0 ] && echo true || echo false )" > "$OUT/acceptance.json"
cat "$OUT/acceptance.json"
echo "LOG: $LOG"
[ "$fail" -eq 0 ] || exit 1
