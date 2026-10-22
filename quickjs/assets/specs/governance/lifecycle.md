---
id: dairn.governance.lifecycle
title: 开发运行反馈与缺陷修复闭环
summary: 定义从开发、验证、发布、运行反馈、事故和 Bug 复发测试再回到下一轮开发的闭环及其可审计条件。
kind: spec
module: governance
keywords: ["开发闭环", "生产反馈", "Bug修复", "运行反馈", "故障反馈", "回归", "复发", "postmortem"]
aliases: ["Dairn 开发运维闭环", "devops feedback loop", "开发-运维-修复循环"]
related: ["dairn.governance.core", "dairn.governance.modes", "dairn.operations.traceability", "dairn.operations.feedback", "dairn.operations.incident", "dairn.operations.defect", "dairn.operations.release"]
symbols: ["dairn validate --base", "dairn check --base"]
---

# 开发—验证—运行—反馈—修复闭环

## 生命周期图

```text
需求/变更 → 设计及必要的 Agent Note → 开发 → 本地验证 → CI 门禁
    ↑                                                  ↓
修复任务 ← Bug Case / 改进行动 ← 运行反馈 ← 发布/部署/观察
    ↑                                  ↓
回归测试 ← 故障诊断 ← Incident / Postmortem
```

生产事故**先止损**，无需等待架构决策文档或完整 CI；修复代码合并与重新发布仍须遵守安全和审批规则。反馈不只源于运行日志，还包括用户、运营、人工观察、测试和支持渠道。

## 按需记录，不是五种记录都必须创建

常规任务复用 PR/MR、Issue、事故管理或 CD 发布记录，只有拥有独立状态机、负责人或审计边界时才在本地创建对应记录。`dairn validate --base <ref>` 验证已有本地记录及必要的事故终态，不要求每个变更都创建五种记录；详见[轻量治理](modes.md)。

## 五种记录及职责

- **Feedback**：观察到什么，何时观察、信号与影响，是否需要 Bug/Incident/Action。
- **Incident**：事故影响、处置过程、恢复/观察、复盘和后续改进；严重度与 Bug 优先级独立。
- **Bug**：可复现行为、缺陷归因、修复 PR/提交、回归测试、部署后观察。一个事故可关联多个 Bug；一个 Bug 可关联多个事故。
- **Release**：构建制品、门禁、部署、回滚、观察与生产准入结果，区分代码合并和实际部署。
- **Action**：事故根因纠正、安全加固、测试补齐、监控修复等可跟踪改进，具备 owner 和结案依据。

重大事故的 **Postmortem** 是独立复盘文档，永久设计决策才进入 **Agent Notes**；上述事件记录和运行日志不能冒充决策 Note。详见[留痕格式](../operations/traceability.md)。

## 闭环完成条件

1. **开发完成**：代码、必要规格、测试、PR/MR（或可选变更声明）及 CI 结果相互关联；CI 通过不代表部署完成。
2. **发布完成**：制品摘要、部署证据、观察结果与回滚方案可追踪；发布前审批由可信系统裁决。
3. **故障恢复**：服务已恢复或被安全隔离，并观察稳定性；可先将 Incident 标为 resolved，长期纠正工作由 Bug/Action 继续跟踪。
4. **Bug 修复关闭**：回归测试确实运行、修复可定位；生产缺陷还需关联实际部署版本与部署后观察。
5. **组织改进**：重要事故复盘产生 owner 明确的 Action，关闭必须有完成/豁免依据；重复事故触发重新评估设计、测试和告警。

不能要求所有 Action 都完成后才能恢复服务或关闭处置流程；但必须保留未完成事项的责任人和追踪关系。

## 权限和反造假边界

本地记录只保存版本库中的结构化留痕（按规范手动写入 JSON/Markdown，没有专门的 CLI 状态迁移命令），不会连接监控系统、验证外部链接真实性、自动批准发布或操作生产环境。记录中的 `actor` 只是提交者声明，不能替代 Git/工单系统身份验证。可观测系统/事件系统是外部事实来源；仓库保存经过脱敏的引用、状态历史与纠正措施。真实的权限、隔离、审计留存和发布权限必须由受保护仓库及外部平台落实。
