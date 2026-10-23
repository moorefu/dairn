#!/bin/sh
# Trusted CI helper: fetch a normalized GitHub approval snapshot via REST API.
# Core never touches the network; this helper runs on a trusted runner with a
# read-only token and emits only the normalized fields approval.mjs consumes.
# Usage: fetch-github-approval.sh OWNER/REPO PR_NUMBER > snapshot.json
set -eu
REPO=${1:?Usage: fetch-github-approval.sh OWNER/REPO PR_NUMBER}
NUMBER=${2:?PR number required}
: "${DAIRN_GITHUB_TOKEN:?Read-only GitHub token required}"
API=${DAIRN_GITHUB_API:-https://api.github.com}
command -v curl >/dev/null && command -v jq >/dev/null || { echo 'curl and jq required' >&2; exit 2; }
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' 0
fetch() { # fetch OUT API_PATH — any failure yields a {"fetch_error":...} document
  : > "$1"
  code=$(curl -sS --max-time 30 --retry 2 -H "Authorization: Bearer $DAIRN_GITHUB_TOKEN" \
    -H 'Accept: application/vnd.github+json' -o "$1" -w '%{http_code}' "$API$2" 2>"$1.err") || code=000
  if [ "$code" != 200 ]; then
    printf '{"fetch_error":"http-%s","target":"%s"}\n' "$code" "$2" > "$1"
  fi
}
fetch "$WORK/pr.json" "/repos/$REPO/pulls/$NUMBER"
fetch "$WORK/reviews.json" "/repos/$REPO/pulls/$NUMBER/reviews?per_page=100"
# A fetch error or a possibly-truncated review page must yield INDETERMINATE
# downstream; the snapshot carries explicit markers instead of silent data loss.
jq -nc --arg repo "$REPO" --argjson number "$NUMBER" --arg fetched_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --slurpfile pr "$WORK/pr.json" --slurpfile reviews "$WORK/reviews.json" '
  ($pr[0] // {"fetch_error":"missing"}) as $p | ($reviews[0] // {"fetch_error":"missing"}) as $r |
  ($p | has("fetch_error")) as $prerr | ($r | has("fetch_error")) as $rverr |
  {schema:"dairn.approval-snapshot.github.v1", repository:$repo, number:$number, fetched_at:$fetched_at,
   fetch_ok:(($prerr|not) and ($rverr|not)),
   truncated:(($rverr|not) and ($r | length >= 100)),
   pr:(if $prerr then {fetch_error:$p.fetch_error} else
       {state:$p.state, merged:$p.merged, user_login:$p.user.login, user_type:$p.user.type, head_sha:$p.head.sha} end),
   reviews:(if $rverr then [] else $r | map({id:(.id|tostring), user_login:.user.login, user_type:.user.type,
       state, commit_id, dismissed_at, submitted_at}) end)}'
