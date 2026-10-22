---
name: dairn-domain-model
description: Use when domain terminology is fuzzy, conflicting, or drifting; drive the shared language from real conversation, maintain a scoped Glossary plus ADRs, and verify structure with Dairn.
dairn-stage: stable
---

# Domain Vocabulary

领域语言由真实对话驱动：Grill、Review、需求讨论中出现同名多义、概念重叠或边界模糊时，就地挑战并收敛，而不是事后补文档。

## 何时更新

1. 对话中出现“一个词指两件事”或“两词指一件事”：给出具体场景与反例，请人裁决。
2. 用户用业务术语描述行为、代码却用另一套命名：把业务词写入 Glossary，作为变量、函数与文件的命名来源。
3. 决策难以逆转、非显而易见且存在真实备选：写入 ADR，或按 `dairn.notes.format` 的规则创建 Agent Note。
4. 只是临时迁移术语或实现细节：不写入词表。

## 写到哪里

- 单一上下文：根 `GLOSSARY.md`，每节一个术语，写定义与必要的排除表述。
- 多上下文 monorepo：根 `GLOSSARY-MAP.md` 指向各上下文自己的 `GLOSSARY.md`；只加载本次改动所属上下文，不加载全部词表。
- 领域决策：`docs/adr/` 或项目约定的 Note 位置；ADR 记录取舍与后果，不重复 Glossary 定义。
- 术语是唯一来源，不在 Skill、代码注释或 Spec 中重复定义；其他位置引用词表。

## 边界与校验

- Glossary 只放长期领域词汇，不把接口字段、临时变量名或实现细节写进去。
- 已有词义与设计意见冲突时，明确提出歧义并请人裁决，不静默重定义。
- `dairn validate` 校验 Glossary 结构（H1、术语节、非空定义、Map 目标有效性）；它不判断术语是否准确。
- 领域语言不构成审批，也不替代 Spec、Review 或受保护 CI。
