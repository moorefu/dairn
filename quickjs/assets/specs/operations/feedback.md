---
id: dairn.operations.feedback
title: 运行信号接入与反馈分流
summary: 规定告警、指标、日志和用户反馈如何形成 Feedback、去重分流、升级与关闭。
kind: spec
module: operations
keywords: ["反馈", "监控告警", "用户反馈", "线上观测", "SLO", "错误率", "性能退化"]
aliases: ["运行反馈接入", "Feedback Triage"]
related: ["dairn.governance.lifecycle", "dairn.operations.traceability", "dairn.operations.incident", "dairn.operations.defect"]
symbols: ["make lifecycle-create", "make lifecycle-evidence"]
---

# 运行信号接入与反馈分流

## 来源与最小事实

接受 metric、alert、user、support、operator、test 和 other；每条记录必须有 owner、初始时间、来源、标题。逐步补充影响范围、首次出现版本、信号引用、是否可重复、误报可能性，以及所需响应优先级。监控原始信号由外部平台保存；本仓库只保留可审查引用。

## 分流状态

`new → triaged → linked/closed`。`linked` 表示关联 Incident、Bug 或 Action，而非已经修复；关闭时 `details.disposition` 必须明确为 duplicate、not-actionable、resolved 或 linked。若 disposition 为 linked，必须存在真实关联记录。任何误报或无法复现应记录原因而非静默丢弃。

## 分流判定

用户影响、数据丢失、安全暴露、持续降级或需要紧急人工处置：优先立 Incident；可重复的逻辑缺陷创建 Bug；监控盲区或长期改进创建 Action。单次反馈可以指向多项。反馈记录不是发布审批，也不单独宣称 SLO 已达到。
