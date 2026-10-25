# Dairn 源码仓库指南

## 项目与架构

Dairn 是确定性的工程治理内核，不调用模型，不代替 GitHub 的审批、分支保护或部署平台。CLI 入口为 `quickjs/main.mjs`；`quickjs/core/` 处理项目、风险、检查、证据与工作流；`quickjs/host/qjs.mjs` 适配原生进程与文件系统；`quickjs/assets/` 分发规范、技能和模板。

能力驱动分析入口为 `dairn analyze plan`（默认 dry-run，仅对受信策略允许的只读 execute analyzer 在超时预算内执行）与 `dairn context`（Phase 1 上下文解析 MVP）。二者属于 advisory 决策/检索层，不构成 Gate 判定；契约见 `dairn docs show dairn.engineering.analyzer-selection` 与 `dairn docs show dairn.engineering.context-intelligence`。

`tools/build.py` 与 `tools/build.cjs` 使用 `quickjs.lock.json` 固定的 QuickJS，将当前源码嵌入 APE，生成 ZIP、Wheel 和 npm 制品。Python 和 npm 只提供构建、安装和调用入口，不替代治理内核。源码构建到根目录 `runtime/`（构建产物，仅用于构建、打包和显式验证新源码）；`.dairn/runtime/` 是项目内 vendor 的治理运行时快照，由根目录 `dairn`/`dairn.cmd` 解析，是日常命令的实际执行者；POSIX 按内容摘要复用私有执行镜像，避免修改原文件字节或权限；默认用户缓存不可写时可显式设置绝对路径的 `DAIRN_CACHE_HOME`。两者不得混淆：运行 `runtime/` 必须通过 `DAIRN_RUNTIME` 显式指定。

## 本地开发与门禁

日常直接运行根启动器（POSIX `./dairn`，Windows `dairn.cmd`），它执行 `.dairn/runtime/` 快照，不需要先构建。修改 `quickjs/core/`、`quickjs/host/`、`quickjs/main.mjs` 或资产后先 `python tools/build.py`，再用 `DAIRN_RUNTIME=$PWD/runtime/dairn-embedded.com ./dairn ...` 验证新构建；不要安装另一个 Dairn 来掩盖本分支缺陷。只有需要刷新治理运行时或发布时才执行 vendor/upgrade 流程。

`.dairn/governance/project.json` 的检查统一调用 `python tools/check-source.py <阶段>`：

| 阶段 | 实际范围 | 证据 |
| --- | --- | --- |
| lint | 内嵌规范与技能检查、分发资产回归 | `validation/source-checks/lint-*.log` |
| unit | QuickJS 原生策略、摘要、治理与交接测试、构建发布工具单元测试 | `validation/source-checks/unit-*.log` |
| integration | 原生宿主、真实临时 Git 项目四项检查、失败与超时证据、Doctor、Context、Runtime Lock、Docs、Launcher 与 Analyzer/Quality | `validation/source-checks/integration/`、`integration-*.log` |
| build | Python 和 npm 构建、三类制品校验清单 | `validation/source-checks/build-*.log`、独立 `build-*/checksums.json` |

必需测试目录统一维护在 `tools/check_catalog.py`，本地与 Linux/Windows CI 共用 `tools/check-source.py`。每阶段生成同目录下的 `<阶段>.json`，记录真实 argv、退出码、日志位置与必需/已执行 Check-ID 覆盖；缺项、重复或失败拒绝聚合成功；构建记录中的 `artifact_dir` 指向本轮独立制品目录，避免与旧制品混杂。它们是本地执行记录，不是签名门禁证据；完整 Dairn Run 由 `check` 生成。

默认集成只需要 Python 3.10+、Git 和已构建的 QuickJS；完整本地门禁的构建阶段还需要 Node 18+ 和 npm。普通 Go 检查属于专项兼容性验收，按需运行 `tools/verify-windows.py`，或运行需要 Go、jq、OpenSSL 和 sha256sum 的 `tools/verify-linux.py`。Go race/CGO 不属于默认或 CI 验收。Linux 脚本先执行共享 lint/unit/integration 门禁，再执行未被共享门禁覆盖的 16 个 Python 模块；native、资产和基础集成测试不重复运行，任何共享门禁失败仍使 Linux 验收失败。缺失本次所选检查的依赖直接失败，不自动安装。

```powershell
python tools/build.py                                    # 仅在验证新源码/刷新运行时前
$env:DAIRN_RUNTIME = "$PWD/runtime/dairn-embedded.com"    # 显式让启动器使用本次构建
.\dairn.cmd doctor
.\dairn.cmd validate
Remove-Item Env:\DAIRN_RUNTIME                             # 回到治理运行时快照
```

完整门禁会重建根目录 `runtime/`，因此应在同步 vendor 后从治理运行时快照执行，避免 Windows 锁住待重建的二进制：完整本地验收直接运行根启动器：`./dairn.cmd check --all --timeout 3600`（POSIX `./dairn check --all --timeout 3600`），并确保未设置 `DAIRN_RUNTIME`，以验证治理运行时快照而不误用构建产物。检查脚本将临时文件放在 `validation/source-checks/tmp/`；Dairn 对默认系统临时目录不可写的已初始化项目自动回退到 `.dairn/tmp/`。显式配置的 `TMPDIR` 无效时直接报错；不要修改全局环境或把工具探测失败改成成功。

本仓库的 `.dairn/governance/project.json` 用 `snapshot_exclusions` 声明 `/.build/`、`/dist/`、`/runtime/`、`/validation/`、`__pycache__/` 等生成物边界，使 `check --all` 的输入覆盖率为 `declared-complete`。该字段只能排除被 Git 忽略的生成物，命中已跟踪或未被忽略的未跟踪输入时检查直接失败；前导 `/` 表示锚定仓库根。新增构建输出时同步更新声明，不能为绕过覆盖率而隐藏源码或测试。语义见 `dairn docs show dairn.engineering.evidence-snapshot`。

Windows 上 Cosmopolitan 通过 `_COSMO_FDS_V2` 向子进程传递 fd 表；原生工具（Python/Node 等）再启动 APE 孙进程时该变量指向未继承句柄，会丢失 stdout 或退出 `0xC0000005`。`tools/check-source.py` 在 Windows 启动时清除该变量，因此 `check --all` 内测试再调用项目 launcher 的嵌套 APE 现在可以正常捕获输出。项目自有检查若也会经由原生工具再调用 Dairn/APE，应在入口做同样清理；不要重试或把空日志当成通过。

## 更新本仓库的 .dairn

nightly 版本由构建入口按北京时间自动生成 `0.1.0-nightly.YYYYMMDDHHMMSS`（基础版本取 `package.json`，可用 `DAIRN_BUILD_TIME` 固定）；正式标签版本仍优先，无需再手动刷新版本。更新版本后，先完成本轮构建再更新 vendor，不使用旧版本 runtime。

仅在新构建的相关回归通过后，显式将根目录 `runtime/` 中的 APE 和完整性清单复制到 `.dairn/runtime/`，再用新构建执行升级（否则 lock 记录的是旧运行时身份）；不要手改二进制或摘要：

```powershell
python tools/build.py
Copy-Item runtime/dairn-embedded.com .dairn/runtime/dairn-embedded.com -Force
Copy-Item runtime/runtime-integrity.json .dairn/runtime/runtime-integrity.json -Force
$env:DAIRN_RUNTIME = "$PWD/runtime/dairn-embedded.com"   # 必须用新构建执行 upgrade
.\dairn.cmd upgrade --vendor-runtime .dairn/runtime --plan
.\dairn.cmd upgrade --vendor-runtime .dairn/runtime --apply
Remove-Item Env:\DAIRN_RUNTIME
.\dairn.cmd doctor
.\dairn.cmd validate
```

升级工具验证二进制、版本和摘要，刷新 lock 与受管资源，并保留项目自有策略。`upgrade --apply` 会刷新 lock 与受管根启动器 `dairn`/`dairn.cmd`，并把旧项目中的 `.dairn/bin/dairn`、`.dairn/bin/dairn.cmd` 作为退役受管文件移除；本仓库日常入口仍是根启动器。维护者必须审阅 Git diff；更新快照不构成发布批准。

## 推送后的交付

1. 创建目标为 `main` 的 PR。功能分支推送本身不触发当前制品 CI，PR 会触发。
2. 确认当前提交的 `全部矩阵通过` 检查成功，完成审查并解决讨论。单人维护不能自我批准；启用独立审批规则前必须确定可用的第二审批人。
3. 合并后，以合并提交重新生成证据。受保护构建与签名独立于 Work 账本，不要求任务停在 implement；本地 review/synchronize 证据不能冒充合并提交的证明。
4. 需要发版时，在已验收的主分支提交上创建版本标签；制品矩阵成功后发布 GitHub Release，再手动触发 npm/PyPI 发布工作流。
5. 核对制品摘要、真实安装结果和回滚版本，再记录发布验收。PR 合并不等于发布完成。

## 平台保护与当前证据边界

正式规范入口为 [治理规范导航](GOVERNANCE_SPEC.md)。实际平台部署和管理员验收见 [受保护发布验收清单](PROTECTED_RELEASE_ACCEPTANCE.md)。本地规则文件、工作流和成功测试都不能证明线上分支保护、签名 runner、审批人或密钥隔离已经启用；必须引用 GitHub 的配置与真实流水线结果。
