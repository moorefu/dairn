#!/bin/sh
# Sign ONLY from a separately configured protected CI job; never from a PR build.
# This is a protected-branch post-merge signer, not a substitute for merge protections.
set -eu
TASK=${1:?Usage: sign-protected.sh TASK_ID [TRUSTED_BASE]}
BASE=${2:-${DAIRN_TRUSTED_BASE_REF:-HEAD^}}
: "${DAIRN_SIGNING_PRIVATE_KEY_PATH:?Private-key file path must be CI-controlled}"
: "${DAIRN_TRUSTED_CI_PUBLIC_KEY:?Public-key file must be CI-controlled}"
: "${DAIRN_EXPECTED_RUNTIME_SHA256:?Pinned runtime digest required}"
: "${DAIRN_EXPECTED_APE_SHA256:?Pinned distributed APE digest required}"
: "${DAIRN_CI_APE_PATH:?Absolute trusted APE path required}"
: "${DAIRN_EXPECTED_POLICY_SHA256:?Pinned project policy digest required}"
: "${DAIRN_CI_BIN:?Path to externally provisioned trusted Dairn launcher required}"
[ "${DAIRN_SIGNING_PRIVATE_KEY_PATH#/}" != "$DAIRN_SIGNING_PRIVATE_KEY_PATH" ] || { echo 'Private key path must be absolute' >&2; exit 2; }
[ "${DAIRN_CI_BIN#/}" != "$DAIRN_CI_BIN" ] || { echo 'Trusted Dairn must have absolute path' >&2; exit 2; }
[ -f "$DAIRN_SIGNING_PRIVATE_KEY_PATH" ] && [ ! -L "$DAIRN_SIGNING_PRIVATE_KEY_PATH" ] || { echo 'Unsafe/missing private key' >&2; exit 2; }
[ -f "$DAIRN_CI_BIN" ] && [ ! -L "$DAIRN_CI_BIN" ] || { echo 'Unsafe/missing Dairn launcher' >&2; exit 2; }
[ "${DAIRN_CI_APE_PATH#/}" != "$DAIRN_CI_APE_PATH" ] && [ -f "$DAIRN_CI_APE_PATH" ] && [ ! -L "$DAIRN_CI_APE_PATH" ] || { echo 'Unsafe APE path' >&2; exit 2; }
case "$DAIRN_EXPECTED_APE_SHA256" in *[!0-9a-f]*|'') echo 'Invalid APE SHA256 pin' >&2;exit 2;; esac
[ "${#DAIRN_EXPECTED_APE_SHA256}" -eq 64 ] || { echo 'Bad APE SHA256 size' >&2;exit 2; }
command -v openssl >/dev/null && command -v jq >/dev/null && command -v git >/dev/null && command -v sha256sum >/dev/null || { echo 'Signing needs openssl, jq, git, sha256sum' >&2; exit 2; }
ACTUAL_APE_SHA256=$(sha256sum "$DAIRN_CI_APE_PATH" | cut -d ' ' -f1)
[ "$ACTUAL_APE_SHA256" = "$DAIRN_EXPECTED_APE_SHA256" ] || { echo 'APE binary pin mismatch' >&2;exit 2; }
HEAD=$(git rev-parse --verify 'HEAD^{commit}')
[ -n "$HEAD" ] || exit 2
# 洁净检查：签名 job 会先把同流水线构建证据 artifact 恢复到 .dairn/，这些文件
# 由后续 work verify/attest 的 SHA256 与任务账本绑定，因此不参与“无关变更”判断；
# 其余未提交改动或未追踪文件仍拒绝签名。
CLEAN=$(git status --porcelain=v1 --untracked-files=all -- . \
  ':(exclude,literal).dairn/governance/evidence' ':(exclude,literal).dairn/work') || exit 2
[ -z "$CLEAN" ] || { echo 'Protected signer requires a clean source checkout; refusing unrelated worktree changes' >&2; exit 2; }
if [ "${GITLAB_CI:-}" = true ]; then
  [ "${CI_PIPELINE_SOURCE:-}" = push ] && [ "${CI_COMMIT_REF_PROTECTED:-}" = true ] && [ "${CI_COMMIT_BRANCH:-}" = "${CI_DEFAULT_BRANCH:-not-default}" ] || { echo 'GitLab: protected default-branch push required' >&2; exit 2; }
  [ "$HEAD" = "${CI_COMMIT_SHA:-}" ] || { echo 'GitLab: checkout mismatch' >&2; exit 2; }
  export DAIRN_CI_PROVIDER=gitlab DAIRN_CI_JOB_ID="${CI_JOB_ID:?}"
  export DAIRN_CI_REPOSITORY="${CI_PROJECT_PATH:?}" DAIRN_CI_REF="refs/heads/${CI_COMMIT_BRANCH}"
  DAIRN_CI_PIPELINE_ID="${CI_PIPELINE_ID:?}"; DAIRN_CI_WORKFLOW="${CI_PIPELINE_ID}/dairn:sign";export DAIRN_CI_WORKFLOW DAIRN_CI_PIPELINE_ID
elif [ "${GITHUB_ACTIONS:-}" = true ]; then
  [ "${GITHUB_EVENT_NAME:-}" = push ] && [ "${DAIRN_CI_REF_PROTECTED:-}" = true ] && [ "${GITHUB_REF:-}" = "refs/heads/${DAIRN_PROTECTED_BRANCH:-main}" ] || { echo 'GitHub: protected branch push required' >&2; exit 2; }
  [ "$HEAD" = "${GITHUB_SHA:-}" ] || { echo 'GitHub: checkout mismatch' >&2; exit 2; }
  export DAIRN_CI_PROVIDER=github DAIRN_CI_JOB_ID="${GITHUB_RUN_ID:?}/${GITHUB_RUN_ATTEMPT:?}"
  export DAIRN_CI_REPOSITORY="${GITHUB_REPOSITORY:?}" DAIRN_CI_REF="${GITHUB_REF}"
  DAIRN_CI_PIPELINE_ID="${GITHUB_RUN_ID:?}/${GITHUB_RUN_ATTEMPT:?}";DAIRN_CI_WORKFLOW="${GITHUB_WORKFLOW_REF:?}";export DAIRN_CI_WORKFLOW DAIRN_CI_PIPELINE_ID
else
  echo 'Refuse to sign outside an explicitly protected GitLab or GitHub job' >&2; exit 2
fi
# A local caller can spoof env vars; the job/protection trust is granted by the CI platform,
# and the private key MUST remain inaccessible to arbitrary user-controlled jobs.
export DAIRN_REQUIRE_CI_CONTEXT=true
export DAIRN_TRUSTED_CI_PROVIDER="$DAIRN_CI_PROVIDER" DAIRN_TRUSTED_CI_REPOSITORY="$DAIRN_CI_REPOSITORY"
export DAIRN_TRUSTED_CI_REF="$DAIRN_CI_REF" DAIRN_TRUSTED_CI_WORKFLOW="$DAIRN_CI_WORKFLOW"
# Accept ONLY the evidence artifact from this same protected pipeline's keyless build job.
ORIGIN=.dairn/governance/evidence/ci-build-origin.json
[ -f "$ORIGIN" ] && [ ! -L "$ORIGIN" ] || { echo 'Missing safe upstream build-origin artifact' >&2;exit 2; }
BUILD_JOB_ID=$(jq -er --arg provider "$DAIRN_CI_PROVIDER" --arg repo "$DAIRN_CI_REPOSITORY" --arg ref "$DAIRN_CI_REF" --arg sha "$HEAD" --arg pipeline "$DAIRN_CI_PIPELINE_ID" \
  'select(.schema==1 and .status=="passed" and .provider==$provider and .repository==$repo and .ref==$ref and .source_commit==$sha and .pipeline_id==$pipeline) | .build_job_id' "$ORIGIN")
[ -n "$BUILD_JOB_ID" ] || { echo 'Invalid upstream CI build origin' >&2;exit 2; }
export DAIRN_CI_BUILD_JOB_ID="$BUILD_JOB_ID" DAIRN_TRUSTED_CI_BUILD_JOB_ID="$BUILD_JOB_ID" DAIRN_TRUSTED_CI_PIPELINE_ID="$DAIRN_CI_PIPELINE_ID"
# IMPORTANT: no project tests or stubs execute here, when the signing key exists.
"$DAIRN_CI_BIN" work verify "$TASK" --require-machine-gates --root "$PWD" >/dev/null
OUT=$("$DAIRN_CI_BIN" work attest-prepare "$TASK" --root "$PWD")
PAYLOAD=$(printf '%s\n' "$OUT" | jq -er '.payload')
case "$PAYLOAD" in .dairn/governance/evidence/*.attestation.json) ;; *) echo 'Unexpected payload path' >&2;exit 2;; esac
case "$PAYLOAD" in *..*|*\\*) echo 'Unsafe payload path' >&2;exit 2;; esac
SIG="$PAYLOAD.sig"
[ ! -e "$SIG" ] || { echo 'Refuse overwrite existing signature' >&2;exit 2; }
umask 077
openssl pkeyutl -sign -inkey "$DAIRN_SIGNING_PRIVATE_KEY_PATH" -rawin -in "$PAYLOAD" -out "$SIG"
"$DAIRN_CI_BIN" work attest-attach "$TASK" "$PAYLOAD" "$SIG" --root "$PWD"
"$DAIRN_CI_BIN" work verify "$TASK" --require-ci-attestation --root "$PWD"
printf 'DAIRN_PROTECTED_SIGNING_SUCCEEDED head=%s task=%s provider=%s\n' "$HEAD" "$TASK" "$DAIRN_CI_PROVIDER"
