---
id: dairn.ci.adaptive-governance
title: 自适应治理计划、能力评估、重构契约与反馈
summary: 规定 dairn governance 与 dairn refactor 命令族的确定性语义：最低充分保证计划、能力分级、债务基线与只给有证据的建议。
kind: spec
module: ci
keywords: ["dairn governance plan", "dairn governance assess", "dairn governance recommend", "dairn refactor", "能力评估", "重构契约", "最低充分保证"]
aliases: ["adaptive governance", "治理计划"]
related: ["dairn.ci.gates", "dairn.ci.protected-attestation"]
symbols: ["dairn governance plan --base", "dairn governance explain --base", "dairn governance assess", "dairn governance recommend --window", "dairn refactor plan --id", "dairn refactor compare --id", "dairn refactor verify --id", "dairn refactor status --id"]
---

# Adaptive Governance

## 治理计划（governance plan / explain）

`dairn governance plan --base <ref>` 从可信项目策略合成 `dairn.governance-plan.v1` 最低充分保证计划；`explain` 输出同一计划的人类解释链。计划是**待执行工作的解释，不是门禁结论**：`ready-to-execute` 只表示验证器分派就绪，运行结果由 `dairn.check-run.v1` 保存，授权由受信 Gate 独立计算。

合成规则（顺序稳定、可重复）：

- 风险取可信下限与声明的较大者，任何输入只能**提高**不能降低（L2 下限不可被自报 L0 绕过）。
- 要求按 `(module_id, check_id)` 精确配对；一个模块的通过记录不覆盖另一个模块。
- 模块上下文（criticality/lifecycle/compatibility，声明于 `project.json` 模块字段）只能追加保证；criticality=high 至少提升到 L1。
- 已批准重构契约（`.dairn/governance/refactors/<id>.json`）覆盖的路径追加其契约检查；`refactor` 意图绝不降级风险。
- 缺失执行器（project.json 无 argv）记为 `MISSING_CAPABILITY` 缺口并以非零退出；缺口不被跳过、不等于通过。
- `local_fast` 仅是速度建议（lint/unit 类）；`ci_required` 始终包含全部强制项，`deferred-to-ci` 永不标记为通过。
- `plan_sha256` 由规范化 JSON（键排序、LF）在计划正文之外计算，不自引用；计划绑定 `change_paths`，不同变更范围不可复用同一计划。
- `work_required` 恒为 false；`advisory_workflow` 可为空，建议项（specify/implement/review/refactor:*）不是检查资格。

## 能力评估（governance assess）

能力分级是相互独立的事实，不是线性阶梯：`declared`（project.json 配置 argv）→ `detected`（命令在本机可解析）→ `executable`（不在本地探测，只有真实运行能证明）→ `ci-verified`（只有受保护签名链可授予，本地输出**永不**自报）。required 检查缺失工具或配置记为缺口。评估结果零写盘、可随时重算。

## 仓库发现（adopt --discover --plan）

`dairn adopt --discover --plan` 在只读计划中报告检测到的语言栈、CI 工作流与测试清单，作为接入建议；已存在的 CI/测试被复用而非覆盖，任何写盘仍需显式 `--apply`。

## 重构契约（refactor plan / compare / verify / status）

- 契约存放 `.dairn/governance/refactors/<id>.json`（`dairn.refactor.v1`），写入必须显式 `--apply`，已存在即拒绝覆盖。
- `compare` 把本地 Run 证据与 `debt.known_failures` 基线比对：签名匹配的失败是已知债务；基线之外的失败是**新失败**（阻断）；同一检查的失败形状变化记为签名漂移（需复核，不静默算已知）；不再失败的基线项记为退役债务。
- `verify` 只判定本地证据能确立的退出条件；无法本地验证的条件（如 no-legacy-callers）输出 `needs-review`（退出码 3），绝不静默通过。

## 治理反馈（governance recommend）

`dairn governance recommend --window <days>` 只输出**有证据的建议**（CI_SLOW/REPEATED_RUNS/FREQUENT_FAILURE/SUSPECTED_FLAKY），每条附观测数据、被保留的保证目标，且全部 `requires_approval`；样本不足时如实输出 `insufficient-evidence`，不宣称任何节约。建议永不自动应用，也不影响计划或门禁的强制项。
