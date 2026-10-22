---
id: dairn.engineering.retro
title: 开发会话复盘与环境反馈
summary: 从开发过程中观察检索、工具、约束的真实失误，并将可重复模式转成改善项。
kind: spec
module: engineering
keywords: ["retro", "会话复盘", "开发环境", "Agent 反馈", "工具改进"]
aliases: ["Developer Experience Retro", "Agent Session Retro"]
related: ["dairn.engineering.feedback", "dairn.skills.lifecycle"]
symbols: []
---

# 会话 Retro

## 触发条件

由人显式请求或在重大工程摩擦后进行；普通任务不自动创建复盘。优先读取可证实的会话输出和已有测试证据，避免凭印象推断 Agent 失败。

## 输出内容

按导航错误、缺少机械检查、不可复现的测试、术语混乱、资源过度、无效指令列出可操作的改进候选。机械错误优先加确定性检查，判断性问题优先增强 Review，频繁找错文档先更新 SDCL 指针。

## 权限边界

建议默认不改 `AGENTS.md`、Skills 或治理门禁；涉及长期规则变更时进入常规代码评审。仅有持久设计取舍才需 Agent Note。Retro 不是事故 Postmortem，不能替代用户/组织的批准。
