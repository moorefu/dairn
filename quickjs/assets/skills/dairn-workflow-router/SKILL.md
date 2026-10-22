---
name: dairn-workflow-router
description: User-oriented lightweight workflow router; use when a human explicitly requests to choose among engineering, feedback, review, release, or maintenance skills.
dairn-stage: stable
disable-model-invocation: true
---

# Dairn Workflow Router

用户显式使用的技能导航入口，不执行批准或修改产品。

1. 使用 `dairn skills catalog` 探索 stable 技能及其调用权，再结合 `dairn docs find <topic>` 找到相关主题规范。
2. G0/G1 优先使用单个聚焦 Skill；G2 加入设计与双轴 Review；G3 使用 incident/反馈闭环，不能要求所有场景强制走全套。
3. Bug 使用 `dairn-bugfix`，真实故障反馈优先给 `dairn-incident-response`；编码使用 `dairn-implementation` 并由其按需参照 `dairn-tdd`。
4. 新项目或文档整理使用 `dairn-project-guidance`，先跑 `dairn guide plan`，按真实源码完善 README/AGENTS/docs；CLI 脚手架不代表项目事实已经验证。
5. 不经人主动调用 `dairn-release-readiness`、`dairn-postmortem`、`dairn-retro`，也不假装 Skill 调用等于门禁证据。

## Engineering workflow contract (Dairn)

For an actual request, use `dairn workflow recommend <request>` as a **suggestion**, never as automatic invocation. Route selectively:

- **Observe**: find the project facts, glossary, decisions and specs first; record what is missing.
- **Diagnose**: for a bug, build a tight, repeatable, red-capable probe before suggesting a fix.
- **Specify / slice**: decide user-visible behavior and test seams, then deliver vertical tracer bullets in a DAG; don't force this for trivial fixes.
- **Implement**: red-green at public seams; capture real stdout/exit codes.
- **Review**: independent Standards + Spec Fidelity assessments; absent spec is `not-applicable`.
- **Synchronize**: `dairn guide drift` suggests exactly which docs need review; no fabricated project facts.
- **Reflect**: after meaningful incidents, improve deterministic guardrails before adding more prose/Skills.

Use G0/G1 by default where proportional; G2/G3 require stronger independent review and provenance, not ritualistic documents. Do not invent automatic multi-agent dispatch or tracker integration.

## Task continuity (Dairn)

When work spans sessions, create a user-visible task ledger with `dairn work start <task> --id <safe-id>`. Use `dairn work next --id <id>` to load only the current stage's Skill and goal; after the actual step, attach a repository-relative evidence artifact using `dairn work record <id> <path> --kind <kind>` and move forward with `dairn work advance <id>`. `dairn work verify <id>` checks evidence file digests, not whether a test was really run. Never claim a task ledger is CI attestation or human approval.

Check `dairn guide impact [--base <trusted-base>]` after implementation; treat public declaration/import edges as heuristics, not a perfect dependency graph. Do not auto-refresh Facts or overwrite project documents to silence a report.

## Agent-first execution protocol (v1.1)

Dairn does not call an LLM. As the coding agent, invoke `dairn work next <task-id> --json`, honor `executor`, `requirements`, and `completion`, and read only the indicated Skill. A stage contract is deterministic routing metadata, **not** proof that an AI ran.

For implementation work in a Git branch, run `dairn check --task <task-id> --base <trusted-base>` to attach an actual local tool execution to the task. A failed run is attached as failed evidence and must not advance the stage. Before advancing, run `dairn work verify <task-id> --require-machine-gates`; make sure the check covered the **current** HEAD and required checks. Preserve test outputs as machine-generated artifacts, never as invented natural-language testimony.

Use `dairn guide impact --base <trusted-base>` to inspect source and module changes. When `.dairn/relations.json` exists, review its explicit Spec/symbol/test/doc bindings; they are assertions requiring human review, **not** machine-proven semantic compatibility. `--precision <stub-id>` optionally invokes a project-provided analyzer through the shared Stub protocol. After changes, review the affected docs and record an evidence-backed no-change rationale if needed. CI attestation and approval remain separate and must never be self-declared by the Agent.
