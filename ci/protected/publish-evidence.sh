#!/bin/sh
# Evidence publisher: verify the signed bundle, append it to the protected
# evidence branch (fast-forward only), and read back the published record.
# This job holds NO signing key; it only has the evidence-ref write identity.
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
# Publisher re-verifies every byte with the external public key before writing.
"$DAIRN_CI_BIN" evidence verify --bundle "$BUNDLE_REL" --root "$PWD"
# No private key exists in this job; verification uses the external public key only.
[ -z "${DAIRN_SIGNING_PRIVATE_KEY_PATH:-}" ] || { echo 'Publisher job must not hold a signing private key' >&2; exit 2; }
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
  # Also publish the raw member files recorded in the bundle so verifiers can re-hash them.
  for entry in $(jq -r '.files | to_entries[] | "\(.key)\t\(.value.path)"' "$BUNDLE_REL"); do
    name=$(printf '%s' "$entry" | cut -f1); rel=$(printf '%s' "$entry" | cut -f2)
    case "$rel" in "$STATEMENT_REL"|"$SIGNATURE_REL"|"$BUNDLE_REL") continue;; esac
    case "$rel" in ../*|/*|*..*) echo "Unsafe bundle member path: $rel" >&2; exit 2;; esac
    mkdir -p "$PUBLISH_DIR/wt/$DEST/$(dirname "$rel")"
    cp "$PWD/$rel" "$PUBLISH_DIR/wt/$DEST/$rel" || { echo "Missing bundle member: $rel" >&2; exit 2; }
  done
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
