# 治理、项目分析与受保护 CI

## 工作方式

Agent 读取目标项目的 `AGENTS.md` 和 `.agents/skills/dairn-*/SKILL.md`，调用 Dairn 执行确定性操作。`CLAUDE.md` 只作导航；接管已有项目时不覆盖其原有内容。内核不调用模型，不读取 Agent 的私有推理，也不授予合并审批。当前发行版为 `0.1.0-rc.1`（预发布；正式版由 `v<版本>` 标签决定）。

`work next` 返回下一步；Agent 修改代码、运行检查并记录可观察证据。普通变更依次经过 Orient → Grill → Specify → Slice → Implement → Review → Synchronize；Grill 阶段必须以人类访谈消除设计树上的未决问题（`--kind grill`），未决问题未清零时不能推进到 Specify。Review 要求当前 HEAD 与 `standards`、`spec_fidelity` 两条审查结论；后者为 `pass` 时需有效 `spec_ref`。存在 Implement 阶段时，还需当前 HEAD 的机器门禁通过。Synchronize 要求 `status`、`head`、`reviewed_docs`、`reason`，记录文档已更新或无需更新的依据。任务完成记录不等于合并批准。

项目初始化后使用项目内 launcher `.dairn/bin/dairn`（Windows `.dairn\bin\dairn.cmd`）作为推荐入口；AGENTS 托管块首行记录该入口，本文与资产中的 `dairn` 均为其简写。Agent 不得自行安装 Dairn；launcher 缺失或 `doctor` 失败时应报告环境问题，而不是安装或下载运行时（详见“项目内 launcher 与 vendored runtime”）。

评审与复盘使用结构化证据：Review 记录 Standards / Spec Fidelity 两轴；Reflect 要求二选一改进项（新增确定性检查，或写入 Review 轴使用的标准文档）。`dairn validate` 只做结构校验，`dairn check` 才真实执行质量门禁；两者都不代表合并批准。

## Agent Hook 与会话锚定

`dairn hooks install --apply` 在项目内生成 `.dairn/hooks/`：`pre-push`、`turn-end.sh`（Claude Code Stop hook，从 stdin 读事件 JSON）、`turn-end-codex.sh`（Codex `notify`，事件 JSON 作为最后 argv）、`turn-end-dsh.sh`（DSH 插件 hook）与 `README.md`（各 harness 接线说明）。`--git` 会安装 `.git/hooks/pre-push`（git worktree 中跳过并告警）；也可把 `.dairn/hooks/pre-push` 追加到既有 hook。npm 本地安装等 PATH 中没有 `dairn` 的场景，用 `--launcher <POSIX 绝对路径>` 写入可执行 launcher。

- `dairn hook pre-push`：解析基线后先跑结构治理（`governanceValidators`），再按 `--base`/`DAIRN_TRUSTED_BASE_REF`/`origin/main`/`HEAD^` 执行完整风险门禁，最后校验活跃任务的证据是否对应当前 HEAD；`--no-check` 只跳过风险门禁，结构治理与活跃任务证据检查仍执行。pre-push 是本地信号，不替代受保护分支上的检查。
- `dairn hook turn-end`：把当前回合锚定到活跃任务，写入 `.dairn/governance/evidence/session/*.json` 并在账本 `session_anchors` 中登记路径与 SHA256。provider/session 取自 `--provider`/`--session`、事件 JSON（`session_id`、`thread-id` 等）、`DAIRN_SESSION_ID`/`DAIRN_SESSION_PROVIDER` 或 harness 变量（`DSH_SESSION_ID`、`CLAUDE_SESSION_ID`/`CLAUDE_CODE_SESSION_ID`、`CODEX_SESSION_ID`）；无法识别时默认失败，显式 `--allow-unattributed` 才记录为未归属锚点。
- 锚点只是 local-unattributed 的过程证据：它证明“某会话在某 HEAD 上结束”，不证明动作合理、测试通过或经过审批；与受保护 CI 的 Ed25519 声明是不同信任级别。

## 项目内 launcher 与 vendored runtime

`dairn init` / `dairn adopt` 生成项目内 launcher（受管文件）：POSIX `.dairn/bin/dairn`、Windows `.dairn\bin\dairn.cmd`，以及保持启动器行尾的 `.dairn/.gitattributes`。推荐入口是 launcher；文档、AGENTS 托管块和 `.dairn/Makefile`（`DAIRN ?= ./.dairn/bin/dairn`）中的 `dairn` 都是它的简写。项目自有 `.dairn/launcher.json` 不参与受管文件哈希：init/adopt 时创建，upgrade 缺失时补齐，内容由 `--vendor-runtime` 更新。

launcher 的运行时解析顺序固定为：`DAIRN_BIN` → 项目内 `.dairn/runtime/dairn-embedded.com` → `PATH` 的 `dairn` → 报错并以 127 退出；不做隐式安装或联网下载。

`dairn upgrade --vendor-runtime .dairn/runtime --apply`（adopt 也可在接入时注册）把已放入 `.dairn/runtime/` 的官方 APE 与 `runtime-integrity.json` 注册为 vendored 运行时：CLI 用内建 SHA256 直接读取二进制计算实际摘要（不可读时才回退 `sha256sum`/`shasum`/`certutil`）、与 integrity 比对、要求运行时版本与执行该命令的 Dairn CLI 版本一致（`upgrade` 同时把项目 lock 更新为该版本），并把 `mode=vendored`、`runtime.path/integrity/version/sha256`、`generated_by` 写入 `.dairn/launcher.json`。`--vendor-runtime` 路径相对项目根解析；`dairn doctor` 会复查 launcher 文件、`launcher.json` 与 vendored 运行时摘要，失败时以 unready 退出（退出码 1）。

Agent 与 CI 约定：

- Agent 不得自行 npm/pip 安装 Dairn；先运行 `./.dairn/bin/dairn doctor`，失败时报告环境问题，而不是安装或下载运行时。
- 生成的 CI 模板统一以 `DAIRN_BIN_VALUE="${DAIRN_CI_BIN:-./.dairn/bin/dairn}"` 为入口，并用 `sh "$DAIRN_BIN_VALUE" …` 调用；`DAIRN_CI_BIN` 由管理员提供并固定到受信 launcher。
- 受保护任务必须用外部 pin 覆盖项目内 vendored 运行时（`DAIRN_EXPECTED_APE_SHA256`、`DAIRN_EXPECTED_RUNTIME_SHA256`），不能只信任 `.dairn/runtime/` 中的文件。PR 内新增或替换的二进制是未审查的可执行代码，不得在受保护/签名任务中直接运行。
- launcher、`launcher.json` 与 vendored 运行时只是执行入口和完整性校验，不是审批或 CI 签名证据；信任仍由受保护 CI 与外部 pin 提供。
- 完整契约（`launcher.json` 字段、`--vendor-runtime` 校验、`work next` 的 `invocation` 块、故障排查）见发行资产 `quickjs/assets/specs/engineering/launcher.md`，可用 `dairn docs show dairn.engineering.launcher` 读取。

## 资产一致性与发布门禁

`dairn docs check` 校验发行版内嵌的 `specs/` 与 `skills/` 资产：frontmatter 必填字段、稳定 ID 唯一性、`related` 与相对链接、Skill 与 `agents/openai.yaml` 的权限声明一致性，以及正文引用的 CLI 命令是否真实存在；任何 `make`/`scripts/*.py` 旧命令引用都会失败。发布构建依次执行 `python tools/build.py`、`npm run build`、`sh ./dairn.sh docs check` 与 `python -m unittest quickjs.tests.test_assets_lint`，制品矩阵的各类安装包也会执行 `docs check`，失败即阻断发布。`dairn docs find/show/context` 从 spec frontmatter 读取稳定 ID，不依赖手工清单。

## 项目自有分析模板（Dairn Analyzers）

```sh
dairn analyzers templates --root ./service
dairn analyzers init --root ./service --template go --id surface
dairn analyzers init --root ./service --template go --id surface --apply
dairn analyzers doctor --root ./service
dairn guide impact --root ./service --base origin/main --analyzer surface
```

默认只规划，`--apply` 才复制到 `tools/dairn/analyzers/` 并更新项目自有的 `.dairn/analyzers.json`（`dairn.analyzers.v1`）。Dairn 不下载分析器工具链；项目可以审查、修改或替换模板。旧 `dairn stubs` 命令与 `.dairn/stubs.json` 协议已按破坏性更名移除：旧命令直接报错，旧配置出现即拒绝（`UNSUPPORTED_LEGACY_ANALYZER_CONFIG`），无兼容别名、无自动迁移。

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

分析协议为 `dairn.analyzer-request.v1` / `dairn.surface-result.v1`。内核直接执行配置的 argv，追加绝对路径的请求和响应 JSON，不拼接 shell 命令。请求包含 `schema`、`analyzer_id`、`domain`（当前仅 `surface`）、`subject{source_commit,base_commit}`、`root`、`scope`、`limits`；响应回传身份并提供 `changes`。内核验证结构、路径、大小与超时。受信 CI 环境要求外部固定的 `DAIRN_EXPECTED_ANALYZERS_SHA256`。脏工作区不复用分析缓存（`.dairn/cache/analyzers/`），缓存不作为签名门禁证据。Windows 的 `.cmd/.bat` 分析器需显式经过 `cmd.exe`。

## 分析执行与质量判定（advisory 层）

`dairn analyze run <id> | --suite <id> [--base <ref>]` 受控执行分析器并生成 `dairn.analysis-run.v1` 记录（completed/tool-error/timeout/report-error/invalidated/not-run）；`dairn analyze import <id> [--artifact PATH]` 只读导入 SARIF 2.1.0 / JUnit XML / Dairn JSON 报告，来源恒为 `unverified-import`。Analysis Run 与 Quality Observation 都是机器观察，不是 Check Run，更不是 Gate 结论。

`dairn quality fitness [--json]` 读取可选的 `.dairn/governance/quality-goals.json`（`dairn.quality-goals.v1`），对每个目标的 producer 现场执行或导入并输出 PASS/FAIL/UNKNOWN/ADVISORY；缺数据输出 UNKNOWN 而非猜 PASS。`dairn capability plan [--base <ref>]` 输出 advisory 的 `dairn.participation-plan.v1`（needs/gaps），必需能力缺失时退出码 3；计划不含 gate_override/approved 之类可提升信任的字段，也不启动任何模型。

## 受保护 CI

项目 CI 模板位于 [ci/templates](../ci/templates)，构建与签名入口位于 [ci/protected](../ci/protected)。这套部署用于目标项目的治理证据，与 Dairn 自身的制品测试工作流分开。

| 环境 | 执行内容 | 私钥 |
| --- | --- | --- |
| PR/MR | 提议修改及真实测试，结果交给分支保护判断 | 无 |
| 受保护构建 | 固定 APE、受保护提交、检查与机器证据 | 无 |
| 独立签名任务 | 核对同一次流水线的证据、提交和来源，签名并验证 | 仅此处可访问 |

签名任务挂载密钥时不得执行项目测试或分析器。密钥应由独立 runner 挂载或 HSM/KMS 按任务授权；不要放入所有受保护分支任务都可读取的 GitLab 变量。GitHub 环境与 runner 组、GitLab 标签与隔离策略、分支保护及 artifact 来源须由管理员配置。模板用于合并后的受保护分支证据，合并前检查仍由分支保护负责。

受保护构建在受保护分支的检出目录上运行 `dairn check --task`，因此要求合并进受保护分支的账本里，目标任务仍处于 **active implement** 阶段（`work.mjs` 的 `prepareCheckTask` 会拒绝其他状态）。该命令同时会重新校验已有证据：review/synchronize 证据绑定了记录时的 HEAD，合并产生新提交后这些证据会因 `head` 过期而被拒绝。因此本地流程与受保护链必须显式对齐：推荐让账本在合并时停在 implement active，且不把本地 review/sync 证据带进受保护构建的检出；由受保护构建生成当前提交的机器证据并签名，签名完成后再补记本地流程状态。若合并后需要保留 review/sync 证据，应改为在受保护构建之后基于合并提交重新记录，而不是复用合并前的账本字段。项目应把这一时序写成自己的 CI 运行手册，并用 `dairn hook pre-push` 在推送前检查活跃任务证据是否仍对应当前 HEAD。

外部可信配置须固定：

- `DAIRN_EXPECTED_APE_SHA256`：APE 文件摘要。
- `DAIRN_EXPECTED_RUNTIME_SHA256`：经审查初始化得到的嵌入式 manifest 指纹。
- `DAIRN_EXPECTED_POLICY_SHA256`：获准的 `.dairn/governance/project.json` 摘要。
- `DAIRN_EXPECTED_ANALYZERS_SHA256`：需要执行获准项目分析器时的 `.dairn/analyzers.json` 摘要（旧 `DAIRN_EXPECTED_STUBS_SHA256` 已随破坏性更名移除）。
- `DAIRN_TASK_ID`、`DAIRN_TRUSTED_BASE_REF`：任务与可信差异基线。

生成的 CI 模板以 `DAIRN_BIN_VALUE="${DAIRN_CI_BIN:-./.dairn/bin/dairn}"` 为入口并调用 `sh "$DAIRN_BIN_VALUE" …`。受保护构建/签名任务应由管理员提供外部 `DAIRN_CI_BIN`，并用外部 `DAIRN_EXPECTED_APE_SHA256` / `DAIRN_EXPECTED_RUNTIME_SHA256` pin 覆盖项目内 vendored 运行时；PR 中提交或替换的 `.dairn/runtime/` 二进制不可信，不能作为受保护任务的执行来源。

公钥与私钥使用检出目录之外的绝对路径，并隔离私钥访问。受保护构建与签名脚本需要 Git、sha256sum、jq，签名另需支持 Ed25519 的 OpenSSL。GitHub 模板的 action 引用应固定到经过审查的提交 SHA。

```sh
# 无私钥的构建任务
/opt/dairn/ci/protected/build-protected.sh "$DAIRN_TASK_ID" "$DAIRN_TRUSTED_BASE_REF"
# 同一流水线的独立签名任务
/opt/dairn/ci/protected/sign-protected.sh "$DAIRN_TASK_ID" "$DAIRN_TRUSTED_BASE_REF"
```

签名器先验证机器门禁，准备声明并签名，再执行 `work verify --require-ci-attestation`。启用 `DAIRN_REQUIRE_CI_CONTEXT=true` 时，还要提供来自可信配置的仓库、ref、workflow、pipeline、build-job 预期值。声明绑定任务、检查集、源码提交、基线、策略、运行时与机器证据指纹。

签名使用自定义 detached Ed25519 格式，不属于 DSSE/in-toto/SLSA；它证明密钥签署了声明，不能独立证明构建节点正确执行了测试。来源保证仍依赖 CI 平台、隔离与 artifact 传输；本地环境变量模拟成功不代表生产签名部署已验证。
