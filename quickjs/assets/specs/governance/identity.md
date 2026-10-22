---
id: dairn.identity.positioning
title: Dairn 产品定位和组件边界
summary: Dairn 产品名称、AI 工程工具套件定位、模块职责和安装命名约定。
kind: spec
module: governance
keywords: ["Dairn", "AI-Native Software Engineering Toolkit", "产品定位", "工程指导", "AI Agent"]
aliases: ["Dairn", "Dairn 全称", "Dairn 是什么", "Dairn 名称", "Dairn 定位"]
related: ["dairn.governance.core", "dairn.governance.distribution", "dairn.docs.discovery", "dairn.skills.lifecycle"]
symbols: ["dairn --version", "dairn init", "dairn check"]
---

# Dairn — AI-Native Software Engineering Toolkit

Dairn 是面向 AI Agent 和开发者的软件工程工具套件，提供按需开发指导、项目规范检索、代码评审、测试反馈和可追溯治理能力。名称为独立产品品牌，不是字母缩写。

## 模块边界

- **Guidance**：Skills、技术栈适配、开发者工作流与调试实践。
- **Knowledge**：SDCL、术语表、Specs 与 Agent Notes 的当前权威与历史决策。
- **Governance Core**：风险分级、质量门禁、证据和审计留痕，是产品的子系统。
- **CLI**：`dairn init/adopt/doctor/check/upgrade/skills/docs`，独立安装，不需要将治理引擎复制入业务仓库。

## 安装和配置命名

Python distribution/package 与 CLI 均为 `dairn`。业务项目命名空间统一为 `.dairn/`，项目策略位于 `.dairn/governance/project.json`；锁文件为 `.dairn/lock.json`；工程 Skills 采用标准 `.agents/skills/` 布局。当前 Dairn 1.0.0 是独立的新产品版本，不提供旧产品别名、旧目录映射和迁移支持。

## 安全性和限制

质量门禁不能替代可信的 CI 运行环境、分支保护、人工审批、密钥管理与生产监控。版本锁及运行时哈希不应被静默修改；受管理文件存在用户编辑冲突时应停止写入。
