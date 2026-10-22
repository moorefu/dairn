---
id: dairn.engineering.workflow
title: Agent 协同开发阶段与技能路由
summary: 按风险裁剪的工程开发流程，覆盖需求定位、诊断、规格、垂直切片、TDD、双轴评审、事实文档同步和复盘。
kind: spec
module: engineering
keywords: ["agent workflow", "tracer bullets", "TDD", "diagnosis", "review", "项目事实", "工程流程"]
aliases: ["dairn workflow", "AI 开发流程"]
related: ["dairn.engineering.review", "dairn.engineering.project-guidance", "dairn.skills.lifecycle"]
symbols: ["dairn workflow recommend", "dairn guide drift"]
---

# Agent Workflow Contract

流程使用项目事实与真实测试信号指引开发，而不是把自动化工具包装成人工审批。`dairn workflow recommend <task>` 只做**提示**：实际 Skill 选择由开发者和 Agent 在上下文中决定。

## 选择性阶段

- **Orient**：定位项目 README、AGENTS、已采纳 Spec、Glossary、Agent Notes 和上次事实快照；先观察再推理。
- **Diagnose**：Bug 须先建立可反红的、针对真实故障的快速反馈回路；不以猜测替代复现。
- **Specify / Slice**：明确用户可观察行为、测试缝隙、非目标；复杂任务分成可独立验证的垂直切片，不强制每次新建 Note 或 Issue。
- **Implement**：按公共接口执行红绿测试循环，先有失败信号再做最小实现；所有通过结论必须源于真实执行。
- **Review**：Standards 与 Spec Fidelity 独立得出证据结论；无权威 Spec 则 Fidelity 为 `not-applicable`，不能写“通过”。
- **Synchronize**：`dairn guide drift` 映射被改的模块、依赖、入口和 Spec 到受影响文档，需审查 Diff；不能自动修正文档或接受快照。
- **Reflect**：只有发生真实摩擦或失败才改善 Skill；优先自动化、收紧上下文导航，避免不必要的长 AGENTS 说明。

## 风险与权限

G0/G1 优先用最短闭环，G2/G3 加入独立评审和可信证据。`dairn workflow recommend` 不执行 Skill、不会审批、不分配外部 Issue。`dairn validate` / `check` 才是可执行门禁；人工审查在受保护的 SCM 流程完成。

## 方法参考与原创边界

方法论借鉴 [Matt Pocock Skills](https://github.com/mattpocock/skills) 中的诊断、TDD、代码评审、Spec/任务拆分和 Retro 设计，Dairn 自行实现规则、CLI 与 `dairn-*` Skills，不拷贝上游 Skill 正文。

## 执行跟踪与影响同步

通过 `dairn work start/status/next/record/advance/verify/finish` 保存任务过程和外部证据，不自动调用 AI。工程变更后先 `dairn guide impact`、再审查 README/AGENTS/项目 Spec；最终由受保护 CI 执行质量门禁，任务记录不替代审批。
