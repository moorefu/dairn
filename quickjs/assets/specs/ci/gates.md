---
id: dairn.ci.gates
title: Makefile 门禁与证据契约
summary: 规定完整风险门禁、单项检查、证据格式与失败处理。
kind: spec
module: ci
keywords: ["Makefile", "make gate", "CI", "测试", "门禁", "lint", "build", "evidence"]
aliases: ["质量门禁", "risk-gate"]
related: ["dairn.ci.provider", "dairn.governance.risk"]
symbols: ["make gate", "make ci", ".dairn/governance/project.json"]
---

# Makefile 门禁与证据契约

## 单一执行入口

统一使用仓库根 `Makefile`。`make gate BASE=<trusted-ref>` 首先检查文档与治理配置，然后调用 `governance.py validate/run`；`make ci` 另执行治理框架自测。

`make lint`、`make unit`、`make integration`、`make build` 仅是定向检查，证据记为 `mode=selected-check`，不能冒充 `mode=risk-gate`。

## 命令来源

每个技术栈的真实检查命令定义在 `.dairn/governance/project.json`，可转调模块 Makefile。CI YAML 不复制门禁判断逻辑；缺少工具链、缺少被要求的检查或退出码非零必须失败。

## 执行证据

记录 Git HEAD 和基线、命令 argv、目录、时间、退出码、输出、测试范围与未验证项。原始证据通过可信 CI 保存；未执行的检查不能被文字标记为通过。

`BASE` 必须显式传入可信 Git ref。单纯从当前 PR 工作树执行治理脚本不能证明治理脚本不可绕过；需由受保护 CI/审批保证。

## 发布边界

技术门禁成功不是上线批准。发布必须另行检查制品 digest、环境变更、健康指标和回滚路径。


## 框架自测去重

`make ci` 先要求完整 risk-gate 通过；只有当前 HEAD 的门禁证据中已包含根目录完整 Dairn 自测（精确 `python3 -m unittest discover -s tests -v` 且执行通过）时，`scripts/ci_postcheck.py` 才跳过第二次相同自测。其他项目的模块测试或部分检查不能替代 Dairn 治理框架测试。
