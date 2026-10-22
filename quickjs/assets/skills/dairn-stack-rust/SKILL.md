---
name: dairn-stack-rust
description: Use when building, testing, reviewing or debugging rust projects, APIs, tests and release toolchains; select risk-appropriate verification rather than assuming tool success means behavioral correctness.
dairn-stage: stable
---

# rust Development Profile

1. 核对真实的工具版本、模块路径与依赖配置；项目自有规范用 `dairn docs find rust` 检索（Dairn 发行版不提供 `dairn.stack.rust` 规范 ID）。
2. 以测试/外部可观察的行为接口为 seam；创建最小可重复的失败信号，遵循 `dairn-tdd` 约束（适用时），避免对内部实现细节断言。
3. L0/L1/L2 依次执行当前项目要求的 lint、unit、integration、build；专项检查遵循文档的触发条件，不把可选扫描偷偷标为已完成。
4. 子模块检查直接运行 `.dairn/governance/project.json` 中配置的 lint/unit/integration/build argv（完整门禁统一用 `dairn check --base <ref>`）；禁止空测试目录、容错 `|| true`、CI 静默降级。
5. 同时进行 Standards 与 Spec Fidelity 两轴 Review，检查未被类型系统或工具捕获的业务行为、安全、取消、资源和兼容风险。

**规则权威来源**：项目自有的 `docs/best-practices/rust.md`（若存在）；本 Skill 只定义操作流程，不复制完整规则。
