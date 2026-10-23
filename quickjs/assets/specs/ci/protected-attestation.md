---
id: dairn.ci.protected-attestation
title: 受保护 CI 双作业签名协议
summary: 无密钥 Build 执行真实检查，同流水线独立 Sign 只校验并签署证据，所有可信声明均依赖服务端保护与 Runner 隔离。
kind: spec
module: ci
keywords: ["ci", "ed25519", "attestation", "sign", "protected", "runner"]
aliases: ["dairn trusted ci", "dairn signing"]
related: ["dairn.ci.gates", "dairn.engineering.work-execution"]
symbols: ["dairn attest prepare", "dairn attest verify", "dairn evidence verify", "dairn gate evaluate"]
---

# Protected CI Evidence Contract

PR/MR 使用不带秘密的质量门禁；仅受保护主分支 Push 才能进入下面的后合并签名链路：

1. **Keyless Build**：受保护构建 Runner 以哈希固定的 Dairn APE、受信策略、固定基线运行真实质量门禁，写入 `machine-evidence`、任务状态及包含源提交、仓库/分支、流水线/Job 的 build-origin 元数据。
2. **Separated Signer**：通过 CI 平台从同一流水线取得证据，独立校验来源、HEAD、策略、运行时和成功检查，不执行任何项目编译、测试或 Analyzer。私钥仅可在这个隔离的 Runner/密钥服务中访问。签署并附加与证据哈希绑定的 Ed25519 声明。
3. **Verify/Gate**：`dairn attest verify` 使用外部受信公钥（必须在项目检出之外）验签 statement 原始字节并绑定受信 CI 上下文；`dairn evidence verify` 独立复核 bundle 成员摘要；`dairn gate evaluate` 组合 Check/Approval/Attestation 输出 PASS/FAIL/INDETERMINATE。任务账本只通过 `dairn work link-check --run <run-id>` 引用已有 Run，不产生可信声明；人工审批和合并策略仍独立生效。
4. **Keyless Publisher**：专用发布身份仅可写同仓库受保护 `refs/heads/dairn-evidence`。发布前必须依次完成：bundle 成员摘要复核、bundle 内 Run Subject 与当前检出 commit 的绑定、CI origin 属性校验（passed 且 source_commit 一致），以及用 CI 受信公钥对 statement 的**真实 Ed25519 验签**并与记录的 CI origin 上下文交叉比对——bundle 摘要正确但签名未验不得发布。发布以 fast-forward CAS 重试并发冲突，成功后从远端 evidence ref 读回签名字节比对，读回不一致不得宣布归档完成；遍历 bundle 成员不得使用 shell 单词拆分，成员路径仅限纯相对 POSIX 白名单。

## Gate 输入的信任绑定

`dairn gate evaluate` 只消费能自证来源的输入，不接受自述 JSON：

- **检查矩阵**：按可信 Policy 对给定风险级别（默认保守 L2）要求的 `(module_id, check_id)` 逐一配对校验；`--modules` 显式给出受影响模块，缺省按 Policy 全部模块（保守超集）。一个模块通过某检查不能覆盖另一个模块的同名检查；缺少模块身份的检查记录不构成覆盖证明。
- **已验签声明**：`--attestation` 必须与 `--signature`、`--key`（CI 控制的绝对路径公钥）同时给出；Gate 内部先执行真实 Ed25519 验签并消费验签结果，裸 statement JSON 直接拒绝。声明还需绑定本次 Subject（repository/commit/tree）与被评估的 run_id。
- **审批身份绑定**：Approval verdict 的 `subject.repository` 与 `subject.reviewed_head_sha` 必须与本次 Subject 匹配；来自其他仓库或旧 head 的审批记录不产生授权。

这不是 DSSE、in-toto 或 SLSA 认证，且签名不能独立证明测试执行真实性。测试作业的信誉、Job 权限、可信制品分发、CI 服务器认证、流水线 artifact 身份、密钥和 Runner 隔离必须在实际生产 CI 平台验收。签名后的 Push 检查不可代替 PR 合并前的 required checks。
