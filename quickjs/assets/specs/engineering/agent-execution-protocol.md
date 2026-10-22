---
id: dairn.engineering.agent-execution-protocol
title: Agent-first stage execution and local gate evidence
summary: AI Agent calls Dairn, Dairn deterministically records stage requirements, hook anchors and real machine check evidence without making model calls or claiming CI trust.
kind: spec
module: engineering
keywords: ["agent-first", "work next", "check --task", "run_id", "grill", "hook", "CI trust"]
aliases: ["agent workflow protocol"]
related: ["dairn.engineering.launcher", "dairn.engineering.workflow", "dairn.engineering.work-execution", "dairn.engineering.hooks"]
symbols: ["dairn work next", "dairn check --task", "dairn work verify"]
---

# Agent-first Workflow and Local Evidence

The developer requests work from an AI coding agent. The agent reads AGENTS.md and `dairn-*` Skills and invokes Dairn; Dairn does not invoke a model or infer an approval.

`dairn work next <id> --json` returns the active stage's `executor`, `skill`, `inputs`, `requirements`, and `completion`. The response also carries an `invocation` block with `posix`, `windows`, `note`, and `doctor`: call the listed launcher instead of assuming a global binary, and report `DAIRN_NOT_AVAILABLE` when none resolves. See the launcher contract for resolution order and vendored runtime rules. The contract is advisory for human judgment and strictly verified only where a machine verifier exists. A Skill being read is not a test result.

Newer stages add their own machine-checkable requirements: the grill stage requires a recorded `grill` artifact whose questions contain no `open` entry (confirmation fields are optional audit data, not machine proof of a human decision); the slice stage records one task object that passes the task validator, while the whole graph is checked by `dairn tasks check`; the reflect stage requires a `retro` artifact whose resolution is either a configured project check with red evidence or a standards document under `AGENTS.md` or `docs/`. `dairn tasks ready` and `dairn tasks check` are structural helpers, not approvals.

`dairn check --task <id> --base <trusted-ref>` requires an active implement stage, a real nonempty Git diff and unchanged checkout HEAD. Every configured policy-required gate is executed. The run file records a unique `run_id`, task ID, HEAD SHA, base commit, required modules/checks, policy SHA256, status, real exit codes, and `trust: local-unattested`. Failed runs remain attached. `dairn work verify <id> --require-machine-gates` fails for missing/stale/failed evidence. Implementation cannot advance based solely on a manually registered `machine-evidence` file.

Agent hooks record process facts, not trust. `dairn hook turn-end` anchors the session to the active task as local-unattributed evidence; `dairn hook pre-push` re-runs local structural and risk checks before a push. Hook output can support traceability and can block a local action, but it never upgrades local evidence to CI identity or human sign-off. See the hooks contract for environment variables, anchor fields and fail-closed behavior.

SHA256 validates content integrity only. It cannot prove who ran a test, trusted CI identity, human sign-off, or branch protection. Protected CI must independently authenticate the workflow, runtime, subject SHA, issuer, policy, and required checks before making merge decisions. Dairn's local task log must not mint that attestation.
