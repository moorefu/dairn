---
id: dairn.ci.gates
title: CLI 门禁与证据契约
summary: 规定完整风险门禁、单项检查、证据格式与失败处理。
kind: spec
module: ci
keywords: ["dairn validate", "dairn check", "CI", "测试", "门禁", "lint", "build", "evidence"]
aliases: ["质量门禁", "risk-gate"]
related: ["dairn.ci.provider", "dairn.governance.risk"]
symbols: ["dairn validate --base", "dairn check --base", ".dairn/governance/project.json"]
---

# CLI 门禁与证据契约

## 单一执行入口

统一入口是 `dairn` CLI；门禁命令与各模块 argv 由 `.dairn/governance/project.json` 定义。`dairn validate --base <trusted-ref>` 先检查文档与治理配置（结构治理），再由 `dairn check --base <trusted-ref>` 实际执行完整风险门禁。

`.dairn/governance/project.json` 中配置的 lint、unit、integration、build argv 仅用于单项调试；单独运行它们不产生 `dairn check` 的 run 证据。`dairn check --base <ref>` 的证据报告记录 `mode=risk-gate-preview`（每个必需 gate 的 argv、退出码与输出摘要都在 `checks[]` 中），`dairn check --all` 记录 `mode=baseline-all`，`dairn hook pre-push` 记录 `mode=pre-push-gate`；单项 argv 成功不能冒充完整门禁。

## 命令来源

每个技术栈的真实检查命令定义在 `.dairn/governance/project.json`。CI YAML 不复制门禁判断逻辑；缺少工具链、缺少被要求的检查或退出码非零必须失败。

## 执行证据

记录 Git HEAD 和基线、命令 argv、目录、时间、退出码、输出、测试范围与未验证项。原始证据通过可信 CI 保存；未执行的检查不能被文字标记为通过。

基线必须通过 `--base` 显式传入可信 Git ref。单纯从当前 PR 工作树执行 `dairn check` 不能证明门禁不可绕过；需由受保护 CI/审批保证。

## 发布边界

技术门禁成功不是上线批准。发布必须另行检查制品 digest、环境变更、健康指标和回滚路径。

## 框架自测门禁

框架自测内建在发布流程中：发行构建先执行 `dairn docs check` 校验分发资产一致性，并在构建产物上运行 `quickjs.tests.test_assets_lint` 回归；完整 Python 套件由本地/专项验证环境执行（依赖 Go/OpenSSL 等工具链），不在发布构建 job 中全量运行。分发资产门禁与本地完整测试都通过才允许发布。
