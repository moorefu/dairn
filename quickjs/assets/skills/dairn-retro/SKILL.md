---
name: dairn-retro
description: Explicit retrospective of AI-assisted development: inspect observed failures, navigation friction, missing tests and automation; propose scoped improvements before policy edits.
dairn-stage: stable
disable-model-invocation: true
---

# Agent Development Retro

人工显式发起：从指定的 PR、会话、测试和流水线日志出发，列出实际发生的摩擦并按严重度排序。

检查 SDCL 定位错误、Glossary 歧义、无效/重复测试、缺少静态检查、慢命令、反复失效的 Skill 触发。

区分机械错误（优先添加可执行门禁）和判断问题（加强 Reviewer）。若需要变更 `AGENTS.md`、Skill 或 CI，必须提交普通治理 PR；不自动写入永久规则。输出少量可验证候选，复盘本身无需 Agent Note。

## Only evidence-backed environment improvements

Ground proposals in actual failed commands, difficult navigation, incorrect instructions or missing verification from a real session. Prefer a fast, deterministic check over another AGENTS paragraph. Do not create new Skills for problems existing Skills already cover; users explicitly invoke this retrospective.
