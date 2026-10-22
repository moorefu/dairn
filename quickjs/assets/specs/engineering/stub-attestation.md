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

`dairn work attest-prepare <task>` emits a JSON statement identifying a previously executed successful run, source SHA, policy hash, runtime hash, and job identity. The protected CI service signs it with Ed25519 using an external private key.
`dairn work attest-attach <task> <payload> <signature>` verifies the signature with `DAIRN_TRUSTED_CI_PUBLIC_KEY` outside the checkout and binds it to the machine run. This is **detached Ed25519 v1**, not DSSE or SLSA certification. The CI must protect the signer, key, runtime, policy, and approvals outside the PR.

# Human vs Machine

The machine can verify integrity, source commitment and signature. It cannot prove a human independently reviewed the code or that all docs are semantically accurate. Review and Synchronize stages require explicit structured decisions.
