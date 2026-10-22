---
id: dairn.notes.format
title: Agent Notes 规范格式
summary: Agent Note 严格四行文件头及 proposed/implemented/rejected 必需章节与禁用章节。
kind: spec
module: notes
keywords: ["Agent Note", "格式", "Status", "Problem", "Proposal", "Decision", "Alternatives considered"]
aliases: ["note-format", "Agent Note格式"]
related: ["dairn.notes.lifecycle"]
symbols: ["Status: proposed", "Status: implemented", "## Alternatives considered"]
---

# Agent Notes 规范格式

## 文件头

活动 Note 前四行严格为：第一行 `# Agent Note: <title>`，第二行空行，第三行为与目录一致的 `Status:`，第四行空行。正文第一个 H2 必须是 `## Problem`。代码围栏内的标题和 Status 不参与解析。

## 必需章节

- `proposed`：`Problem`、`Proposal`、`Alternatives considered`、`Acceptance criteria`、`Risks`。
- `implemented`：`Problem`、`Decision`、`Alternatives considered`、`Consequences`；禁止 `Proposal`、`Plan`、`Migration plan`、`Acceptance criteria` 这些提案时期标题。
- `rejected`：`Problem`、`Proposal`、`Alternatives considered`；`Status: rejected — <one-line reason>` 必须说明否决原因。

`Alternatives considered` 只保留真实讨论过的替代方案以及放弃理由，不能为了通过门禁凭空制造。状态目录和状态行必须对应，禁止无意义的格式性空章节。

## 分类与命名

路径格式 `.agents/notes/{proposed|implemented|rejected}/{class}/YYYY-MM-DD-topic.md`。Dairn 使用官方六类和扩展 `security` 分类。日期为首次提出日期，不随状态迁移变化。

参考 [Agent Notes 生命周期](../notes/lifecycle.md)。
