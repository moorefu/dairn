---
id: dairn.engineering.feedback
title: Tight Feedback 与行为测试
summary: 针对具体回归的快速失败信号、TDD 垂直切片、复现与修复闭环。
kind: spec
module: engineering
keywords: ["TDD", "复现", "快速反馈", "bug", "红绿", "回归", "tight feedback"]
aliases: ["Tight Feedback", "故障快速反馈环"]
related: ["dairn.operations.defect", "dairn.engineering.review"]
symbols: ["dairn validate"]
---

# Tight Feedback 与行为验证契约

## 快速反馈

先固定预期和实际症状，尽可能定义一个能证明具体问题存在的红色信号。命令需可重复、有界、尽量在正确外部接口层观察，且同时保留用于独立校验的输出。轻量任务可直接记录在 PR/MR，只有跨会话/跨系统需要独立跟踪时才创建 `.dairn/governance/engineering/feedback/*.json`。

## 测试与诊断

推荐一个垂直行为切片一轮 `red → green`，防止批量空洞测试，预期不能由被测实现本身重新计算。复现暂不可得或事故止损优先时可以声明 blocker/限制，但不能假称复现成功。对非确定性缺陷，记录复现概率、运行次数、环境和时间预算；压力与故障注入不等于无竞态证明。

## 证据语义

显式保存 red/green 的命令、提交、输出引用与结论，检验相应记录字段/链接，但机器不能仅凭填入的 JSON 声明证明真实执行。可信执行由受保护 CI 和外部工单证据负责。
