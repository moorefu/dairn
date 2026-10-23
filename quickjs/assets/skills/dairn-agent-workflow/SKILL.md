---
name: dairn-agent-workflow
description: Agent-first Dairn tracked software delivery. Use when coding a multi-stage task in a Dairn project; ask Dairn for the next stage, read only the relevant skill, run actual checks, and link evidence without inventing approvals.
dairn-stage: stable
---

# Dairn Agent Workflow

You (the existing coding AI Agent) **call Dairn**. Dairn NEVER silently calls an LLM or certifies your reasoning. This Skill is a tool-use protocol, not an autonomous agent service. A normal change runs `orient → grill → specify → slice → implement → review → synchronize`; bugs, incidents, documentation and review-only work take shorter routes.

**Invocation.** Call the project launcher, not an untracked global binary: run the launcher's `doctor` first (the launcher path is in `AGENTS.md`; `.dairn/bin/dairn` on POSIX, `.dairn/bin/dairn.cmd` on Windows). Every `dairn <command>` example below is shorthand for that launcher. If no launcher resolves, report `DAIRN_NOT_AVAILABLE` and stop: do not install Dairn, download a runtime, or write one into the repository.

1. Read project `AGENTS.md`. Obtain a task ID or create one via `dairn work start "<goal>" --id <safe-id>`. Read `dairn work next <id> --json` and follow its `executor`, `skill`, `inputs`, `requirements`, and `completion` fields. Load only the relevant additional `dairn-*` Skill.
2. Base claims on observed project files, authoritative Specs, and actual tests. Diagnose bugs with a red-capable signal. Respect human approvals and externally protected CI requirements.
3. At the **grill** stage, settle unresolved design decisions with the human before writing a spec. Facts are yours to look up; decisions belong to the human. Record `.dairn/governance/grills/<task-id>.json` with `dairn work record <id> <path> --kind grill`; the stage does not advance while any question is `open`. `confirmed_by` and `confirmed_at` are optional audit fields: include them when a human confirmed the answers, but never treat them as machine proof.
4. Record meaningful project-owned artifacts with `dairn work record <id> <path> --kind <kind>`: `grill`, `spec`, `tasks`, `test`, `machine-evidence`, `review`, `document`, `note`, `retro`. Artifacts carry content SHA256 only; they are not CI attestations and not human approval.
5. At **slice**, create a vertical task graph only for large or concurrent work. Run `dairn tasks check` to validate ids, status values, blocking edges and cycles, and `dairn tasks ready` to list the ready frontier. Declare `write_scopes` and `test_seams`; overlapping write scopes stay serial.
6. At **implement**, execute `dairn check --task <id> --base <trusted-base>`. The real check execution attaches a machine run to the task. A failed run stays failed and does not advance the stage. Verify with `dairn work verify <id> --require-machine-gates` and ensure HEAD has not changed. **Never synthesize a machine run JSON** in place of actual command execution.
7. At **review**, write two-axis structured findings (Standards and Spec Fidelity; no Spec means `not-applicable`). At **synchronize**, call `dairn guide impact --base <trusted-base>`; optionally use project-defined `--precision <stub-id>`; review explicitly bound contracts under `.dairn/relations.json`, which are suggestions requiring review rather than semantic proof. Update the relevant documents or record an evidence-backed no-change rationale.
8. At **reflect**, each improvement is exactly one of: a new deterministic check, or an entry in the standards document the review axis reads. Record the decision with `dairn work record <id> <path> --kind retro`.
9. Move with `dairn work advance <id>` and finish with `dairn work finish <id>`, subject to the verified evidence requirements. Planning stages may be explicitly skipped with `dairn work skip <id> --reason "<reason>"` (recorded in the ledger); evidence stages cannot. A failing review may be recorded for traceability but never advances. Do not claim that a recorded-complete ledger equals protected CI success, approval, merge, or release.

For any language, a project may configure a `surface-analysis` Stub in `.dairn/stubs.json`. Dairn does not bundle a language parser, and precision remains a project-supplied advisory result. Mark uncertainty explicitly.

## Stage completion and turn-end anchors

Run `dairn check --task <id> --base <trusted-base>` for real machine evidence; the run is standalone evidence and linking it into the ledger (`dairn work link-check <id> --run <run-id>`) is an advisory reference only. Trusted CI statements are produced by the protected evidence chain (`dairn attest prepare` on the isolated signer over an evidence bundle, verified with `dairn attest verify` against an out-of-repository public key); the task ledger cannot mint them. Never sign with a key in the project checkout.

`dairn hook turn-end` anchors the current session to the active task as local-unattributed evidence. Trigger it (or install the harness hook with `dairn hooks install --apply`) so the ledger can show which session ended on which HEAD. An anchor is not proof of correctness, a passing test, or approval.

In Review, record JSON with `standards`, `spec_fidelity`, and `head` (the current Git commit). In Synchronize, record JSON containing `status: updated|no-change`, `head`, `reviewed_docs`, and a meaningful `reason`; `no-change` is a reviewed judgment, not an automatic pass. CI-level verification lives outside the task ledger: verify evidence bundles with `dairn evidence verify` and compose final gate decisions with `dairn gate evaluate`; the CLI cannot invent CI trust.

Provider-neutral: Codex reads AGENTS.md; Claude Code follows the CLAUDE.md pointer; DeepSeek Harness discovers project `.agents/skills`. Dairn does not initiate AI calls.
