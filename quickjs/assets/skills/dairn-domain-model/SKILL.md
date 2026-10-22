---
name: dairn-domain-model
description: Use when domain terminology is fuzzy, conflicting, or drifting; define canonical terms and scenarios in a scoped Glossary and preserve durable tradeoffs in Agent Notes only if warranted.
dairn-stage: stable
---

# Domain Vocabulary

读取 `GLOSSARY.md` 和 `make glossary-find Q=...`，对同名多义、概念重叠和业务边界提出具体场景；若无明确业务词汇不创建新文档。

确定词义后在唯一 Glossary 所有者处更新，记录术语、定义和必要的排除表述；不把实现细节或临时迁移计划写入词表。

只有难以逆转、非显而易见且存在真实备选方案的长期决策才创建 Agent Note，其他改变仍按 G0/G1/G2 规则走普通 CI。
