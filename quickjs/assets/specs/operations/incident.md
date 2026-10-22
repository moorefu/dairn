---
id: dairn.operations.incident
title: 事故响应、恢复、复盘与预防
summary: 定义事故 SEV、先止损后修复、状态推进、Postmortem 和改进跟踪的分工。
kind: spec
module: operations
keywords: ["Incident", "事故", "故障", "应急", "故障复盘", "SEV1", "SEV2", "恢复"]
aliases: ["事故响应", "生产故障回路", "Postmortem 工作流"]
related: ["dairn.governance.lifecycle", "dairn.operations.traceability", "dairn.operations.defect", "dairn.operations.feedback"]
symbols: ["dairn validate"]
---

# Incident 与 Postmortem

## 事件生命周期

`detected → mitigating → monitoring → resolved → reviewed → closed`，允许处置中的回退以反映复发。SEV1/SEV2/SEV3/SEV4 为风险等级示例，团队应根据影响、范围和时效性制定对应通知时限；本框架不虚构统一分钟阈值。

事故处置优先保护用户与数据。紧急回滚、限流、降级和隔离可按应急授权先操作，事后补齐时间线与记录。`resolved` 是服务恢复，不表示根因已永久修复；复盘和 Action 在恢复后继续推进。

## 重大事故强制复盘

SEV1/SEV2 在 `closed` 前必须有 `docs/postmortems/<INC-ID>.md`，章节包括 Summary、Impact、Timeline、Contributing factors、Detection and response、Corrective actions、Verification，并至少关联一个 Action。复盘文件按该模板手动创建（没有专门的 CLI 初始化命令），写完后运行 `dairn validate` 校验记录结构与关联。复盘采用不归责的语言，记载真实影响、可验证时间线、有效纠正措施、负责人和核验方法。未完成的 Action 可保持 open，不阻断用户恢复。

## 关闭与 Agent Note 的区别

关闭 Incident 需 `details.impact`、`details.mitigation`、`details.resolution`、证据和完整状态历史。Postmortem 是特定事故事实与复盘，Bug 是缺陷修复证据，只有持续影响系统架构/治理规则的结论才另建 Agent Note。严重事故触发的永久流程变更应关联对应 Note 和验证门禁。
