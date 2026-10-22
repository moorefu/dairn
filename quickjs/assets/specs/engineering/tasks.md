---
id: dairn.engineering.tasks
title: 垂直切片任务与依赖图
summary: 将跨会话工程拆成可单独验证的行为切片，显式声明阻塞关系。
kind: spec
module: engineering
keywords: ["tracer bullet", "任务图", "多 Agent", "依赖", "slice", "handoff", "任务拆分"]
aliases: ["Tracer Bullet", "任务依赖图"]
related: ["dairn.engineering.feedback", "dairn.governance.modes"]
symbols: ["make tasks-ready", "make tasks-check"]
---

# 任务图治理

## 适用范围

只在项目跨多次会话、多 Agent 或多工作项时建立 `.dairn/governance/tasks/*.json`。简单修改无需建立任务工单。优先复用 GitHub/GitLab 原生 Issue 阻塞关系，本地目录仅为无外部工单系统的可选方案。

## 完成判定

一个任务尽可能完成一个贯通需求、接口、数据层、测试的垂直切片；每个任务有可观察的验收条件和独立影响边界。`blocked_by` 形成 DAG，无循环、无悬空引用；`make tasks-ready` 只列出前驱已完成的任务。

## 并行约束

两个并行任务若共享可变文件或需要争用单一迁移顺序，应先调整切片或串行合并；多 Agent 不会因此获得合并批准。大范围机械重构可使用 expand–migrate–contract，避免强制错误的垂直切分。
