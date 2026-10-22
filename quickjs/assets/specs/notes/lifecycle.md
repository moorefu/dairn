---
id: dairn.notes.lifecycle
title: Agent Notes 生命周期与封存
summary: Note 何时新增、如何变更状态、如何处理取代、交叉引用及不可变归档。
kind: spec
module: notes
keywords: ["notes", "Agent Note", "生命周期", "proposed", "implemented", "rejected", "archived", "封存", "哈希"]
aliases: ["note-lifecycle", "Note归档", "Agent Note 归档"]
related: ["dairn.notes.format"]
symbols: ["make notes-check", "make seal-archive"]
---

# Agent Notes 生命周期与封存

## 何时新增 Note

仅在设计动机、真实替代方案、损失、边界条件或负面保证具有长期价值时新增 Note；局部机械变更免除。Dairn v1.5.1 不再按 L2 一律强制 Note；仅对具有持久设计取舍的变更强制记录。L2 仍需真实人工审批。

## 生命周期迁移

- `proposed → implemented`：改变目录和 Status，改写为已经交付的 Decision 与 Consequences；不得保留未来计划或验收待办描述。
- `proposed → rejected`：保留提案结构，状态行写明具体拒绝原因。
- 决策被改变必须新增 Note，相互交叉链接；只有完整吸收旧 Note 的独特理由时才能删除。部分取代双方仍保持活跃和交叉引用。

## 已实施记录的事实维护

当代码路径、实际字段名、默认值变化时，负责决策的已实施 Note 的事实部分随代码调整；不得借事实更新悄悄改写原始决策依据。

## 归档的不可变保证

只允许已实施且不再指导未来工作的 Note 进入 `archived/<class>/`，并插入 `Archived: YYYY-MM-DD`。先运行受保护的归档命令登记哈希，后续永久冻结，不能修改正文、翻译、移动或删除。受信任的 Git 基线用于证明旧 manifest 不变。归档不再是当前行为的权威来源。

活动 Note 仍按官方原则不建立手工集中 INDEX；当前 Spec 的自动化检索索引与 Agent Notes 生命周期目录互不冲突。
