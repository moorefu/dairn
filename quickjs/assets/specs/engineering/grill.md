---
id: dairn.engineering.grill
title: Grill 阶段与设计树收敛契约
summary: 规格化之前先用设计树访谈把未决问题收敛到零；规定问题记录 JSON、阶段判据、机器可验证边界与重录语义。
kind: spec
module: engineering
keywords: ["grill", "grilling", "设计树", "frontier", "需求对齐", "未决问题", "访谈"]
aliases: ["Grill 阶段", "设计树访谈", "Grilling Contract"]
related: ["dairn.engineering.workflow", "dairn.engineering.work-execution", "dairn.engineering.tasks", "dairn.governance.modes"]
symbols: ["dairn work record", "dairn work advance", "dairn work next"]
---

# Grill 阶段契约

Grill 是 Orient 与 Specify 之间的**人类决策收敛阶段**。它把散落在对话里的取舍记录下来，使 Specify 面对的是已决议问题，而不是 Agent 的假设。

## 位置与触发

- 普通变更：`orient → grill → specify → slice → implement → review → synchronize`。
- 设计类任务默认包含 grill；缺陷与事故变体路由本身不含 grill（见 workflow 变体），无需跳过操作。
- 已冻结的重复任务与纯机械修改（L0）可以用 `dairn work skip <task-id> --reason "<原因>"` 显式跳过，理由写入账本；跳过不等于已决议，后续审查仍可要求补齐。
- `dairn work next <task-id> --json` 报告阶段，Agent 只加载当前阶段需要的 Skill。

## 设计树与 frontier

决策构成一棵**设计树**：一个决策的结论决定了下层有哪些问题可问。**frontier** 是“前置决策已定”的节点集合。

- 每轮只问 frontier 上的问题，一轮问完再等回答。
- 事实（文件、Spec、命令输出、外部文档）由 Agent 检索，必要时派 subagent 只做检索；决策由人给出。
- 每个问题附推荐答案，使用户回一个“是”即完成。
- 依赖本轮其他未答问题的问题属于下一轮，不得混入本轮。

## 问题记录

证据文件位于 `.dairn/governance/grills/<task-id>.json`：

```json
{
  "schema": 1,
  "task_id": "auth",
  "questions": [
    {
      "id": "Q1",
      "prompt": "错误重试是否对用户可见？",
      "recommendation": "不可见，内部重试三次",
      "status": "resolved",
      "decision": "不可见，内部重试三次，超限返回 503",
      "rationale": "现有界面没有重试状态"
    }
  ],
  "confirmed_by": "maintainer",
  "confirmed_at": "2026-01-01T00:00:00Z"
}
```

- `schema` 固定为 1；`task_id` 必须等于被记录的任务 ID。这里的任务 ID 是 `dairn work start --id` 的小写 kebab 标识（如 `auth`），不是切片任务文件的 `TASK-*` ID；两者不要混用。
- `questions` 非空；每条必须带 `id`、`prompt`、`recommendation`，`id` 在文件内唯一。
- `status` 只允许 `open` 或 `resolved`；`resolved` 必须带非空 `decision`，`rationale` 可选且必须是字符串。
- `confirmed_by` / `confirmed_at` 是**可选审计字段**：提供时必须非空。机器无法据此证明决策真的由人给出。
- 同一阶段重录 grill 证据会替换上一版草稿（frontier 是活的），便于用已解决的访谈覆盖早期未决快照。

## 完成判据

`dairn work advance` 进入 Specify 之前，运行时强制：

1. grill 阶段已通过 `dairn work record <task-id> <path> --kind grill` 记录证据；
2. 证据是合法 JSON，`schema` 为 1、`task_id` 匹配、`questions` 非空、每条问题字段合法；
3. `questions` 中不存在 `status: "open"`。

建议同时记录 `confirmed_by` / `confirmed_at`，让审查者能追溯到确认者与时间；它们缺失不阻止推进。被 `dairn work skip` 显式跳过的 grill 阶段不适用本判据，但跳过理由与审查要求仍会保留在账本中。

## 机器能验证什么

- 能：文件存在性与 SHA256 完整性、JSON 可解析、schema 与任务绑定、问题字段合法性、未决问题是否清零、审计字段非空。
- 不能：证明某个 `decision` 真的由人给出，也不能证明它是最优决策；伪造 `confirmed_by` 违反规范，但结构校验无法识别。
- 因此 grill 证据只用于**可追溯性与阶段推进**，不构成审批；审批仍在受保护 SCM 流程与人工审查中完成。

## 与 Specify / Slice 的关系

- Specify 读取已决议问题，把决定写进规格的用户可观察行为、非目标与测试缝隙，不再重复访谈同一决策。
- Slice 使用决议结果确定任务边界与阻塞关系；未决问题不得被“先做起来再定”掩盖。
- 若 Specify 阶段出现新决策，回到 grill 追加问题，而不是在代码里默认选择。

## 失败语义

- 仍有 `open` 问题时 `advance` 失败属于期望行为，不得通过删除问题、改写 `status` 或删除证据绕过。
- 未实现对应校验的运行时，缺失的检查不得被记为通过；以 `dairn work verify` 的实际输出为准。
