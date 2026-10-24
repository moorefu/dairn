---
name: dairn-retro
description: Explicit retrospective of AI-assisted development: inspect observed failures, navigation friction, missing tests and automation; force each improvement into a deterministic check or a review standard record.
dairn-stage: stable
disable-model-invocation: true
---

# Agent Development Retro

人工显式发起：从指定的 PR、会话、测试和流水线日志出发，列出实际发生的摩擦并按严重度排序。

## 输入

- 真实的失败命令、退出码与测试输出；
- 导航困难（反复找错文档或文件）与缺失的机械检查；
- 无效或重复测试、慢命令、反复失效的 Skill 触发。

不要凭印象推断 Agent 失败；没有可证实证据时标注“未验证”。

## 二选一输出

每条改进必须落到一种形态：

1. **新增确定性检查**：项目已有检查集里的门禁项，必须能在改进前复现失败（red），改进后通过。
2. **写入 Review 标准文档**：判断性问题写进 Review 的 Standards 轴消费的文档（`AGENTS.md` 或 `docs/` 下已有文件）的某一节，由 `dairn-code-review` 的 Standards 轴消费。

记录 JSON：`{schema, task_id, observed, resolution}`，`resolution.kind` 取 `check`（`check` 填项目配置里已存在的检查名，另带 `red_evidence` 路径与 `verified_red: true`）或 `standard`（带 `document` 与 `section`）。文件存 `.dairn/governance/retro/<task-id>.json`，用 `dairn work record <task-id> <path> --kind retro` 记录。完整契约用 `dairn docs show dairn.engineering.retro` 加载。

## 边界

- 默认不改 `AGENTS.md`、Skill 或治理门禁；涉及长期规则变更时提交普通治理 PR 并接受 Review。
- 结构校验只证明记录存在与字段完整，不证明改进有效。
- Retro 不是事故 Postmortem，不能替代用户或组织的批准。
- 优先补既有门禁的缺口，而不是新增更多说明文字。
