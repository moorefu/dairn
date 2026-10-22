---
id: dairn.engineering.work-execution
title: 可恢复的 AI 工程任务执行记录
summary: Dairn work 命令记录任务阶段、Skill 路由、证据 kind 与证据摘要；规定阶段判据、revision 并发、取消与重开，但不替代 Agent、真实检查和人工批准。
kind: spec
module: engineering
keywords: ["task", "work", "resume", "evidence", "grill", "retro", "tasks", "任务", "恢复", "工作流"]
aliases: ["dairn work", "task ledger"]
related: ["dairn.engineering.launcher", "dairn.engineering.workflow", "dairn.engineering.review", "dairn.engineering.grill", "dairn.engineering.hooks"]
symbols: ["dairn work start", "dairn work verify"]
---

# Work Execution Contract

`dairn work` 是**持久化过程记录器**，不是 Agent 调度器。一个任务有稳定 ID、分类、顺序阶段、当前 Skill 与状态。简单任务按推荐路由跳过不适用阶段；多会话通过 `.dairn/work/<id>.json` 恢复上下文。CLI 不自动执行 AI，不声称人类已审批。文件由项目所有，不参与核心运行时的受管理文件哈希。调用入口是项目 launcher，本文中的 `dairn` 是它的简写；`dairn work next` / `status` / `verify` 返回 `invocation` 块给出 posix、windows 与 doctor 命令，解析顺序、vendored 运行时与安全边界见 [launcher 契约](launcher.md)。

## 生命周期

- `dairn work start <title> --id <id>`：新建任务，返回第一个阶段；重复 ID 拒绝覆盖。
- `dairn work list`、`dairn work status`、`dairn work next <id> --json`：输出阶段、Skill、已记录证据和下一步，不改变状态。
- `dairn work record <id> <path> --kind <kind>`：仅接收仓库内现有证据文件并记录 SHA256；拒绝符号链接、越界、空文件和超大制品；不保证该证据是真实的执行记录。
- `dairn work verify <id>`：重新计算证据 SHA256；证据丢失或被修改时失败。`--require-machine-gates` 要求当前 HEAD 有通过的机器门禁运行；`--require-session-anchor` 要求该任务至少登记过一个会话锚点；`--require-review-actor`（或环境变量 `DAIRN_REQUIRE_REVIEW_ACTOR=true`）要求最后一条 review 证据带非空 `actor` 声明。
- `dairn work advance <id>`：当前阶段满足证据与阶段判据才可前进一步。
- `dairn work skip <id> --reason "<原因>"`：显式跳过规划类阶段（orient/grill/diagnose/specify/slice/reflect），保留跳过理由；implement/review/synchronize 等证据阶段不可跳过。
- `dairn work cancel <id> --reason "<原因>"`：关闭活跃任务并保留已有证据与历史；取消不是删除。
- `dairn work reopen <id> --reason "<原因>"`：从取消或 `recorded-complete` 状态恢复任务，保留原证据并要求重新满足当前阶段规则。
- `dairn work finish <id>`：只有最后阶段才能完成，结果为 `recorded-complete`，不是生产或审查批准。

## 证据 kind

`--kind` 只接受：`note`、`test`、`review`、`spec`、`document`、`machine-evidence`、`grill`、`retro`、`tasks`。把一类证据冒用为另一类（例如用 `document` 冒充 `review`）不构成满足阶段判据。

## 阶段判据

| 阶段 | 运行时判据 |
| --- | --- |
| orient | 至少一份证据；建议 `document` 或 `note`，不强制 kind |
| grill | `--kind grill`；schema 1、task_id 匹配、questions 非空且逐字段合法；推进时不得存在 `open` 问题 |
| diagnose | 至少一份证据；建议 `test` 或 `document`，不强制 kind |
| specify | `--kind spec`；且 grill 阶段已完成或显式跳过（若任务包含 grill）；JSON 规格须有非空 `acceptance` 数组 |
| slice | `--kind tasks` 或 `--kind note`；`tasks` 证据须通过任务对象校验 |
| implement | `--kind test` 或 `machine-evidence`；推进需要当前 HEAD 有通过的机器门禁运行 |
| review | `--kind review`；`standards` 为 pass|fail、`spec_fidelity` 为 pass|fail|not-applicable、`head` 为当前提交；失败结论可记录留痕，但 `advance` 只接受 `standards=pass` 且 Fidelity 不为 fail；Fidelity 为 pass 时必须给出已存在的 `docs/specs/*.md` 作为 `spec_ref`；若任务包含 implement 阶段，还需当前 HEAD 有通过的机器运行；可选 `actor` 为 self-asserted 审查者声明，不认证身份 |
| synchronize | `--kind document`；JSON 含 `status`、当前 `head`、非空 `reviewed_docs` 与不少于 10 字符的 `reason`；若任务包含 review 阶段，该阶段必须已完成 |
| reflect | `--kind retro`；schema 1、task_id 匹配、`observed` 非空、`resolution.kind` 取 check|standard 且字段完整 |

普通变更的阶段是 `orient → grill → specify → slice → implement → review → synchronize`；`diagnose` 是缺陷/事故变体的阶段，`reflect` 仅属于事故变体流程，下表只描述各阶段自身的判据，不代表每种分类都会经过全部阶段。

grill 证据是**活的 frontier**：同一阶段重录 `--kind grill` 会用新草稿替换上一版，便于用已解决访谈覆盖早期未决快照。

review 证据可带可选 `actor`（不超过 200 字符）：优先级为 `review.actor` > `--actor` > `DAIRN_ACTOR`，记录时写入证据条目的 `actor` 字段。它只是**提交者声明（self-asserted）**，机器仅校验非空与长度，不做身份认证；真正身份与批准来自 PR 平台、受保护 CI 与人工审批。

## revision 与并发

- 任务账本带单调递增的 `revision`；每次记录证据或推进阶段都会改变它。
- 每个写操作先取 per-task 锁，再按读取时的 revision 做 compare-and-swap；另一个会话已推进时报 `Task changed concurrently; retry`，不覆盖更新状态。
- 锁文件 `.dairn/work/.<id>.lock` 超过 10 分钟视为崩溃遗留，CLI 会回收一次再重试；仍不可获取时报清晰错误而不是静默跳过写入。
- 多个 Agent 会话可以并行工作，但各自只记录自己的证据文件；覆盖、重置或删除他人账本属于违规。
- 证据以 SHA256 绑定内容；同一路径文件被修改后旧记录失效，需要重新记录。
- HEAD 变化后，review、synchronize 与机器门禁证据视为过期，重新执行后才能推进。
- 受保护构建在受保护分支上执行 `dairn check --task`，要求账本中的任务仍处于 active implement 阶段，且 review/synchronize 证据的 `head` 等于当前提交。因此合并产生新提交后，不要把本地 review/sync 证据带进受保护构建的检出；推荐让账本在合并时停在 implement active，签名完成后再补记本地流程状态（详见仓库治理指南的受保护 CI 一节）。
- 显式跳过的规划阶段记录在 `skips[]`，不会伪造证据；跳过理由随账本保留。

## 会话锚点

`dairn hook turn-end` 会把会话锚点登记到账本 `session_anchors`，记录路径、SHA256、provider、session_id、HEAD、event 与时间。锚点是 local-unattributed 过程证据，不提升信任级别；字段与失败策略见 [hooks 契约](hooks.md)。

## 安全边界

项目任务文件不得自我引用为证据；不执行证据文件，不信任未经验证的用户声明。Dairn work 文件不作为质量门禁的可信授权输入。所有测试与门禁仍必须独立执行 `dairn validate`、`dairn check`，并在受保护的 CI 与人工审批中完成合并决策。
