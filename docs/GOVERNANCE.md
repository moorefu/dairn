# 治理、项目分析与受保护 CI

## 工作方式

Agent 读取目标项目的 `AGENTS.md` 和 `.agents/skills/dairn-*/SKILL.md`，调用 Dairn 执行确定性操作。`CLAUDE.md` 只作导航；接管已有项目时不覆盖其原有内容。内核不调用模型，不读取 Agent 的私有推理，也不授予合并审批。

`work next` 返回下一步；Agent 修改代码、运行检查并记录可观察证据。Review 要求当前 HEAD 与 `standards`、`spec_fidelity` 两条审查结论；后者为 `pass` 时需有效 `spec_ref`。存在 Implement 阶段时，还需当前 HEAD 的机器门禁通过。Synchronize 要求 `status`、`head`、`reviewed_docs`、`reason`，记录文档已更新或无需更新的依据。任务完成记录不等于合并批准。

## 项目自有分析模板

```sh
dairn stubs templates --root ./service
dairn stubs init --root ./service --template go --id surface
dairn stubs init --root ./service --template go --id surface --apply
dairn stubs doctor --root ./service
dairn guide impact --root ./service --base origin/main --precision surface
```

默认只规划，`--apply` 才复制到 `tools/dairn/stubs/` 并更新项目自有的 `.dairn/stubs.json`。Dairn 不下载分析器工具链；项目可以审查、修改或替换模板。

| 模板 | 依赖与分析方式 |
| --- | --- |
| Go | Go、Git；Go AST 导出声明 |
| Python | Python 3.9+、Git；标准库 AST |
| JavaScript / TypeScript | Node.js 18+、Git；导出声明扫描，不做类型解析 |
| Java | JDK 11+、Git；公开签名扫描 |
| Rust | Cargo、serde、serde_json、Git；公开声明扫描 |
| PHP | PHP 7.4+、Git；类和函数声明扫描 |
| Lua | LuaJIT、lua-cjson、Git；函数扫描 |
| Shell | POSIX sh、jq、Git；函数声明扫描 |
| Ruby | Ruby 2.7+、Git；类、模块与方法扫描 |
| C# | .NET SDK 8+、Git；公开声明扫描 |

这些模板输出分析线索，不构成语义兼容证明或签名信任依据。`doctor` 只探测本地依赖；缺少显式请求的分析器、超时或无效响应会失败。

分析协议为 `dairn-stub-v1`。内核直接执行配置的 argv，追加绝对路径的请求和响应 JSON，不拼接 shell 命令。请求包含 `schema`、`kind`、`stub_id`、`root`、`base_commit`、`head_commit`、`protocol`；响应回传身份并提供 `changes`。内核验证结构、路径、大小与超时。脏工作区不复用分析缓存，缓存不作为签名门禁证据。Windows 的 `.cmd/.bat` 分析器需显式经过 `cmd.exe`。

## 受保护 CI

项目 CI 模板位于 [ci/templates](../ci/templates)，构建与签名入口位于 [ci/protected](../ci/protected)。这套部署用于目标项目的治理证据，与 Dairn 自身的制品测试工作流分开。

| 环境 | 执行内容 | 私钥 |
| --- | --- | --- |
| PR/MR | 提议修改及真实测试，结果交给分支保护判断 | 无 |
| 受保护构建 | 固定 APE、受保护提交、检查与机器证据 | 无 |
| 独立签名任务 | 核对同一次流水线的证据、提交和来源，签名并验证 | 仅此处可访问 |

签名任务挂载密钥时不得执行项目测试或分析器。密钥应由独立 runner 挂载或 HSM/KMS 按任务授权；不要放入所有受保护分支任务都可读取的 GitLab 变量。GitHub 环境与 runner 组、GitLab 标签与隔离策略、分支保护及 artifact 来源须由管理员配置。模板用于合并后的受保护分支证据，合并前检查仍由分支保护负责。

外部可信配置须固定：

- `DAIRN_EXPECTED_APE_SHA256`：APE 文件摘要。
- `DAIRN_EXPECTED_RUNTIME_SHA256`：经审查初始化得到的嵌入式 manifest 指纹。
- `DAIRN_EXPECTED_POLICY_SHA256`：获准的 `.dairn/governance/project.json` 摘要。
- `DAIRN_EXPECTED_STUBS_SHA256`：需要执行获准项目分析器时的 manifest 摘要。
- `DAIRN_TASK_ID`、`DAIRN_TRUSTED_BASE_REF`：任务与可信差异基线。

公钥与私钥使用检出目录之外的绝对路径，并隔离私钥访问。受保护构建与签名脚本需要 Git、sha256sum、jq，签名另需支持 Ed25519 的 OpenSSL。GitHub 模板的 action 引用应固定到经过审查的提交 SHA。

```sh
# 无私钥的构建任务
/opt/dairn/ci/protected/build-protected.sh "$DAIRN_TASK_ID" "$DAIRN_TRUSTED_BASE_REF"
# 同一流水线的独立签名任务
/opt/dairn/ci/protected/sign-protected.sh "$DAIRN_TASK_ID" "$DAIRN_TRUSTED_BASE_REF"
```

签名器先验证机器门禁，准备声明并签名，再执行 `work verify --require-ci-attestation`。启用 `DAIRN_REQUIRE_CI_CONTEXT=true` 时，还要提供来自可信配置的仓库、ref、workflow、pipeline、build-job 预期值。声明绑定任务、检查集、源码提交、基线、策略、运行时与机器证据指纹。

签名使用自定义 detached Ed25519 格式，不属于 DSSE/in-toto/SLSA；它证明密钥签署了声明，不能独立证明构建节点正确执行了测试。来源保证仍依赖 CI 平台、隔离与 artifact 传输；本地环境变量模拟成功不代表生产签名部署已验证。
