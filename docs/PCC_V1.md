# PCC v1：核心离线、平台职责委托、可信入口保留

Dairn 负责确定本次变更必须完成的机器保障，并核对执行证据；CI 负责可信执行与工件传输；GitHub/GitLab 负责人工审批、过期审批、Code Owner 与最终合并。源码组件通过不代表可信入口已部署。实施依据见 [离线收敛计划](changes/pcc-offline-v1.md)。

## 默认执行路径

```sh
./dairn governance plan --base <完整BaseSHA> --json
./dairn governance execute --base <完整BaseSHA> --assurance --json
# 已有本轮 Run 时，只重核证据，不重跑项目测试
./dairn gate evaluate --base <完整BaseSHA> --check <run.json> --json
```

核心不读取 Token、不调用 SCM API，也不依赖 HTTP 客户端。这里的离线不约束 Git checkout、项目测试依赖、CI 上传或可选发布/审计适配器的联网。

Base 中的策略与生效 Refactor 契约决定要求，组织配置只能增加机器保障下限。Head 不能删除当前要求。每个 Requirement 恰好对应一个实际成功结果，绑定仓库、Base/Head/Tree、Plan、执行器、输入快照、工具身份和原始日志摘要。缺项、重复、非零、skipped、neutral、cancelled、身份错配或输入漂移都不能满足要求。

输出仍是 v1，但 scope 固定为 machine-assurance：

```text
Machine assurance: PASS
Human approval: delegated to SCM
Merge eligibility: not evaluated locally
```

本地 assurance 为 local-observed；不填 approved=true，不宣称平台已批准、可以合并或受信入口已上线。`gate evaluate --approval` 不再接受；显式审批快照审计仍独立可用。计划不再维护按风险分级的审核者人数。

## 固定 CI 集成入口

`ci/protected/pcc-gate.py` 是薄的离线适配器：核对管理员配置、入口 pin 与本地 Git 身份后，调用固定的项目启动器/Runtime，不读取 PR、Check、Review 或权限 API。部署时脚本、启动器、Runtime 和配置均位于 checkout 外的只读受控位置。管理员配置 schema 仍为 dairn.pcc-admin.v1：

```json
{
  "schema": "dairn.pcc-admin.v1",
  "repository": "org/repo",
  "launcher": "/opt/dairn/dairn",
  "launcher_sha256": "<启动器SHA256>",
  "runtime": "/opt/dairn/.dairn/runtime/dairn-embedded.com",
  "runtime_sha256": "<APE的SHA256>",
  "verifier": "/opt/dairn/ci/protected/pcc-gate.py",
  "verifier_sha256": "<离线适配器SHA256>"
}
```

可选 organization_policy 只增加机器要求。旧 requirements→App/Check 映射及 min_approvals 配置明确拒绝，不静默当成新协议。外部配置的完整 SHA256 独立固定；Base/Head 来自受信 CI 事件上下文，必须是完整不可变 SHA。启动器负责正确进入内嵌 CLI，POSIX 使用私有执行缓存，Windows 保持原生 APE。

```sh
python /opt/dairn/ci/protected/pcc-gate.py \
  --admin-config /etc/dairn/pcc-admin.json --admin-sha256 <配置SHA256> \
  --repository org/repo --root <checkout> --base <BaseSHA> --head <HeadSHA> \
  --execute
```

`--execute` 在无发布/签名凭据的域中执行完整计划并直接核对；已有证据时用 `--check <run.json>`。0/1/3 分别表示机器 PASS/FAIL/INDETERMINATE。固定配置和本地文件不能自行认证平台身份。

## 多作业直接聚合

固定的 expected_jobs 由管理员配置提供，不能从现有结果反推。需要分片时，各受信作业运行 `governance execute --base <SHA> --requirements app.lint,app.unit`，保留完整 Plan 身份、所执行的 Requirement 和局部 Run；局部成功不能独立宣称完整保障通过。

聚合输入是本轮直接 needs 和 Run 清单，形状分别为：

```json
{"quality":{"result":"success","outputs":{"run_sha256":"<Run原始SHA256>"}}}
```

```json
[{"job_id":"quality","path":".dairn/governance/evidence/run.json","sha256":"<同一原始SHA256>"}]
```

以 `gate evaluate --base <SHA> --runs <清单> --jobs <固定作业数组> --needs <直接上下文>` 核对。每个固定作业必须真实 success，且其输出摘要与所取回的 Run 字节相符；集合缺项、重复、取消、跳过均拒绝。各 Run 共同恰好覆盖完整 Requirement 集合。跨平台输入必须绑定同一 Git 身份，各自和聚合检出保持干净；不把不同平台的文件模式快照强行视为相同。

## 单一发布结果与平台审批

目标项目只发布一个 `Dairn / Required Assurance`。组织条件允许时，用 Required Workflow 固定执行定义、来源仓库和 Runtime；不能假定个人仓库拥有这一能力。普通 PR 可修改的 Workflow 仅提供工程检查，不能声明已防止恶意 PR 绕过。GitHub Actions 共享 App 身份不等于特定受信 Workflow。

可选 `ci/providers/publish-github-assurance.py` 只发布一个汇总 Check，内部不枚举 SCM。管理员配置还需固定 publisher、publisher_sha256、expected_jobs。它只接受本轮直接 needs 与摘要绑定的 Run 清单，不接受裸 verdict 文件或 --execute；needs 文件由受信作业在 checkout 外创建并只读提供，不能由 PR 或测试工件替代。它先调用固定离线核验器，只把实际核对结果发布到固定仓库/Head/状态名；未知和失败都发布 failure，不将 neutral/skipped 变成平台成功。单次完成发布使用一个 POST，禁止重定向，凭据仅在该隔离入口读取。

执行域不能取得 Publisher 凭据、签名密钥，不能改写聚合域的固定配置和 needs 输入；可信代码及凭据通过独立 runner/受信集成挂载。禁止在 pull_request_target 高权限任务直接运行 PR 代码。

平台统一执行审批底线和敏感路径 Code Owner；审核者的组织身份由团队管理。Base 更新后重验、严格合并条件和 Merge Queue 的 merge_group 验证由平台触发，Dairn 不轮询。部署模板不会自动更改线上 Ruleset、App 或权限。

## 发布签名与可选归档

默认预合并机器保障不等待发布签名链。post-merge/release 仍要求真实 Ed25519 验签、外部受信公钥、本次 Run 原始字节、Policy、Plan、Runtime 与 CI 上下文；缺失或篡改仍拒绝。

声明 scope 为 machine-assurance，human_approval 为 delegated-to-scm。仅在显式 `evidence bundle --approval <快照>` 审计归档时，签名的 audit 部分绑定审批文件原始摘要并标记 snapshot-bytes-only；不证明当前平台审批，不成为机器 Gate 条件。原有 v1 无范围声明或旧混合审批声明不静默解释为新语义，需由已验证构建重新生成。证据保存与签名隔离要求见[签名规范](../quickjs/assets/specs/ci/protected-attestation.md)。

实际平台验收仍需确认受信入口来源、不可由 PR 修改的配置、凭据隔离、单一 Required Check/Workflow 与原生审批规则，并执行缺项、错配、跳过、伪造同名状态和 Base 更新故障注入。组件测试或模拟 needs 只证明组件，不代表上述部署已完成。
