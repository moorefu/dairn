# 一体化 v1 分支验收记录

本分支按维护者要求集中实现统一提案，随后补齐启动器摩擦修复、固定运行时更新和 Python 标准库实测。提案建议分八批 PR；本次采用同一分支集中审查，不能以组件测试替代每批的平台验收。

## 交付判断

源码组件已实现，并在独立审查后修复候选生命周期、事务恢复、观测闭合、回放真实性、Base 策略绑定、内置检查分派和审批证据打包问题。本地四项门禁和三类制品冒烟已经通过；无网络 Podman 全套已执行完毕，140 项专项中 137 项通过、3 项旧预期断言失败。安全行为没有放行；受影响用例与治理 CLI 模块在同一环境补验 7 项全部通过（退出码 0）。本轮验收由原始完整套件和该补验共同组成，最终分支仍待 PR CI 整套复验。

PCC-02 尚未达到提案的 Done：本次没有部署专用 GitHub App、隔离 Publisher、线上 Required Gate 或 Ruleset，也没有真实 PR 拒绝合并的故障注入证据。Windows 实机、ARM64 与六平台矩阵等待 CI；OBS-02 的真实宿主接线同样未验收。PR 用于组件审查和平台验证，不能标记整份提案已经交付。

## 验收索引

“组件”指本地真实命令或受控故障夹具；“待平台”明确表示尚无目标平台证据。命令和持久日志目录列于文末。

| 索引 | 实现与组件证据 | 尚未闭合的验收 |
| --- | --- | --- |
| RT01 | 隔离暂存区；候选、打包测试核对 Pin/Lock 不变；清理拒绝中间父目录符号链接越界 | 最终 Linux/六平台状态见验证记录 |
| RT02 | 包装器保留退出码和摘要；SIGKILL 后活动子进程拒绝清理 | Windows 中断实测待 CI |
| RT03 | Windows Job 跟踪和 cleanup-deferred | Windows 活动 APE 实机待 CI |
| RT04 | 并行候选独占目录与固定时间摘要回归 | Windows 并发待 CI |
| RT05 | 普通 upgrade 不复制候选载荷 | 组件已测 |
| RT06 | 根启动器固定 Pin，不查询 PATH 安装版 | 组件已测；不安装替代运行时 |
| RT07 | Plan 绑定来源、目标、摘要；替换候选拒绝 | 组件已测 |
| RT08 | journal、备份、锁归属、rollback/recover 故障注入 | Windows 文件占用/断电实机待 CI |
| RT09 | 兼容性声明缺失或未知拒绝激活 | 真正旧版本不支持新增必需契约的端到端实测待补 |
| RT10 | ZIP/Wheel/npm 同轮时间、同一 APE、独立安装冒烟 | 六平台矩阵待 CI |
| OB01 | CLI 成败、原退出码、duration 和脱敏事件回归 | 组件已测 |
| OB02 | Python Harness 适配器记录 CLI 启动前失败 | DSH 真实宿主接线待验收 |
| OB03 | 未接线/不闭合 Session 为 UNKNOWN | 组件已测 |
| OB04 | 每次调用独立原子文件；并发适配器测试 | 组件已测 |
| OB05 | 损坏记录与暂存缺口；恢复后有界重试，不改业务退出 | 完全不可写且进程结束时无法保证持久化缺口，须报告覆盖未知 |
| OB06 | 白名单事件，不存参数、Prompt、令牌和用户绝对路径 | 组件已测；local-full 当前仍采用 minimal 白名单 |
| OB07 | 本地观测仅 advisory，不能形成受信 Gate 证明 | 组件已测 |
| OB08 | 不同 Input Snapshot 不等价 | 组件已测 |
| OB09 | 任务绑定、条件完整性和覆盖描述；条件不同不可归因模型 | 同一真实任务的 Codex/DSH 配对执行待验收 |
| RV01 | 不存在来源与篡改输出不能进入 verified | 组件已测 |
| RV02 | 单一 v1 七类 findings 独立迁移 | 组件已测 |
| RV03 | no-action 合法，草案迁移不继承授权 | 组件已测 |
| RV04 | 缺接线建议与 Check 修复区分 | 组件已测 |
| RV05 | 布尔 red/verified 不能代替真实命令与输出摘要 | 组件已测 |
| RV06 | CI 变绿不直接证明 KPI 改善 | 组件已测 |
| RV07 | 无等价输入重试不得确认 flaky | 组件已测 |
| RV08 | 失败回放可 revised/retired/ineffective，重新核对依赖 | 组件已测 |
| RV09 | Prune 只输出建议，受保护项要求独立审批/等效保障 | 真实平台审批负例待验收 |
| RV10 | Retro 没有自动写 Runtime/Policy 路径 | 真实宿主越权负例待验收 |
| PC01 | 不可变 Base 策略不被 Head 降级；真实 Git 夹具 | 真实 Required Gate 故障注入待部署 |
| PC02 | 删除 Head 必需项仍执行 Base 矩阵 | 同上 |
| PC03 | 来源未认证为 POLICY_UNTRUSTED/INDETERMINATE | 真实 GitHub 来源闭环待部署 |
| PC04 | 全局契约缺执行器拒绝；有执行器实际运行 | 平台待部署 |
| PC05 | 必需项缺失/重复/ID 冲突拒绝 | 平台待部署 |
| PC06 | 普通检查与隔离执行器共用分派；失败码/timeout 回归 | 平台超时注入待部署 |
| PC07 | Subject/Head 绑定拒绝旧结果 | 平台旧 Head 注入待部署 |
| PC08 | Plan/Policy/argv/cwd/timeout 摘要绑定 | 平台待部署 |
| PC09 | 独立只读 API 核验器拒绝普通同名状态及共享 App 冒充 | 专用 App 与真实同名状态注入待部署 |
| PC10 | JSON 无法恢复当前进程的真实验签身份；Ed25519 实测 | 组件已测 |
| PC11 | 独立、有效且当前 Head 的审批下限；签名绑定审批文件 | 真实 stale/dismissed/self review 待平台 |
| PC12 | 固定外部 Runtime/配置/密钥边界的部署接口 | 隔离 Runner/Signer/Publisher 权限须部署方验收 |
| PC13 | Advisory Analyzer 不单独阻断已完整保障 | 组件已测 |
| PC14 | v1 L0 显式低风险集合不强制 Work/Retro/Grill | 真实小文档 PR 待 CI |

## 主要改动文件

- Runtime：`tools/with-built-runtime.py`、`tools/runtime_context.py`、`tools/cleanup-candidates.py`、`quickjs/core/runtime-promotion.mjs` 与构建/测试入口；固定快照及 Lock 单独显式提升。
- 观测与复盘：`quickjs/core/observe.mjs`、`retro.mjs`、`retro-effects.mjs`、Harness 适配器、Work/Feedback 与对应 Skill/Spec。
- PCC：`quickjs/core/governance-plan.mjs`、`checks.mjs`、`stack-check.mjs`、`gate.mjs`、`attestation.mjs` 和 `ci/protected/pcc-gate.py`。
- 使用摩擦：根/模板 POSIX 启动器、`tools/verify-linux.py`、`tools/verify-podman.py`、Python 实测及文档；Windows 启动器保留原生 APE 入口。

## 验证记录

最终构建版本为 `0.1.0-nightly.20261025232338`，APE SHA256 为 `0b503ce3fd7246fc135ad13ddefde865cdce0fb221893e7ac557a93ff9a3784a`。本地四项门禁全部通过（退出码 0，`validation/ship-e-local-check.log`；候选摘要 `validation/runtime-builds/35666-axr38g5r/summary.json`，清理 completed），其中工具单测 107 项通过。Linux 完整命令原始退出码为 1：共享 lint/unit/integration 全部退出 0，专项 140 项中 137 项通过、3 项失败、0 错误、0 跳过；APE 原始字节不变。原始记录为 `validation/ship-linux-e/linux-summary.json`、`linux-regression.log` 与 `podman.json`，没有重写为通过。三类制品安装冒烟已经通过（退出码 0，`validation/ship-e-package-smoke/summary.json`）。所有 `validation/` 日志均为本地生成物，不纳入 Git，也不代表平台受信签名。

独立审查的窄回归日志：

- `validation/runtime-review-python-final.log`：候选清理与事务恢复。
- `validation/observe-retro-review-final/summary.json`：观测、回放、迁移与资产。
- `validation/pcc-review-regressions.log`、`validation/pcc-work-policy-regressions.log`：审批/矩阵/Work 绑定。
- `validation/pcc-executor-approval-red.log`、`validation/pcc-executor-approval-regressions.log`：内置分派及审批打包的 Red→Green。
- `validation/ship-orchestration-unit.log`：Linux 去重、Podman 离线/超时诊断与跨平台路径。

首次 Podman 完整尝试暴露镜像缺少 `python` 别名，`source-integration` 失败；修正测试镜像后重跑，旧失败保留，不计为通过。旧容器在确认该环境问题后停止（容器退出 143），诊断已复制，未完成的专项回归不计入验收。之前 VM 存储 I/O 故障和 ZIP 名称丢失的失败也保留于本地日志。

补充组件验收：清理越界用例先复现错误删除临时夹具（Red，退出 1），修复后候选生命周期 8 项通过（退出 0）；Linux 普通用户下该边界用例通过（退出 0）。证据为 `validation/candidate-cleanup-boundary-red.log`、`candidate-cleanup-boundary-green.log`、`candidate-cleanup-boundary-linux.log`。这项最终工具修复晚于完整 Linux 容器的源码复制，已在独立目录补验，没有修改正在运行的套件。

最终构建的 macOS x64 观测组件测量：100 次采样，首次 5 ms；开启时 p50 2 ms、p95 3 ms，关闭时 p50 0 ms、p95 1 ms。证据 `validation/ship-e-observe-benchmark.json`。磁盘类型未测量；不包含 CLI 启动、缓存及业务执行，也不外推 Windows/其他平台。

独立 Runtime、OBS/Retro、PCC 组件审查发现的问题均已修复并补回归。外部 Codex 首轮复现的两项问题已完成 Red→Green；修复后的外部复评因源码外传风险被自动审批拒绝，未重试或绕过。最终差异由当前会话继续检查，不声称外部复评已通过。

项目 Pin 已通过 `runtime promote --source installed --plan` 审阅并显式应用，事务 `mvnzjzfz-iq20rkw7`，结果 applied、可回滚。版本与上述最终制品一致；Lock 的 Runtime 设计身份为 `87a5b36bfb47c88f36f6768969d229d236912418797c82c27bec41a47b0ad6b1`。应用后用根启动器运行 `version`、`doctor`、`validate`、`docs check`，四项均退出 0；证据 `validation/ship-e-project-runtime/summary.json`。未设置候选覆盖变量。

## 复现命令与环境

本轮同一构建时间为 `2026-10-25T23:23:38+08:00`，Python/npm 构建分别使用 `--out validation/ship-e-artifacts`，随后 `python tools/checksums.py --dist validation/ship-e-artifacts`。首次误用 `checksums.py --out` 退出 2，已改用正式 `--dist` 参数成功生成清单；没有把该失败算成通过。

本地四项门禁使用 `python tools/with-built-runtime.py --from-zip validation/ship-e-artifacts/dairn-0.1.0-nightly.20261025232338.zip -- python tools/check-source.py <阶段>` 的同一候选上下文，阶段依次为 lint、unit、integration、build。制品冒烟命令为 `python tools/verify-packages.py --artifacts validation/ship-e-artifacts --smoke --out validation/ship-e-package-smoke`。

完整 Linux 命令：

```sh
python tools/verify-podman.py \
  --image localhost/dairn-linux-verify:20261025-alias \
  --runtime-zip validation/ship-e-artifacts/dairn-0.1.0-nightly.20261025232338.zip \
  --test-user dairn-test --timeout 3600 --out validation/ship-linux-e
```

实际镜像在预备阶段装齐工具，测试阶段为 network=none、UID/GID=1000。镜像 ID 为 `2033a1e29aa9bc47a5e115252db7b94aacad65e7ac7b8ed7e1bd37be79e6181b`；Linux amd64，Python 3.11.2（python/python3 同一解释器）、Go 1.27.3、Node 18.20.4、npm 9.2.0、jq 1.6、OpenSSL 3.0.22、Git 2.39.5。工具版本原始记录 `validation/ship-e-linux-toolchain.log`。这是本次本地镜像环境，不冒充 `tools/Containerfile.validation` 的 Python 3.12/Node 22 默认组合或六平台 CI。

Linux 完整套件发现 `test_policy_change_invalidates_machine_evidence` 的旧诊断断言失败：程序已按不可变 Base 验证，Head 策略文件修改触发 `Worktree changed`，测试仍匹配 `Policy changed`。单条原用例已在同一环境复现（退出 1，`validation/linux-policy-diagnostic-red.log`）；修正后同时断言 Run 绑定真实 Base 策略摘要、Head 修改仍非零拒绝，补跑 1 项通过（退出 0，`validation/linux-policy-diagnostic-green-v2.log`）。没有修改核心或最终 APE，也没有放宽拒绝条件。补验入口初次因夹具路径层级不足退出 1，调整独立夹具路径后成功，原失败日志保留。完整套件的原始退出码和失败记录不会被补验覆盖，最终汇总分别列出。

完整 Linux 的另外两条失败位于治理 CLI 旧夹具：审批预期缺少新增的 `min_count: 1`；契约预期把仅在 Head 提议的记录直接视为 Base 生效契约。修正测试后明确验证：Head 删除执行器不能削弱本次 Base，新 Base 自身缺执行器仍报 MISSING_CAPABILITY；Head 契约不会自动生效，进入后续 Base 后必须有显式执行器。原失败由完整套件真实复现，没有修改核心来迎合旧断言。补验覆盖策略证据用例及整个治理 CLI 模块，最终结果见 `validation/linux-final-followup/`。

最终补验结果：`validation/linux-final-followup/tests.log` 记录 7 项通过、0 失败、0 跳过，耗时 122.768 秒；驱动退出 0，候选摘要记录 cleanup=completed。`summary.json` 保存同一镜像、network=none、普通用户和 APE 摘要。完整套件专项耗时 1656.675 秒，原始退出 1 保留；全部诊断均已复制，任务容器已清理。最终源码修正仅涉及两份测试与本记录，运行时核心和制品字节不变。

`./dairn tasks check` 退出 0（8 个任务、0 错误、0 告警）；任务未批量标记 Done，因为跨平台和 PCC 部署证据尚缺。`guide impact --base origin/main` 退出 0、结果为 heuristic 的 contract-impact，仅用于文档审查，不作为语义正确或批准证明。远端 main 复核仍为 `3ba5568d46f34bdb3aec46c34a65df976f19d087`。

## 2026-10-26：PR #4 集成回归修复

原始 Linux 失败来自 Launcher 夹具混用了旧 Pin 与新候选，以及三份受保护脚本在 Git 中缺少执行位。Windows 还暴露了离线测试未预置锁定 QuickJS、Python 子进程编码、生成模块路径的反斜杠问题。提交 `15258fc` 修正这些入口后，云端 Linux 完整回归通过；Windows 剩余 10 项失败的原始日志与制品保留在 `validation/ci-failures-15258fc/`。

剩余失败中，9 项事务恢复因固定 Cosmopolitan 4.0.2 的 Windows 零信号接口无法可靠确认所有者退出而被安全拒绝；不能把权限错误解释为已退出。Windows 改用系统 PowerShell 的只读 .NET 进程查询，查询失败仍返回未知并拒绝恢复。另 1 项是测试恢复 Run 时的文本换行转换，已改为原始字节恢复，保留摘要篡改拒绝断言。新增真实 Python 子进程的存活、退出、探测不终止目标及查询工具不可用回归，并明确验证未知状态不能夺锁。平台行为仍须由修复提交的 Windows CI 实跑确认。

本地定向 16 项通过；隔离 ZIP 上单元与集成阶段均退出 0，工具单测 109 项通过。日志为 `focused-green.log`、`candidate-recheck.log`。最终构建再通过原生宿主、集成组件、存活查询回归与资产检查，日志 `candidate-v2-probes.log`。一次错误验证入口直接使用无执行位的构建输出，产生的失败保留在 `incorrect-entry/` 与 `candidate-verify.log`，不计为通过。

项目 Pin 已显式提升到 `0.1.0-nightly.20261026010634`，APE SHA256 为 `1175ae0154497cbd8ae3925030a15c593b17e198e96eb3e7577471b0e6db57e1`，设计身份为 `34faccc970254701fb08e457dabb00c723c3cdc27a67719da4acd385030ea63a`。事务 `mvo2zzdv-atn3zun7` 已应用、可回滚、无受管资产迁移；Launcher 配置与 Lock 同步更新。提升后根启动器的 `version`、`doctor`、`validate`、`docs check` 均退出 0，证据 `pin-checks.log`。本节相对日志路径均位于 `validation/ci-failures-15258fc/`，不代表平台批准或签名。

随后提交 `6ec0800` 的本地四项门禁全部通过，真实 Run 为 `run-mvo38t7m-8rvdwsu7f6`，`work verify --require-machine-gates` 退出 0；但 Windows 实跑仍因存活查询返回未知而失败，原始制品保留在 `validation/ci-failures-6ec0800/`。补充底层诊断并在查询前规范化 `SYSTEMROOT` 后，提交 `8fd8a0f` 的 [Windows 完整套件](https://github.com/moorefu/dairn/actions/runs/40216075174/job/121237465218)通过；工具单测运行 109 项，其中既有 POSIX 专用条件跳过 8 项，失败 0。真实进程存活、退出、映射盘符、工具缺失以及全部事务恢复用例均通过。六平台制品冒烟也已通过；当时 Linux 专项仍在运行，最终状态以对应提交的 CI 汇总为准。

最终 Pin 选用上述 CI 的同一构建制品，版本 `0.1.0-nightly.20261026012141`，APE SHA256 `252548bd67902da401db0b05e3c7aa29aaecb8d644ee4e1dcca5311a1dab2a41`，设计身份 `0e7250f3170e8f862d04a7cd93ade2f04aee63a614ebb50bb3777aa0c84bdc66`。外层制品摘要与 GitHub 记录一致，三类包均与 CI 校验清单一致；本机原生宿主、集成组件、存活查询与资产补验退出 0。提升事务 `mvo3rydn-m61v3zxa` 已应用、可回滚、无受管资产迁移；Launcher 与 Lock 同步更新。证据位于 `validation/ci-failures-8fd8a0f/`，包括 `unit-10.log`、`pin-candidate-probes.log` 与 `promotion-apply.json`。
