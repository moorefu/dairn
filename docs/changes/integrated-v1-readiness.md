# 一体化 v1 分支验收记录

本分支按维护者要求集中实现统一提案，随后补齐启动器摩擦修复、固定运行时更新和 Python 标准库实测。提案建议分八批 PR；本次采用同一分支集中审查，不能以组件测试替代每批的平台验收。

## 交付判断

源码组件已实现，并在独立审查后修复候选生命周期、事务恢复、观测闭合、回放真实性、Base 策略绑定、内置检查分派和审批证据打包问题。最终源码正在进行本地及无网络 Podman 验收，结果将在提交前填入。

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

最终构建版本为 `0.1.0-nightly.20261025232338`，APE SHA256 为 `0b503ce3fd7246fc135ad13ddefde865cdce0fb221893e7ac557a93ff9a3784a`。本地四项门禁全部通过（退出码 0，`validation/ship-e-local-check.log`；候选摘要 `validation/runtime-builds/35666-axr38g5r/summary.json`，清理 completed），其中工具单测 107 项通过。Linux 结果待本轮完成后更新；三类制品安装冒烟已经通过（退出码 0，`validation/ship-e-package-smoke/summary.json`）。所有 `validation/` 日志均为本地生成物，不纳入 Git，也不代表平台受信签名。

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
