# Dairn

Dairn 是供 AI Agent 调用的开发治理内核，提供项目初始化、确定性检查、工作流状态、影响分析和证据验证。治理逻辑运行于自带的 Cosmopolitan QuickJS APE；Dairn 不调用模型。

## 安装

npm 包名是 `@moorefu/dairn`（unscoped `dairn` 被 npm 以“与既有包过于相似”为由拒绝），PyPI 分发名与模块名是 `dairn`；包内自带 APE 和校验信息，安装时无需另外下载运行时。CLI 命令名是 `dairn`。版本由发布标签决定：正式版进入默认通道，预发布进入 npm 的 `next` dist-tag 与 PyPI 的预发布通道。

| 渠道 | 安装方式 | 环境 |
| --- | --- | --- |
| npm（[npmjs.com](https://www.npmjs.com/package/@moorefu/dairn)） | `npm install @moorefu/dairn`；预发布 `npm install @moorefu/dairn@next` | Node.js 18+、npm |
| PyPI（[pypi.org](https://pypi.org/project/dairn/)） | `python -m pip install dairn`；预发布 `python -m pip install --pre dairn` | Python 3.10+ |
| 离线 tgz（[dairn-latest.tgz](https://github.com/moorefu/dairn/releases/download/latest/dairn-latest.tgz)） | `npm install --offline --ignore-scripts ./dairn-latest.tgz` | Node.js 18+、npm |
| 离线 Wheel（[安装索引 wheels.html](https://github.com/moorefu/dairn/releases/download/latest/wheels.html)） | `python -m pip install --upgrade --pre --no-index --find-links ./wheels.html dairn` | Python 3.10+ |
| 离线 ZIP（[dairn-latest.zip](https://github.com/moorefu/dairn/releases/download/latest/dairn-latest.zip)） | 解压后使用 `dairn.cmd` 或 `sh dairn.sh` | 自带 QuickJS 运行时 |

如果默认通道还没有正式版（例如当前只有预发布版本），上面的 `npm install @moorefu/dairn` / `pip install dairn` 会找不到可安装版本，请改用 `@next` / `--pre`；也可以固定到具体版本：`npm install @moorefu/dairn@<版本>`、`python -m pip install dairn==<PEP 440 版本>`。

npm 本地安装后用 `npx dairn` 调用，全局安装（`npm install -g @moorefu/dairn`）后可直接 `dairn`。`latest` 是离线下载入口，包内保留真实版本；Wheel 按规范保留版本文件名，下载索引后 pip 会获取其中指定的 Wheel 并校验 SHA256；需要固定版本时使用 [历史 Release](https://github.com/moorefu/dairn/releases)。

## 使用

```sh
dairn version
dairn init --root "示例 项目" --name demo --stack go --sample
dairn validate --root "示例 项目"
dairn check --root "示例 项目" --all
dairn docs check                       # 校验内嵌 Skill/Spec 的命令与元数据一致性
dairn tasks check --root "示例 项目"     # 校验任务切片与阻塞关系（可选）
dairn hooks install --apply --root "示例 项目"   # 生成 pre-push / turn-end hook
```

初始化后的项目优先使用项目内 launcher：`./.dairn/bin/dairn …`（Windows `.dairn\bin\dairn.cmd …`）；目标项目文档中的 `dairn` 均指该 launcher（Dairn 源码仓库场景用根 `./dairn.sh`，见下一节）。

任务流程使用 `dairn work start/list/status/next/record/advance/skip/verify/finish/cancel/reopen`（普通变更新增 Grill 阶段，必须先消除未决问题；`skip` 只允许规划阶段并留下理由）；`dairn hook turn-end` 把当前会话锚定到活跃任务，`dairn hook pre-push` 在推送前复跑结构治理、风险门禁并校验活跃任务证据是否对应当前 HEAD。发布构建会执行 `dairn docs check` 与资产 lint 回归，把 Skill/Spec 与 CLI 的命令漂移挡在发布之前。

**零仪式交接。** `dairn handoff` 在任意 Git 仓库（无需 `.dairn/`、无需任务）生成只读的接手摘要：当前 HEAD/分支/基线、staged/unstaged/untracked、基线以来的提交与变更路径、本地可见的检查证据（明确区分本地观察/陈旧/未知，绝不冒充 CI 通过）、活跃任务引用、证据支持的阻塞项与推断建议。默认只输出到 stdout、不落盘、不读文件内容；`--json` 供 Agent 解析，`--base`/`--max-chars`/`--note`/`--out` 按需使用。接手者重新运行并比对 `handoff_fingerprint_sha256` 即可检测交接后工作区是否已变化。

项目检查需要项目自己的工具链；Go `-race` 需要 CGO 和 C 编译器。Windows 支持中文和空格路径，拒绝目录联接与符号链接；批处理门禁需显式配置 `cmd.exe`。POSIX 首次启动 APE 使用系统基础命令初始化加载器，macOS ARM64 还需 Xcode Command Line Tools 的 `cc`。

## 在仓库中调用 Dairn（无安装/离线）

`dairn init` / `dairn adopt` 会在项目里生成 launcher：POSIX `.dairn/bin/dairn`、Windows `.dairn\bin\dairn.cmd`。它是项目内的稳定入口（目标项目文档中的 `dairn` 都是它的简写），按以下顺序解析运行时：

1. 环境变量 `DAIRN_BIN` 指定的 Dairn 可执行入口（外部受信的启动器/CLI）；
2. 项目内 vendored 运行时 `.dairn/runtime/dairn-embedded.com`；
3. `PATH` 上的 `dairn`；
4. 都不可用时输出 `dairn not found (DAIRN_NOT_AVAILABLE): vendor the runtime into .dairn/runtime/ or set DAIRN_BIN` 并以 127 退出。**launcher 不会自动安装或联网下载。**

**离线 vendoring。** 把官方发布的 APE `dairn-embedded.com` 与 `runtime-integrity.json` 放入目标项目的 `.dairn/runtime/`，然后用已有 Dairn 注册并固定该运行时：

```sh
# 已有 Dairn 项目：切换/固定到项目内运行时（写入 .dairn/launcher.json）
dairn upgrade --root "示例 项目" --vendor-runtime .dairn/runtime --apply
# 已有仓库接入时也可在 adopt 时注册（先把运行时放入 .dairn/runtime/）
dairn adopt --root "示例 项目" --vendor-runtime .dairn/runtime
```

新项目先 `dairn init ...` 建好项目，再把运行时放入 `.dairn/runtime/`，最后执行上面的 `dairn upgrade --vendor-runtime … --apply`（`init` 要求空目录，不能在 init 前预置运行时；`--vendor-runtime` 路径相对项目根解析）。CLI 用内建 SHA256 直接读取二进制计算实际摘要并与 `runtime-integrity.json` 比对（仅当二进制读取不可用时才回退 `sha256sum`/`shasum`/`certutil`），同时要求运行时版本与执行该命令的 Dairn CLI 版本一致（init/adopt/upgrade 会把该版本写入项目 lock；升级 Dairn 版本时用同版本 CLI 执行 `upgrade`）；成功后 `.dairn/launcher.json` 记录 `mode=vendored` 与 `runtime.sha256`。之后无需 PATH 中的 Dairn：

```sh
./.dairn/bin/dairn version              # POSIX
.dairn\bin\dairn.cmd version            # Windows
```

**Fresh clone。** 把 `.dairn/bin/`、`.dairn/launcher.json`、`.dairn/runtime/` 一并提交后，clone 出来的项目可直接 `./.dairn/bin/dairn doctor`（Windows `.dairn\bin\dairn.cmd doctor`）。`.dairn/cache/`、`.dairn/tmp/` 是 gitignore 的临时目录；空的 `operations/*` 目录不会被 Git 记录，校验按“暂无记录”处理，不属于治理损坏。

**Agent 规则。** 在项目任务中不要自动执行 `npm install` / `pip install` 安装 Dairn；先运行 launcher 的 `doctor`（`./.dairn/bin/dairn doctor`），launcher 缺失或检查失败时停止并报告环境问题，而不是自行安装或下载运行时。

**Dairn 源码仓库本身。** 本仓库的 `runtime/` 是被 gitignore 的构建产物，没有 `.dairn/` 项目文件：fresh checkout 先 `python tools/build.py`（或 `npm run build`）生成运行时，再用 POSIX `./dairn.sh <命令>`、Windows `dairn.cmd <命令>` 调用；不要在此仓库裸敲 `dairn`。

## 构建与维护

```sh
python tools/build.py
npm run build
```

两个入口先按根目录 `quickjs.lock.json` 获取并校验 [moorefu/quickjs-cosmo](https://github.com/moorefu/quickjs-cosmo/releases) 的现成 QuickJS，再自举生成 Wheel + ZIP 或 npm + ZIP。生成的运行时位于 `runtime/`，`.com` 作为构建产物管理。Windows 的 `build.cmd` 或 POSIX 的 `sh build.sh` 通过 QuickJS 自举 ZIP。ZIP 只含启动器、`runtime/` 与许可证。Python 包源码位于 `src/dairn/`，根目录 `pyproject.toml` 提供标准构建入口。

发布由 `v<版本>` 标签触发：标签版本会写入三类制品，矩阵验证通过后先发布 GitHub Release，再通过手动工作流把同一套已验证字节发布到 npm 与 PyPI。下载环境、六种平台的制品矩阵和注册表发布步骤见 [构建指南](https://github.com/moorefu/dairn/blob/main/BUILDING.md)；模板、工作流和受保护 CI 见 [治理指南](https://github.com/moorefu/dairn/blob/main/docs/GOVERNANCE.md)。

仓库自身的文档集中在这三处。`quickjs/assets/` 下的 Markdown 是分发给目标项目的规则与技能资源。

## 许可证

Dairn 采用 [MIT 许可证](https://github.com/moorefu/dairn/blob/main/LICENSE)。内嵌的 Cosmopolitan 与 QuickJS 等第三方组件声明位于 `licenses/`，随三类发布制品一并分发。
