---
id: dairn.operations.release
title: 发布制品、部署、运行观察与回滚闭环
summary: 规定发布记录、制品哈希、质量门禁、审批、部署后验证、反馈关联与安全回滚。
kind: spec
module: operations
keywords: ["Release", "发布反馈", "部署", "灰度", "回滚", "验证", "部署观察", "制品"]
aliases: ["发布运行闭环", "Release Observation", "生产发布审计"]
related: ["dairn.governance.lifecycle", "dairn.operations.traceability", "dairn.operations.feedback", "dairn.ci.gates"]
symbols: ["dairn check --base", "dairn validate"]
---

# 发布与运行反馈

## 状态

`planned → approved → deployed → observing → accepted`，若效果不达标可从 deployed/observing/accepted 转为 `rolled_back`。这个记录只是对真实外部发布的镜像。`approved` 文本不等价于真实审批；GitHub/GitLab/CD 平台需实施受保护环境、人工确认、制品完整性和批准留痕。

发布前先运行 `dairn check --base <ref>` 覆盖真实风险门禁，并核对项目 release checklist（`.dairn/governance/templates/release-checklist.md`，若存在）；技术门禁通过不等于部署批准。

## 事实关联

Release 最终态需 `details.artifact_digest`、`details.gate_ref`、`details.deployment_ref`、`details.observation`，必须分别附 CI、部署事件及部署后指标/日志/追踪观察证据。记录变更 SHA、可用的回滚版本、灰度指标和观察窗口由项目定义；工具不读取实际生产状态。

## 失败回路

部署引发告警时创建 Feedback，必要时升级 Incident / Bug 并回链 Release；先控制影响范围，再补充真实回滚证据。即使恢复运行，也必须将遗留改进纳入 Action；监测稳定后才能得出运营闭环结论。
