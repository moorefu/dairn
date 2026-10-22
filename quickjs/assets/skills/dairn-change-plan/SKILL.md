---
name: dairn-change-plan
description: 需求拆解和变更计划 Skill。接到新功能、缺陷或重构请求时，用它消费已决议问题、定义可观察行为与测试缝隙，并划定兼容性、风险、并行工作边界与切片衔接。
dairn-stage: stable
---

# Scope & Change Plan

Specify 阶段只综合**已决议**内容，不重新访谈。

1. 先读 Grill 记录：已有 `resolved` 问题的 `decision` 直接作为输入；发现新决策时回到 `dairn-grill` 追加问题，不在计划里默认选择。
2. 复述需求作为可观察行为：输入、输出、失败、边界、兼容承诺、禁止改变的现有行为。
3. 列出实际读取过的模块与调用方；不要先造新抽象，再去寻找使用场景。
4. 对每个模块确定实现责任人/Agent、受影响文件、所需接口契约和依赖；并行代理不得同时向同一文件无保护地写入。
5. 同时确定风险 L0/L1/L2 与模式 G0/G1/G2/G3。首选 PR/MR 作为变更说明；可选 Manifest。L2 请求 `dairn-design-review` 和负责人独立评审，只有持久设计取舍才创建 Note。
6. 为每个验收项指定测试层：unit、contract、integration、e2e、performance/security（按风险）；写出失败/取消/回滚用例。
7. 根据真实代码与包管理工具确定可执行命令，填入 `.dairn/governance/project.json`；模块级构建入口只包装技术工具命令，治理编排集中在项目根配置；不使用仅在理论上存在的测试。计划用 `dairn validate` 校验结构。

**完成标志**：变更范围和边界得到确认；可独立验证的验收条件明确；测试命令与审批责任可落实。不需要为机械修改制造 Agent Note。

## 与 Grill、Tickets 的衔接

- Grill 仍是本阶段的完成条件：未决问题未清零时继续访谈，不把计划写成“边做边定”。
- 需要“怎么做”的票据时交给 `dairn-tracer-tasks`：垂直切片、每票声明阻塞边与测试缝隙；本地任务图用 `dairn tasks check` 校验、用 `dairn tasks ready` 找前沿。
- 日常 G0/G1 不强制建票；跨会话、多 Agent 或大范围机械重构才切票，宽重构按 expand-migrate-contract 排序。
- 计划与任务记录都是过程证据，不替代 Review、受保护 CI 或人工审批。
