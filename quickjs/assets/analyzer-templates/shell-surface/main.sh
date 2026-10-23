#!/bin/sh
# Project-owned POSIX sh analyzer; needs jq and git. Advisory function declaration scan.
set -eu
[ "$#" -eq 2 ] || { echo 'usage: main.sh REQUEST OUTPUT' >&2; exit 2; }
command -v jq >/dev/null || { echo 'jq required' >&2; exit 2; }
REQ=$1 OUT=$2
ROOT=$(jq -er '.root' "$REQ"); BASE=$(jq -er '.subject.base_commit' "$REQ"); HEAD=$(jq -er '.subject.source_commit' "$REQ"); ID=$(jq -er '.analyzer_id' "$REQ")
[ "$(jq -r '.schema' "$REQ")" = dairn.analyzer-request.v1 ] && [ "$(jq -r '.domain' "$REQ")" = surface ] || exit 2
[ -n "$BASE" ] && [ -d "$ROOT/.git" ] || { echo 'invalid git baseline' >&2; exit 2; }
TMP=$(mktemp -d "${TMPDIR:-/tmp}/dairn-shell-analyzer.XXXXXXXX");trap 'rm -rf "$TMP"' EXIT HUP INT TERM
: > "$TMP/changes.jsonl"
git -C "$ROOT" diff --name-only --diff-filter=ACDMRT "$BASE" "$HEAD" -- > "$TMP/paths"
[ "$(wc -l < "$TMP/paths")" -le 500 ] || exit 2
while IFS= read -r path; do
 case "$path" in *.sh) ;; *) continue;; esac
 case "$path" in /*|*..*|*\\*) echo 'unsafe path' >&2;exit 2;; esac
 [ ! -L "$ROOT/$path" ] || { echo 'symlink refused' >&2;exit 2; }
 git -C "$ROOT" show "$BASE:$path" > "$TMP/pre" 2>/dev/null || : > "$TMP/pre"
 if [ -f "$ROOT/$path" ]; then cp "$ROOT/$path" "$TMP/post"; else : > "$TMP/post"; fi
 for side in pre post; do
   awk '/^[[:space:]]*(function[[:space:]]+)?[a-zA-Z_][a-zA-Z_0-9]*[[:space:]]*\(\)[[:space:]]*\{/ {print}' "$TMP/$side" | sed -E 's/^[[:space:]]*//' | sed -E 's/^function[[:space:]]+//' | awk -F'\(' '{print $1"|"$0}' | sort -u > "$TMP/$side.sig"
 done
 cut -d'|' -f1 "$TMP/pre.sig" "$TMP/post.sig" | sort -u | while IFS= read -r symbol; do
   [ -n "$symbol" ] || continue
   before=$(grep -F "${symbol}|" "$TMP/pre.sig" | head -1 | cut -d'|' -f2- || true)
   after=$(grep -F "${symbol}|" "$TMP/post.sig" | head -1 | cut -d'|' -f2- || true)
   [ "$before" != "$after" ] || continue
   change=changed;[ -n "$before" ] || change=added;[ -n "$after" ] || change=removed
   jq -cn --arg path "$path" --arg symbol "function:$symbol" --arg change "$change" --arg before "$before" --arg after "$after" '{path:$path,symbol:$symbol,change:$change,before:$before,after:$after}' >> "$TMP/changes.jsonl"
 done
done < "$TMP/paths"
jq -s --arg id "$ID" --arg base "$BASE" --arg head "$HEAD" '{schema:"dairn.surface-result.v1",analyzer_id:$id,domain:"surface",subject:{source_commit:$head,base_commit:$base},changes:.}' "$TMP/changes.jsonl" > "$OUT"
