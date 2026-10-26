---
id: dairn.ci.provider
title: GitHub / GitLab 中立 CI 接入
summary: GitHub Actions 与 GitLab CI 如何提供可信基线并调用同一 CLI 门禁。
kind: spec
module: ci
keywords: ["GitHub", "GitLab", "MR", "PR", "merge-base", "CI基线"]
aliases: ["双CI", "流水线"]
related: ["dairn.ci.gates"]
symbols: ["dairn validate --base", "dairn check --base"]
---

# GitHub / GitLab 中立 CI 接入

## 职责分工

GitHub Actions 与 GitLab CI 只负责正确检出仓库、确定可信差异基线、安装依赖、调用 `dairn validate --base "$BASE"` + `dairn governance execute --base "$BASE" --assurance`、保存原始工件和通过受保护合并规则约束合并。不得在 YAML 中复制风险策略。

## PR / MR 差异范围

对 PR 使用平台提供的真实 base commit 或可信合并基线；GitLab MR 优先使用 `CI_MERGE_REQUEST_DIFF_BASE_SHA`。全零值、不可解析提交以及猜测的 `HEAD~1` 不可接受。普通 MR pipeline 与 merged results pipeline 的测试对象可能不同，必须明确记录。

## 可信执行

禁止把未审查的 PR 脚本直接置于拥有生产密钥的高权限 Runner 中。治理规则本身的改变必须由受保护规则、Code Owners 和独立校验控制；不能依赖 PR 提交的脚本自证安全。

详见 [受保护 CI 双作业签名协议](protected-attestation.md)。

## 单一平台结果与可信入口

目标项目向 SCM 暴露一个聚合状态，例如 Dairn / Required Assurance；内部仍保留逐 Requirement 证据。聚合消费本轮直接 needs 与工件摘要，不枚举 PR、Check、Review 或审核者权限。审批、过期审批、Code Owner、严格 Base 更新与最终合并由平台原生规则负责。启用 Merge Queue 时工作流必须处理 merge_group，并使用该事件的 Base/Head。

可信入口由部署方固定：可用组织受信 Required Workflow 时绑定来源工作流及 Runtime；没有该能力时使用独立受信 Publisher/CI 集成入口。不能仅以 GitHub Actions 共享 App 身份或同名绿色状态认证特定 Workflow，也不能假定个人仓库具备组织规则能力。PR 可修改的普通 Workflow 只提供工程检查，不声明恶意 PR 无法绕过。测试域没有 Publisher 凭据、签名密钥，聚合域只读取由受信 CI 传递的裁决输入；禁止在 pull_request_target 高权限作业中执行 PR 代码。

离线只指 PCC 内核不主动调用 SCM API；网络依赖、checkout、工件上传及显式发布/审计适配器不在此承诺内。HTTP/HTTPS 扩展仍为显式启用的可选能力，不是 doctor/check/Context/Retro 的前提。
