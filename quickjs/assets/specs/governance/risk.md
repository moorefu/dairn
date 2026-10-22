---
id: dairn.governance.risk
title: 风险等级与最低验证要求
summary: 规范 L0/L1/L2 风险划分及不能降级的最低验证集合。
kind: spec
module: governance
keywords: ["风险", "L0", "L1", "L2", "安全", "兼容", "审批"]
aliases: ["risk-levels", "风险分级"]
related: ["dairn.ci.gates", "dairn.governance.authority", "dairn.governance.modes"]
symbols: ["risk_level"]
---

# 风险等级与最低验证要求

## 风险等级

- **L0**：纯文档或无可观察行为变化的机械改动；至少 `validate` 与对应 lint。
- **L1**：常规用户可观察行为或内部逻辑；至少 lint 与 unit，按影响追加集成/契约测试。
- **L2**：鉴权、安全、资金、协议和持久化兼容、并发状态机、数据库迁移、高风险发布及跨服务契约；至少 lint、unit、integration、build，增加专项验证和真实人类审批。

风险等级只是下限。技术或项目特定测试可更严格，不能通过调整本 PR 的配置回避失败。

## 变更声明

变更以 PR/MR 元数据为默认主记录；无可靠 PR/MR 元数据时可以用 `.dairn/governance/changes/` 中的可选 Manifest，或在本地暂用 Git 提交信息作非权威预检。仅 `durable_decision=true` 需要 Agent Note。L2 始终要求真实人工审批，但不因为是 L2 就要求制造 Note。详情见 [治理模式](modes.md)。

## 审查与例外

对风险冲突，Reviewer 按最不利的受影响行为审查。例外必须有受保护的审批记录、期限、补偿控制、范围及后续事项；默认 FAIL/CANNOT RELEASE。
