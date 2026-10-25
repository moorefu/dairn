---
id: dairn.engineering.observability
title: 本地观测事件、来源覆盖与隐私
summary: dairn.observation-event.v1 的白名单事件、独占 JSONL、限额、关闭模式与 UNKNOWN 统计分母；过程观测不能作为 Gate 证明。
kind: spec
module: engineering
keywords: ["observe", "observability", "观测", "Harness", "coverage", "隐私"]
aliases: ["Observability v1"]
related: ["dairn.engineering.retro", "dairn.engineering.feedback"]
symbols: ["dairn observe status", "dairn observe report", "dairn observe trace", "dairn observe ingest", "dairn observe config", "dairn observe compare", "dairn observe suggest", "dairn observe reference"]
---

# 本地观测 v1

初始化项目默认 minimal；`.dairn/observe/config.json` 可设 disabled、minimal、local-full。三个模式均不记录原始参数、Prompt、私有推理或 stderr，不联网上传。local-full 当前沿用 minimal 白名单，未实现额外采集。

入口在命令前后写 dairn.observation-event.v1：唯一 event_id、UTC occurred_at、kind、source、correlation.invocation_id、Runtime 身份、允许的 operation、outcome 与 coverage。CLI 来源固定 local-cli-observed；显式 Harness 导入固定 harness-reported，不能声明自己来自受信 CI。Session 仅保留项目范围哈希，不存原文。诊断仅采集允许的稳定错误码。

事件放 `.dairn/observe/events/YYYY-MM-DD/`，每次独占 .part 文件写入后 rename 为 JSONL。每文件最多 64 KiB、每天最多 512 个文件、保留 30 天；过期文件只在安全路径与已知文件名下清理，遇未知内容拒绝清理。额度或磁盘错误不改变命令退出码；孤立 started、损坏行、partial 文件、读取失败和截断均进入报表覆盖缺口。CLI 写失败在本次 finish 重试记录 observation.collection-gap；仍失败时尝试独占写入一份有界 deferred-gap.json，下次启用采集的调用重试，不覆盖已有待记缺口。报表公开 collection_gaps 与 deferred_gaps；存在缺口时不计算完整首次成功率。整个存储不可写或并发时无法保存所有缺口，不承诺恢复全部丢失数据，也不虚构完整覆盖。

CLI 开始时写独占 .part，结束后合并结束事件并原子改名；中断保留 .part。单次查询最多读取 4096 文件、8 MiB、10000 条事件，达到任一上限报告 truncated。查询排除本次查询调用尚未完成的事件文件。目录自带忽略规则，本地配置也不进入版本控制。

`dairn observe status|report --window 14d --json` 汇总当前可观察样本；window 仅 1d..30d。`trace --invocation <id>` 返回指定调用；`suggest` 只提出 Episode 并要求人发起 Retro。`compare --baseline <id> --experiment <id>` 在缺少可比输入/策略/环境时明确 insufficient-evidence，不推断因果收益。

`dairn observe ingest --provider codex|dsh|claude --stdin` 接收小型宿主事件：kind、invocation_id、可选 operation/session_id/exit_code/status；忽略原始工具参数。支持 launcher.attempt.started/failed/succeeded、harness.session-start/turn-end。可显式提供安全 task_id、完整 subject_commit，以及 64 位 worktree_snapshot_sha256、policy_sha256、plan_sha256、toolchain_sha256、runtime_sha256；缺字段保持未知。独立 Python 事件桥接受同一白名单，或对应命令参数（task_id 用 --task），来源始终为 harness-reported。宿主必须在 CLI 外捕获启动失败；CLI 不能补造未启动事件。没有 Harness 时尝试次数和首次成功率保持 UNKNOWN；部分事件也不能产生完整 Session 分母。

CLI 从 --task 关联安全任务 ID。report 的 task_comparisons 按同任务列出各 provider 的终结样本数、完整绑定数和未知样本数；仅当至少两个 provider 的全部可见样本具有相同操作、Subject、输入、策略、计划、工具链和 Runtime 身份时输出 comparable-description，缺绑定为 UNKNOWN、条件不同为 incomparable。报告只描述已收集样本，不证明全量会话覆盖、平台身份或模型的因果优劣；未关联任务的事件仍只进入总体统计。

首次成功率只统计存在 session-start、声明 complete 的 turn-end、闭合尝试事件且起始时间无歧义的 Session。每个 started 与 failed/succeeded 必须双向唯一匹配，事件均位于该 Session 起止时间内；缺启动或终结、重复终结或越界事件均不能进入完整分母。重试成功不能冒充首次成功。`reference --file <path>` 导入有界的 dairn.ci-observation.v1，只保留仓库引用摘要、运行身份、Head 与状态，来源固定 external-referenced，不能提供 Gate 证明。

观测目录与本地配置属于忽略的过程数据；快照不得因此隐藏已跟踪源码。观测、Episode 与复盘记录均为 local-unattested，不作为 Required Assurance、审批或发布授权来源。p50/p95 开销目标尚需各平台实测。
