---
id: dairn.engineering.portable-analyzers
title: 项目自主实现的可移植 Analyzer 协议
summary: QuickJS 核心只校验、调用项目声明的分析器；按需安装的多语言示例是项目自有代码，不能作为可信签名来源。
kind: spec
module: engineering
keywords: ["analyzer", "parser", "portability", "ast", "project", "adapter", "surface"]
aliases: ["dairn analyzers", "surface analyzer"]
related: ["dairn.engineering.impact-analysis", "dairn.engineering.work-execution"]
symbols: ["dairn analyzers init", "dairn analyzers doctor", "dairn guide impact"]
---

# Portable Analyzer Contract

Core 不内置某种语言的 AST SDK。一个 Analyzer 的 `execution.argv` 为 JSON 字符串数组；运行时在尾部附加 `REQUEST.json RESPONSE.json` 绝对路径。`execution.cwd` 指向项目内部路径；不得通过 shell 模板插值拼接用户数据。

`analyzers templates` 查看可用样例；`analyzers init --template <language> --id <id>` 默认只规划；`--apply` 才复制源码到项目 `tools/dairn/analyzers/` 并写入项目自行维护的 `.dairn/analyzers.json`（`dairn.analyzers.v1`）。相同 ID 或已存在目标路径必须阻断，无自动覆盖。旧 `.dairn/stubs.json` 属于已删除协议：出现即报 `UNSUPPORTED_LEGACY_ANALYZER_CONFIG`，不解析、不迁移、无别名。

请求为 `dairn.analyzer-request.v1`（`analyzer_id`、`domain:surface`、`subject{source_commit,base_commit}`、`root`、`scope`、`limits`）；响应为 `dairn.surface-result.v1`，回传身份并返回 `changes`，各项包含路径、符号、added/removed/changed 及前后签名。缺失、超时、路径不安全或返回格式错误均失败。

各项目语言工具链是开发者可选的工具链；Dairn 原生 CI 的默认治理检查不依赖它们。检测结果为 advisory，不可代替实测、人工 Review 或加密签名；缓存位于 `.dairn/cache/analyzers/`，工作区脏时不得复用，不能成为可信证据。

## Built-in optional template catalog

`dairn analyzers templates` lists Python, JavaScript, Java and Shell starter adapters (the catalog is intentionally small until the surface domain stabilizes; more languages will follow). Templates are **examples**, not guaranteed type-complete parsers. Python uses the standard-library AST; Java/JavaScript/Shell examples use intentionally bounded heuristics. Shell requires jq.

`analyzers init` is **read-only by default**; only `--apply` copies project-owned code and updates `.dairn/analyzers.json`. Multi-file templates (when present) install atomically relative to the manifest; any collision or symlink blocks the operation. Templates do not run during `init`, `doctor` or default `check`. `analyzers doctor` probes commands only. For accurate semantic or type-level compatibility, a project should replace its starter adapter with a vetted parser.

The analyzer request requires a pinned `subject.base_commit` to compute meaningful before/after signatures. The default lightweight `guide impact` still works without a template.
