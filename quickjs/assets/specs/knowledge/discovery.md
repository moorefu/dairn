---
id: dairn.docs.discovery
title: 规格文档索引与渐进加载
summary: 定义文档单一权威、主题切分、ID、Frontmatter 索引、检索排序和上下文预算。
kind: spec
module: knowledge
keywords: ["文档索引", "检索", "Spec拆分", "渐进加载", "context", "metadata", "semantic"]
aliases: ["SDCL", "Spec Discovery", "文档查找"]
related: ["dairn.docs.maintenance", "dairn.governance.authority", "dairn.governance.core"]
symbols: ["make docs-find", "make docs-show", "make docs-context"]
---

# 规格文档索引与渐进加载

本机制是 Dairn Core 的必需能力，核心组成由 [Dairn Core 契约](../governance/core.md) 确定；本篇是具体检索与上下文加载规则的唯一权威说明。

## 文档职责分层

`AGENTS.md` 给出常驻开发约束和发现入口；`docs/specs/<module>/<topic>.md` 保存当前可验证的规范；Skill 定义操作步骤；Agent Notes 保存不可从当前代码直接获得的长期决策理由；Runbook 是操作指引；测试/CI 证明执行事实。

每项规范性事实应有唯一权威文件。跨文件链接到它，而不是重写相同正文。历史 Note 不能与当前 Spec 混成同等优先级的检索结果。

## 拆分边界

按模块所有者、接口语义和独立审查单元拆分，建议单份主题文档 400–1200 词。硬切分行数/Token 容易切断不变量；很长但不可分割的 Schema 可保留并使用小节精确加载。

## 文档元数据

每个 Spec 在文件顶端维护轻量 YAML Frontmatter：`id`（永久逻辑身份）、`title`、`summary`、`kind`、`module`、`keywords`、`aliases`、`related`，可选 `symbols`。`id` 对路径迁移保持稳定，别名帮助兼容旧搜索词。正文只有当前事实，不维护全量目录副本。

索引基于文件自身元数据自动生成到 `.dairn/governance/cache/`，它可丢弃、可重建、不能作为权威源。每次查询直接检查真实源文件，保证索引不会因缓存陈旧而误导。

## 渐进查找协议

1. 用 `make docs-find Q='关键词或规范ID'` **只返回元数据**和相关性解释。
2. 如果有多个高分候选，先选择 ID/模块，不强行加载一个错误结果。
3. 用 `make docs-show ID=dairn....` 加载确切正文；长文档选择 `SECTION=...` 进一步限制上下文。
4. 需要快捷路由用 `make docs-context Q='...'`；歧义时只列候选，单篇超出预算时报错并提供可选择章节，**不静默截断规范内容**。
5. `related` 只提供关联 ID，不自动递归加载；实现/测试/历史理由按需另查。

## 当前限制

v1 检索优先精确 ID、别名、配置符号，再利用关键词、标题、章节、正文词法打分；不承诺语义向量召回。复杂中文同义词查询依赖别名/关键词；没有结果时使用全文搜索并明确未命中，不虚构文档。

知识检索不属于审批机制；它只决定找到哪里，门禁和可信代码仍独立。
