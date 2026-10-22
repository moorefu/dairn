---
id: dairn.engineering.review
title: Standards 与 Spec Fidelity 双轴审查
summary: 分别评估工程规范合规性及需求实现完整性，不互相抵消。
kind: spec
module: engineering
keywords: ["code review", "双轴评审", "Standards", "Spec Fidelity", "PR", "MR"]
aliases: ["Dual Axis Review", "双轴审查"]
related: ["dairn.engineering.feedback", "dairn.governance.modes"]
symbols: ["make feedback-check"]
---

# 双轴代码评审

## Standards

独立检查代码正确性、安全、并发资源、依赖、兼容性、各技术 Stack 规范及证据有效性。只报告具体缺陷或有根据的审查意见；静态工具已确定性验证的模式不应再次成为人工流水账。

## Spec Fidelity

从 Issue、权威主题 Spec 或验收标准出发，检查遗漏、偏离、过度开发和错误预期。没有独立规格时明确标注 `not-applicable` 及理由，不能伪造规格来源或声称 Spec Passed。

## 合并与裁剪

G0/G1 通常允许一个审查者完成两条轴；G2 重要变更可采用独立上下文或 Reviewer，以减少共同偏见。可复核的结构化摘要存现有 PR/MR；可选 `.dairn/governance/engineering/reviews/*.json` 支持结构校验。二者结论独立呈现；AI 审查不是人工批准，CI 绿灯也不是规格正确性的证明。
