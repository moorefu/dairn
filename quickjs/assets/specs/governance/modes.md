---
id: dairn.governance.modes
title: 按风险触发的轻量化治理模式
summary: L0-L2 技术门禁与 G0-G3 流程深度独立判定，主记录复用与按条件留痕，不允许绕过强制质量要求。
kind: spec
module: governance
keywords: ["轻量化治理", "治理裁剪", "按需治理", "G0", "G1", "G2", "G3", "流程瘦身", "强制升级"]
aliases: ["adaptive-governance", "轻量化评审", "治理模式", "G0/G1/G2/G3"]
related: ["dairn.governance.risk", "dairn.governance.lifecycle", "dairn.notes.lifecycle", "dairn.ci.gates", "dairn.operations.traceability"]
symbols: ["dairn scope --base", "dairn check --base", "dairn validate --base"]
---

# 轻量化治理模式与触发条件

## 两轴独立

代码风险 L0/L1/L2 决定验证门禁，治理模式 G0/G1/G2/G3 决定流程深度。可识别的安全、鉴权、协议、持久化、状态机和治理基础设施等改动至少 L2；未知影响必须由审查者升级。目录/文件名检测只是下限，无法证明代码内容完全安全。PR/MR 里的 L0 声明不能覆盖下限；可信 CI 和人类 Reviewer 负责补足语义检查。

- G0：纯文档、机械变更；保留 Git/PR（按仓库策略）和适用静态检查。
- G1：普通功能、局部修复；PR/MR、真实 lint/unit 及受影响的契约测试，不生成多余运行记录。
- G2：协议、安全、兼容、架构或高影响变更；L2 检查与人工审批，只有出现长期有用的设计理由时才创建 Agent Note。
- G3：SEV1/SEV2 或其他重大事故；允许先授权止损，之后必须保留影响、恢复、观察、复盘和可跟踪改进。

## 变更主记录与留痕

优先使用已有 PR/MR 的变更原因、测试和审查作为主记录；没有 PR 的本地运行仅依据 Git 提交和路径产生**临时、未经审查**的分类。CI 中的 PR/MR 模式必须读取平台事件提供的元数据，不允许缺失时默默采用 Git fallback。Manifest 为可选附件，不能同时创造多个相互冲突的主记录。L2 PR/MR 必须明确 `Durable decision: yes/no`：`yes` 时必须提供有效的 Agent Note 相对路径；`no` 时仍需 Reviewer 确认该判断是否合理。Manifest 的 `durable_decision` 布尔值采用相同语义，遗留 Manifest 如提供 `decision_note` 则默认视为 true。

运行反馈优先复用已有监控事件、Issue、Incident 平台和 CD 记录。独立责任、状态机或留存需求才创建 FB/INC/BUG/REL/ACT。一个普通 Bug 不强制建立对应五种记录；G3 严重事故的复盘及行动项在事故关闭前必需。已建立的本地记录仍按原有严格状态机、历史和终态校验执行。外部引用不构成自动核验证据，尤其不能用 URL 直接使本地生产 BUG/REL 进入 accepted/closed。

## 绝不允许裁剪

风险对应的强制技术检查、当前 SHA 绑定、真实人工审查、生产部署与观察事实、应急授权、重大事故复盘与行动项、已经提交的不可改写历史均不可删除。治理 CLI 对规则自身的修改不能提供独立的授权保证：组织还需使用受保护分支、代码所有者审查、可信 Runner 和最小权限配置。任何“跳过测试”“自行审批”“未部署即关闭生产 Bug”等情况都必须拒绝。

## 使用方式与局限

运行 `dairn scope --base <verified-ref>` 得到 `risk`、`governance_mode`、原因、适用门禁与条件性记录；`dairn check --base <verified-ref>` 实际执行完整必需命令。`.dairn/governance/project.json` 中配置的单项 lint/unit argv 仍不能代替完整门禁。仅有运行账本或文档变化而不命中业务代码模块时，仅执行适用静态与终态门禁，不虚构不存在的技术栈测试。静态路径识别不能理解任意代码的业务语义；人工 Reviewer 有义务在发现更高风险时升级。当前版本没有连接外部 Issue/CD 系统去校验真实性：跳过重复本地记录是基于组织级记录系统的事实和审查，不是自动验证了外部链接。
