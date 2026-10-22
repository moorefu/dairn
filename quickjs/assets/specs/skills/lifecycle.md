---
id: dairn.skills.lifecycle
title: Skill 调用策略与生命周期
summary: 用户/模型调用权限、跨客户端元数据一致性及 stable/experimental/deprecated 管理。
kind: spec
module: skills
keywords: ["Skill", "Invocation", "experimental", "deprecated", "生命周期", "路由", "P2"]
aliases: ["Skill Governance", "Skill 调用协议"]
related: ["dairn.governance.core", "dairn.docs.discovery"]
symbols: ["make skills-check", "make skills-list", "make skills-route"]
---

# Skill 合约与生命周期

## 调用权限

`SKILL.md` 的 `disable-model-invocation: true` 表示人显式调用，映射 `agents/openai.yaml` 中 `policy.allow_implicit_invocation: false`。其他 Skill 供模型按任务自动调用；跨产品权限不一致是失败。人调用 Skill 不得通过 Prompt 技巧跨越只允许人直接调用的 Skill。是否调用某能力不等于完成任何风险门禁。

## 生命周期

每个 Skill 通过 `dairn-stage: stable | experimental | deprecated` 声明状态。默认推荐路由只列 stable；实验版本只能在人明确指定下评估，弃用必须提供 `dairn-replaced-by`，不能进入默认路由。元数据与目录/文档同步接受 `make skills-check` 审查。

## 质量与退出条件

引入/升级 Skill 需要真实失败案例或已验证的工程收益，说明触发边界与可观察完成条件；候选可小范围测试，失败可回退。重复能力优先合并，禁止纯粹为了分类增加过多 Skill。稳定 Skill 的行为改变需更新对应文档及 Review；删除弃用 Skill 须检查跨 Skill 引用。
