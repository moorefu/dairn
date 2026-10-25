---
id: dairn.project.integrated-v1
title: Runtime、观测、复盘与 PCC v1 实施契约
summary: 固定治理运行时、隔离候选构建、本地观测、单一 Retro v1 和受信必需保障闭环的行为与验收边界。
kind: spec
module: engineering
keywords: ["runtime", "observe", "retro", "PCC", "promotion", "临时构建"]
aliases: ["一体化 v1"]
related: []
---

# 一体化 v1 实施契约

实施依据为 [统一架构提案](../../changes/integrated-v1-proposal.md)。用户已要求在当前分支实现；提案中的平台部署与 Runtime 提升仍是独立操作，文档中的历史平台状态不作为现状证明。

- RT-01：打包只保留发行制品；测试候选在 `.build/runs/<id>/` 私有目录中，完成后清理。普通构建和检查不得写根 `runtime/`、固定 Runtime 或 Lock。
- RT-02：普通 upgrade 不复制载荷；显式 inspect/plan/apply/rollback 绑定来源内容、目标状态和计划摘要，支持事务恢复，未知兼容性拒绝应用。
- OBS-01/02：本地、可关闭、有界事件；CLI 与 Harness 来源独立，未接线为 UNKNOWN。采集失败不改变业务退出码；不记录参数、Prompt、私有路径或自动上传。
- RETRO-01/02：只使用 `dairn.retro.v1`，支持七类改进和 no-action；引用来源、实施与效果验证分别校验，布尔值不提升可信度。同提交不等价，失败率不等于 flaky。
- PCC-01/02：受信策略下限取组织配置与受保护 Base，Head 不能降低本次要求。必需项包含明确执行器、范围、Subject 和计划身份；缺项或来源未知不能 PASS。SCM 与密码学验证结果不得由普通 JSON 自证。

## 验证与交付边界

每批以原提案 RT01–RT10、OB01–OB09、RV01–RV10、PC01–PC14 为验收索引。源码测试证明组件行为，不能声称真实平台已阻止合并。维护者已授权在当前分支集中实现、更新固定运行时，并在本地及 Podman 验收后准备 PR；这不包含修改线上 Ruleset、部署签名服务或发布版本。平台 CI、Windows 实机、性能分位数及 PCC 真实试点故障注入须分别保存实测记录，未运行标为未验证。交付状态见 [分支验收记录](../../changes/integrated-v1-readiness.md)。
