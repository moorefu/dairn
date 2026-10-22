---
id: dairn.knowledge.glossary
title: Glossary 与上下文词汇发现
summary: 保持项目和模块术语清晰，绑定 SDCL 和开发评审的常用术语。
kind: spec
module: knowledge
keywords: ["Glossary", "术语", "上下文", "domain", "context pointer"]
aliases: ["领域术语", "领域模型词汇"]
related: ["dairn.docs.discovery", "dairn.engineering.tasks"]
symbols: ["make glossary-check", "make glossary-find"]
---

# Glossary 与上下文发现

## 权威与布置

默认一个根 `GLOSSARY.md`；大型 monorepo 可选 `GLOSSARY-MAP.md` 路由到不同局部 Glossary。术语是领域词义的唯一来源，不是技术接口规格或设计历史。已有词义与设计意见冲突时，应明确提出歧义而不是偷偷重定义。Glossary 适用于长期领域词汇，非每个临时术语。

## 低成本校验

`make glossary-check` 校验标题结构、重复术语、非空定义和 Map 目标有效性；`make glossary-find Q=...` 查询。未采用 Glossary 的仓库不受影响。Map 不得循环引用或包含仓库外路径。
