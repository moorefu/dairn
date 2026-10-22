---
id: dairn.governance.authority
title: 治理职责与权威顺序
summary: 定义治理角色、Policy、Skill、Profile、Gate、Evidence与人类审批的责任边界。
kind: spec
module: governance
keywords: ["治理", "权责", "审批", "Policy", "AGENTS.md", "ownership"]
aliases: ["治理层级", "权威顺序"]
related: ["dairn.governance.risk", "dairn.ci.gates", "dairn.governance.core"]
symbols: []
---

# 治理职责与权威顺序

## Governance and runtime

Dairn 属于开发治理元层，不属于 OpenResty、Java、Spring Boot 或 Vue 运行时。业务运行时产生的可观测信号不等同于治理审批。AI Agent 的开发结论必须可由他人独立复核。

## 权威层级

1. 组织级 Policy：受保护的安全、合规、审批底线；不可由代码变更自行降级。
2. 仓库级 `AGENTS.md` 与 `.dairn/governance/project.json`：通用行为与风险门禁的声明。
3. 模块级技术 Profile：相关技术特有的限制与工具。
4. 工作流 Skill：操作过程，不拥有运行 API 或最终审批权。
5. 当前技术 Spec：具体接口、数据和行为的权威契约；Agent Notes 只保存设计理由。

遇到冲突应显式上报，严格的安全/组织要求优先；不能用本 PR 内的规则修改批准自己。

## SDCL 在权威链中的位置

SDCL 负责**发现**当前权威规范和选择需要加载的段落，不提升所找到材料的审批权限。SDCL 的组成契约见 [Dairn Core](core.md)，具体加载行为见 [发现规则](../knowledge/discovery.md)。

## 人与工具的权责

Implementer 负责代码、验证与变更声明；Reviewer 独立检查影响；Maintainer 决策架构和兼容；Security Owner 负责安全豁免；Release Owner 批准部署；CI 只提供真实执行证据，不代替审批。L2 必须有适当人类授权。
