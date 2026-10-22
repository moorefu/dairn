---
id: dairn.engineering.agent-execution-protocol
title: Agent-first stage execution and local gate evidence
summary: AI Agent calls Dairn, Dairn deterministically records stage requirements and real machine check evidence without making model calls or claiming CI trust.
kind: spec
module: engineering
keywords: ["agent-first", "work next", "check --task", "run_id", "CI trust"]
aliases: ["agent workflow protocol"]
related: ["dairn.engineering.workflow", "dairn.engineering.work-execution"]
symbols: ["dairn work next", "dairn check --task", "dairn work verify"]
---

# Agent-first Workflow and Local Evidence

The developer requests work from an AI coding agent. The agent reads AGENTS.md and `dairn-*` Skills and invokes Dairn; Dairn does not invoke a model or infer an approval.

`dairn work next <id> --json` returns the active stage's `executor`, `skill`, `inputs`, `requirements`, and `completion`. The contract is advisory for human judgment and strictly verified only where a machine verifier exists. A Skill being read is not a test result.

`dairn check --task <id> --base <trusted-ref>` requires an active implement stage, a real nonempty Git diff and unchanged checkout HEAD. Every configured policy-required gate is executed. The run file records a unique `run_id`, task ID, HEAD SHA, base commit, required modules/checks, policy SHA256, status, real exit codes, and `trust: local-unattested`. Failed runs remain attached. `dairn work verify <id> --require-machine-gates` fails for missing/stale/failed evidence. Implementation cannot advance based solely on a manually registered `machine-evidence` file.

SHA256 validates content integrity only. It cannot prove who ran a test, trusted CI identity, human sign-off, or branch protection. Protected CI must independently authenticate the workflow, runtime, subject SHA, issuer, policy, and required checks before making merge decisions. Dairn's local task log must not mint that attestation.
