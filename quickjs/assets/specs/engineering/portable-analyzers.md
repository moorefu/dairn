---
id: dairn.engineering.portable-analyzers
title: 项目自主实现的可移植 Analyzer 协议
summary: QuickJS 核心只校验、调用项目声明的分析器；分析器按 capability 惰性选择并按策略授权执行，多语言示例是项目自有 provider，不是 Core 解析器。
kind: spec
module: engineering
keywords: ["analyzer", "parser", "portability", "ast", "project", "adapter", "surface", "capability", "lazy execution"]
aliases: ["dairn analyzers", "surface analyzer"]
related: ["dairn.engineering.impact-analysis", "dairn.engineering.work-execution", "dairn.engineering.analyzer-selection"]
symbols: ["dairn analyzers init", "dairn analyzers doctor", "dairn guide impact"]
---

# Portable Analyzer Contract

Core 不内置某种语言的 AST SDK。一个 Analyzer 的 `execution.argv` 为 JSON 字符串数组；运行时在尾部附加 `REQUEST.json RESPONSE.json` 绝对路径。`execution.cwd` 指向项目内部路径；不得通过 shell 模板插值拼接用户数据。

`analyzers templates` 查看可用样例；`analyzers init --template <language> --id <id>` 默认只规划；`--apply` 才复制源码到项目 `tools/dairn/analyzers/` 并写入项目自行维护的 `.dairn/analyzers.json`（`dairn.analyzers.v1`）。相同 ID 或已存在目标路径必须阻断，无自动覆盖。旧 `.dairn/stubs.json` 属于已删除协议：出现即报 `UNSUPPORTED_LEGACY_ANALYZER_CONFIG`，不解析、不迁移、无别名。

请求为 `dairn.analyzer-request.v1`（`analyzer_id`、`domain:surface`、`subject{source_commit,base_commit}`、`root`、`scope`、`limits`）；响应为 `dairn.surface-result.v1`，回传身份并返回 `changes`，各项包含路径、符号、added/removed/changed 及前后签名。缺失、超时、路径不安全或返回格式错误均失败。

各项目语言工具链是开发者可选的工具链；Dairn 原生 CI 的默认治理检查不依赖它们。检测结果为 advisory，不可代替实测、人工 Review 或加密签名；缓存仅对相同 subject、analyzer 定义摘要、toolchain 指纹与干净工作区可复用，工作区脏时不得复用，不能成为可信证据。

## Lazy, capability-driven selection

分析器不再被无条件执行，而是由 capability 需求惰性选择。`.dairn/analyzers.json` 的 `capabilities` 使用规范能力名（如 `surface.api-diff`）；`domain=surface` 的 execute analyzer 省略 `capabilities` 时默认 `surface.api-diff`。此前模板写入的 `quality.surface-diff` 不是规范能力名，升级后不再匹配任何 need，请改为 `surface.api-diff`（无隐式别名）。`analyze plan` 先推导 needs、复用有效缓存，再按可信策略决定执行、请求授权或报告缺口；默认 dry-run 不执行任何工具，只有同时出现在 `.dairn/governance/analysis.json` 的 `auto_execute` 白名单中且处于超时预算内的只读 execute analyzer，才允许 `--apply` 自动执行。

- **execute**：可被按需执行，必须有界、只读；执行受策略与超时预算约束。
- **import**：永不执行；报告经适配后作为 Quality Fitness 的 `unverified-import` 观察，不满足执行型 needs，也不成为门禁结论。
- surface 模板是**项目自有的可选 provider**（capability `surface.api-diff`），不是 Core 内置解析器；替换或删除它们不改变 Core 行为。
- 缺口是显式的：缺少 provider 或精度不足时报告 `NO_PROVIDER`/`PRECISION_INSUFFICIENT` 缺口（上下文包中同时以 `MISSING_CAPABILITY` UNKNOWN 标记），不会静默跳过或伪造 PASS。
- 策略文件把“发现”与“执行”分开：`.dairn/analyzers.json` 声明 provider 及其 capability 供选择，`.dairn/governance/analysis.json` 只决定授权与预算；生成 Analysis Run 仍是 advisory 观察，不构成门禁结论。

选择、精度与缺口契约见 [Analyzer Selection](analyzer-selection.md)；任务感知上下文见 [Context Intelligence](context-intelligence.md)。

## Built-in optional template catalog

`dairn analyzers templates` lists Python, JavaScript, Java and Shell starter adapters (the catalog is intentionally small until the surface domain stabilizes; more languages will follow). Templates are **examples**, not guaranteed type-complete parsers. Python uses the standard-library AST; Java/JavaScript/Shell examples use intentionally bounded heuristics. Shell requires jq.

`analyzers init` is **read-only by default**; only `--apply` copies project-owned code and updates `.dairn/analyzers.json`. Multi-file templates (when present) install atomically relative to the manifest; any collision or symlink blocks the operation. Templates do not run during `init`, `doctor` or default `check`. `analyzers doctor` probes commands only. For accurate semantic or type-level compatibility, a project should replace its starter adapter with a vetted parser.

The analyzer request requires a pinned `subject.base_commit` to compute meaningful before/after signatures. The default lightweight `guide impact` still works without a template.
