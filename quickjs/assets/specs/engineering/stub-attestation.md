---
id: dairn.engineering.stubs-attestation
title: Project Stubs and Signed CI Evidence
summary: Language-neutral project analyzers, reproducible execution cache, and protected CI signatures.
kind: spec
module: engineering
keywords: ["stub", "workflow", "evidence", "CI", "Ed25519", "project-intelligence"]
aliases: []
related: ["dairn.engineering.work-execution", "dairn.engineering.impact-analysis"]
---

# Project Stub Protocol

Dairn QuickJS Core never embeds AST tooling. `.dairn/stubs.json` is project-owned, contains `{"schema":1, "stubs":[{"id":"surface","kind":"surface-analysis","argv":["..."],"cwd":"."}]}`.
A stub receives two final argv values: absolute request JSON path and absolute response JSON path. Request contains schema, kind, stub_id, root, base_commit, head_commit. Response must contain exactly matching identity plus `changes: [{path,symbol,change,before,after}]`.
No shell interpolation. Time and response size bounded. Cache under `.dairn/cache/` is advisory, never a trust boundary. Dirty workspaces bypass cache.

# External CI Attestation

`dairn attest prepare --bundle <path> --context <trusted-ci.json>` emits a `dairn.attestation.v1` statement binding the run digests, subject commit, policy/runtime hashes and trusted CI job identity. The isolated protected signer signs those exact bytes with Ed25519.
`dairn attest verify --statement <s.json> --signature <s.sig> --key <absolute-trusted-pubkey> --context <trusted-ci.json>` verifies the signature outside the checkout. This is **detached Ed25519 v1**, not DSSE or SLSA certification. The task ledger only references existing runs via `dairn work link-check` and never verifies or mints CI trust. The CI must protect the signer, key, runtime, policy, and approvals outside the PR.

# Human vs Machine

The machine can verify integrity, source commitment and signature. It cannot prove a human independently reviewed the code or that all docs are semantically accurate. Review and Synchronize stages require explicit structured decisions.
