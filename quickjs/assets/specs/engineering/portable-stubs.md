---
id: dairn.engineering.portable-stubs
title: 项目自主实现的可移植 Stub 协议
summary: QuickJS 核心只校验、调用项目声明的分析器；按需安装的多语言示例是项目自有代码，不能作为可信签名来源。
kind: spec
module: engineering
keywords: ["stub", "parser", "portability", "ast", "project", "adapter"]
aliases: ["dairn stubs", "surface-analysis"]
related: ["dairn.engineering.impact-analysis", "dairn.engineering.work-execution"]
symbols: ["dairn stubs init", "dairn stubs doctor", "dairn guide impact"]
---

# Portable Stub Contract

Core 不内置某种语言的 AST SDK。一个 Stub 的 `argv` 为 JSON 字符串数组；运行时在尾部附加 `REQUEST.json RESPONSE.json` 绝对路径。`cwd` 指向项目内部路径；不得通过 shell 模板插值拼接用户数据。

`stubs templates` 查看可用样例；`stubs init --template <language> --id surface` 默认只规划；`--apply` 才复制源码到项目 `tools/dairn/stubs/` 并写入项目自行维护的 `.dairn/stubs.json`。相同 ID 或已存在目标路径必须阻断，无自动覆盖。

请求包含 `schema:1`、`protocol:dairn-stub-v1`、`kind:surface-analysis`、`stub_id`、`root`、`base_commit`、`head_commit`；返回 `changes`，各项包含路径、符号、added/removed/changed 及前后签名。缺失、超时、路径不安全或返回格式错误均失败。

各项目语言工具链是开发者可选的工具链；Dairn 原生 CI 的默认治理检查不依赖它们。检测结果为 advisory，不可代替实测、人工 Review 或加密签名；缓存位于 `.dairn/cache/`，工作区脏时不得复用，不能成为可信证据。

## Built-in optional template catalog

`dairn stubs templates` lists Go, Python, Java, JavaScript, TypeScript, Rust, PHP, Lua/OpenResty, Shell, Ruby and C# starter adapters. Templates are **examples**, not guaranteed type-complete parsers. Go/Python use standard-library AST; Java/JS/TS/PHP/Lua/Shell/Ruby/C# examples use intentionally bounded heuristics; Rust uses a `pub` declaration scanner built as a Cargo project. Rust requires serde/serde_json supplied by Cargo (vendor for offline work); Lua requires lua-cjson; Shell requires jq; C# requires .NET 8+.

`stubs init` is **read-only by default**; only `--apply` copies project-owned code and updates `.dairn/stubs.json`. Rust/C# install multiple files atomically relative to the manifest; any collision or symlink blocks the operation. Templates do not run during `init`, `doctor` or default `check`. `stubs doctor` probes commands only. For accurate semantic or type-level compatibility, a project should replace its starter adapter with a vetted parser.

The analyzer request requires a pinned `base_commit` to compute meaningful before/after signatures. The default lightweight `guide impact` still works without a template.
