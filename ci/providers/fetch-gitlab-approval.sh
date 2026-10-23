#!/bin/sh
# Trusted CI helper: fetch a normalized GitLab approval snapshot via REST API.
# Core never touches the network; read-only token, edition gaps surface as
# explicit markers so approval.mjs can return INDETERMINATE instead of PASS.
# Usage: fetch-gitlab-approval.sh PROJECT_ID MR_IID > snapshot.json
set -eu
PROJECT=${1:?Usage: fetch-gitlab-approval.sh PROJECT_ID MR_IID}
IID=${2:?MR IID required}
: "${DAIRN_GITLAB_TOKEN:?Read-only GitLab token required}"
API=${DAIRN_GITLAB_API:-${CI_API_V4_URL:-https://gitlab.com/api/v4}}
command -v curl >/dev/null && command -v jq >/dev/null || { echo 'curl and jq required' >&2; exit 2; }
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' 0
fetch() {
  : > "$1"
  code=$(curl -sS --max-time 30 --retry 2 -H "PRIVATE-TOKEN: $DAIRN_GITLAB_TOKEN" \
    -o "$1" -w '%{http_code}' "$API$2" 2>"$1.err") || code=000
  if [ "$code" != 200 ]; then
    printf '{"fetch_error":"http-%s","target":"%s"}\n' "$code" "$2" > "$1"
  fi
}
fetch "$WORK/mr.json" "/projects/$PROJECT/merge_requests/$IID"
fetch "$WORK/appr.json" "/projects/$PROJECT/merge_requests/$IID/approvals"
fetch "$WORK/rules.json" "/projects/$PROJECT/merge_requests/$IID/approval_rules"
jq -nc --argjson project "$PROJECT" --argjson iid "$IID" --arg fetched_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg repo_path "${DAIRN_GITLAB_PROJECT_PATH:-${CI_PROJECT_PATH:-}}" \
  --slurpfile mr "$WORK/mr.json" --slurpfile appr "$WORK/appr.json" --slurpfile rules "$WORK/rules.json" '
  ($mr[0] // {"fetch_error":"missing"}) as $m |
  ($appr[0] // {"fetch_error":"missing"}) as $a |
  ($rules[0] // {"fetch_error":"missing"}) as $rl |
  ($m | has("fetch_error")) as $merr | ($a | has("fetch_error")) as $aerr | ($rl | has("fetch_error")) as $rerr |
  {schema:"dairn.approval-snapshot.gitlab.v1",
   repository:(if $repo_path != "" then $repo_path else ("project-" + ($project|tostring)) end), number:$iid,
   fetched_at:$fetched_at,
   fetch_ok:(($merr|not) and ($aerr|not)),
   rules_available:($rerr|not),
   mr:(if $merr then {fetch_error:$m.fetch_error} else
      {state:$m.state, author_username:$m.author.username, author_bot:($m.author.bot // false),
       head_sha:($m.sha // $m.diff_refs.head_sha)} end),
   approvals:(if $aerr then {fetch_error:$a.fetch_error} else
      {approved:($a.approved // false),
       syncing:($a.approvals_syncing // ($a.approval_state // {} | .syncing? // false)),
       checking:($a.approval_state.checking? // false),
       approved_by:(($a.approved_by // []) | map({username:(.user.username // .username),
         bot:(.user.bot // false)})),
       rules:(if $rerr then null else $rl end)} end)}'
