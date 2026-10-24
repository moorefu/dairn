---
id: dairn.engineering.impact-analysis
title: 项目影响图与文档契约同步
summary: 从真实源码声明、导入、构建、依赖与 Spec 提取有限事实，对比可信 Git 基线输出文档影响建议。
kind: spec
module: engineering
keywords: ["impact", "imports", "public API", "dependency graph", "影响分析", "文档漂移"]
aliases: ["dairn guide impact", "project intelligence"]
related: ["dairn.engineering.project-guidance", "dairn.engineering.workflow", "dairn.engineering.analyzer-selection", "dairn.engineering.context-intelligence"]
symbols: ["dairn guide impact", "dairn guide drift", "dairn analyze plan"]
---

# Project Impact Analysis Contract

`dairn guide impact` 对观察到的模块、依赖清单、构建入口、公共声明、import/use 和项目 Spec 变化作**保守启发式分析**。源码每文件最多读取 128 KiB，最多采集 500 份源码；Python/Go/Rust/Java/JS/TS 的声明识别不是完整 AST 解析，也不能证明语义兼容。跳过或无法完全解析的代码必须标注不确定性。

- `informational`：实现内部变化，没有观察到接口或依赖声明变化。
- `review-required`：模块、公开声明、导入、构建或依赖发生变化，建议审查受影响文档。
- `contract-impact`：权威 `docs/specs` 文档变化，需要明确的契约与测试复核；不等于已证明破坏兼容。

允许使用 `--base <trusted-Git-commit>`，优先从可信提交读取原始快照，不信任 PR 自行更新的当前快照。默认仅报告；`--strict` 在无基线或检测到需要审查的变化时失败。机器只能提出文档、Spec 和测试的关联边，不能在未审查源码时自动修改 README、AGENTS 或重设事实基线。

## Public-surface heuristic feeds analyzer selection

`guide impact` 的启发式观察是分析需求的输入，而不是最终结论。公共接口发生变化时，选择器要求 `surface.api-diff`；**仅源码布局变化时为 advisory**，不升级为必需；变更模块存在观察到的下游依赖者时，要求 `contract.compatibility`。这些需求由声明对应 capability 的 execute analyzer 提供更高精度证据，选择、授权与复用规则见 [Analyzer Selection](analyzer-selection.md)。

若缺少 provider 或精度不足，结果必须显式报告缺口（`NO_PROVIDER`/`PRECISION_INSUFFICIENT`），并将相应结论标记为 `UNKNOWN`，**不得静默通过**。启发式影响报告不能声称语义兼容；`analyze plan` 的输出（需求、决策、缺口）与 `guide impact` 的影响报告是并列证据，互不替代：plan 不重排 impact 报告，impact 报告不产生门禁结论。任务感知的上下文聚合见 [Context Intelligence](context-intelligence.md)。
