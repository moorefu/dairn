---
name: dairn-retro
description: 人工显式发起，基于真实 Episode 提出七类环境改进，以回放、可比样本和副作用评估检验收益；无证据时允许无建议。
dairn-stage: stable
disable-model-invocation: true
---

# Agent 开发复盘

只在人显式请求时执行。读取 `dairn.engineering.retro`，核对实际会话、测试、观测事件和 SCM 引用；先查已有检查是否未接线，避免重复制造机制。

使用单一 `dairn.retro.v1`，findings 可独立提出 check、review-standard、navigation、tooling、harness-integration、information-access、prune。没有值得改善的内容用 no-action；资料不足用 insufficient-evidence；两者 findings 为空。

每项必须有可定位来源、可证伪假设、具体动作、验证方法和安全约束。人工接受、实施提交、机制回放与长期效果分别记录；旧 schema 1 草案须补齐来源后显式迁移，不复制 verified_red 布尔值充当证明。

check 用真实 red/green Run 与日志摘要；其他动作使用真实回放记录；effective 需要可比输入、样本、限制和副作用。不能由绿色 PR 推断 KPI 已改善。同 Commit 不等于同输入，高失败率不等于 flaky。

记录仍用 `dairn work record <id> <path> --kind retro`。本地记录不认证人类、不升级证据，不允许复盘自动改 Runtime、Policy、Gate 或 Required Check。涉及规则删改进入常规独立审查，允许无收益的改进被撤销。
