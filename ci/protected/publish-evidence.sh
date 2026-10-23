#!/bin/sh
# Evidence publisher: verify the signed bundle — including REAL Ed25519
# signature verification and origin/subject binding — append it to the
# protected evidence branch (fast-forward only), and read back the published
# record. This job holds NO signing key; it only has the evidence-ref write
# identity.
set -eu
: "${DAIRN_CI_BIN:?Path to externally provisioned trusted Dairn launcher required}"
: "${DAIRN_TRUSTED_CI_PUBLIC_KEY:?Public-key file must be CI-controlled}"
: "${DAIRN_EVIDENCE_DIR:?Restored evidence directory (with statement + signature) required}"
: "${DAIRN_EVIDENCE_REF_NAME:-refs/heads/dairn-evidence}"
EVIDENCE_BRANCH=${DAIRN_EVIDENCE_REF_NAME#refs/heads/}
[ "${DAIRN_CI_BIN#/}" != "$DAIRN_CI_BIN" ] || { echo 'Trusted Dairn must have absolute path' >&2; exit 2; }
case "$DAIRN_EVIDENCE_DIR" in "$PWD"/*) ;; *) echo 'DAIRN_EVIDENCE_DIR must live inside the project checkout' >&2; exit 2;; esac
command -v openssl >/dev/null && command -v jq >/dev/null && command -v git >/dev/null && command -v sha256sum >/dev/null || { echo 'Publishing needs openssl, jq, git, sha256sum' >&2; exit 2; }
[ "${DAIRN_TRUSTED_CI_PUBLIC_KEY#/}" != "$DAIRN_TRUSTED_CI_PUBLIC_KEY" ] && [ ! -L "$DAIRN_TRUSTED_CI_PUBLIC_KEY" ] || { echo 'Unsafe trusted public key' >&2; exit 2; }
HEAD=$(git rev-parse --verify 'HEAD^{commit}')
[ -n "$HEAD" ] || exit 2
STATEMENT_REL=$(printf '%s' "$DAIRN_EVIDENCE_DIR/statement.json" | sed "s#^$PWD/##")
SIGNATURE_REL=$(printf '%s' "$DAIRN_EVIDENCE_DIR/statement.json.sig" | sed "s#^$PWD/##")
BUNDLE_REL=$(printf '%s' "$DAIRN_EVIDENCE_DIR/bundle.json" | sed "s#^$PWD/##")
[ -f "$STATEMENT_REL" ] && [ -f "$SIGNATURE_REL" ] && [ -f "$BUNDLE_REL" ] || { echo 'Missing statement/signature/bundle from signer job' >&2; exit 2; }
[ -z "${DAIRN_SIGNING_PRIVATE_KEY_PATH:-}" ] || { echo 'Publisher job must not hold a signing private key' >&2; exit 2; }
# Step 1: bundle member digests and run schema (independent evidence verify).
"$DAIRN_CI_BIN" evidence verify --bundle "$BUNDLE_REL" --root "$PWD"
# Step 2: subject binding — the bundled run must belong to THIS checkout's
# commit; a bundle forged for another repository/PR/commit stops here.
BUNDLE_COMMIT=$(jq -er '.run.subject.source_commit' "$BUNDLE_REL")
[ "$BUNDLE_COMMIT" = "$HEAD" ] || { echo "Bundle subject commit $BUNDLE_COMMIT does not match checkout HEAD $HEAD" >&2; exit 2; }
# Step 3: origin binding — the run must carry the CI origin of this push and
# the statement must have been verified against exactly that origin.
ORIGIN_REL=$(jq -er '.files.origin_json.path // empty' "$BUNDLE_REL")
[ -n "$ORIGIN_REL" ] || { echo 'Bundle has no origin_json member; refusing to publish unattributed evidence' >&2; exit 2; }
case "$ORIGIN_REL" in ../*|/*|*..*|*[!A-Za-z0-9._/-]*) echo "Unsafe origin path: $ORIGIN_REL" >&2; exit 2;; esac
[ -f "$ORIGIN_REL" ] || { echo "Missing origin file: $ORIGIN_REL" >&2; exit 2; }
ORIGIN_STATUS=$(jq -r '.status // empty' "$ORIGIN_REL")
ORIGIN_COMMIT=$(jq -r '.source_commit // empty' "$ORIGIN_REL")
[ "$ORIGIN_STATUS" = "passed" ] && [ "$ORIGIN_COMMIT" = "$HEAD" ] || { echo 'Build origin is not a passed run for this commit' >&2; exit 2; }
# Step 4: REAL Ed25519 verification of the statement bytes with the
# CI-controlled public key, cross-checked against the recorded origin context.
# Bundle digests alone (previous behavior) never establish signature validity.
CONTEXT_DIR=$(mktemp -d)
jq -nc --arg provider "$(jq -r '.provider // empty' "$ORIGIN_REL")" \
  --arg repository "$(jq -r '.repository // empty' "$ORIGIN_REL")" \
  --arg workflow_ref "$(jq -r '.ref // empty' "$ORIGIN_REL")" \
  --arg pipeline_id "$(jq -r '.pipeline_id // empty' "$ORIGIN_REL")" \
  --arg build_job_id "$(jq -r '.build_job_id // empty' "$ORIGIN_REL")" \
  --arg source_commit "$HEAD" \
  '{provider:$provider,repository:$repository,workflow_ref:$workflow_ref,pipeline_id:$pipeline_id,build_job_id:$build_job_id,source_commit:$source_commit}' > "$CONTEXT_DIR/context.json"
"$DAIRN_CI_BIN" attest verify --statement "$STATEMENT_REL" --signature "$SIGNATURE_REL" \
  --key "$DAIRN_TRUSTED_CI_PUBLIC_KEY" --context "$CONTEXT_DIR/context.json" --root "$PWD"
rm -rf "$CONTEXT_DIR"
RUN_ID=$(jq -er '.run.run_id' "$BUNDLE_REL")
case "$RUN_ID" in run-[A-Za-z0-9][A-Za-z0-9._-]*) ;; *) echo 'Unsafe run id' >&2; exit 2;; esac
# Publish target layout: evidence/runs/<full-source-sha>/<run-id>/...
DEST="evidence/runs/$HEAD/$RUN_ID"
git fetch --quiet origin "$DAIRN_EVIDENCE_REF_NAME" || { echo "Evidence ref $DAIRN_EVIDENCE_REF_NAME not found; an admin must create and protect it first" >&2; exit 2; }
PUBLISH_DIR=$(mktemp -d)
trap 'rm -rf "$PUBLISH_DIR"' 0
for attempt in 1 2 3; do
  TIP=$(git rev-parse --verify "origin/$EVIDENCE_BRANCH" 2>/dev/null) || { echo 'Missing evidence branch tip' >&2; exit 2; }
  git worktree add --quiet --detach "$PUBLISH_DIR/wt" "$TIP"
  [ ! -e "$PUBLISH_DIR/wt/$DEST" ] || { echo "Refuse overwriting published run: $RUN_ID" >&2; git worktree remove --force "$PUBLISH_DIR/wt"; exit 2; }
  mkdir -p "$PUBLISH_DIR/wt/$DEST"
  cp "$PWD/${STATEMENT_REL}" "$PUBLISH_DIR/wt/$DEST/statement.json"
  cp "$PWD/${SIGNATURE_REL}" "$PUBLISH_DIR/wt/$DEST/statement.sig"
  cp "$PWD/${BUNDLE_REL}" "$PUBLISH_DIR/wt/$DEST/bundle.json"
  # Also publish the raw member files recorded in the bundle so verifiers can
  # re-hash them. Iteration is newline-framed with jq -c (paths stay
  # JSON-escaped inside each line, so embedded spaces/tabs/newlines cannot
  # smuggle through shell word splitting); each path is additionally
  # restricted to a plain relative POSIX whitelist and decoded via jq itself.
  while IFS= read -r entry; do
    [ -n "$entry" ] || continue
    name=$(printf '%s' "$entry" | jq -r '.[0]')
    rel=$(printf '%s' "$entry" | jq -r '.[1]')
    case "$rel" in "$STATEMENT_REL"|"$SIGNATURE_REL"|"$BUNDLE_REL") continue;; esac
    case "$rel" in ../*|/*|*..*|*[!A-Za-z0-9._/-]*|'') echo "Unsafe bundle member path: $rel" >&2; exit 2;; esac
    mkdir -p "$PUBLISH_DIR/wt/$DEST/$(dirname "$rel")"
    cp "$PWD/$rel" "$PUBLISH_DIR/wt/$DEST/$rel" || { echo "Missing bundle member: $rel" >&2; exit 2; }
  done <<EOF
$(jq -c '.files | to_entries[] | [.key, .value.path]' "$BUNDLE_REL")
EOF
  git -C "$PUBLISH_DIR/wt" add -A
  git -C "$PUBLISH_DIR/wt" -c user.name='dairn-evidence-publisher' -c user.email='dairn-evidence@invalid' \
    commit -qm "evidence: $RUN_ID @ $HEAD"
  NEW=$(git -C "$PUBLISH_DIR/wt" rev-parse HEAD)
  # CAS push: only a fast-forward of the tip we based on is accepted.
  if git push --quiet origin "$NEW:refs/heads/$EVIDENCE_BRANCH" 2>/dev/null; then
    git worktree remove --force "$PUBLISH_DIR/wt" || true
    # Read-back verification from the remote evidence ref before declaring success.
    git fetch --quiet origin "$DAIRN_EVIDENCE_REF_NAME"
    PUBLISHED=$(git rev-parse --verify "origin/$EVIDENCE_BRANCH")
    [ "$PUBLISHED" = "$NEW" ] || { echo 'Read-back tip mismatch after publish' >&2; exit 2; }
    git show "origin/$EVIDENCE_BRANCH:$DEST/statement.sig" > "$PUBLISH_DIR/readback.sig" || { echo 'Read-back failed to fetch signature' >&2; exit 2; }
    cmp -s "$PUBLISH_DIR/readback.sig" "$PWD/${SIGNATURE_REL}" || { echo 'Read-back signature differs' >&2; exit 2; }
    printf 'DAIRN_EVIDENCE_PUBLISHED ref=%s commit=%s run=%s\n' "$DAIRN_EVIDENCE_REF_NAME" "$NEW" "$RUN_ID"
    exit 0
  fi
  echo "CAS push attempt $attempt failed (concurrent publisher); retrying" >&2
  git worktree remove --force "$PUBLISH_DIR/wt" || true
done
echo 'Evidence publish failed after CAS retries' >&2
exit 1
