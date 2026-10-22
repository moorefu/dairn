---
id: dairn.operations.traceability
title: 运行闭环留痕格式与引用校验
summary: 定义 Feedback、Incident、Bug、Release、Action 的状态历史、关联 ID、证据引用、Git 追加性校验与可信边界。
kind: spec
module: operations
keywords: ["运营留痕", "证据链", "事件记录", "审计", "append-only", "状态历史", "工单关联", "trace"]
aliases: ["运行证据链", "Lifecycle Ledger", "闭环记录格式"]
related: ["dairn.governance.lifecycle", "dairn.governance.modes", "dairn.operations.feedback", "dairn.operations.incident", "dairn.operations.defect", "dairn.operations.release"]
symbols: ["make lifecycle-check", "make lifecycle-trace", "scripts/lifecycle.py"]
---

# 运行闭环留痕与证据链

## 记录创建触发

本地实体属于可选承载形式。优先选择现有 Issue、Incident 平台或 CD 作为主记录；不要求普通 PR 额外创建五种 JSON。已经采用本地格式的记录仍接受完整状态与历史校验。外部链接只作为线索，脚本尚不能验证其内容真实性，因此不能用随意填写的 URL 绕过本地已建立记录的终态条件。

## ID 与实体位置

统一 ID `FB-YYYYMMDD-NNN`、`INC-...`、`BUG-...`、`REL-...`、`ACT-...`。源文件固定在 `.dairn/governance/operations/{feedback,incident,bug,release,action}/<ID>.json`。活动状态记录与 Agent Notes 的 `proposed/implemented/rejected/archived` 不是同一种状态机。

每个实体提供 `schema_version`、`id`、`type`、`title`、`owner`、`status`、`opened_at`、`updated_at`、`details`、`links`、`evidence`、`history`。关联必须是可解析的真实记录 ID，Agent Note 路径单独通过 `links.note` 引用。

## 事件与证据

`history` 记录 `at`（含时区）、`actor`、`from`、`to`、`reason`、`evidence_refs`。首次事件创建记录，后续状态迁移受合法转换约束；添加证据和关联也产生同状态历史事件。已在 Git 基线中的事件不能通过下一次 PR 删除或改写；能追加新事件，但不能清空旧事件以“重置”问题。

`evidence` 必须含 `kind`、`ref`、`at`。引用只存可检索的 CI 报告、脱敏监控面板、测试报告、发布 ID 或工单地址；禁止把 Token、原始患者数据、用户身份、敏感日志拷贝进 Git。CLI 不访问这些 URL，因此不会把“引用存在”当成“证据真实”；人工或可信外部验证仍必需。

## 校验与命令

`make lifecycle-check [BASE=<trusted-ref>]` 检查文件格式、状态历史、跨实体 ID 链接、终态关闭条件（发布需同时有 CI、部署及运行信号；生产 Bug 需关联已接受的发布）；存在 `BASE` 时额外检查旧事件前缀、记录 ID/类型不可改写。`make validate/gate/ci` 自动调用同一校验。`make lifecycle-trace RECORD_ID=...` 返回该记录及反向引用，不加载全部日志。状态变更通过 `make lifecycle-transition`，保留 actor、原因和已登记的证据。

## 保留和信任边界

Git 只能检测与所给基线的修改，不能保证组织管理员不可改写历史。应使用 GitHub/GitLab 受保护分支、CODEOWNERS、可信 Runner 和外部事件系统的不可变审计；禁止将 PR 自带的风险配置作为唯一可信规则。生产事件可先在外部事故系统处理，再同步摘要/证据 ID 进入此账本，不得因仓库门禁耽误现场处置。
