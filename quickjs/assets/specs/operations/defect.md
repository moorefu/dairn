---
id: dairn.operations.defect
title: Bug 从复现到修复、上线观察和关闭
summary: 定义 Bug Case 的复现、根因、最小修复、回归、复发检测与生产闭环条件。
kind: spec
module: operations
keywords: ["Bug", "缺陷", "复现", "根因", "回归测试", "hotfix", "补丁", "重新打开"]
aliases: ["Bug 修复闭环", "Bug修复", "缺陷修复记录", "回归与复发治理"]
related: ["dairn.governance.lifecycle", "dairn.operations.traceability", "dairn.operations.release", "dairn.operations.incident"]
symbols: ["dairn validate"]
---

# Bug Case 修复闭环

## 生命周期

`new → triaged → fixing → verifying → fixed → closed`；不能修复时可从 new/triaged 转 `rejected` 并附依据，已关闭的缺陷复发可重新进入 triaged。Bug 与 Incident 可以多对多关联：故障是运行事件，Bug 是需要修正的可观察行为或技术缺陷。状态迁移按本规范手动编辑记录 JSON，然后运行 `dairn validate`（需要校验历史不可改写时加 `--base <ref>`）；没有专门的 CLI 状态迁移命令。

## 修复准则

描述期望/实际行为、触发条件、受影响版本、根因与反例。优先建立能在修复前失败的回归测试或说明无法确定性复现的原因；再进行最小修复、边界/错误路径验证与评审。Bug Case 通过 `details.reproduction`、`details.fix_ref`、`details.verification_ref` 和 evidence 保存执行事实。仅有 Agent 文字总结而无测试/PR 引用，不构成已修复证据。

## 生产关闭要求

生产缺陷 `origin=production` 的 closed 状态必须关联处于 `accepted` 的 Release（不能只关联 `planned` 版本），留下 `details.post_release_observation` 和部署后指标、日志、追踪或看板信号证据。`fixed` 只说明代码侧工作达到验证标准，不能代替生产发布。复发时重新打开 Bug 并补充观察事件，必要时创建新的 Incident；跨项目永久取舍写 Agent Note。
