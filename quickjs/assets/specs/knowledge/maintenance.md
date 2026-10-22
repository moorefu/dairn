---
id: dairn.docs.maintenance
title: 文档维护、迁移与完整性检查
summary: 规定主题 Spec 迁移、单一权威、兼容入口和新旧路径审查。
kind: spec
module: knowledge
keywords: ["文档", "迁移", "重命名", "断链", "维护", "索引"]
aliases: ["docs-maintenance", "文档拆分"]
related: ["dairn.docs.discovery"]
symbols: ["docs-check", "docs-index"]
---

# 文档维护、迁移与完整性检查

## 修改流程

新增一个主题时，先确认已有文件是否拥有相同概念；找到归属模块，再决定是否扩展旧文档或创建新文档。新文件要添加稳定 `id` 和检索关键词，并声明真实 `related` 关系。

## 迁移规则

拆分大 Spec 时，应将规范性文字迁至新叶子文档，旧入口改为小型导航页并链接到新位置；不得让旧总览保留冲突的另一份规范正文。跨文件引用优先稳定 ID（供 CLI），Markdown 链接用于人类浏览。

## CI 校验

`make docs-check` 拒绝缺失元数据、重复 ID、重复别名、未知关联 ID、非法模块或章节定位冲突。`make validate` 和 `make gate` 会执行相同的发现层检查。变更主题/路径应附 `make docs-find` 的检索结果，证明新文档可被准确发现。

`make docs-index` 仅生成缓存供工具使用，不应要求在 PR 提交缓存；`make docs-find` 即使缓存被删也能工作。大文档警告与上下文预算分开：单篇不能被上下文工具偷偷裁断。

## 验证的边界

机器能证明元数据完整和 ID 链接存在，却不能自动证明文档事实正确、跨文件内容没有语义重复、别名覆盖了所有自然语言表述。语义审查仍属于维护者。
