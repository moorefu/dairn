---
name: dairn-grill
description: 设计树访谈阶段。需求、方案或设计仍有未决取舍时使用：先查事实，再逐轮只问前置已定的问题并给出推荐答案，结论写入 .dairn/governance/grills/<task-id>.json，未决问题清零后才进入 Specify。Use when a request, plan, or design needs human decisions settled before specification.
dairn-stage: stable
---

# Dairn Grill

Grill 把“人想要的”和“Agent 准备做的”对齐。它是对话阶段，不是审批，也不是机器证明。

## 何时进入

- `dairn work next <task-id> --json` 报告当前阶段为 grill 时。
- 用户提出新需求、方案、重构或跨模块改动，且存在会影响实现方向的未决选择时。
- 纯机械修改（L0）或已冻结的重复任务可以显式跳过：`dairn work skip <task-id> --reason "<理由>"`；跳过理由会写入账本，不等于已完成访谈。

## 原则

1. **事实归 Agent，决策归人**：仓库、Spec、命令输出能查到的事实自己查，必要时派 subagent 只做检索；不要拿事实问题占用人的时间。
2. **只问 frontier**：把决策画成设计树，只提问“前置决策已定”的节点。依赖本轮其他未答问题的问题属于下一轮。
3. **每问必带推荐答案**：让用户回一个“是”即可接受；推荐理由控制在两行内。
4. **一轮问完 frontier**：编号提问，等用户回答后再计算下一轮；不要边问边改代码。
5. **frontier 清空才算完成**：每条 `open` 问题必须有结论，或被明确记为 out-of-scope；不能静默假设。

## 提问格式

```
❓ Q1 <短标题>：<问题正文，可含选项>
➡️ 推荐：<答案与一行理由>
```

## 输出

写入 `.dairn/governance/grills/<task-id>.json`：

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

- `status` 只允许 `open` 或 `resolved`；`resolved` 必须带 `decision`，`open` 表示尚未决定、不能计入完成。
- 用户未答复的条目标 `open`；把猜测写成 `resolved` 属于伪造决策。
- `confirmed_by` 与 `confirmed_at` 是可选审计字段：建议记录确认者与时间，提供时必须非空；它们不能证明决策真的由人给出。
- 同一阶段重录 `--kind grill` 会替换上一版草稿，便于用已解决访谈覆盖早期未决快照。

## 与阶段契约

- 记录证据：`dairn work record <task-id> .dairn/governance/grills/<task-id>.json --kind grill`。
- `dairn work advance` 在仍有 `open` 问题、schema 或字段不合法时失败；未决问题清零后才进入 Specify。
- Specify 与 Slice 直接消费已决议问题，不再重复访谈同一决策。
- 契约细节用 `dairn docs show dairn.engineering.grill` 加载，不复制正文。

## 边界

- Grill 不替代 Review、不替代受保护 CI，也不构成人工审批。
- 机器只能校验 JSON 结构、`open` 是否清零、证据文件完整性；决策是否真实、是否最优由人与后续 Review 判断。
- 不为每一行代码访谈；提问数量以“是否影响实现方向”为准。
