---
id: dairn.engineering.impact-analysis
title: 项目影响图与文档契约同步
summary: 从真实源码声明、导入、构建、依赖与 Spec 提取有限事实，对比可信 Git 基线输出文档影响建议。
kind: spec
module: engineering
keywords: ["impact", "imports", "public API", "dependency graph", "影响分析", "文档漂移"]
aliases: ["dairn guide impact", "project intelligence"]
related: ["dairn.engineering.project-guidance", "dairn.engineering.workflow"]
symbols: ["dairn guide impact", "dairn guide drift"]
---

# Project Impact Analysis Contract

`dairn guide impact` 对观察到的模块、依赖清单、构建入口、公共声明、import/use 和项目 Spec 变化作**保守启发式分析**。源码每文件最多读取 128 KiB，最多采集 500 份源码；Python/Go/Rust/Java/JS/TS 的声明识别不是完整 AST 解析，也不能证明语义兼容。跳过或无法完全解析的代码必须标注不确定性。

- `informational`：实现内部变化，没有观察到接口或依赖声明变化。
- `review-required`：模块、公开声明、导入、构建或依赖发生变化，建议审查受影响文档。
- `contract-impact`：权威 `docs/specs` 文档变化，需要明确的契约与测试复核；不等于已证明破坏兼容。

允许使用 `--base <trusted-Git-commit>`，优先从可信提交读取原始快照，不信任 PR 自行更新的当前快照。默认仅报告；`--strict` 在无基线或检测到需要审查的变化时失败。机器只能提出文档、Spec 和测试的关联边，不能在未审查源码时自动修改 README、AGENTS 或重设事实基线。
