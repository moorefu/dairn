---
id: dairn.ci.protected-attestation
title: 受保护 CI 双作业签名协议
summary: 无密钥 Build 执行真实检查，同流水线独立 Sign 只校验并签署证据，所有可信声明均依赖服务端保护与 Runner 隔离。
kind: spec
module: ci
keywords: ["ci", "ed25519", "attestation", "sign", "protected", "runner"]
aliases: ["dairn trusted ci", "dairn signing"]
related: ["dairn.ci.gates", "dairn.engineering.work-execution"]
symbols: ["dairn work attest-prepare", "dairn work attest-attach", "dairn work verify"]
---

# Protected CI Evidence Contract

PR/MR 使用不带秘密的质量门禁；仅受保护主分支 Push 才能进入下面的后合并签名链路：

1. **Keyless Build**：受保护构建 Runner 以哈希固定的 Dairn APE、受信策略、固定基线运行真实质量门禁，写入 `machine-evidence`、任务状态及包含源提交、仓库/分支、流水线/Job 的 build-origin 元数据。
2. **Separated Signer**：通过 CI 平台从同一流水线取得证据，独立校验来源、HEAD、策略、运行时和成功检查，不执行任何项目编译、测试或 Stub。私钥仅可在这个隔离的 Runner/密钥服务中访问。签署并附加与证据哈希绑定的 Ed25519 声明。
3. **Verify/Review/Synchronize**：要求的 CI 级别验证使用外部受信公钥与服务端可信来源/分支/工作流/流水线/Build Job 期望值，比对当前 HEAD，人工审批和合并策略仍独立生效。

这不是 DSSE、in-toto 或 SLSA 认证，且签名不能独立证明测试执行真实性。测试作业的信誉、Job 权限、可信制品分发、CI 服务器认证、流水线 artifact 身份、密钥和 Runner 隔离必须在实际生产 CI 平台验收。签名后的 Push 检查不可代替 PR 合并前的 required checks。
