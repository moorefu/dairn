# Dairn 源码仓库指南

## 项目与架构

Dairn 是确定性的工程治理内核，不调用模型，不代替 GitHub 的审批、分支保护或部署平台。CLI 入口为 `quickjs/main.mjs`；`quickjs/core/` 处理项目、风险、检查、证据与工作流；`quickjs/host/qjs.mjs` 适配原生进程与文件系统；`quickjs/assets/` 分发规范、技能和模板。

能力驱动分析入口为 `dairn analyze plan`（默认 dry-run，仅对受信策略允许的只读 execute analyzer 在超时预算内执行）与 `dairn context`（Phase 1 上下文解析 MVP）。二者属于 advisory 决策/检索层，不构成 Gate 判定；契约见 `dairn docs show dairn.engineering.analyzer-selection` 与 `dairn docs show dairn.engineering.context-intelligence`。

`tools/build.py` 与 `tools/build.cjs` 使用锁定 QuickJS，将当前源码嵌入临时 APE并打包；候选在私有 `.build/runs/` 暂存，完成后清理。根启动器始终默认执行 `.dairn/runtime/` Pin。系统安装升级与项目 Pin 提升分开；普通 upgrade --apply 不复制来源载荷。详见 [统一实施契约](specs/engineering/integrated-v1.md) 和 [PCC 部署边界](PCC_V1.md)。

## 本地开发与门禁

日常直接运行根启动器，它执行固定快照。修改核心或资产后用 `python tools/with-built-runtime.py -- python tools/check-source.py unit`（或 integration/lint）验证当前源码。包装器只对子进程注入候选路径，结束清理候选；日志与清理状态保留。打包入口仅生成发行制品，不留下可被后续命令误用的根 runtime。

`.dairn/governance/project.json` 的检查统一调用 `python tools/check-source.py <阶段>`：

| 阶段 | 实际范围 | 证据 |
| --- | --- | --- |
| lint | 内嵌规范与技能检查、分发资产回归 | `validation/source-checks/lint-*.log` |
| unit | QuickJS 原生策略、摘要、治理与交接测试、构建发布工具单元测试 | `validation/source-checks/unit-*.log` |
| integration | 原生宿主、真实临时 Git 项目四项检查、失败与超时证据、Doctor、Context、Runtime Lock、Docs、Launcher 与 Analyzer/Quality | `validation/source-checks/integration/`、`integration-*.log` |
| build | Python 和 npm 构建、三类制品校验清单 | `validation/source-checks/build-*.log`、独立 `build-*/checksums.json` |

必需测试目录统一维护在 `tools/check_catalog.py`，本地与 Linux/Windows CI 共用 `tools/check-source.py`。每阶段生成同目录下的 `<阶段>.json`，记录真实 argv、退出码、日志位置与必需/已执行 Check-ID 覆盖；缺项、重复或失败拒绝聚合成功；构建记录中的 `artifact_dir` 指向本轮独立制品目录，避免与旧制品混杂。它们是本地执行记录，不是签名门禁证据；完整 Dairn Run 由 `check` 生成。

默认集成只需要 Python 3.10+、Git 和已构建的 QuickJS；完整本地门禁的构建阶段还需要 Node 18+ 和 npm。普通 Go 检查属于专项兼容性验收，按需运行 `tools/verify-windows.py`，或运行需要 Go、jq、OpenSSL 和 sha256sum 的 `tools/verify-linux.py`。Go race/CGO 不属于默认或 CI 验收。Linux 脚本先执行共享 lint/unit/integration 门禁，再执行未被共享门禁覆盖的 16 个 Python 模块；native、资产和基础集成测试不重复运行，任何共享门禁失败仍使 Linux 验收失败。缺失本次所选检查的依赖直接失败，不自动安装。

```sh
python tools/with-built-runtime.py -- python tools/check-source.py unit
python tools/with-built-runtime.py -- python tools/check-source.py integration
./dairn check --all --timeout 3600
```

完整本地门禁从固定治理 Runtime 执行，各源码门禁在自身候选上下文验证；不需要为源码验证更新项目 Pin。Windows 同样使用 Python 包装器。测试临时文件保存在 validation/source-checks/tmp，生成物不属于检查输入。

本仓库的 `.dairn/governance/project.json` 用 `snapshot_exclusions` 声明 `/.build/`、`/dist/`、`/runtime/`、`/validation/`、`__pycache__/` 等生成物边界，使 `check --all` 的输入覆盖率为 `declared-complete`。该字段只能排除被 Git 忽略的生成物，命中已跟踪或未被忽略的未跟踪输入时检查直接失败；前导 `/` 表示锚定仓库根。新增构建输出时同步更新声明，不能为绕过覆盖率而隐藏源码或测试。语义见 `dairn docs show dairn.engineering.evidence-snapshot`。

Windows 上 Cosmopolitan 通过 `_COSMO_FDS_V2` 向子进程传递 fd 表；原生工具（Python/Node 等）再启动 APE 孙进程时该变量指向未继承句柄，会丢失 stdout 或退出 `0xC0000005`。`tools/check-source.py` 在 Windows 启动时清除该变量，因此 `check --all` 内测试再调用项目 launcher 的嵌套 APE 现在可以正常捕获输出。项目自有检查若也会经由原生工具再调用 Dairn/APE，应在入口做同样清理；不要重试或把空日志当成通过。

## 显式维护项目 Pin

候选构建或源码验证不会更新 `.dairn/runtime/` 与 Lock。确需升级时，由维护者选定已验证安装入口，先运行 runtime inspect/promote 的只读计划，审阅来源摘要、兼容性、受管变化和回滚信息，再以计划摘要显式 apply。普通 upgrade --apply 在身份不匹配时返回 RUNTIME_PROMOTION_REQUIRED。

新接口、事务恢复与回滚步骤见 [运行时生命周期](../quickjs/assets/specs/engineering/runtime-lifecycle.md)。计划 hash 不代表人类批准；只有维护者明确授权后才对源码仓库实际执行 Promotion。旧版入口尚无新命令时，从选定并验证的发行载荷入口生成提升计划，不先手工覆盖项目 Pin。

## 观测与复盘

minimal 本地观测默认仅写允许的事件字段；可用 observe config 关闭。CLI 与 Harness 来源独立，缺少宿主事件时尝试次数和首次成功率为 UNKNOWN。可选 Hook 生成 observe-adapter.py 及 Codex/DSH/Claude 桥，不依赖 Work；只有显式接线后才报告可达性，未自动修改用户宿主配置。

Retro 采用单一 dairn.retro.v1，支持七类 Findings、no-action 与 insufficient-evidence。运行引用完整性、机制回放、人工决定和长期效果分别记录，不能用布尔值或绿色 CI 自证。PCC 与它们保持独立，平台上线验收见 [PCC v1](PCC_V1.md)。

## 推送后的交付

1. 创建目标为 `main` 的 PR。功能分支推送本身不触发当前制品 CI，PR 会触发。
2. 确认当前提交的 `全部矩阵通过` 检查成功，完成审查并解决讨论。单人维护不能自我批准；启用独立审批规则前必须确定可用的第二审批人。
3. 合并后，以合并提交重新生成证据。受保护构建与签名独立于 Work 账本，不要求任务停在 implement；本地 review/synchronize 证据不能冒充合并提交的证明。
4. 需要发版时，在已验收的主分支提交上创建版本标签；制品矩阵成功后发布 GitHub Release，再手动触发 npm/PyPI 发布工作流。
5. 核对制品摘要、真实安装结果和回滚版本，再记录发布验收。PR 合并不等于发布完成。

## 平台保护与当前证据边界

正式规范入口为 [治理规范导航](GOVERNANCE_SPEC.md)。实际平台部署和管理员验收见 [受保护发布验收清单](PROTECTED_RELEASE_ACCEPTANCE.md)。本地规则文件、工作流和成功测试都不能证明线上分支保护、签名 runner、审批人或密钥隔离已经启用；必须引用 GitHub 的配置与真实流水线结果。
