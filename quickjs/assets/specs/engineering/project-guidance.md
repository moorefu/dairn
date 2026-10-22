---
id: dairn.engineering.project-guidance
title: 项目文档分层与 Agent 指引契约
summary: 项目 README、AGENTS、PROJECT_GUIDE、专题 Spec 和决策记录如何由 CLI + Skill 共同维护；包括事实来源、权限与冲突边界。
kind: spec
module: engineering
keywords: ["项目文档", "README", "AGENTS.md", "project guidance", "docs", "dairn guide"]
aliases: ["dairn-project-guidance", "项目初始化文档"]
related: ["dairn.governance.distribution", "dairn.docs.discovery", "dairn.notes.format"]
symbols: ["dairn guide plan", "dairn guide audit", "dairn guide scaffold"]
---

# Project Guidance Contract

项目文档是工程事实的导航，而非复制 Dairn 内核规范。开发者资料与 Agent 入口分层：`README.md` 面向人，`AGENTS.md` 面向 Agent，`docs/PROJECT_GUIDE.md` 面向项目工程事实，`docs/specs/` 面向被正式采纳的可追溯契约。

## 生成与编辑权责

`dairn init` 对空目录创建最小 README 与项目指南；`dairn adopt` 只补齐缺失的文档，不改写已有内容。两个项目文档在创建后属于业务团队，**不进入 Dairn 管理文件哈希**。受管理的导航区块、治理入口与 Skill 版本仍由 Dairn lock 保护。

`dairn-project-guidance` Skill 负责读取实际代码和清单后改写人类可读的项目内容，必须区分事实、配置声明、实测结论和未知项。文档变更通过审查 Diff，不得隐含修改风险下限或用文档检查冒充质量检查。

## 校验与失败边界

`dairn guide plan` 只读取信息并建议整理步骤；`dairn guide scaffold` 默认只预览，`--apply` 仅创建缺失的业务文档；`dairn guide audit` 返回结构化缺口与本地 Markdown 链接问题，默认用于报告；`--strict` 将缺口作为失败。核心 `dairn validate` 保持独立，防止团队自维护的文档 TODO 在开发初期误阻断技术门禁。结构治理与技术门禁不得被文档检查替代。

## Observed facts and drift

`dairn guide facts` previews observed manifests, dependencies, entrypoints, build files, module checks and topic Specs. `dairn guide facts --apply` explicitly accepts a project-owned baseline at `.dairn/facts/project-facts.json`. `dairn guide drift` compares that frozen baseline to current facts and names affected README/AGENTS/PROJECT_GUIDE paths, without rewriting docs or refreshing baselines. `--strict` makes unreviewed drift a nonzero CI result.

For `init`, Dairn saves the initial observed fact baseline after files are created. For `adopt`, the team must review the existing project first, then accept a baseline. No facts snapshot proves the documentation is truthful; the agent compares affected prose to actual sources and proposes reviewable diffs.

A protected CI should prefer `dairn guide drift --base <trusted-base> --strict`: it loads the facts snapshot from the trusted Git commit, **not the potentially self-updated snapshot in a PR**. Local `dairn guide drift` compares the current snapshot. A merge reviewer must still inspect whether updated docs accurately reflect source changes; this is a structural detector, not a semantic documentation proof.
