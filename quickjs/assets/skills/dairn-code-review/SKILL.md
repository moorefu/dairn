---
name: dairn-code-review
description: 独立 PR 代码评审 Skill。检查正确性、安全性、生命周期、兼容性和证据；对阻断项按严重度出具可复现的审查意见。
dairn-stage: stable
---

# Independent Code Review

## 审查范围

1. 取得真实 PR base/head SHA，并与 diff 文件一一对应；读取受影响接口周围的调用链和测试。
2. 对照 `AGENTS.md`、风险声明、Agent Note 和命中的 stack Skill。Reviewer 必须检查 L2 是否被错误降级，并验证 G0/G1/G2/G3 裁剪符合触发器；不存在 Note 或 BUG 并不自动构成缺陷。
3. 先看 correctness/security：认证授权绕过、输入边界、数据一致性、错误后不安全继续、协议兼容、状态泄漏、并发/资源清理、性能回归。
4. 再看可验证性：新增行为是否有相关测试；CI 是当前 head 的结果吗；`make gate BASE=<base>` 对应的证据是否为 `mode=risk-gate`（而不是 `mode=selected-check`）；命令确实执行了吗；为什么被跳过？
5. 仅将具体可重现/可推导的缺陷列为 blocker；样式/可读性建议单独标注。不要以纯风格意见压过正确性。
6. 不接受“AI 已审查”作为独立的人类批准；重要变更必须走受保护的 review 机制。

## 评审输出

按严重度输出：位置、错误前提或影响、复现/推理证据、推荐修复、欠缺的验证。明确未能读取或未能执行的内容；无法验证时结论为 **BLOCKED/NEEDS EVIDENCE**，而不是 PASSED。

## Mandatory two-axis conclusion (do not average)

Read `dairn.engineering.review`. Separate the output into **Standards Review** (repo standards, safety, reliability, technology-profile quality) and **Spec Fidelity Review** (requirements fulfilled, omissions, scope creep, unintended behavior). Each axis needs its own source, evidence and `pass / fail / needs-evidence / not-applicable` outcome. When no spec exists say **no authoritative spec** and `not-applicable` with reasoning, not `pass`. G2 can use independent reviewer contexts; G0/G1 usually need no extra agents. A review file is optional unless the project deliberately opts into structured reports. Human approval remains external.

## Fixed-point and independent verdicts

Resolve a concrete base SHA/branch and compare only that change. Independently judge repository standards (including tests/security) and the authoritative requirements/spec. Report `not-applicable` if no spec exists; a checked diff without a spec is not a passed fidelity review. Cite changed files and actual evidence.
