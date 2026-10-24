---
name: dairn-workflow-router
description: User-oriented lightweight workflow router; use when a human explicitly requests to choose among engineering, feedback, review, release, or maintenance skills.
dairn-stage: stable
disable-model-invocation: true
---

# Dairn Workflow Router

用户显式使用的技能导航入口，不执行批准或修改产品。

前置条件：先确认项目 launcher 可用（运行 launcher 的 `dairn doctor`，路径见 `AGENTS.md` 的托管块）；无法解析 launcher 时报告 `DAIRN_NOT_AVAILABLE`，不要安装 Dairn。下文示例中的 `dairn` 都是该 launcher 的简写。

1. 使用 `dairn skills catalog` 探索 stable 技能及其调用权，再结合 `dairn docs find <topic>` 找到相关主题规范。
2. G0/G1 优先使用单个聚焦 Skill；G2 加入设计与双轴 Review；G3 使用 incident/反馈闭环，不能要求所有场景强制走全套。
3. 需求、方案或重构存在影响实现方向的未决取舍时，先走 `dairn-grill`；未决问题清零（或对 L0/机械任务用 `dairn work skip` 显式跳过并留理由）后才进入 `dairn-change-plan` 的 Specify。人工确认字段是建议审计项，不是机器证明。
4. Bug 使用 `dairn-bugfix`，真实故障反馈优先给 `dairn-incident-response`；编码使用 `dairn-implementation` 并由其按需参照 `dairn-tdd`；跨会话大任务才用 `dairn-tracer-tasks`。
5. 新项目或文档整理使用 `dairn-project-guidance`，先跑 `dairn guide plan`，按真实源码完善 README/AGENTS/docs；CLI 脚手架不代表项目事实已经验证。
6. 不经人主动调用 `dairn-release-readiness`、`dairn-postmortem`、`dairn-retro`，也不假装 Skill 调用等于门禁证据。

## Engineering workflow contract (Dairn)

For an actual request, use `dairn workflow recommend <request>` as a **suggestion**, never as automatic invocation. A normal change runs `orient → grill → specify → slice → implement → review → synchronize`; bugs, incidents, documentation and review-only work take the shorter routes. Route selectively:

- **Observe**: find the project facts, glossary, decisions and specs first; record what is missing.
- **Grill**: settle human decisions on the design-tree frontier before specifying; a request with unresolved choices does not move on. The stage completes when the grill record has no `open` question. Confirmation fields are optional audit data, not proof of a human decision.
- **Diagnose**: for a bug, build a tight, repeatable, red-capable probe before suggesting a fix.
- **Specify / slice**: decide user-visible behavior and test seams from the settled decisions, then deliver vertical tracer bullets in a DAG; use `dairn tasks check` and `dairn tasks ready` when a local task graph exists.
- **Implement**: red-green at public seams; capture real stdout and exit codes.
- **Review**: independent Standards + Spec Fidelity assessments; absent spec is `not-applicable`.
- **Synchronize**: `dairn guide drift` suggests exactly which docs need review; no fabricated project facts.
- **Reflect**: after meaningful incidents, improve deterministic guardrails before adding more prose or Skills; each improvement is a check or a Review standard, not both.

Use G0/G1 by default where proportional; G2/G3 require stronger independent review and provenance, not ritualistic documents. Do not invent automatic multi-agent dispatch or tracker integration. `dairn hook turn-end` and `dairn hook pre-push` only record local process facts; they never replace protected CI or human approval.

## Task continuity (Dairn)

When work spans sessions, create a user-visible task ledger with `dairn work start <task> --id <safe-id>`. Use `dairn work next <id> --json` to load only the current stage's Skill and goal; after the actual step, attach a repository-relative evidence artifact using `dairn work record <id> <path> --kind <kind>` and move forward with `dairn work advance <id>`.

Evidence kinds follow the stage: `grill` for the design-tree record, `spec` for the plan, `tasks` for the sliced graph, `test` or `machine-evidence` for implementation, `review` for both review axes, `document` for synchronization, `retro` for the two-way improvement record, plus `note`. `dairn work verify <id>` checks evidence file digests, not whether a test was really run. Never claim a task ledger is CI attestation or human approval.

Check `dairn guide impact [--base <trusted-base>]` after implementation; treat public declaration/import edges as heuristics, not a perfect dependency graph. Do not auto-refresh Facts or overwrite project documents to silence a report.

## Agent-first execution protocol

Dairn does not call an LLM. As the coding agent, invoke `dairn work next <task-id> --json`, honor `executor`, `requirements`, and `completion`, and read only the indicated Skill. A stage contract is deterministic routing metadata, **not** proof that an AI ran.

For implementation work in a Git branch, run `dairn check --task <task-id> --base <trusted-base>` to attach an actual local tool execution to the task. A failed run is attached as failed evidence and must not advance the stage. Before advancing, run `dairn work verify <task-id> --require-machine-gates`; confirm the check covered the **current** HEAD and required checks. Preserve test outputs as machine-generated artifacts, never as invented natural-language testimony.

Use `dairn guide impact --base <trusted-base>` to inspect source and module changes. When `.dairn/relations.json` exists, review its explicit Spec/symbol/test/doc bindings; they are assertions requiring human review, **not** machine-proven semantic compatibility. `--analyzer <analyzer-id>` optionally invokes a project-provided analyzer through the shared Analyzer protocol. After changes, review the affected docs and record an evidence-backed no-change rationale if needed. CI attestation and approval remain separate and must never be self-declared by the Agent.
