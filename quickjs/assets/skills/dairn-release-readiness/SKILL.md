---
name: dairn-release-readiness
description: 发布与生产准入评审 Skill。审核不可变制品、CI 证据、兼容迁移、健康指标、回滚策略与人工审批；不代替部署平台。
dairn-stage: stable
disable-model-invocation: true
---

# Production Readiness & Release

1. 锁定 release commit/tag、构建环境、制品摘要（digest）、部署配置版本，核实和已评审 PR 一致。
2. 执行或核实已执行 `make release-preflight BASE=<base>`；审阅 `.dairn/governance/templates/release-checklist.md` 的项目填写版本，追溯真实 CI 日志及检查执行结果。`release-preflight` 仅验证技术门禁，不等于部署批准。
3. 依变更风险检查 API/数据库/协议兼容，特别检查滚动升级时的新旧版本共存、配置升级、数据库不可逆步骤和回滚成本。
4. 依据实际 SLI/SLO 定义金丝雀观察指标和停止阈值，明确告警、责任人及故障处置。
5. 确认必要的独立审批出自代码托管/部署平台的授权身份，不来自 Agent Note 的自我声明。
6. 若任一关键门禁失败、制品不一致、回滚未验证或审批未完成，结论为 **NO-GO**。不得用“风险可控”空话覆盖缺失证据。
7. 发布后登记事件/指标、事故复盘和后续回归测试。

**输出**：GO / NO-GO / BLOCKED（带证据链接）；不可变 SHA、已验证项、未覆盖项、残余风险、人工批准记录、回滚负责人。


## Runtime observation and rollback evidence

Read `dairn.operations.release`. Prefer the existing trusted CD deployment record. Link real release/build digest, actual deployment evidence, rollback plan and post-deploy observation; create a local REL only when independent local state is necessary. Existing local REL terminal validation remains strict. Release approval and protected environments are external; a local `REL-*` state alone is not authorization. If a production signal fails, capture Feedback and escalate to Incident/Bug, then verify restoration before accepting release closure.
