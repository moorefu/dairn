---
name: dairn-agent-workflow
description: Agent-first Dairn tracked software delivery. Use when coding a multi-stage task in a Dairn project; ask Dairn for the next stage, read only the relevant skill, run actual checks, and link evidence without inventing approvals.
dairn-stage: stable
---

# Dairn Agent Workflow

You (the existing coding AI Agent) **call Dairn**. Dairn NEVER silently calls an LLM or certifies your reasoning. This Skill is a tool-use protocol, not an autonomous agent service. A normal change runs `orient → grill → specify → slice → implement → review → synchronize`; bugs, incidents, documentation and review-only work take shorter routes.

**Invocation.** Call the project launcher, not an untracked global binary: run the launcher's `doctor` first (the launcher path is in `AGENTS.md`; project-root `dairn` on POSIX, `dairn.cmd` on Windows). Every `dairn <command>` example below is shorthand for that launcher. If no launcher resolves, report `DAIRN_NOT_AVAILABLE` and stop: do not install Dairn, download a runtime, or write one into the repository.

1. Read project `AGENTS.md`. Obtain a task ID or create one via `dairn work start "<goal>" --id <safe-id>`. Read `dairn work next <id> --json` and follow its `executor`, `skill`, `inputs`, `requirements`, and `completion` fields. Load only the relevant additional `dairn-*` Skill. For task-oriented orientation, `dairn context <query> [--change]` returns a bounded, sourced context pack (paths, symbols, Specs, tests, change relations, explicit unknowns) with precision labels; it is advisory and never replaces authoritative Specs or real checks.
2. Base claims on observed project files, authoritative Specs, and actual tests. Diagnose bugs with a red-capable signal. Respect human approvals and externally protected CI requirements.
3. At the **grill** stage, settle unresolved design decisions with the human before writing a spec. Facts are yours to look up; decisions belong to the human. Record `.dairn/governance/grills/<task-id>.json` with `dairn work record <id> <path> --kind grill`; the stage does not advance while any question is `open`. `confirmed_by` and `confirmed_at` are optional audit fields: include them when a human confirmed the answers, but never treat them as machine proof.
4. Record meaningful project-owned artifacts with `dairn work record <id> <path> --kind <kind>`: `grill`, `spec`, `tasks`, `test`, `machine-evidence`, `review`, `document`, `note`, `retro`. Artifacts carry content SHA256 only; they are not CI attestations and not human approval.
5. At **slice**, create a vertical task graph only for large or concurrent work. Run `dairn tasks check` to validate ids, status values, blocking edges and cycles, and `dairn tasks ready` to list the ready frontier. Declare `write_scopes` and `test_seams`; overlapping write scopes stay serial.
6. At **implement**, execute `dairn check --task <id> --base <trusted-base>`. The real check execution attaches a machine run to the task. A failed run stays failed and does not advance the stage. Verify with `dairn work verify <id> --require-machine-gates` and ensure HEAD has not changed. When the change needs language or domain evidence, run `dairn analyze plan --base <trusted-base>` first: it defaults to a dry run, reuses valid cached results, and reports reusable, authorization-needed and missing capabilities explicitly. **Never synthesize a machine run JSON** in place of actual command execution.
7. At **review**, write two-axis structured findings (Standards and Spec Fidelity; no Spec means `not-applicable`). At **synchronize**, call `dairn guide impact --base <trusted-base>`; optionally use project-defined `--analyzer <analyzer-id>`; review explicitly bound contracts under `.dairn/relations.json`, which are suggestions requiring review rather than semantic proof. Read `dairn analyze plan` decisions and gaps alongside the impact report: it is advisory, and a `missing-capability` status (or any plan `unknowns` entry) is a gap to report, never a silent pass. Update the relevant documents or record an evidence-backed no-change rationale.
8. At **reflect**, use dairn.retro.v1 with independent findings, seven resolution kinds, no-action and evidence-linked replay/effect evaluation. Record the decision with `dairn work record <id> <path> --kind retro`.
9. Move with `dairn work advance <id>` and finish with `dairn work finish <id>`, subject to the verified evidence requirements. Planning stages may be explicitly skipped with `dairn work skip <id> --reason "<reason>"` (recorded in the ledger); evidence stages cannot. A failing review may be recorded for traceability but never advances. Do not claim that a recorded-complete ledger equals protected CI success, approval, merge, or release.

For any language, a project may configure a `surface`-domain Analyzer in `.dairn/analyzers.json`. Analyzers are discovered lazily by capability: `dairn analyze plan --base <trusted-base>` derives required capabilities, reuses valid cached results and reports `request-authorization`/gap states explicitly. The default is a dry run; only a read-only analyzer allowlisted by project policy (`.dairn/governance/analysis.json`) may execute under `--apply`, and `--capability <name>` narrows the plan while `guide impact --analyzer <id>` stays the explicit per-analyzer override. Dairn does not bundle a language parser, and precision remains a project-supplied advisory claim. Mark uncertainty explicitly.

## Stage completion and turn-end anchors

任务标题含明确实现意图时，流程应包含 implement；需要固定意图时使用 `work start --kind change|bug|documentation|review|design|incident`。发现原任务误分类，使用 `work revise <id> --kind change --reason "..."` 归档旧状态后重启。已记录证据改变时，使用 `work revise <id> --stage <最早失效阶段> --reason "..."` 重新执行该阶段及后续阶段，不能直接刷新旧摘要冒充通过。

回合末锚点应在 `work finish` 前、任务仍活跃时调用，并在多个活跃任务时显式传入 `--task`。只需过程观测且没有 Work 任务时，接线独立 observe 事件桥；不要伪造一个活跃任务以通过 hook。

Run `dairn check --task <id> --base <trusted-base>` for real machine evidence; the run is standalone evidence and linking it into the ledger (`dairn work link-check <id> --run <run-id>`) is an advisory reference only. Trusted CI statements are produced by the protected evidence chain (`dairn attest prepare` on the isolated signer over an evidence bundle, verified with `dairn attest verify` against an out-of-repository public key); the task ledger cannot mint them. Never sign with a key in the project checkout.

`dairn hook turn-end` anchors the current session to the active task as local-unattributed evidence. Trigger it (or install the harness hook with `dairn hooks install --apply`) so the ledger can show which session ended on which HEAD. An anchor is not proof of correctness, a passing test, or approval.

In Review, record JSON with `standards`, `spec_fidelity`, and `head` (the current Git commit). In Synchronize, record JSON containing `status: updated|no-change`, `head`, `reviewed_docs`, and a meaningful `reason`; `no-change` is a reviewed judgment, not an automatic pass. CI-level verification lives outside the task ledger: verify evidence bundles with `dairn evidence verify` and compose final gate decisions with `dairn gate evaluate`; the CLI cannot invent CI trust.

Provider-neutral: Codex reads AGENTS.md; Claude Code follows the CLAUDE.md pointer; DeepSeek Harness discovers project `.agents/skills`. Dairn does not initiate AI calls.
