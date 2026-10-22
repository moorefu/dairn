---
name: dairn-skill-maintenance
description: Explicit Skill lifecycle governance: review observed failures before promoting, deprecating or replacing skills; verify cross-client invocation policy and router visibility.
dairn-stage: stable
disable-model-invocation: true
---

# Skill Lifecycle Maintenance

由人显式启动。读取 `dairn.skills.lifecycle` 和 Skill 入口，审查真实使用失败、重复能力、误触发、可观察完成条件和发布支持情况。

新实验能力标记 `dairn-stage: experimental`，默认 route 不推荐；已有稳定能力标记 stable；弃用标记 deprecated 且注明替代技能，不删除历史使用者仍需要的引用。

通过 `make skills-check` 检查每个客户端权限声明一致，再做定向行为测试、Skill 文档和 PR Review。不要因添加技能数量好看而新增 Skill。
