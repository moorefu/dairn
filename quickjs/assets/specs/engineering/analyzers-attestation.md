---
id: dairn.engineering.analyzers-attestation
title: Project Analyzers and Signed CI Evidence
summary: Language-neutral project analyzers, reproducible execution cache, and protected CI signatures.
kind: spec
module: engineering
keywords: ["analyzer", "workflow", "evidence", "CI", "Ed25519", "project-intelligence"]
aliases: []
related: ["dairn.engineering.work-execution", "dairn.engineering.impact-analysis"]
---

# Project Analyzer Protocol

Dairn QuickJS Core never embeds AST tooling. `.dairn/analyzers.json` is project-owned, contains `{"schema":"dairn.analyzers.v1","analyzers":[{"id":"surface","domain":"surface","mode":"execute","execution":{"argv":["..."],"cwd":"."}}]}`.
An analyzer receives two final argv values: absolute request JSON path and absolute response JSON path. Request is `dairn.analyzer-request.v1` (schema, analyzer_id, domain, subject{source_commit, base_commit}, root, scope, limits). Response must be `dairn.surface-result.v1` with exactly matching identity plus `changes: [{path,symbol,change,before,after}]`.
No shell interpolation. Time and response size bounded. Cache under `.dairn/cache/analyzers/` is advisory, never a trust boundary. Dirty workspaces bypass cache. The legacy `.dairn/stubs.json` protocol (`dairn-stub-v1`, `surface-analysis`) is removed without a compatibility layer.

# External CI Attestation

`dairn attest prepare --bundle <path> --context <trusted-ci.json>` emits a `dairn.attestation.v1` statement binding the run digests, subject commit, policy/runtime hashes and trusted CI job identity. The isolated protected signer signs those exact bytes with Ed25519.
`dairn attest verify --statement <s.json> --signature <s.sig> --key <absolute-trusted-pubkey> --context <trusted-ci.json>` verifies the signature outside the checkout. This is **detached Ed25519 v1**, not DSSE or SLSA certification. The task ledger only references existing runs via `dairn work link-check` and never verifies or mints CI trust. The CI must protect the signer, key, runtime, policy, and approvals outside the PR.

# Human vs Machine

The machine can verify integrity, source commitment and signature. It cannot prove a human independently reviewed the code or that all docs are semantically accurate. Review and Synchronize stages require explicit structured decisions.
