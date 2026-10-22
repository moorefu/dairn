---
name: dairn-change-plan
description: 需求拆解和变更计划 Skill。接到新功能、缺陷或重构请求时，用它分析范围、依赖、兼容性、测试与 Agent 并行工作边界。
dairn-stage: stable
---

# Scope & Change Plan

1. 复述需求作为可观察行为：输入、输出、失败、边界、兼容承诺、禁止改变的现有行为。
2. 列出实际读取过的模块与调用方；不要先造新抽象，再去寻找使用场景。
3. 对每个模块确定实现责任人/Agent、受影响文件、所需接口契约和依赖；并行代理不得同时向同一文件无保护地写入。
4. 同时确定风险 L0/L1/L2 与模式 G0/G1/G2/G3。首选 PR/MR 作为变更说明；可选 Manifest。L2 请求 `dairn-design-review` 和负责人独立评审，只有持久设计取舍才创建 Note。
5. 为每个验收项指定测试层：unit、contract、integration、e2e、performance/security（按风险）；写出失败/取消/回滚用例。
6. 根据真实代码与包管理工具确定可执行命令，填入 `.dairn/governance/project.json`；可用模块级 Makefile 包装技术工具命令，项目根 Makefile 只做治理编排；不使用仅在理论上存在的测试。

**完成标志**：变更范围和边界得到确认；可独立验证的验收条件明确；测试命令与审批责任可落实。不需要为机械修改制造 Agent Note。

## Optional multi-session decomposition

Use `dairn.engineering.tasks` for genuinely large or concurrent changes. Prefer thin vertical tracer tasks with separate behavior-based acceptance criteria and explicit blockers; don't force everyday G0/G1 work to create tickets. On large mechanical refactors consider expand–migrate–contract. Use `make tasks-ready` only when local task records are selected. Explicitly assess parallel write conflicts and shared state.
