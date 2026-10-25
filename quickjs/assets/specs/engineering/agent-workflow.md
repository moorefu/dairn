---
id: dairn.engineering.workflow
title: Agent 协同开发阶段与技能路由
summary: 按风险裁剪的工程流程：定位、Grill 对齐、诊断、规格、垂直切片、TDD、双轴评审、文档同步与复盘；Grill/Tickets/Retro 软层借鉴外部方法并由 Dairn 自行实现。
kind: spec
module: engineering
keywords: ["agent workflow", "grill", "tracer bullets", "TDD", "diagnosis", "review", "项目事实", "工程流程"]
aliases: ["dairn workflow", "AI 开发流程"]
related: ["dairn.engineering.launcher", "dairn.engineering.grill", "dairn.engineering.tasks", "dairn.engineering.review", "dairn.engineering.retro", "dairn.engineering.project-guidance", "dairn.skills.lifecycle"]
symbols: ["dairn workflow recommend", "dairn workflow stages", "dairn guide drift"]
---

# Agent Workflow Contract

流程使用项目事实与真实测试信号指引开发，而不是把自动化工具包装成人工审批。`dairn workflow recommend <task>` 只做**提示**：实际 Skill 选择由开发者和 Agent 在上下文中决定。

## 阶段

- **Orient**：定位项目 README、AGENTS、已采纳 Spec、Glossary、Agent Notes 和上次事实快照；先观察再推理。
- **Grill**：用设计树访谈把影响实现方向的未决问题收敛到零；事实由 Agent 查，决策归人。产出问题 JSON，未决问题清零才进入 Specify；建议同时记录确认字段作为审计线索。详见 [grill 契约](grill.md)。
- **Diagnose**：Bug 须先建立可反红的、针对真实故障的快速反馈回路；不以猜测替代复现。
- **Specify**：明确用户可观察行为、测试缝隙与非目标；只综合已决议内容，不重复访谈同一决策。
- **Slice**：把变更切成可独立验证的垂直切片，声明验收条件、测试缝隙、写域与阻塞关系。详见 [任务切片契约](tasks.md)。
- **Implement**：按公共接口执行红绿测试循环，先有失败信号再做最小实现；所有通过结论必须源于真实执行。
- **Review**：Standards 与 Spec Fidelity 独立得出证据结论；无权威 Spec 则 Fidelity 为 `not-applicable`，不能写“通过”。
- **Synchronize**：`dairn guide drift` 映射被改的模块、依赖、入口和 Spec 到受影响文档，需审查 Diff；不能自动修正文档或接受快照。
- **Reflect**：只有发生真实摩擦或失败才复盘；采用 dairn.retro.v1 的七类改进与 no-action，分别记录来源、回放和效果。详见 [retro 契约](retro.md)。

## 流程变体

- 普通变更：orient → grill → specify → slice → implement → review → synchronize。
- 缺陷：orient → diagnose → implement → review → synchronize；若缺陷实际包含设计选择，改用 design/change 任务重新规划（bug 路由不含 grill，不提供运行中插入阶段的命令）。
- 事故：orient → diagnose → review → reflect；止损优先，证据与复盘不可省略。
- 文档：orient → synchronize；涉及规则变化时按普通变更处理。
- 纯评审：orient → review → synchronize。
- 设计：orient → grill → specify → slice → review → synchronize。

标题包含“实现、实施、重构、精简、优化、迭代”等明确实现意图时，采用包含 implement 的普通变更流程，不因同时包含架构、文档或 PR 等词而降为纯设计或评审。“仅评审”“仅设计”仍采用对应流程；`work start --kind` 可以显式选择，误分类可通过 `work revise --kind` 归档后重启。

`dairn workflow stages` 输出当前运行时支持的阶段表；`dairn workflow recommend <task>` 返回建议裁剪，不执行 Skill、不分配 Issue。

## 软层来源与原创边界

Grill、任务切片、双轴 Review 与 Retro 的**方法**借鉴 [Matt Pocock Skills](https://github.com/mattpocock/skills)：设计树访谈（grilling）、领域语言与 ADR、tracer bullet 切片与阻塞边、面向 Agent 的写作规范、诊断与 TDD、双轴代码评审、复盘优先自动化。Dairn 自行实现规则、CLI 与 `dairn-*` Skills，不复制上游 Skill 正文。

借鉴的是**流程与证据形态**，不是信任：任何 Skill 被调用、任何复盘被记录，都不构成审批、不替代机器门禁，也不证明模型推理正确。

## 风险与权限

G0/G1 优先用最短闭环，G2/G3 加入独立评审和可信证据。`dairn workflow recommend` 不执行 Skill、不会审批、不分配外部 Issue。`dairn validate` 与 `dairn check` 才是可执行门禁；人工审查在受保护的 SCM 流程完成。

## 执行跟踪与影响同步

通过 `dairn work start/list/status/next/record/advance/skip/verify/finish/cancel/reopen` 保存任务过程与外部证据，不自动调用 AI（`skip` 只允许规划阶段并必须给出理由）。工程变更后先 `dairn guide impact`、再审查 README/AGENTS/项目 Spec；最终由受保护 CI 执行质量门禁，任务记录不替代审批。

调用入口是项目根启动器 `dairn`（Windows `dairn.cmd`）；本文档与 Skill 示例中的 `dairn` 是它的简写。启动器不可用时报告 `DAIRN_NOT_AVAILABLE`，**不要自行安装 Dairn**，也不要在仓库里写入运行时；解析顺序与 vendored 运行时见 [launcher 契约](launcher.md)。
