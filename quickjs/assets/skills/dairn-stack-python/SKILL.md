---
name: dairn-stack-python
description: Use when building, testing, reviewing or debugging python projects, APIs, tests and release toolchains; select risk-appropriate verification rather than assuming tool success means behavioral correctness.
dairn-stage: stable
---

# python Development Profile

1. 先通过 `make docs-find Q="python"` 查找 `dairn.stack.python` 并按需加载；核对真实的工具版本、模块路径与依赖配置。
2. 以测试/外部可观察的行为接口为 seam；创建最小可重复的失败信号，遵循 `dairn-tdd` 约束（适用时），避免对内部实现细节断言。
3. L0/L1/L2 依次执行当前项目要求的 lint、unit、integration、build；专项检查遵循文档的触发条件，不把可选扫描偷偷标为已完成。
4. 推荐子模块 `make lint|unit|integration|build`，并确认与 `.dairn/governance/project.json` 中的真实 argv 一致；禁止空测试目录、容错 `|| true`、CI 静默降级。
5. 同时进行 Standards 与 Spec Fidelity 两轴 Review，检查未被类型系统或工具捕获的业务行为、安全、取消、资源和兼容风险。

**规则权威来源**：`docs/best-practices/python.md`；本 Skill 只定义操作流程，不复制完整规则。
