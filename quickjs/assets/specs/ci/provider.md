---
id: dairn.ci.provider
title: GitHub / GitLab 中立 CI 接入
summary: GitHub Actions 与 GitLab CI 如何提供可信基线并调用同一 Makefile。
kind: spec
module: ci
keywords: ["GitHub", "GitLab", "MR", "PR", "merge-base", "CI基线"]
aliases: ["双CI", "流水线"]
related: ["dairn.ci.gates"]
symbols: ["CI_MERGE_REQUEST_DIFF_BASE_SHA", "scripts/ci_base.py"]
---

# GitHub / GitLab 中立 CI 接入

## 职责分工

GitHub Actions 与 GitLab CI 只负责正确检出仓库、确定可信差异基线、安装依赖、调用 `make ci`、保存原始工件和通过受保护合并规则约束合并。不得在 YAML 中复制风险策略。

## PR / MR 差异范围

对 PR 使用平台提供的真实 base commit 或可信合并基线；GitLab MR 优先使用 `CI_MERGE_REQUEST_DIFF_BASE_SHA`。全零值、不可解析提交以及猜测的 `HEAD~1` 不可接受。普通 MR pipeline 与 merged results pipeline 的测试对象可能不同，必须明确记录。

## 可信执行

禁止把未审查的 PR 脚本直接置于拥有生产密钥的高权限 Runner 中。治理规则本身的改变必须由受保护规则、Code Owners 和独立校验控制；不能依赖 PR 提交的脚本自证安全。

详见 [平台接入实现说明](../../CI_INTEGRATION.md)。
