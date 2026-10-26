# PCC v1 离线收敛实施计划

依据为本轮用户提供并要求实现的收敛方案。继续使用当前分支与 v1 协议；本轮实现源码和部署模板，不修改线上审批规则、密钥、App 权限或发布版本。

现状：`governance-plan.mjs` 与 `checks.mjs` 已有固定 Base、Requirement、执行器和输入快照；`pcc-gate.py` 却逐项读取 GitHub Check、Review、权限及 PR 身份。`gate.mjs` 默认拒绝本地预合并结果，且签名和人工审批混合。现有发布签名链仍须保留。

确定的责任：PCC 核心只计划、执行和核对机器保障；CI 负责可信执行与本轮工件传输；SCM 原生负责审批、过期审批和最终合并。机器 PASS 明示 `human_approval=delegated-to-scm`、`merge_eligibility=not-evaluated`，不产生 approved 布尔值。

实施切片：

1. PCC-01：固定 Base 和组织机器保障下限，生成完整计划；审批要求改为平台委托说明，不再按风险枚举审核者。
2. PCC-02：本地 QuickJS 核对固定预期集合与直接 Run，Python 受信入口仅检查外部固定配置、Git 身份和调用固定 Runtime；删除在线枚举。独立 Publisher 只发布一个 `Dairn / Required Assurance` 状态，测试执行域不持有其凭据。
3. 同流水线多作业使用直接依赖的 needs 与结果工件：先固定作业及 Requirement 集合，再核对唯一成功结果。必需项 skipped、neutral、cancelled、缺失或重复均拒绝。
4. 签名声明限定机器证据，审批快照仅在显式审计归档中保留；post-merge/release 的真实验签和内容绑定继续强制。
5. 更新规范、CLI 帮助、CI 模板、部署说明和 PCC 两票验收。组织受信 Workflow 与独立 Publisher 是部署选择，普通 PR 可修改的 Workflow 只提供工程检查证据。

验收不变量：

- 无 GitHub Token、HTTP 客户端或 SCM API 请求也可完成计划、真实执行和本地核对。
- Head 降低策略、不同 Base/Head/Tree/仓库/Plan/输入快照、不同执行器不能满足当前要求。
- 每个必需 Requirement 恰好有一个有效成功结果；多模块和全局契约分别绑定；结果全绿但预期项缺失仍失败。
- needs 的跳过、取消、失败和遗漏不能满足固定预期作业；其输出不能自证来源或平台审批。
- 本地及预合并 PASS 只表示机器保障，不能声称平台已批准、可以合并或已部署可信入口。
- 签名缺失、错误密钥、篡改 Run、策略或 Plan 时，发布阶段仍非零退出；机器签名不镜像平台审批。
- Publisher 从当前受信验证进程取得裁决，固定状态名称与提交身份，仅发状态请求，不读取 PR/Review/Check 列表。测试无其密钥；文档不假定个人仓库可用组织级 Required Workflow。

验证：先补原生负例与真实临时 Git 项目回归；再重建候选执行源码 lint/unit/integration/build 四门禁，候选资产检查、结构检查、任务图校验。现有 PR 的云端验证与本地证据分别记录，不伪造批准。固定 Runtime 只在验证后另行执行 Promotion。

兼容性：不增加 v2。v1 Gate/Plan/Statement 明确机器范围，旧的在线管理员配置与混合审批裁决不静默当成新协议。审批快照工具保留为显式审计用途，不接入默认机器保障路径。回滚需要整体回滚规范、Runtime 与调用方，不能只删除来源检查。

设计审查：保留并翻译在线 Verifier 会继续重复平台职责，因此采用本地纯核对与独立发布适配器；不以普通 JSON 的 verified 标记认证执行环境。外部固定 Runtime/配置、CI 作业隔离、组织受信 Workflow 或受信 Publisher 的实际部署仍由维护者验收。

平台依据：[直接 needs 上下文](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts)、[Ruleset 原生约束](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)、[不可信代码与权限隔离](https://docs.github.com/en/actions/reference/security/secure-use)。
