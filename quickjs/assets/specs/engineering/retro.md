---
id: dairn.engineering.retro
title: Reflect 复盘与二选一改进契约
summary: 从真实会话摩擦中提炼改进项，并强制在“新增确定性检查”与“写入 Review 标准文档”之间二选一；机器校验结构与目标存在，不证明改进有效。
kind: spec
module: engineering
keywords: ["retro", "复盘", "反思", "确定性检查", "编码标准", "reflect", "改进项"]
aliases: ["Reflect 阶段", "会话复盘", "Developer Experience Retro"]
related: ["dairn.engineering.review", "dairn.engineering.feedback", "dairn.skills.lifecycle", "dairn.engineering.workflow"]
symbols: ["dairn work record", "dairn validate"]
---

# Reflect 复盘与二选一改进契约

## 触发条件

由人显式请求，或在 G2/G3 事故、反复摩擦后执行；普通任务不自动创建复盘。优先读取真实会话输出、失败命令与已有测试证据，不凭印象推断 Agent 失败。

## 二选一输出

每条改进必须落到两种形态之一，并给出可验证目标：

- **新增确定性检查**（`resolution.kind: "check"`）：把机械错误变成项目已有检查集里的门禁项。`check` 必须填写 `.dairn/governance/project.json` 中已配置的检查名（`modules[].checks` 或 `required_checks` 的键），不是整条命令；`red_evidence` 指向仓库内已存在的证据文件；`verified_red` 必须为 `true`，表示已观察到改进前失败。
- **写入 Review 轴使用的标准文档**（`resolution.kind: "standard"`）：判断性问题写入 Review 的 Standards 轴消费的文档。`document` 只能是 `AGENTS.md` 或 `docs/` 下已存在的文件；`section` 写该文档中的小节标题。

同一条改进不能同时声称“已自动化”和“仅靠人记”。既不新增检查、也不进入标准文档的复盘项视为未落地。

```json
{
  "schema": 1,
  "task_id": "auth",
  "observed": [
    "同类缺陷连续两次由人工 Review 发现",
    "修改公共接口后忘记同步调用点测试"
  ],
  "resolution": {
    "kind": "check",
    "check": "unit",
    "red_evidence": ".dairn/governance/engineering/feedback/feedback-0123.json",
    "verified_red": true
  }
}
```

`kind: "standard"` 时 `resolution` 改为：

```json
{
  "kind": "standard",
  "document": "docs/CODING_STANDARDS.md",
  "section": "错误处理"
}
```

- `observed` 至少一条，写可复述的真实摩擦，不写笼统感受。
- `check` 必须是项目配置里真实存在的检查名；`red_evidence` 必须存在。
- `document` 与 `section` 必须非空，文档必须存在；缺失文件会导致记录失败。

## 记录方式

证据文件放在 `.dairn/governance/retro/<task-id>.json`，用 `dairn work record <task-id> <path> --kind retro` 记录；文件须已存在且位于仓库内。该记录只对 reflect 阶段有效，`dairn work advance` 在缺少合法 retro 证据时失败。

## 机器能验证什么

- 能：JSON 可解析、`schema` 为 1、`task_id` 匹配、`observed` 非空、`resolution.kind` 取值、`check` 属于项目配置的检查集、`red_evidence` 文件存在、`verified_red` 为 true、`document` 存在、`section` 非空。
- 不能：证明改进真的有效、检查真的能抓住原错误、`section` 指向的小节确实存在或标准真的被后续 Review 消费。结构通过只是“已记录”，不是“已改善”。
- 现有工具链已覆盖的检查不应重复新建；先确认既有门禁是否静默失效。

## 权限边界

- 默认不改 `AGENTS.md`、Skills 或治理门禁；涉及长期规则变更时进入常规评审并留下审查记录。
- 只有持久、非显而易见且存在真实备选方案的设计取舍才创建 Agent Note。
- Retro 不是事故 Postmortem，不能替代用户或组织的批准。

## 与其他阶段的关系

Reflect 在 Review 与 Synchronize 之后。机械缺口补检查，判断缺口补 Review 标准；改进项落地前不宣称已修复。
