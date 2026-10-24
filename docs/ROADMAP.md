# 路线图与试点计划

本文记录 Dairn 的演进方向、尚未落地的目标接口、Context Intelligence 的分阶段计划，以及建议的试点与验收方式。架构与当前能力边界见 [ARCHITECTURE.md](ARCHITECTURE.md)，分析器现状见 [ANALYZERS.md](ANALYZERS.md)。

**状态语义**：`[Current]` 表示已在源码中实现、有对应命令与测试；`[Planned]` 表示尚未实现，示例不可直接照搬执行；`[Current — 需真实部署验收]` 表示代码与脚本已存在，但生产信任仍依赖组织真实的 CI/SCM 配置与验收。本文不宣称 GitHub 受保护 CI 已在本仓库生产部署。

## 1. 演进方向总览

| 方向 | 最新状态 | 重点下一步 |
| --- | --- | --- |
| Project Bootstrap / Skills / Workflow / Work | **[Current]** | 优化零仪式 UX、减少强制流程依赖 |
| Independent Check / Evidence / Attestation / Gate | **[Current — 需真实部署验收]** | Protected CI/SCM 配置、端到端签名和发布验收 |
| Handoff | **[Current · MVP]** | 带验证来源的定向上下文、过期检测 |
| **Adaptive Governance Planner** | **[Current · MVP]** | 融合 Quality Goal / Analyzer Requirement；证明自适应减少无谓执行 |
| **Capability Assessment** | **[Current · MVP]** | 安全、无副作用的命令发现与真实执行能力区分 |
| **Refactor Contract / Technical Debt Baseline** | **[Current · MVP]** | 契约检查执行器、Subject/Run 与 Gate 强绑定，质量趋势 |
| **Governance Feedback** | **[Current · MVP]** | 纠正 Flaky 推断、引入缺陷/返工/成本实证与 A/B |
| **Dairn Analyzers** | **[Current]** | Runner/Suite/Report Adapter 与 `analyze run`/`analyze import` 的持续完善 |
| **Capability 驱动的按需分析（Analyzer Selection Planner）** | **[Current · MVP]** | 更多 capability provider、LSP/SCIP 集成、策略可观测性 |
| **Quality Fitness & Continuous Improvement** | **[Current · MVP]** | 架构 Fitness、SARIF/JUnit/Coverage 导入、质量基线与趋势 |
| **Capability-Aware Agent & Skill Participation** | **[Current · MVP]** | 发现专业能力、按需参与的建议和输出契约 |
| **Context Intelligence / Project Engineering Memory** | **[Current · Phase 1]** | Phase 2 外部 Code Intelligence、Phase 3 记忆陈旧性判断、Phase 4 Harness 集成 |

**优先级原则**：先验证真实受保护 CI 的信任边界和现有 Planner/Gate 约束一致性，再将新增 Quality 指标绑定到强制门禁。Analyzer 的只读执行与 Agent Capability Discovery 可并行推进。Analyzer 命名已落地（`dairn analyzers`）；**旧 `stubs` 接口已删除，无兼容层**。

## 2. 仍属目标 [Planned] 的命令

以下命令目前**不可调用**，仅用于说明接口方向：

```sh
# 依据长期目标的可信基线比较（当前 Fitness 为 local-only）
dairn quality fitness --base origin/main --trusted-baseline

# 定向交接项目工程记忆（现有 handoff 尚无 --for）
dairn handoff --for security.threat-analysis
```

## 3. Context Intelligence 路线图

| 阶段 | 范围 | 状态 |
| --- | --- | --- |
| Phase 1 | Context Resolver MVP：返回带来源的路径/符号/Spec/测试/变更关系 | **[Current · MVP]** |
| Phase 2 | Analyzer Code Intelligence：外部索引/AST 经 Analyzer Selection Planner 接入 | [Planned] |
| Phase 3 | Engineering Memory Retrieval：ADR/Git/Incident/Quality Fitness/Refactor Contract/Evidence 与陈旧性判断 | [Planned] |
| Phase 4 | Agent Harness 集成：按需为 Claude Code/Codex 生成最小上下文包；Dairn 不接管其工具权限 | [Planned] |

### 度量计划（计划中的评估，不是已测结果）

A/B 真实工程任务：A 组使用原生 rg/read/git/LSP；B 组在同一工具之上叠加 Dairn Context Intelligence。

| 指标 | 观察内容 |
| --- | --- |
| time-to-first-correct-edit-location | 首次定位到正确修改位置所需时间 |
| relevant-spec/test discovery rate | 相关 Spec 与测试的发现率 |
| agent tool-call count | 完成任务的工具调用次数 |
| context token usage | 上下文 token 消耗 |
| stale/incorrect relation rate | 陈旧或错误关系的比例 |
| missed-test rate | 漏掉应运行测试的比例 |
| extra index cost/latency | 额外索引成本与延迟 |

对抗性场景：同名函数、动态派发、生成代码、陈旧 ADR、缺失 SCIP 索引、未提交的工作区变更。

## 4. 试点建议：先做七个场景

不必先部署完整质量平台，也无需启用所有 Skills。建议在隔离分支或临时项目中，以相同 CI 与工程工具做对照：

| 场景 | 操作 | 应观察的证据 | 试点问题 |
| --- | --- | --- | --- |
| **L0 最小治理** | README 提交后运行 `dairn governance plan --base <sha>` | Risk L0，极少额外阶段与必需检查 | 小改动是否没有多余仪式？ |
| **L2 不可降级** | 修改认证/协议文件，执行 `governance plan/explain` | 完整检查矩阵、SCM 人工审批需求 | 高风险保障是否被保留？ |
| **能力缺口** | 在隔离项目中故意移除必需检查执行器，运行 `governance plan` | `MISSING_CAPABILITY`、非成功状态 | 缺配置是否会被误认为通过？ |
| **按需分析缺口** | 对需要 `contract.compatibility` 的变更运行 `analyze plan --base <sha>`，且不配置语义 provider | 显式 gap（`NO_PROVIDER`/`PRECISION_INSUFFICIENT`），plan status 非 ready | 缺能力是否被伪装成通过？ |
| **任务上下文** | 同一任务对比原生 rg/read 与 `context` 的定位路径 | 带来源与精度的最小文件集，未知项显式列出 | 是否减少无效搜索？ |
| **渐进重构** | 新建 `refactor` 契约并运行 `compare/verify` | 已知失败与新增失败分开，退出条件不明时报 `needs-review` | 是否能管理跨 PR 技术债？ |
| **跨 Agent 接手** | 本地修改、运行检查后执行 `handoff --json` | Git HEAD/工作区指纹、Run 来源与陈旧标记 | 是否减少重复摸索？ |

补充运行 `governance assess` 和 `governance recommend`，分别观察**当前能力是否真的可用**、**样本不足时是否拒绝得出过度结论**。

参照已编写的试点方案做真实任务 A/B，至少记录：总体耗时、返工、回归缺陷、等待时间、CI 资源消耗、接手时间和治理维护工作量。**Dairn 的成功标准不是调用更多 Agent 或输出更多报告，而是以更低的总体成本保持或改善工程保证。**

## 5. 参与方向

欢迎围绕以下方向讨论、提交 Issue 或 PR：

- Agent 无关的工程治理协议与 CLI 体验；
- Analyzer Runner、能力驱动的按需分析、上下文解析、跨语言工具报告 Adapter 和可复用分析模板；
- 可执行 Architecture Fitness Functions、契约与性能回归验证；
- 受信 CI/SCM 证据绑定、负向测试与跨平台可靠性；
- 工程记忆、Agent Handoff、质量反馈与治理成本实证。

贡献原则：提供可运行的测试和真实观察结果；不要通过新增不必要的工作流或文档来替代确定性检查；涉及信任边界的变更必须包含失败/伪造/过期/缺失证据等负向场景。开始前请阅读 [AGENTS.md](../AGENTS.md)、[BUILDING.md](../BUILDING.md) 与 [docs/GOVERNANCE.md](GOVERNANCE.md)。
