---
id: dairn.ci.gates
title: CLI 门禁与证据契约
summary: 规定完整风险门禁、单项检查、证据格式与失败处理。
kind: spec
module: ci
keywords: ["dairn validate", "dairn check", "CI", "测试", "门禁", "lint", "build", "evidence", "PCC", "离线", "machine-assurance", "审批委托", "gate evaluate"]
aliases: ["质量门禁", "risk-gate"]
related: ["dairn.ci.provider", "dairn.governance.risk"]
symbols: ["dairn validate --base", "dairn check --base", ".dairn/governance/project.json"]
---

# CLI 门禁与证据契约

## 单一执行入口

统一入口是 `dairn` CLI；门禁命令与各模块 argv 由 `.dairn/governance/project.json` 定义。`dairn validate --base <trusted-ref>` 先检查文档与治理配置（结构治理），再由 `dairn check --base <trusted-ref>` 实际执行完整风险门禁。

`.dairn/governance/project.json` 中配置的 lint、unit、integration、build argv 仅用于单项调试；单独运行它们不产生 `dairn check` 的 run 证据。`dairn check --base <ref>` 写入 `dairn.check-run.v1` Run 证据（`execution.mode=risk-gate-preview`；每个必需 gate 的 argv、退出码、审计日志路径与输出摘要都在 `checks[]` 中），`dairn check --all` 记录 `execution.mode=baseline-all`，`dairn hook pre-push` 记录 `execution.mode=pre-push-gate`；单项 argv 成功不能冒充完整门禁。

`runs/<完整提交>/<run_id>/run.json` 是唯一的机器证据格式（旧版 JSON 报告双写已移除）。执行器不能自证可信：`declared_assurance` 恒为 `local-observed`，`environment` 只是声明性观察（CI 环境记为 `ci-declared`），CI 级信任只能由受保护签名链建立，绝不来自 JSON 自报。快照输入覆盖不完整（存在未声明的被忽略输入）时 Run 状态为 `invalidated` 而不是 `passed`；非 Git 工作区没有可证明的提交身份，只写不可用于门禁的执行审计记录（`dairn.execution-record.v1`）。

## 命令来源

每个技术栈的真实检查命令定义在 `.dairn/governance/project.json`。CI YAML 不复制门禁判断逻辑；缺少工具链、缺少被要求的检查或退出码非零必须失败。

## 执行证据

记录 Git HEAD 和基线、命令 argv、目录、时间、退出码、输出、测试范围与未验证项。原始证据通过可信 CI 保存；未执行的检查不能被文字标记为通过。

基线必须通过 `--base` 显式传入可信 Git ref。单纯从当前 PR 工作树执行 `dairn check` 不能证明门禁不可绕过；需由受保护 CI/审批保证。

## 发布边界

技术门禁成功不是上线批准。发布必须另行检查制品 digest、环境变更、健康指标和回滚路径。

## 框架自测门禁

框架自测内建在发布流程中：发行构建先执行 `dairn docs check` 校验分发资产一致性，并在构建产物上运行 `quickjs.tests.test_assets_lint` 回归；完整 Python 套件由本地/专项验证环境执行（依赖 Go/OpenSSL 等工具链），不在发布构建 job 中全量运行。分发资产门禁与本地完整测试都通过才允许发布。

## PCC v1 机器保障范围

默认入口 `dairn governance execute --base <SHA> --assurance --json` 直接核对本次执行结果，不发布逐项平台状态后再通过 SCM API 读回。`dairn gate evaluate --base <SHA> --check <run.json>` 可独立重核本地证据，固定 Base、Head、Tree、仓库、Plan、执行器、输入快照和工具身份必须匹配。每个必需 Requirement 恰好有一个真实零退出成功记录；重复和缺项均拒绝。单项仅有 status=passed 不构成保障。

裁决 schema 仍为 `dairn.gate-verdict.v1`，但 scope 固定为 `machine-assurance`，`human_approval=delegated-to-scm`、`merge_eligibility=not-evaluated`，本地 assurance 为 local-observed。PASS 不声明 SCM 已批准、可信 Workflow 已部署或允许合并。旧 Gate 的 `--approval` 输入明确拒绝；审批快照仅供独立审计归档。

多作业模式的 Run 清单含项目相对 path、原始文件 sha256、job_id；摘要须与直接 needs 对应作业的 outputs.run_sha256 一致。预期作业集合必须先固定并完整成功，不从已有结果推导。每个 Run 的输入覆盖完整、执行前后稳定；跨平台聚合要求各自及聚合检出均干净，并绑定同一 Git 身份，不能拿平台文件模式不同的快照互相替代。
