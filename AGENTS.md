# AGENTS.md — Dairn 源码仓库

本仓库是 **Dairn 治理内核的源码仓库**，也通过 `.dairn/` 自我接入治理。`quickjs/assets/` 是分发给目标项目的规范、技能和模板；根目录 `runtime/`、`dist/`、`validation/`、`.build/` 是被忽略的构建与验证产物。文档地图见 [README.md](README.md)，各宿主加载方式见 [docs/AGENT_INTEGRATION.md](docs/AGENT_INTEGRATION.md)。

## 启动器

不要全局安装 npm/pip 版 Dairn，也不要裸敲 PATH 中的 `dairn`。本仓库：

- 唯一启动器是仓库根的 `./dairn`（Windows `dairn.cmd`），实际执行 `.dairn/runtime/` 中 vendor 的治理运行时快照，日常使用不需要先构建；
- 根目录 `runtime/` 是旧构建遗留（被忽略），新的构建不写入；源码验证用 tools/with-built-runtime.py 管理候选；
- 分发 ZIP 自带同目录 `.dairn/runtime/`，解压后即可运行 `./dairn init`/`./dairn adopt`；pip/npm 安装后的 `init`/`adopt` 同样在项目根生成启动器，并经由 `DAIRN_RUNTIME_DIR` 把包内运行时复制到 `.dairn/runtime/`，**不再回退**安装包内的 `runtime/`；
- 启动器缺失或无法执行（`DAIRN_NOT_AVAILABLE`、缺工具链/网络/权限）时：报告 blocked 及原因；**不要**安装替代运行时或改用其他 Dairn 版本。

## 常用命令

```sh
./dairn version
./dairn docs check                               # 分发资产（specs/skills）门禁
./dairn handoff --json                           # 只读接手摘要
python -m unittest quickjs.tests.test_assets_lint
python tools/with-built-runtime.py -- python tools/verify-linux.py /tmp/dairn-verify   # Linux 专项，需 go/git/openssl/jq
python tools/verify-packages.py                  # 制品验收（可选，耗时）
python tools/checksums.py
```

- 本仓库四项真实门禁：`python tools/check-source.py lint|unit|integration|build`，策略入口 `.dairn/governance/project.json`；不要使用未配置标记的 `pytest -m integration`。
- 完整本地验收：`./dairn check --all --timeout 3600`。源码门禁使用私有候选，build 只保留发行制品；固定 Runtime 不受影响。
- nightly 版本由构建入口按北京时间自动生成（`DAIRN_BUILD_TIME` 可固定，基础版本取 `package.json` 三段号）；同一轮构建与验收共用同一时间戳，发布版本仍以标签为准，不再手动刷新 `package.json`。
- 验证新源码：`python tools/with-built-runtime.py -- python tools/check-source.py unit|integration|lint`；候选仅注入子进程，退出后清理。需要更新治理 Pin 时，维护者另行审阅 runtime promote 计划并显式应用，见 docs/PROJECT_GUIDE.md。
- 首次构建需 Python 3.10+，联网获取 `quickjs.lock.json` 锁定的 QuickJS（缓存 `.build/quickjs/`；`DAIRN_OFFLINE=1` 可离线但需预热）。
- `dairn doctor` 的 `runtime.source` 与 `runtime.freshness` 是观察字段；运行时身份以 lock 的 `runtime_sha256` 为准。

## 修改规则

- 先读 `README.md`、`BUILDING.md`、`docs/GOVERNANCE.md`；改治理行为时读 `quickjs/assets/specs/` 对应规范与 `quickjs/assets/skills/dairn-*/SKILL.md`。
- 只改任务范围内的文件；不提交 `runtime/`、`dist/`、`validation/`、`.build/`。`.dairn/runtime/` 是显式维护的自测快照，只能从审阅并验证的构建更新，同时刷新启动器配置与 lock；不要手改二进制或摘要。
- 改 `quickjs/core/**`、`quickjs/host/**` 或 `quickjs/main.mjs` 后**必须用 with-built-runtime.py 重新构建候选再验证**，旧 Runtime 会掩盖改动。
- 改 `quickjs/assets/**` 后**必须**运行 `python tools/with-built-runtime.py -- ./dairn docs check`（验证当前资产）；新增/改名资产要满足 frontmatter、命令面与相对链接规则。
- 新增或改名被 `.gitignore` 忽略的构建输出/缓存目录时，同步更新 `.dairn/governance/project.json` 的 `snapshot_exclusions`，让 `check` 的输入覆盖率保持 `declared-complete`；排除项只能声明生成物边界，不得隐藏源码、测试或配置（命中已跟踪/未忽略输入会 fail closed）。语义见 `dairn docs show dairn.engineering.evidence-snapshot`。
- 不修改他人负责的文件；并行任务只改 shared task 标明的 write scope。
- 不伪造测试、机器证据或批准；未执行的检查不得声称通过。报告命令、退出码与证据路径。

## 安全

- `.dairn/runtime/` 仅作本仓库固定自测入口；不执行 PR 中未审查的二进制。CI 从源码构建，受保护签名使用外部固定的运行时和策略，不信任 PR 自带的 APE 或摘要。
- Agent 不得自行安装 Dairn、修改全局环境或绕过受保护 CI；CI 使用固定版本与外部 pin。
- 发现疑似凭据/敏感数据时停止并报告，不要写入日志或文档。

## 汇报

改动文件清单 → 验证命令与结果 → 未验证项/风险。不得省略失败、跳过或无法运行的项目。

<!-- Dairn:BEGIN managed navigation -->
Dairn — AI-Native Software Engineering Toolkit.
Project launcher: `./dairn` (Windows: `dairn.cmd`); `dairn` below is shorthand for this launcher. Never install Dairn during a task; if the launcher is missing, stop and report.
Run `dairn doctor`, `dairn validate`, or `dairn check --base <trusted-ref>` before PR/MR.
Discover shared guidance with `dairn docs find <topic>`; additional Skills via `dairn skills add <name> --apply`.
Project governance policy: `.dairn/governance/project.json`; decisions: `.agents/notes/`.
Project-specific context: `README.md` and `docs/PROJECT_GUIDE.md`; run `dairn guide plan` to enrich with observed facts.
For task continuity use `dairn work start <task> --id <id>` and `dairn work next --id <id>`; inspect impact using `dairn guide impact`.
Task slices: `dairn tasks check` / `dairn tasks ready`; release asset consistency: `dairn docs check`; local hooks: `dairn hooks install --apply`.
For language-specific analysis run `dairn analyzers templates` then `dairn analyzers init --template LANGUAGE --id NAME --apply` and `dairn guide impact --analyzer <analyzer-id>`.
AI Agents call Dairn; Dairn does not invoke a model. Codex and DeepSeek Harness use AGENTS.md; Claude Code follows CLAUDE.md.
<!-- Dairn:END managed navigation -->
