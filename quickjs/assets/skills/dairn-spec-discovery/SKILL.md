---
name: dairn-spec-discovery
description: Dairn Core 正式规则发现阶段；在架构、设计、实现、评审或调整治理规范时，通过稳定 ID 按需加载权威 Spec，控制上下文并校验索引。
dairn-stage: stable
---

# Specification Discovery / Context Loading

这是 Dairn Core 的必需能力，正式归属与失败规则见 [`docs/specs/governance/core.md`](../../../docs/specs/governance/core.md)；本 Skill 提供执行步骤，不重述或覆盖规范。

## 任务入口

1. 不直接完整读取 `docs/GOVERNANCE_SPEC.md` 或 `docs/specs/` 全树。根 `AGENTS.md` 提供入口，运行 `dairn docs find "本次变更涉及的主题或字段"`；结果只含元数据。
2. 优先稳定 ID / 精确符号 / 别名；匹配多条时依所属模块、标题、summary 和 section 选择，而非凭排名猜测。
3. 加载命中的单份 Spec：`dairn docs show dairn.notes.format`。如果文档过长，检索后只阅读所需章节；现版 `dairn docs show` 输出单份全文，暂不支持 `SECTION` 参数，不能把旧 Makefile 语法写成可用命令。
4. 若需要完整设计理由，按关联关系去 `.agents/notes/` 查现行 Note；不要把历史归档当作当前规范。`related` 只提供引用，不自动递归加载。
5. 搜索无结果时可补充仓库代码 / `rg` 精确搜索；不能虚构 Spec 或从被归档的决策直接推断当前行为。

## 修改与检索维护

主题文档顶端维护 `id, title, summary, kind, module, keywords, aliases, related`，必要时追加 `symbols`。ID 与文件路径解耦；改变主题路径不能改 ID 的语义。新文档不能复制其他主题的完整规则，使用 `related` 和相对链接引用。

如果原 Spec 包含多个独立审查/演进单位，拆成按职责归属的主题文档；旧入口只保留导航。每次修改运行 `dairn validate`，再验证至少一项真实问题关键词和精确 ID 都能找到正确文档。

## 强制边界

文档检索能力不具有技术验证或发布审批权。普通检索先返回元数据，全文仅显式请求后加载；不可把模型曾经看到的摘要当作真实当前契约。

## Optional domain vocabulary

If the query is about domain semantics, consult 项目自己的 Glossary（如存在） after precise topic discovery. Glossary definitions disambiguate terms but do not replace the authoritative Spec; for monorepo use the owning context declared in GLOSSARY-MAP.md and avoid loading every glossary. Use short context pointers, not duplicated rules.
