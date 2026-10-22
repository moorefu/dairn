---
id: dairn.governance.core
title: Dairn Core 组成与能力契约
summary: 规定治理核心组成、SDCL 正式地位、规则发现与验证的职责边界和接入要求。
kind: spec
module: governance
keywords: ["Dairn Core", "SDCL", "治理核心", "规范发现", "核心架构", "按需加载"]
aliases: ["Dairn Core 架构", "治理核心组件", "SDCL Core"]
related: ["dairn.docs.discovery", "dairn.docs.maintenance", "dairn.governance.authority", "dairn.ci.gates", "dairn.governance.lifecycle", "dairn.governance.modes"]
symbols: ["make docs-check", "make docs-find", "make docs-show"]
---

# Dairn Core 组成与能力契约

## 正式组成

Dairn Core 包含：治理职责与风险规范、按需触发的 G0-G3 治理模式、Agent/人类权限边界、Agent Notes 决策约束、**Specification Discovery & Context Loading（SDCL）**、质量门禁及证据契约、**运行反馈与持续修复闭环**。Workflow Skills 与 Technology Profiles 使用这些能力；业务运行时（如 OpenResty、Spring Boot、Vue）不执行开发治理。

本文件只负责核心组件的归属，不重复各组件的完整规则。当前权威说明分别见 [职责与权威](authority.md)、[SDCL 发现规范](../knowledge/discovery.md)、[文档维护规范](../knowledge/maintenance.md) 和 [门禁与证据](../ci/gates.md)。

闭环全过程的反馈、事故、缺陷、发布和纠正措施参照[全生命周期规范](lifecycle.md)，当前事实与持久决策分开留痕。

## SDCL 的必需职责

1. **Discover**：任何依赖规范判断的实现、评审或设计工作，先按任务主题、规范 ID 或符号查找；首次返回轻量元数据，不批量读取所有 Spec。
2. **Resolve**：通过稳定 ID 选择权威主题；查询冲突时列出候选并显式消歧，不把第一项排名等同权威。
3. **Load**：使用单篇或单章节加载；超预算时要求缩小范围，不静默截断规范性文本。
4. **Trace**：跨主题仅保存关系和引用；Agent Notes 解释决策理由，不冒充当前规范。
5. **Validate**：文档元数据、ID 唯一性、关联、相对链接和关键查询回归必须通过 `make docs-check`；该校验是 `make validate` / `make gate` / `make ci` 的必需前置条件。

## 权威与失败语义

SDCL 是**规则发现与上下文选择层**，不是新的审批机关、规则副本或可信计算边界。它不能覆盖组织级安全要求、仓库治理政策、代码行为或真实 CI 结果。

发现失败或含糊时，不得推断未找到的规范已不存在：对依赖该规范的决策应继续定位源代码、正式文档或请求维护者裁定；普通检索不因此修改运行时状态。脚本和索引不可私自更改风险等级、授予豁免或声称测试通过。

## 接入和验收

Dairn 发行版必须同时提供根目录发现指引、`dairn-spec-discovery` Skill、受版本管理的主题规范、`scripts/docs.py` 及统一 Makefile 命令。索引缓存可以删除重建，**源文档是唯一权威**。修改核心规范时，至少加入或更新一条真实任务用语到稳定 ID 的查询回归，再执行 `make docs-check` 和所需的完整门禁。
