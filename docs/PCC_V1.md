# PCC v1 组件与部署验收

统一目标见 [实施契约](specs/engineering/integrated-v1.md)。当前代码提供受信 Base 计划、完整 Requirement 执行与证据绑定，以及独立 GitHub 核验组件。**源码组件通过测试不代表 PCC Required Gate 已在平台上线。**

治理计划从完整 Base SHA 读取策略和生效 Refactor 契约；Head 策略修改不能减小本次要求。每项必需保障有 scope、requirement_id、执行器、argv/cwd/timeout、Subject 与计划摘要；全局契约没有执行器时明确 REQUIRED_EXECUTOR_MISSING。Quality 概览放 advisory，不在计划哈希内偷偷增加执行含义。

普通 check --base 使用 Base 策略执行同一计划的 Requirement，包括 module_id 为空的全局契约。check --all 是本地完整基线，使用当前配置，不充当受保护 Base 认证。Run 记录计划、执行器、输入快照与日志摘要；输入变化、覆盖不全或检查失败不能成功。

隔离执行器可使用外部固定 Runtime 的 `governance execute --base <SHA> --context <文件> --plan-sha256 <SHA>`，独立重算并执行 Base 要求，不提升项目 Pin。context 提供 Subject 与管理员来源绑定，不能把普通本地运行升级为受信平台证据。

本地 gate evaluate 的 pre-merge 输入仍无法认证 SCM 来源，返回 INDETERMINATE。post-merge/release 要求当前进程真实 Ed25519 验签，不能从磁盘 JSON 重新导入“已验证”标签；签名必须覆盖本次 Run 原始字节、Policy 与 Subject。

有审批下限时，使用 `evidence bundle --run <id> --evidence <run.json> --approval <approval.json> --out <bundle.json>` 归档实际消费的审批文件。`attest prepare` 先复核所有成员字节，再把 `approval_snapshot_sha256` 写入签名声明；签名前后篡改审批或 Run 都会拒绝。受保护构建可通过绝对路径 `DAIRN_CI_APPROVAL_VERDICT` 接收 checkout 外的审批裁决文件。该路径只提供输入和字节绑定，部署方仍须认证 SCM 来源，普通 JSON 不能自行获得信任。

## 独立核验入口

`ci/protected/pcc-gate.py` 必须由管理员在隔离 Verifier 环境部署，源码、Python、Git 和 APE 均需在 PR 控制之外固定。管理员配置放 checkout 外，使用独立 pin 指定配置摘要。配置 schema 为 dairn.pcc-admin.v1，包含：

- runtime：checkout 之外的固定 APE 绝对路径；runtime_sha256：经过审阅的二进制 SHA256。
- organization_policy：可选的 dairn.policy.v1 组织下限，必需项与 Base 要求合并。
- requirements：Requirement ID 到专用 GitHub App 的 app_id 和 check_name 映射。
- min_approvals：组织审批下限，和计划中的要求取最大值。

受信 Job 提供只读 DAIRN_GITHUB_TOKEN；Token 不进入参数、日志或 verdict。脚本从认证 GitHub API 重读 PR、受保护 Base、Head Tree、完整分页 Check 与 Review，并在结束时检查 Head/Base 没有移动。

每个 Required Check 的 external_id 为 `pcc:<完整计划SHA>:<Requirement ID 的SHA256>:<HeadSHA>`。发布 Check 的专用 App 只能由受信执行器持有：执行器必须在无发布/签名密钥的隔离 Job 中按固定 Base 计划执行，核对 Run、快照、计划和工具身份之后，再把实际结论交给独立 Publisher。GitHub Actions 共享 App 不能区分 PR 自造同名 job，组件拒绝用其 App 身份满足要求。较新的失败或 pending 不得被旧成功覆盖。

当前入口只读验证并输出 dairn.pcc-verdict.v1；0/1/3 分别为 PASS/FAIL/INDETERMINATE。它不把普通 CI 名称自动解释成 PCC 身份，也不自动配置 App、Ruleset 或发布 check。

## 仍需部署方完成

1. 隔离执行器与 Publisher 的代码来源、安装身份、权限和不可由 PR 修改的 pin。
2. 将独立 App 来源的 PCC 状态绑定为 Required Check；审批使用 SCM 原生 Review Rule，避免状态与审批互锁。
3. 按提案 PC01–PC11 做真实 PR 故障注入：降低策略、删除必需项、同名伪造状态、旧 Head、缺项、超时和 stale/dismissed/self review 均不能合并。
4. 保留平台 API、Required Check、拒绝合并和恢复正向结果的证据。未完成这些之前，PCC-02 状态只能是组件已实现、平台闭环未验证。

当前分支已获准准备 PR，供源码审查和平台 CI 验证；本次未修改线上保护规则或部署 App。平台闭环的未验收项仍按上述清单保留。
