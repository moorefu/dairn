# Dairn 源码仓库指南

## 项目与架构

Dairn 是确定性的工程治理内核，不调用模型，不代替 GitHub 的审批、分支保护或部署平台。CLI 入口为 `quickjs/main.mjs`；`quickjs/core/` 处理项目、风险、检查、证据与工作流；`quickjs/host/qjs.mjs` 适配原生进程与文件系统；`quickjs/assets/` 分发规范、技能和模板。

`tools/build.py` 与 `tools/build.cjs` 使用 `quickjs.lock.json` 固定的 QuickJS，将当前源码嵌入 APE，生成 ZIP、Wheel 和 npm 制品。Python 和 npm 只提供构建、安装和调用入口，不替代治理内核。源码构建到根目录 `runtime/`；`.dairn/runtime/` 是维护者显式同步的自测快照，两者不得混淆。

## 本地开发与门禁

先运行 `python tools/build.py`；Windows 通过 `dairn.cmd` 验证新构建，POSIX 通过 `./dairn.sh`。不要安装另一个 Dairn 来掩盖本分支缺陷。

`.dairn/governance/project.json` 的检查统一调用 `python tools/check-source.py <阶段>`：

| 阶段 | 实际范围 | 证据 |
| --- | --- | --- |
| lint | 内嵌规范与技能检查、分发资产回归 | `validation/source-checks/lint-*.log` |
| unit | QuickJS 原生策略、摘要、治理与交接测试、构建发布工具单元测试 | `validation/source-checks/unit-*.log` |
| integration | 原生宿主、真实临时 Git 项目四项检查、失败与超时证据、doctor、vendor 离线升级 | `validation/source-checks/integration/`、`integration-*.log` |
| build | Python 和 npm 构建、三类制品校验清单 | `validation/source-checks/build-*.log`、独立 `build-*/checksums.json` |

每阶段生成同目录下的 `<阶段>.json`，记录真实 argv、退出码和日志位置；构建记录中的 `artifact_dir` 指向本轮独立制品目录，避免与旧制品混杂。它们是本地执行记录，不是签名门禁证据；完整 Dairn Run 由 `check` 生成。

默认集成只需要 Python 3.10+、Git 和已构建的 QuickJS；完整本地门禁的构建阶段还需要 Node 18+ 和 npm。普通 Go 检查属于专项兼容性验收，按需运行 `tools/verify-windows.py`，或运行需要 Go、jq、OpenSSL 和 sha256sum 的 `tools/verify-linux.py`。Go race/CGO 不属于默认或 CI 验收。缺失本次所选检查的依赖直接失败，不自动安装。

```powershell
python tools/build.py
.\dairn.cmd doctor
.\dairn.cmd validate
.\.dairn\bin\dairn.cmd check --all --timeout 3600
```

完整门禁会重建根目录 `runtime/`，因此应在同步 vendor 后从项目启动器执行，避免 Windows 锁住待重建的二进制。检查脚本将临时文件放在 `validation/source-checks/tmp/`；Dairn 对默认系统临时目录不可写的已初始化项目自动回退到 `.dairn/tmp/`。显式配置的 `TMPDIR` 无效时直接报错；不要修改全局环境或把工具探测失败改成成功。

本仓库的 `.dairn/governance/project.json` 用 `snapshot_exclusions` 声明 `/.build/`、`/dist/`、`/runtime/`、`/validation/`、`__pycache__/` 等生成物边界，使 `check --all` 的输入覆盖率为 `declared-complete`。该字段只能排除被 Git 忽略的生成物，命中已跟踪或未被忽略的未跟踪输入时检查直接失败；前导 `/` 表示锚定仓库根。新增构建输出时同步更新声明，不能为绕过覆盖率而隐藏源码或测试。语义见 `dairn docs show dairn.engineering.evidence-snapshot`。

Windows 上 Cosmopolitan 通过 `_COSMO_FDS_V2` 向子进程传递 fd 表；原生工具（Python/Node 等）再启动 APE 孙进程时该变量指向未继承句柄，会丢失 stdout 或退出 `0xC0000005`。`tools/check-source.py` 在 Windows 启动时清除该变量，因此 `check --all` 内测试再调用项目 launcher 的嵌套 APE 现在可以正常捕获输出。项目自有检查若也会经由原生工具再调用 Dairn/APE，应在入口做同样清理；不要重试或把空日志当成通过。

## 更新本仓库的 .dairn

每轮 nightly 先运行 `python tools/nightly-version.py --apply`，以北京时间生成 `0.1.0-nightly.YYYYMMDDHHMMSS`；正式标签版本仍优先。更新版本后，先完成本轮构建再更新 vendor，不使用旧版本 runtime。

仅在新构建的相关回归通过后，显式将根目录 `runtime/` 中的 APE 和完整性清单复制到 `.dairn/runtime/`，然后通过根目录启动器运行：

```powershell
.\dairn.cmd upgrade --vendor-runtime .dairn/runtime --plan
.\dairn.cmd upgrade --vendor-runtime .dairn/runtime --apply
.\.dairn\bin\dairn.cmd doctor
.\.dairn\bin\dairn.cmd validate
```

升级工具验证二进制、版本和摘要，刷新 lock 与受管资源，并保留项目自有策略。维护者必须审阅 Git diff；更新快照不构成发布批准。

## 推送后的交付

1. 创建目标为 `main` 的 PR。功能分支推送本身不触发当前制品 CI，PR 会触发。
2. 确认当前提交的 `全部矩阵通过` 检查成功，完成审查并解决讨论。单人维护不能自我批准；启用独立审批规则前必须确定可用的第二审批人。
3. 合并后，以合并提交重新生成证据。受保护构建与签名独立于 Work 账本，不要求任务停在 implement；本地 review/synchronize 证据不能冒充合并提交的证明。
4. 需要发版时，在已验收的主分支提交上创建版本标签；制品矩阵成功后发布 GitHub Release，再手动触发 npm/PyPI 发布工作流。
5. 核对制品摘要、真实安装结果和回滚版本，再记录发布验收。PR 合并不等于发布完成。

## 平台保护与当前证据边界

正式规范入口为 [治理规范导航](GOVERNANCE_SPEC.md)。实际平台部署和管理员验收见 [受保护发布验收清单](PROTECTED_RELEASE_ACCEPTANCE.md)。本地规则文件、工作流和成功测试都不能证明线上分支保护、签名 runner、审批人或密钥隔离已经启用；必须引用 GitHub 的配置与真实流水线结果。
