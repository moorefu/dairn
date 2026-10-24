#!/bin/sh
# Isolated signer: verify same-pipeline evidence bytes, then sign the statement.
# No project tests, no analyzers, no work ledger, no checkout of PR code run here.
set -eu
: "${DAIRN_SIGNING_PRIVATE_KEY_PATH:?Private-key file path must be CI-controlled}"
: "${DAIRN_TRUSTED_CI_PUBLIC_KEY:?Public-key file must be CI-controlled}"
: "${DAIRN_EXPECTED_RUNTIME_SHA256:?Pinned runtime digest required}"
: "${DAIRN_EXPECTED_APE_SHA256:?Pinned distributed APE digest required}"
: "${DAIRN_CI_APE_PATH:?Absolute trusted APE path required}"
: "${DAIRN_EXPECTED_POLICY_SHA256:?Pinned project policy digest required}"
: "${DAIRN_CI_BIN:?Path to externally provisioned trusted Dairn launcher required}"
: "${DAIRN_EVIDENCE_DIR:?Restored evidence directory from the same pipeline's build job required}"
case "$DAIRN_EVIDENCE_DIR" in "$PWD"/*) ;; *) echo 'DAIRN_EVIDENCE_DIR must live inside the project checkout' >&2; exit 2;; esac
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
if [ "${GITLAB_CI:-}" = true ]; then
  [ "${CI_PIPELINE_SOURCE:-}" = push ] && [ "${CI_COMMIT_REF_PROTECTED:-}" = true ] && [ "${CI_COMMIT_BRANCH:-}" = "${CI_DEFAULT_BRANCH:-not-default}" ] || { echo 'GitLab: protected default-branch push required' >&2; exit 2; }
  [ "$HEAD" = "${CI_COMMIT_SHA:-}" ] || { echo 'GitLab: checkout mismatch' >&2; exit 2; }
  PROVIDER=gitlab;REPO=${CI_PROJECT_PATH:?};REF=refs/heads/${CI_COMMIT_BRANCH};PIPELINE=${CI_PIPELINE_ID:?}
elif [ "${GITHUB_ACTIONS:-}" = true ]; then
  [ "${GITHUB_EVENT_NAME:-}" = push ] && [ "${DAIRN_CI_REF_PROTECTED:-}" = true ] && [ "${GITHUB_REF:-}" = "refs/heads/${DAIRN_PROTECTED_BRANCH:-main}" ] || { echo 'GitHub: protected branch push required' >&2; exit 2; }
  [ "$HEAD" = "${GITHUB_SHA:-}" ] || { echo 'GitHub: checkout mismatch' >&2; exit 2; }
  PROVIDER=github;REPO=${GITHUB_REPOSITORY:?};REF=${GITHUB_REF};PIPELINE=${GITHUB_RUN_ID:?}/${GITHUB_RUN_ATTEMPT:?}
else
  echo 'Refuse to sign outside an explicitly protected GitLab or GitHub job' >&2; exit 2
fi
# Accept ONLY the evidence artifact restored from this same protected pipeline's keyless build job.
ORIGIN="$DAIRN_EVIDENCE_DIR/ci-build-origin.json"
[ -f "$ORIGIN" ] && [ ! -L "$ORIGIN" ] || { echo 'Missing safe upstream build-origin artifact' >&2;exit 2; }
BUILD_JOB_ID=$(jq -er --arg provider "$PROVIDER" --arg repo "$REPO" --arg ref "$REF" --arg sha "$HEAD" --arg pipeline "$PIPELINE" \
  'select(.schema==1 and .status=="passed" and .provider==$provider and .repository==$repo and .ref==$ref and .source_commit==$sha and .pipeline_id==$pipeline) | .build_job_id' "$ORIGIN")
[ -n "$BUILD_JOB_ID" ] || { echo 'Invalid upstream CI build origin' >&2;exit 2; }
BUNDLE="$DAIRN_EVIDENCE_DIR/bundle.json"
[ -f "$BUNDLE" ] && [ ! -L "$BUNDLE" ] || { echo 'Missing evidence bundle from build job' >&2;exit 2; }
CONTEXT=$(mktemp -d)/context.json
trap 'rm -rf "$(dirname "$CONTEXT")"' 0
jq -nc --arg provider "$PROVIDER" --arg repo "$REPO" --arg workflow "$REF" --arg pipeline "$PIPELINE" \
  --arg job "$BUILD_JOB_ID" --arg sha "$HEAD" \
  '{provider:$provider,repository:$repo,workflow_ref:$workflow,pipeline_id:$pipeline,build_job_id:$job,source_commit:$sha,event:"push"}' > "$CONTEXT"
# Verify every bundle byte before producing a statement; refuses non-passing runs.
"$DAIRN_CI_BIN" evidence verify --bundle "$(printf '%s' "$BUNDLE" | sed "s#^$PWD/##")" --root "$PWD"
STATEMENT="$DAIRN_EVIDENCE_DIR/statement.json"
[ ! -e "$STATEMENT" ] || { echo 'Refuse overwriting statement' >&2;exit 2; }
"$DAIRN_CI_BIN" attest prepare --bundle "$(printf '%s' "$BUNDLE" | sed "s#^$PWD/##")" --context "$CONTEXT" \
  --out "$(printf '%s' "$STATEMENT" | sed "s#^$PWD/##")" --root "$PWD" >/dev/null
SIG="$STATEMENT.sig"
[ ! -e "$SIG" ] || { echo 'Refuse overwrite existing signature' >&2;exit 2; }
umask 077
openssl pkeyutl -sign -inkey "$DAIRN_SIGNING_PRIVATE_KEY_PATH" -rawin -in "$STATEMENT" -out "$SIG"
# Self-check the signature against the trusted public key before publishing.
"$DAIRN_CI_BIN" attest verify --statement "$(printf '%s' "$STATEMENT" | sed "s#^$PWD/##")" \
  --signature "$(printf '%s' "$SIG" | sed "s#^$PWD/##")" --key "$DAIRN_TRUSTED_CI_PUBLIC_KEY" \
  --context "$CONTEXT" --root "$PWD" >/dev/null
printf 'DAIRN_PROTECTED_SIGNING_SUCCEEDED head=%s provider=%s\n' "$HEAD" "$PROVIDER"
