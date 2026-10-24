# AGENTS.md — Dairn 源码仓库

本仓库是 **Dairn 治理内核的源码仓库**，也通过 `.dairn/` 自我接入治理。`quickjs/assets/` 是分发给目标项目的规范、技能和模板；根目录 `runtime/`、`dist/`、`validation/`、`.build/` 是被忽略的构建与验证产物。

源码是本仓库的事实源。修改内核后先构建并通过根目录启动器验证，再由维护者显式更新 `.dairn/runtime/` 和运行 `upgrade --vendor-runtime`，避免项目 launcher 一直执行旧代码。本仓库允许用已验证的本地构建自测，这不构成官方发行版或受保护 CI 的信任证明。

## Build-first：先构建再调用

不要全局安装 npm/pip 版 Dairn，也不要裸敲 `dairn`。在本仓库中：

- POSIX：先 `python tools/build.py`（或 `npm run build`）生成 `runtime/`，再用 `./dairn.sh <args>`；
- Windows：同样构建后使用 `dairn.cmd <args>`；
- 构建需要 Python 3.10+；首次联网获取 `quickjs.lock.json` 锁定的 QuickJS（缓存 `.build/quickjs/`，可用 `DAIRN_OFFLINE=1` 离线但需预热）；
- 无法构建（缺工具链/网络/权限）时，报告 blocked 及原因；**不要**安装替代运行时或改用其他 Dairn 版本。

## 常用命令

```sh
./dairn.sh version
./dairn.sh docs check                    # 分发资产（specs/skills）门禁
./dairn.sh handoff                       # 只读接手摘要（任意 Git 仓库可用；--json 供 Agent 解析）
python -m unittest quickjs.tests.test_assets_lint
python tools/verify-linux.py /tmp/dairn-verify   # Linux 专项，需 go/git/openssl/jq
python tools/verify-packages.py                  # 制品验收（可选，耗时）
python tools/checksums.py
```

本仓库的 `doctor/validate/check/work` 使用已提交的 `.dairn/lock.json` 与项目自有策略。修改内核或资产后，根目录新构建与旧 lock 的差异会导致校验失败，需审阅并执行升级计划，不能手改摘要绕过。接手时先运行 `dairn.cmd handoff --json`（POSIX 用 `./dairn.sh`）获取只读摘要，并以 `handoff_fingerprint_sha256` 检测会话间工作区变化。

本仓库的四项真实门禁由 `python tools/check-source.py lint|unit|integration|build` 实现，策略入口为 `.dairn/governance/project.json`；不要使用未配置标记的 `pytest -m integration`。默认集成验证轻量临时项目全流程，不需要 Go/gcc；普通 Go 检查和三类制品完整验收保留为专项入口，不把 Go race 作为默认验收。每轮 nightly 用 `python tools/nightly-version.py --apply` 刷新北京时间版本，同轮构建和验收保持版本一致。同步 vendor 后，完整本地验收运行 `.dairn\bin\dairn.cmd check --all --timeout 3600`，避免构建门禁重写正在执行的根目录 APE。具体范围、证据和推送后流程见 `docs/PROJECT_GUIDE.md`。

## 修改规则

- 先读 `README.md`、`BUILDING.md`、`docs/GOVERNANCE.md`；改治理行为时读 `quickjs/assets/specs/` 的对应规范与 `quickjs/assets/skills/dairn-*/SKILL.md`。
- 只改任务范围内的文件；根目录 `runtime/` 只能由构建生成，不提交 `runtime/`、`dist/`、`validation/`、`.build/`。`.dairn/runtime/` 是显式维护的自测快照，只能从审阅并验证的构建更新，同时刷新 launcher 配置与 lock；不要手改二进制或摘要。
- 改 `quickjs/core/**`、`quickjs/host/**` 或 `quickjs/main.mjs` 后**必须重新构建 runtime 再验证**，旧 runtime 会掩盖改动。
- 改 `quickjs/assets/**` 后**必须**运行 `./dairn.sh docs check`；新增/改名资产要满足 frontmatter、命令面与相对链接规则。
- 新增或改名被 `.gitignore` 忽略的构建输出/缓存目录时，同步更新 `.dairn/governance/project.json` 的 `snapshot_exclusions`，让 `check` 的输入覆盖率保持 `declared-complete`；排除项只能声明生成物边界，不得隐藏源码、测试或配置（命中已跟踪/未忽略输入会 fail closed）。语义见 `dairn docs show dairn.engineering.evidence-snapshot`。
- 不修改他人负责的文件；并行任务只改 shared task 标明的 write scope。
- 不伪造测试、机器证据或批准；未执行的检查不得声称通过。报告命令、退出码与证据路径。

## 安全

- `.dairn/runtime/` 仅作本仓库固定自测入口；不执行 PR 中未审查的二进制。CI 从源码构建，受保护签名使用外部固定的运行时和策略，不信任 PR 自带的 APE 或摘要。
- Agent 不得自行安装 Dairn、修改全局环境或绕过受保护 CI；CI 使用固定版本与外部 pin。
- 发现疑似凭据/敏感数据时停止并报告，不要写入日志或文档。

## 汇报

汇报格式：改动文件清单 → 验证命令与结果 → 未验证项/风险。不得省略失败、跳过或无法运行的项目。

<!-- Dairn:BEGIN managed navigation -->
Dairn — AI-Native Software Engineering Toolkit.
Project launcher: `./.dairn/bin/dairn` (Windows: `.dairn\bin\dairn.cmd`); `dairn` below is shorthand for this launcher. Never install Dairn during a task; if the launcher is missing, stop and report.
Run `dairn doctor`, `dairn validate`, or `dairn check --base <trusted-ref>` before PR/MR.
Discover shared guidance with `dairn docs find <topic>`; additional Skills via `dairn skills add <name> --apply`.
Project governance policy: `.dairn/governance/project.json`; decisions: `.agents/notes/`.
Project-specific context: `README.md` and `docs/PROJECT_GUIDE.md`; run `dairn guide plan` to enrich with observed facts.
For task continuity use `dairn work start <task> --id <id>` and `dairn work next --id <id>`; inspect impact using `dairn guide impact`.
Task slices: `dairn tasks check` / `dairn tasks ready`; release asset consistency: `dairn docs check`; local hooks: `dairn hooks install --apply`.
For language-specific analysis run `dairn analyzers templates` then `dairn analyzers init --template LANGUAGE --id NAME --apply` and `dairn guide impact --analyzer <analyzer-id>`.
AI Agents call Dairn; Dairn does not invoke a model. Codex and DeepSeek Harness use AGENTS.md; Claude Code follows CLAUDE.md.
<!-- Dairn:END managed navigation -->
