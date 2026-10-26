#!/bin/sh
# Keyless post-merge protected build. MUST NOT have access to signing keys.
# Task-independent (architecture Q4): the run is standalone evidence; no work
# ledger is required or consulted.
set -eu
BASE=${1:-${DAIRN_TRUSTED_BASE_REF:-HEAD^}}
: "${DAIRN_CI_BIN:?Trusted Dairn launcher required}"
: "${DAIRN_CI_APE_PATH:?Trusted APE required}"
: "${DAIRN_EXPECTED_APE_SHA256:?Pinned APE SHA256 required}"
: "${DAIRN_EXPECTED_POLICY_SHA256:?Pinned policy required}"
: "${DAIRN_EXPECTED_RUNTIME_SHA256:?Pinned runtime required}"
command -v jq >/dev/null && command -v sha256sum >/dev/null || { echo 'jq and sha256sum required' >&2; exit 2; }
[ "$(sha256sum "$DAIRN_CI_APE_PATH" | cut -d ' ' -f1)" = "$DAIRN_EXPECTED_APE_SHA256" ] || { echo 'APE mismatch' >&2; exit 2; }
HEAD=$(git rev-parse --verify 'HEAD^{commit}')
[ -z "$(git status --porcelain=v1 --untracked-files=all)" ] || { echo 'Protected build requires a clean checkout; refusing unrelated worktree changes' >&2; exit 2; }
if [ "${GITLAB_CI:-}" = true ]; then
  [ "${CI_PIPELINE_SOURCE:-}" = push ] && [ "${CI_COMMIT_REF_PROTECTED:-}" = true ] && [ "${CI_COMMIT_BRANCH:-}" = "${CI_DEFAULT_BRANCH:-_}" ] && [ "$HEAD" = "${CI_COMMIT_SHA:-}" ] || { echo 'Unprotected GitLab build refused' >&2; exit 2; }
  PROVIDER=gitlab;REPO=${CI_PROJECT_PATH:?};REF=refs/heads/${CI_COMMIT_BRANCH};PIPELINE=${CI_PIPELINE_ID:?};JOB_ID=${CI_JOB_ID:?}
elif [ "${GITHUB_ACTIONS:-}" = true ]; then
  [ "${GITHUB_EVENT_NAME:-}" = push ] && [ "${DAIRN_CI_REF_PROTECTED:-}" = true ] && [ "${GITHUB_REF:-}" = "refs/heads/${DAIRN_PROTECTED_BRANCH:-main}" ] && [ "$HEAD" = "${GITHUB_SHA:-}" ] || { echo 'Unprotected GitHub build refused' >&2; exit 2; }
  PROVIDER=github;REPO=${GITHUB_REPOSITORY:?};REF=${GITHUB_REF};PIPELINE=${GITHUB_RUN_ID:?}/${GITHUB_RUN_ATTEMPT:?};JOB_ID=${GITHUB_JOB:?}
else
  echo 'No authenticated CI context, refusing build origin' >&2;exit 2
fi
# Standalone check run: no --task, no work ledger dependency.
"$DAIRN_CI_BIN" check --base "$BASE" --root "$PWD"
# v1 protocol evidence carries the run id (the legacy report may not).
RUN_JSON=$(ls ".dairn/governance/evidence/runs/$HEAD/"*/run.json 2>/dev/null | head -1)
[ -n "$RUN_JSON" ] || { echo "Expected v1 check evidence not found under runs/$HEAD/" >&2; exit 2; }
RUN_ID=$(jq -er '.run_id // empty' "$RUN_JSON")
[ -n "$RUN_ID" ] || { echo 'Check evidence has no run_id' >&2; exit 2; }
ORIGIN=.dairn/governance/evidence/ci-build-origin.json
[ ! -e "$ORIGIN" ] || { echo 'Refuse overwriting build origin' >&2;exit 2; }
umask 077
jq -nc --arg provider "$PROVIDER" --arg repo "$REPO" --arg ref "$REF" --arg sha "$HEAD" --arg pipeline "$PIPELINE" --arg job "$JOB_ID" \
  '{schema:1,status:"passed",provider:$provider,repository:$repo,ref:$ref,source_commit:$sha,pipeline_id:$pipeline,build_job_id:$job}' > "$ORIGIN"
# Bundle the run plus this origin so the isolated signer verifies bytes, not stories.
BUNDLE=.dairn/governance/evidence/bundle.json
[ ! -e "$BUNDLE" ] || { echo 'Refuse overwriting evidence bundle' >&2;exit 2; }
set -- evidence bundle --run "$RUN_ID" --evidence "$RUN_JSON" --origin "$ORIGIN" --out "$BUNDLE"
[ -z "${DAIRN_CI_APPROVAL_VERDICT:-}" ] || { echo 'Legacy approval input refused; use explicit audit snapshot archival' >&2;exit 2; }
if [ -n "${DAIRN_CI_AUDIT_APPROVAL_SNAPSHOT:-}" ]; then
  # 管理员提供由受信 SCM 抓取/裁决得到的文件；只归档原始字节，不由 JSON 自证来源。
  case "$DAIRN_CI_AUDIT_APPROVAL_SNAPSHOT" in /*) ;; *) echo 'Approval verdict path must be absolute' >&2;exit 2;; esac
  case "$DAIRN_CI_AUDIT_APPROVAL_SNAPSHOT" in "$PWD"/*) echo 'Approval verdict must come from outside checkout' >&2;exit 2;; esac
  [ -f "$DAIRN_CI_AUDIT_APPROVAL_SNAPSHOT" ] && [ ! -L "$DAIRN_CI_AUDIT_APPROVAL_SNAPSHOT" ] || { echo 'Unsafe/missing approval verdict' >&2;exit 2; }
  APPROVAL=.dairn/governance/evidence/ci-approval-verdict.json
  [ ! -e "$APPROVAL" ] || { echo 'Refuse overwriting approval verdict' >&2;exit 2; }
  cp "$DAIRN_CI_AUDIT_APPROVAL_SNAPSHOT" "$APPROVAL"
  set -- "$@" --approval "$APPROVAL"
fi
"$DAIRN_CI_BIN" "$@"
printf 'DAIRN_PROTECTED_BUILD_SUCCEEDED head=%s run=%s job=%s\n' "$HEAD" "$RUN_ID" "$JOB_ID"
