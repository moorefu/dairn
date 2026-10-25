# 构建与验证

仓库提供 Python PEP 517 和 npm 入口。**发布版本以 `v<版本>` 标签为准；没有标签时（PR、分支、本地构建）由构建入口按构建时间自动生成 `主版本.次版本.修订号-nightly.YYYYMMDDHHMMSS`（北京时间），基础版本取 `package.json` 的 `version`**。CI 在标签推送时通过 `DAIRN_VERSION` 传递标签版本，本地可用同名环境变量演练。`tools/release.json` 只管理分发名称与源码范围，不得定义版本。CLI、npm、ZIP 使用该 SemVer 版本，Release 标签加 `v` 前缀；Python 元数据与 Wheel 自动转换为 PEP 440 格式（`-alpha.N` → `aN`、`-beta.N` → `bN`、`-rc.N` → `rcN`、`-nightly.时间戳` → `.dev时间戳`）。

开发构建采用 `主版本.次版本.修订号-nightly.YYYYMMDDHHMMSS`，时间戳固定使用北京时间（UTC+8），由构建入口在运行时生成，无需修改 `package.json`；`package.json` 只保留三段基础版本。构建时间可通过 `DAIRN_BUILD_TIME`（ISO 8601 或 epoch 秒）固定，Python、npm、ZIP、校验和及验收因此共用同一版本；`python tools/nightly-version.py` 可预览本轮会生成的版本，`--instant` 输出可直接写入 `DAIRN_BUILD_TIME` 的构建时间。这样同一版本仍可复现，已有发布制品也不会被新版本覆盖。

Python 工程采用 `pyproject.toml` + `src/dairn/` 布局；npm 入口为 `package.json` + `bin/dairn.cjs`。构建工具集中在 `tools/`，分发测试位于 `tools/tests/`，共享的 QuickJS 下载锁为根目录 `quickjs.lock.json`。

发版只需推送 `v<版本>` 标签；标签版本会写入内嵌 manifest、运行时校验元数据和三类制品文件名，`package.json` 不再需要跟着升版（没有标签的本地构建以它的三段基础版本加构建时间生成 nightly）。构建自动生成这些版本信息，无需手动同步。CLI 从内嵌 manifest 读取版本，Python 模块从安装元数据读取版本。仓库不提交根目录构建产物；显式维护的 `.dairn/runtime/` 自测快照通过审阅后的 Runtime Promotion 更新。源码验证使用隔离候选包装器，不更新该快照。

## 三类发布制品

| latest 下载入口 | 内容 |
| --- | --- |
| `dairn-latest.tgz` | npm 启动器 `bin/dairn.cjs`、POSIX 根启动器 `dairn`、包内 `.dairn/runtime/` 与完整性清单、元数据、README、`LICENSE`（MIT）与 `licenses/`（第三方声明） |
| `wheels.html` → 对应 Wheel | Python 启动器、POSIX 根启动器 `dairn`、包内 `.dairn/runtime/` 与完整性清单、元数据、`LICENSE`（MIT）与 `licenses/`（第三方声明） |
| `dairn-latest.zip` | `dairn`、`dairn.cmd`、`.dairn/runtime/dairn-embedded.com`、`.dairn/runtime/runtime-integrity.json`、`LICENSE`（MIT）与 `licenses/Cosmopolitan-ISC.txt`、`licenses/QuickJS-MIT.txt`，不含完整源码 |

三者携带相同 APE，治理代码、模板、规则、技能与 manifest 全部嵌入 `/zip/quickjs/`。Wheel 不依赖 CPython 扩展 ABI；实际运行范围仍由下面的平台矩阵验证。`checksums.json` 是三类制品的校验清单。Dairn 自有代码采用 MIT 许可证（根目录 `LICENSE`），`licenses/` 只放第三方声明；构建、Wheel METADATA 与 npm `package.json` 会同步该声明。PEP 517 后端保留内部 sdist 协议兼容性，发布流程不生成或上传 sdist。

ZIP 解压到目标项目根即可运行：根启动器从同目录 `.dairn/runtime/` 解析 vendored 运行时。随后用 `dairn init`（新项目）或 `dairn adopt`（既有项目）展开 `AGENTS.md`、`.agents/skills/`、`.dairn/governance/` 等治理文件；已存在的 `.dairn/runtime/` 会被复用。npm / Wheel 安装后通过 CLI 运行 `dairn init` / `dairn adopt`，会在项目根生成相同的受管 `dairn`/`dairn.cmd`，并把安装适配层通过 `DAIRN_RUNTIME_DIR` 暴露的包内运行时复制到项目 `.dairn/runtime/`、写入 vendored 配置；不会再生成 `.dairn/bin/dairn*`。`LICENSE` 与 `licenses/` 只随发行包分发，不复制进项目。

本地 `dist/` 和版本 Release 使用真实版本文件名；发布阶段另外生成 `latest` 别名，直接复制已验证制品。Wheel 的文件名保留 PEP 440 版本，通过固定的 `latest/wheels.html` 下载索引安装。索引链接到对应版本 Release，附带 SHA256，避免滚动更新时下载到其他版本。

## 打包与自举

```sh
python tools/nightly-version.py  # 预览本轮构建会生成的 nightly 版本
python tools/build.py          # Python 3.10+，生成 Wheel 和 ZIP，候选随私有暂存区清理
npm run build                 # Node.js 18+，生成 npm tarball 和同一 ZIP，候选随私有暂存区清理
python tools/checksums.py      # 校验发布目录仅有三类制品并写入清单
```

两种入口支持 `--out`。PEP 517 可用 `python -m build --wheel` 或 `python -m pip wheel --no-deps .`。源码根目录直接 `npm pack` 由 prepack 拒绝并提示 `npm run build`，防止覆盖项目 Pin；正式包在独占暂存区生成，没有安装脚本。

在仓库中，`python tools/build.py`（Python 3.10+）与 `npm run build`（Node 18+）都会先获取现成 QuickJS，再由它把当前 JS/资源嵌入临时 APE，不更新固定项目 Runtime 或根 `runtime/`。各入口共用下载锁和缓存；固定 `DAIRN_BUILD_TIME` 时重复构建字节一致，未固定时 nightly 时间戳变化会带来新的版本和产物名。ZIP 解压即可运行，不携带源码或构建脚本；源码自举需使用仓库。Python/npm 使用内部暂存区构建。

根目录的 `dairn`、`dairn.cmd` 是唯一启动器来源，由 `tools/render-launchers.mjs` 从 `quickjs/assets/templates/project/launcher/` 生成；ZIP、npm/Wheel 与 `dairn init`/`dairn adopt` 生成的项目启动器都与它们同源。源码仓库中，根启动器执行 `.dairn/runtime/` 的治理运行时快照（日常命令不需要先构建）；根 `runtime/` 是旧构建遗留，新的构建与测试不再依赖它。源码验证使用 `python tools/with-built-runtime.py -- <测试命令>`，候选覆盖仅注入子进程。启动器按“显式 `DAIRN_RUNTIME` → 同目录 `.dairn/runtime/dairn-embedded.com` → 报错并以 2 退出”的顺序解析运行时，不隐式回退到 `runtime/`、不联网下载。npm 与 Wheel 原样收录启动器与包内运行时，安装适配层把 `DAIRN_RUNTIME_DIR` 指向包内运行时；在 POSIX 调用启动器，在 Windows 直接执行包内 APE，参数、工作目录和退出码透传。POSIX 启动器按原 APE 的 SHA256 复用持久执行镜像：首次复制到私有临时文件、设置镜像 0700 权限并校验后原子发布；命中只校验源文件和镜像摘要，然后 `exec /bin/sh` 执行，不再逐次复制、chmod 或删除。原文件字节和权限保持不变。镜像缓存在 `${DAIRN_CACHE_HOME:-${XDG_CACHE_HOME:-$HOME/.cache}/dairn}/runtime-images-v1`；目录须由当前用户拥有且权限 0700，缓存异常或工具缺失退出 2。不同运行时内容使用不同镜像，旧镜像可在没有命令运行时手动清理。校验仍读取摘要，操作系统页缓存可减少物理磁盘读取；缓存不构成受信证据。`DAIRN_RUNTIME_DIR` 始终指向原载荷，Python/npm 在 POSIX 共用此入口。

POSIX 首次启动 APE 需要 `uname`、`mkdir`、`dd`、`gzip`、`chmod`、`mv` 初始化加载器缓存；macOS ARM64 还需要系统 `cc`。取得 QuickJS 后，嵌入和 ZIP 写入由它自身完成。

## 根启动器与 CI 测试运行时

`dairn init` / `dairn adopt` 会在目标项目根生成受管启动器 `dairn`、`dairn.cmd` 与保持行尾的 `.dairn/.gitattributes`，以及项目自有的 `.dairn/launcher.json`；模板来自嵌入运行时。它们的模板源码位置是 `quickjs/assets/templates/project/launcher/`，源码仓库根的两个文件由 `tools/render-launchers.mjs` 生成，生成副本纳入 lock 受管资源。项目启动器按“`DAIRN_RUNTIME` → 同目录 `.dairn/runtime/dairn-embedded.com` → 报错退出 2”解析，实际执行项目内 `.dairn/runtime/` 的 vendored 运行时。旧版本生成的 `.dairn/bin/dairn` / `.dairn/bin/dairn.cmd` 是退役受管文件，由 `dairn upgrade --apply` 迁移删除。这些文件只影响目标项目，不改变发布制品的字节；发布构建与 6 平台矩阵安装 npm/Wheel/ZIP 后仍使用包内运行时，并执行 `docs check`，不依赖目标项目的启动器。

源码回归统一使用临时候选，不写根 `runtime/` 或 `.dairn/runtime/`。例如 `python tools/with-built-runtime.py -- python tools/check-source.py unit`；直接运行 check-source.py 且没有候选上下文时会自动调用同一包装器。包装器在 `.build/runs/<id>/` 构建、校验 APE，将 DAIRN_TEST_RUNTIME 等变量仅传给子进程，退出后清理候选，日志和摘要保存在 `validation/runtime-builds/`。

发布工作流从已构建 ZIP 创建隔离候选：`python tools/with-built-runtime.py --from-zip incoming -- python tools/verify-linux.py validation/ci`。Windows 同样包装 verify-windows.py，复用同一制品而不下载另一版本。固定 Runtime 的提升、回滚与事务恢复见 [生命周期契约](quickjs/assets/specs/engineering/runtime-lifecycle.md)；它们是独立的维护操作。

### Windows 实机验收

日常集成使用 `python tools/check-source.py integration`，跨平台只需要 Python、Git 和已构建的 QuickJS。它在临时 Git 项目中运行实际的语法检查、单元计算、独立子进程调用和构建检查，验证成功、非零退出、超时三类 Run，再验证 vendor 升级和离线启动；真实日志与 Run 副本在 `validation/source-checks/integration/`。该流程不需要 Go、gcc、Node 或 npm，不替代三类发布制品的完整验收。

在 Windows x64 + Git for Windows 上运行 `python tools/with-built-runtime.py -- python tools/verify-windows.py`（需要 node/git/npm；需要 Go 时默认从 `C:\Program Files\Go\bin` 查找，也可用 `--go-bin` 指定）。Go 门禁使用普通 `go test ./...`，不启用 race/CGO；没有 Go 工具链时加 `--skip-go`，跳过 `go-env/go-init/go-checks`，其余 CLI、launcher、native host/policy、npm、wheel 步骤照常执行并参与总体验收。

Go race/CGO 不属于默认或 CI 验收；需要普通 Go 门禁时直接运行 `python -B -X utf8 tools\verify-windows.py`，没有 Go 工具链则加 `--skip-go`。

其中 `quickjs.tests.test_windows` 覆盖普通生命周期、junction 边界、真实子进程门禁，以及项目根启动器文件、vendored 运行时离线执行、缺失运行时故障、`core.autocrlf=true` 克隆后的受管哈希稳定性；`test_host_native.mjs` 用构建缓存中的原生 `qjs-*.com` 运行（没有缓存时回退 APE），覆盖 `host.readBytes` + 内建 SHA256。Go 步骤使用临时 `GOCACHE/GOTMPDIR/GOMODCACHE`，避免宿主机全局 Go 缓存 ACL 影响结果。

Windows 相关实现约束：

- **Git 输出捕获**：Windows 的 `host.run` 直接以 QuickJS 原生 `os.exec`/Worker 创建并同时排空 stdout/stderr 原生管道，Git、Python、Node 均不经过 `sh.exe`；命令名按 `PATHEXT` 解析为显式 `.exe`，`.cmd/.bat` 仅通过 `cmd.exe` 的 `call` 启动。主线程仍保留超时控制，输出超过 1 MiB 或子进程初始化失败会 fail closed。原生管道由 Worker 负责持续读取，避免 Cosmo 文件句柄重定向和管道容量死锁。
- **临时目录**：系统 Temp 无法创建捕获文件时，已初始化项目自动回退 `.dairn/tmp/`。显式设置的 `TMPDIR` 失败仍报错；自动回退拒绝符号链接和越界路径，不修改全局环境。
- **嵌套 APE**：Windows 上 Cosmopolitan 通过 `_COSMO_FDS_V2` 把父进程 fd 表传入子进程。原生工具（Python/Node 等）再启动 APE 孙进程时，该变量指向未继承的句柄，表现为 stdout 丢失或退出码 `0xC0000005`。`tools/check-source.py` 在 Windows 启动时清除该变量，使源码门禁内的嵌套 APE 正常工作；若项目自有检查也会在原生工具内再次调用 Dairn/APE，应在入口处做同样清理，而不是把空日志当成检查通过。
- **二进制摘要**：vendored 运行时 SHA256 使用 `host.readBytes` + 内建 `sha256Bytes`，不依赖 `certutil`（其输出在部分 Windows 版本/重定向下不可捕获）；外部工具仅作回退。
- **事务所有者存活**：Windows 使用系统 Windows PowerShell 的 .NET 进程查询，只在明确确认所有者已退出后允许恢复。固定 Cosmopolitan 版本的 `kill(pid, 0)` 不适合只读探测；PowerShell 不可用、查询失败或权限不足时返回未知并拒绝夺锁。POSIX 继续使用零信号探测。
- **fresh clone**：`.dairn/cache/`、`.dairn/tmp/` 被忽略；空的 `operations/*` 目录不会被 Git 记录，校验按“暂无记录”处理；`dairn validate` / `dairn doctor` 在 fresh clone 中应通过。

## 获取 QuickJS

上游为 [moorefu/quickjs-cosmo](https://github.com/moorefu/quickjs-cosmo/releases)，已包含 Windows 补丁。构建获取现成解释器，再嵌入 Dairn 资源。`quickjs.lock.json` 锁定版本、Release ZIP 地址、归档 SHA256、解释器条目及其 SHA256。升级解释器时更新该锁文件。

所有构建入口使用相同的系统引导脚本：Windows 需要系统 Windows PowerShell 与 .NET ZIP/SHA256；Linux/macOS 需要 POSIX shell、`curl`、`unzip`、`sha256sum` 或 `shasum` 和基础文件工具。Python 入口使用 Python 3.10+，npm 入口使用 Node.js 18+ 与 npm。

首次构建联网下载；缓存默认在 `.build/quickjs/`，可通过 `DAIRN_QUICKJS_CACHE` 指定共享缓存。缓存文件名含摘要，每次使用都校验 SHA256；校验失败立即停止。下载和解包使用临时文件，成功后才写入缓存。`DAIRN_OFFLINE=1` 禁止下载，缓存缺失时失败。

可先运行 Windows 的 `powershell -NoProfile -File tools/bootstrap.ps1 -FetchOnly` 或 POSIX 的 `sh tools/bootstrap.sh --fetch-only` 预热缓存。三类制品携带生成后的完整运行时，用户安装和运行无需再获取 QuickJS。`runtime/runtime-integrity.json` 记录上游地址、摘要与当前运行时摘要。

Linux 可在 `python:3.12-bookworm` 容器中执行该脚本。Windows Podman 若无法挂载工作盘，使用 `podman cp` 复制工程和缓存，运行后取回 APE、manifest 与构建记录。

## GitHub Actions：6 个 runner 的冒烟矩阵

[发布工作流](.github/workflows/release.yml) 在 Ubuntu 构建一次，随后在 6 个 runner 上各跑一个任务；每个任务用 `tools/verify-packages.py` 的默认 `--package all` 一次验收 npm、Wheel、ZIP 三类制品，合计 18 项验证。所有任务下载同一个 artifact 并校验指纹。

| 系统 | 架构 | runner |
| --- | --- | --- |
| Windows | x64 | `windows-2025` |
| Windows | ARM64 | `windows-11-arm` |
| Linux | x64 | `ubuntu-24.04` |
| Linux | ARM64 | `ubuntu-24.04-arm` |
| macOS | x64 | `macos-15-intel` |
| macOS | ARM64 | `macos-15` |

构建任务先获取并校验 QuickJS，自举嵌入后生成同一套三类制品，并在打包后执行 `./dairn docs check` 与 `python -m unittest quickjs.tests.test_assets_lint` 作为分发资产一致性门禁；标签推送时制品版本取自标签，没有标签时按构建时间生成 nightly（基础版本取 `package.json`）。矩阵统一使用 `--smoke` 最小验证：校验制品指纹，安装 npm/Wheel 或解压 ZIP，再执行 `version`、初始化、`validate` 与 `docs check`。初始化使用 Python 模板，仅验证内嵌资源和项目结构，不执行项目工具链。测试 runner 不下载 QuickJS、不安装 Go，不跑 Go race、npm 深度测试或自举回归。

除矩阵外还有两个集成回归 job，均被 `accepted` 汇总门禁：

- **test-python**（`ubuntu-24.04`）：从发布 ZIP 提取运行时，运行 `tools/verify-linux.py` 的共享源码门禁与额外 Python/Go 回归；工作流清空 CI 平台变量，模拟本地开发者环境。
- **test-python-windows**（`windows-2025`）：与 Linux 套件同源复用 build job 的 `dairn-packages` artifact——从发布 ZIP 提取运行时，并把 wheel/npm 制品复制到 `dist/`（`verify-windows.py --artifacts incoming --skip-go`），不在 Windows 重新构建任何制品；不下载 QuickJS、不跑 `python tools/build.py`，也不安装 MinGW。脚本同样清空 CI 平台变量；覆盖 launcher/vendored runtime、npm/Wheel 安装与 fresh-clone 受管哈希；产物写入 `validation/windows` 并上传 artifact。

Linux 与 Windows 验收均调用 `tools/check-source.py lint|unit|integration`，必需测试唯一目录位于 `tools/check_catalog.py`，覆盖 Analyze Plan Native、Context CLI、Runtime Diagnostic、Docs Retrieval 及报告适配器回归。`validation/source-checks/<阶段>.json` 保存必需/已执行 Check-ID 与覆盖结果，并随日志上传；任一必需项缺失、重复或失败即拒绝聚合成功。这些本地覆盖记录不构成受信 CI 签名。

各任务独立保存结果，不跳过失败；矩阵、test-python 与 test-python-windows 全部成功后汇总才通过。Windows ARM64 由系统兼容层执行 APE 的 Windows x64 入口。流程支持 push、PR 和手动运行，上游版本统一从锁文件读取；发布只由标签触发。

推送 `v<版本>` 标签且矩阵全部通过后，发布任务才下载本次已验证的同一套制品，校验 SHA256，再上传 npm `.tgz`、Wheel `.whl`、运行 `.zip` 和 `checksums.json` 至 GitHub Release。发布版本即标签版本（没有标签的运行只构建验证、不发布）；alpha/beta/rc 标为预发布。普通分支推送和 PR 只构建验证、不发布，只有发布任务获得 `contents: write`。GitHub Release 只是附件；npm 与 PyPI 通过下面的注册表发布工作流单独推送。

先发布不可变的版本 Release，再创建或更新标签为 `latest` 的滚动 Release；预发布也更新该入口并保留预发布标记。文档使用 `/releases/tag/latest` 和 `/releases/download/latest/…`，不依赖 GitHub 仅指向正式版的 `/releases/latest` 路径。

发布使用草稿，附件齐全后公开。同一提交、相同文件重跑不改写 Release；同版本指向其他提交或已发布不同文件时失败，须先更新版本号。更新 `latest` 时先上传整套别名和索引，再移动标签并公开；旧工作流重跑不会回退 `latest`。GitHub 自动附带的源码归档独立于 Dairn 的运行 ZIP。

分支/标签保护、Required Checks、受保护构建与签名 runner 的配置、导入命令、生效证据和未验收项见 [受保护发布验收清单](docs/PROTECTED_RELEASE_ACCEPTANCE.md)；其中 `.github/rulesets/*.json` 只是可导入物料，必须由仓库管理员在 GitHub 上实际导入并留存平台证据，源码测试通过不能替代这些平台控制。

## 发布到 npm 与 PyPI

GitHub Release 只保存附件，注册表通过手动触发的 [注册表发布工作流](.github/workflows/registry-publish.yml) 发布：先由 `validate` job 校验输入标签格式、Release 存在且已公开、标签提交等于 Release 目标提交且已在受保护 `main` 历史内、Release 资产恰好为三类制品加 `checksums.json` 且摘要一致；随后 `npm`/`pypi` job 下载对应 Release 里**已验证的同一份** `.tgz`/`.whl` 并按 `checksums.json` 再次复核 SHA256，不重新构建，因此注册表上的字节与矩阵验证一致。发布前确认名称仍可用：

```sh
npm view @moorefu/dairn version                          # 404 表示该 scoped 包尚未创建
curl -s -o /dev/null -w '%{http_code}\n' https://pypi.org/pypi/dairn/json
```

npm 使用 scoped 包名 `@moorefu/dairn`：unscoped 名称 `dairn` 会被 npm 以 `Package name too similar to existing packages dagre,yarn` 拒绝（防止近似名抢注的策略，不是令牌问题），npm 报错里也建议改用该 scoped 名。PyPI 使用 `dairn`。工作流入口：Actions → **发布到 npm 与 PyPI** → Run workflow，填写**版本标签**（如 `v0.1.0-rc.4`，不能填 `latest` 这类滚动别名），选择 `both`/`npm`/`pypi`。工作流会先检查目标版本是否已存在，已存在则跳过，因此发布成功后可以安全重跑 `both`；失败时会输出 `::error::` 注解和常见令牌问题提示，便于直接定位。

### npm（npmjs.com）

1. 在 npmjs.com 创建/使用 `@moorefu` scope，创建 Granular Access Token（Read and write + **All packages**——新包还无法在令牌里单独勾选；账号开启 2FA 时勾选 **Bypass two-factor authentication**），存为仓库 Secret `NPM_TOKEN`。
2. 发布命令与工作流等价：`npm publish ./incoming/moorefu-dairn-0.1.0-rc.4.tgz --access public --tag next`（tarball 路径必须带 `./` 或使用绝对路径，否则 npm 会按 GitHub `owner/repo` 简写解析）。预发布版本（带 `-alpha`/`-beta`/`-rc`）用 `--tag next`，正式版才用 `--tag latest`，否则 `npm install @moorefu/dairn` 会装到预发布版；工作流在发布预发布版本后，若 `latest` 仍指向预发布版本会移除该 dist-tag。
3. 版本不可覆盖：同一版本重复发布会失败，需先升版本（新标签）；工作流已自动跳过已存在版本。若报 `403 ... Two-factor authentication or granular access token with bypass 2fa enabled is required`，说明账号开启了 2FA 但令牌没有启用 Bypass 2FA：编辑或新建 Granular token 并勾选 **Bypass two-factor authentication**，或改用 Classic Automation token；`E401` 表示令牌无效、被撤销或过期；`E403` 还可能是 scope/包名不匹配（Granular token 选 Read and write + All packages）。
4. 可选升级：npmjs.com → 包 Settings → Trusted Publishing 配置 GitHub 仓库、工作流 `registry-publish.yml` 和环境 `npm`；随后可移除 `NPM_TOKEN`，由 OIDC 发布并附带 provenance（需 `package.json` 含 `repository` 字段并给 `npm publish` 加 `--provenance`）。

### PyPI（pypi.org）

1. 在 pypi.org 注册账号并创建 API token（首次发布可先用账号级 token，项目建立后收紧到 `dairn` 项目），存为仓库 Secret `PYPI_TOKEN`。
2. 发布命令与工作流等价：`python -m twine upload dist/dairn-0.1.0rc4-py3-none-any.whl`（用户名 `__token__`，密码为 token）。工作流使用 `TWINE_USERNAME=__token__` 与 `PYPI_TOKEN`。
3. PyPI 上预发布版本默认可下载但不被 `pip install dairn` 选中，需要 `pip install --pre dairn`；正式版正常安装。
4. 版本不可覆盖：同一版本重复上传会失败；此外 **PyPI 不允许重用已上传过的文件名，即使删除了项目或该版本也不行**，删除后必须升版本（新 tag）重新构建上传。
5. 可选升级：PyPI → Publishing 添加 GitHub trusted publisher（仓库 `moorefu/dairn`、工作流 `registry-publish.yml`、环境 `pypi`），再把工作流里的 twine 步骤换成 `pypa/gh-action-pypi-publish@release/v1`，无需长期 token。

GitHub Release 与注册表发布互相独立：Release 永远先发；注册表发布会因名称被占用、版本已存在或令牌缺失而失败，此时补新版本再发，不要覆盖已发布字节。

## 本地复核

```sh
python -B -X utf8 tools/verify-packages.py
python tools/checksums.py
python -B -X utf8 tools/verify-packages.py --smoke --artifacts dist --package npm --out validation/smoke/windows-npm
python -B -X utf8 tools/verify-podman.py --image localhost/dairn-validation:2026-10-22 --smoke --artifacts dist --package zip --out validation/smoke/linux-zip
python tools/verify-podman.py --image localhost/dairn-validation:2026-10-22 --runtime-zip dist/dairn-<版本>.zip --test-user dairn-test --timeout 3600 --out validation/linux-full
```

`--package` 可选 `npm`、`wheel`、`zip` 或默认的 `all`。`--smoke` 与 Actions 保持一致；不加此参数可在本地运行完整制品验收。`tools/verify-linux.py` 在 Linux CI 执行，本地也可用 with-built-runtime.py 包装运行。共享 lint/unit/integration 门禁统一执行 native 和基础 Python 测试，Linux 补充集合只执行其余 16 个 Python 模块（含标准库 Python 实测与独立语言场景），同一检查不重复执行。原生测试结果见 `validation/source-checks/unit-*.log` 与 `integration-1.log`，专项日志和汇总写入脚本指定的输出目录。本地镜像由 `tools/Containerfile.validation` 组合，运行验收时断网。日志与 JSON 结果保存在已忽略的 `validation/`。

离线容器会先核对并复制本地 `.build/quickjs/` 中与 `quickjs.lock.json` 匹配的解释器；缓存未预热时明确拒绝，不在禁网回归里隐式下载。`--quickjs-cache` 可指定已有缓存。`--test-user dairn-test` 使用镜像内的普通用户运行，权限负向测试才能实际覆盖；容器使用独立 init 回收子进程。超时或失败仍导出已生成的 `/results`、候选构建与源码门禁诊断，最后只删除本次创建的容器，不重置 VM 或已有镜像。

本地覆盖 Windows x64 和 Linux x64；macOS/ARM64 以 [moorefu/dairn 的 Actions](https://github.com/moorefu/dairn/actions) 对应提交结果为准。
