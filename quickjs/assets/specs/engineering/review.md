---
id: dairn.engineering.review
title: Standards 与 Spec Fidelity 双轴审查
summary: 分别评估工程规范合规性及需求实现完整性，固定 merge-base、两轴独立、不跨轴重排，机械问题转为确定性检查。
kind: spec
module: engineering
keywords: ["code review", "双轴评审", "Standards", "Spec Fidelity", "merge-base", "PR", "MR"]
aliases: ["Dual Axis Review", "双轴审查"]
related: ["dairn.engineering.feedback", "dairn.engineering.tasks", "dairn.governance.modes", "dairn.engineering.workflow"]
symbols: ["dairn work record", "dairn check"]
---

# 双轴代码评审

## Standards

独立检查代码正确性、安全、并发资源、依赖、兼容性、各技术 Stack 规范及证据有效性。只报告具体缺陷或有根据的审查意见；静态工具已确定性验证的模式不再成为人工流水账。

## Spec Fidelity

从 Issue、权威主题 Spec 或验收标准出发，检查遗漏、偏离、过度开发和错误预期。没有独立规格时明确标注 `not-applicable` 并给出理由，不能伪造规格来源或声称 Spec 通过；`pass` 必须带有效的 `spec_ref`。

## 操作细节

- **固定比较点**：审查对象是固定 ref 与 `HEAD` 之间的差异，按 merge-base 做三点比较，避免把目标分支上的无关提交算进本变更。ref 由人指定；不指定时先问，不猜。
- **两轴独立**：两轴各自得出证据结论，不互相抵消。Standards 通过而 Spec 失败是常见组合，反之亦然。
- **不跨轴重排**：聚合时保留两轴原始结论，不把一轴的问题降级成另一轴的附注，也不挑一个“总冠军”掩盖另一轴。
- **按分支决定上下文隔离**：G0/G1 允许同一审查者完成两轴；G2 及高风险变更采用独立 Reviewer 或独立上下文，减少共同偏见。

## 机械问题转确定性检查

Review 发现的**机械性**违规（固定语法模式、被禁 API、导入形状、文件位置规则）应转为确定性检查：lint 规则、CI 门禁或项目配置。判断性问题（跨文件一致性、与周边风格匹配）才留在 Review 的标准文档里。重复出现的人工 Review 流水账说明门禁缺口。

## 记录与证据

- 结构化结论至少包含 `standards`、`spec_fidelity`、`head`；`spec_fidelity` 为 `pass` 时附 `spec_ref`。
- 用 `dairn work record <task-id> <path> --kind review` 记录；可选 `.dairn/governance/engineering/reviews/*.json` 支持结构校验。
- 失败结论（`standards: fail` 或 `spec_fidelity: fail`）可以记录留痕，但 `dairn work advance` 只接受最后一条 review 证据为 pass；修正后必须用**新的证据路径**记录修订版（同一阶段不允许重复路径），旧失败证据保留在账本中。
- Review 证据绑定当前 HEAD；HEAD 变化后需重新审查，旧结论不得复用。
- 可选 `actor`：记录审查者声明，优先级为 `review.actor` > `--actor` > `DAIRN_ACTOR`。它只是 **self-asserted** 声明，机器不校验身份；真实身份与批准由 PR 平台、受保护 CI 与人工审查提供。

## 合并与裁剪

可复核的结构化摘要存现有 PR/MR。AI 审查不是人工批准，CI 绿灯也不是规格正确性的证明；合并决策仍由受保护分支策略与人工审批完成。
