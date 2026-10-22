# 构建与验证

仓库提供 Python PEP 517 和 npm 入口。**发布版本以 `v<版本>` 标签为准；没有标签时使用 `package.json` 的 `version`**。CI 在标签推送时通过 `DAIRN_VERSION` 传递标签版本，本地可用同名环境变量演练。`tools/release.json` 只管理分发名称与源码范围，不得定义版本。CLI、npm、ZIP 使用该 SemVer 版本，Release 标签加 `v` 前缀；Python 元数据与 Wheel 自动转换为 PEP 440 格式（`-alpha.N` → `aN`、`-beta.N` → `bN`、`-rc.N` → `rcN`）。

Python 工程采用 `pyproject.toml` + `src/dairn/` 布局；npm 入口为 `package.json` + `bin/dairn.cjs`。构建工具集中在 `tools/`，分发测试位于 `tools/tests/`，共享的 QuickJS 下载锁为根目录 `quickjs.lock.json`。

发版只需推送 `v<版本>` 标签；标签版本会写入内嵌 manifest、运行时校验元数据和三类制品文件名，`package.json` 不再需要跟着升版（没有标签的本地构建仍以它为准）。构建自动生成这些版本信息，无需手动同步。CLI 从内嵌 manifest 读取版本，Python 模块从安装元数据读取版本。仓库不提交 `.com`，构建后可通过根目录启动器使用 `runtime/` 中的产物。

## 三类发布制品

| latest 下载入口 | 内容 |
| --- | --- |
| `dairn-latest.tgz` | npm 启动器、`runtime/`、元数据、README 与许可证 |
| `wheels.html` → 对应 Wheel | Python 启动器、`dairn/runtime/`、元数据与许可证 |
| `dairn-latest.zip` | `dairn.cmd`、`dairn.sh`、`runtime/` 与许可证，不含完整源码 |

三者携带相同 APE，治理代码、模板、规则、技能与 manifest 全部嵌入 `/zip/quickjs/`。Wheel 不依赖 CPython 扩展 ABI；实际运行范围仍由下面的平台矩阵验证。`checksums.json` 是三类制品的校验清单。PEP 517 后端保留内部 sdist 协议兼容性，发布流程不生成或上传 sdist。

本地 `dist/` 和版本 Release 使用真实版本文件名；发布阶段另外生成 `latest` 别名，直接复制已验证制品。Wheel 的文件名保留 PEP 440 版本，通过固定的 `latest/wheels.html` 下载索引安装。索引链接到对应版本 Release，附带 SHA256，避免滚动更新时下载到其他版本。

## 打包与自举

```sh
python tools/build.py          # Python 3.10+，生成 Wheel 和 ZIP
npm run build                 # Node.js 18+，生成 npm tarball 和同一 ZIP
python tools/checksums.py      # 校验发布目录仅有三类制品并写入清单
```

两种入口支持 `--out`。PEP 517 可用 `python -m build --wheel` 或 `python -m pip wheel --no-deps .`。根目录直接 `npm pack` 会通过 `prepack` 生成 `runtime/`（这条本地路径按 `package.json` 的版本构建）；正式 npm 包没有安装脚本。

在仓库中，Windows 执行 `build.cmd`，POSIX 执行 `sh build.sh`，先获取现成 QuickJS，再由它生成运行 ZIP。三种入口共用下载锁和缓存，重复构建字节一致；每次把当前 JS/资源嵌入新 APE，并更新 `runtime/`。ZIP 解压即可运行，不携带源码或构建脚本；源码自举需使用仓库。Python/npm 使用内部暂存区构建。

根目录的 `dairn.sh`、`dairn.cmd` 是唯一启动器来源，ZIP 原样收录，安装脚本也使用同一份。npm 与 Wheel 原样收录 `dairn.sh`，各自校验包内运行时后，在 POSIX 调用它，在 Windows 直接执行包内 APE；参数、工作目录和退出码透传。发布制品在 POSIX 构建时保留运行时的执行位；若安装或复制后丢失该位，POSIX 启动器只补执行位、不改写文件内容，因为 APE 的 sh 加载器用 `command -v "$0"` 定位自身，而 bash（macOS 的 `/bin/sh`）对不可执行路径会返回失败。默认启动保持安装目录原样；设置 `DAIRN_FAST_RUNTIME=1` 后，POSIX 共用按 APE 摘要命名的缓存，`DAIRN_CACHE_HOME` 可指定缓存位置。Python 不再单独复制或转换运行时。

POSIX 首次启动 APE 需要 `uname`、`mkdir`、`dd`、`gzip`、`chmod`、`mv` 初始化加载器缓存；macOS ARM64 还需要系统 `cc`。取得 QuickJS 后，嵌入和 ZIP 写入由它自身完成。

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

构建任务先获取并校验 QuickJS，自举嵌入后生成同一套三类制品；标签推送时制品版本取自标签，没有标签时取 `package.json`。矩阵统一使用 `--smoke` 最小验证：校验制品指纹，安装 npm/Wheel 或解压 ZIP，再执行 `version`、初始化和 `validate`。初始化使用 Python 模板，仅验证内嵌资源和项目结构，不执行项目工具链。测试 runner 不下载 QuickJS、不安装 Go，不跑 Go race、npm 深度测试或自举回归。

各任务独立保存结果，不跳过失败；6 个任务全部成功后汇总才通过。Windows ARM64 由系统兼容层执行 APE 的 Windows x64 入口。流程支持 push、PR 和手动运行，上游版本统一从锁文件读取；发布只由标签触发。

推送 `v<版本>` 标签且矩阵全部通过后，发布任务才下载本次已验证的同一套制品，校验 SHA256，再上传 npm `.tgz`、Wheel `.whl`、运行 `.zip` 和 `checksums.json` 至 GitHub Release。发布版本即标签版本（`package.json` 只在该次运行没有标签时兜底）；alpha/beta/rc 标为预发布。普通分支推送和 PR 只构建验证、不发布，只有发布任务获得 `contents: write`。GitHub Release 只是附件；npm 与 PyPI 通过下面的注册表发布工作流单独推送。

先发布不可变的版本 Release，再创建或更新标签为 `latest` 的滚动 Release；预发布也更新该入口并保留预发布标记。文档使用 `/releases/tag/latest` 和 `/releases/download/latest/…`，不依赖 GitHub 仅指向正式版的 `/releases/latest` 路径。

发布使用草稿，附件齐全后公开。同一提交、相同文件重跑不改写 Release；同版本指向其他提交或已发布不同文件时失败，须先更新版本号。更新 `latest` 时先上传整套别名和索引，再移动标签并公开；旧工作流重跑不会回退 `latest`。GitHub 自动附带的源码归档独立于 Dairn 的运行 ZIP。

## 发布到 npm 与 PyPI

GitHub Release 只保存附件，注册表通过手动触发的 [注册表发布工作流](.github/workflows/registry-publish.yml) 发布：下载对应 Release 里**已验证的同一份** `.tgz`/`.whl`，不重新构建，因此注册表上的字节与矩阵验证一致。发布前确认名称仍可用：

```sh
npm view @moorefu/dairn version                          # 404 表示该 scoped 包尚未创建
curl -s -o /dev/null -w '%{http_code}\n' https://pypi.org/pypi/dairn/json
```

npm 使用 scoped 包名 `@moorefu/dairn`（`moorefu` scope 须属于你的账号），PyPI 使用 `dairn`。工作流入口：Actions → **发布到 npm 与 PyPI** → Run workflow，填写**版本标签**（如 `v0.1.0-rc.2`，不能填 `latest` 这类滚动别名），选择 `both`/`npm`/`pypi`。工作流会先检查目标版本是否已存在，已存在则跳过，因此发布成功后可以安全重跑 `both`；失败时会输出 `::error::` 注解和常见令牌问题提示，便于直接定位。

### npm（npmjs.com）

1. 在 npmjs.com 创建/使用 `@moorefu` scope，创建 Granular Access Token（Read and write + **All packages**——新包还无法在令牌里单独勾选；账号开启 2FA 时勾选 Bypass 2FA），存为仓库 Secret `NPM_TOKEN`。
2. 发布命令与工作流等价：`npm publish ./incoming/moorefu-dairn-0.1.0-rc.2.tgz --access public --tag next`（tarball 路径必须带 `./` 或使用绝对路径，否则 npm 会按 GitHub `owner/repo` 简写解析）。预发布版本（带 `-alpha`/`-beta`/`-rc`）必须用 `--tag next`，正式版才用 `--tag latest`，否则 `npm install @moorefu/dairn` 会装到预发布版。
3. 版本不可覆盖：同一版本重复发布会失败，需先升版本（新标签）；工作流已自动跳过已存在版本。若报 `403 ... Two-factor authentication or granular access token with bypass 2fa enabled is required`，说明账号开启了 2FA 但令牌没有启用 Bypass 2FA：编辑或新建 Granular token 并勾选 **Bypass two-factor authentication**，或改用 Classic Automation token；`E401` 表示令牌无效、被撤销或过期；`E403` 还可能是 scope/包名不匹配（Granular token 选 Read and write + All packages）。
4. 可选升级：npmjs.com → 包 Settings → Trusted Publishing 配置 GitHub 仓库、工作流 `registry-publish.yml` 和环境 `npm`；随后可移除 `NPM_TOKEN`，由 OIDC 发布并附带 provenance（需 `package.json` 含 `repository` 字段并给 `npm publish` 加 `--provenance`）。

### PyPI（pypi.org）

1. 在 pypi.org 注册账号并创建 API token（首次发布可先用账号级 token，项目建立后收紧到 `dairn` 项目），存为仓库 Secret `PYPI_TOKEN`。
2. 发布命令与工作流等价：`python -m twine upload dist/dairn-0.1.0rc2-py3-none-any.whl`（用户名 `__token__`，密码为 token）。工作流使用 `TWINE_USERNAME=__token__` 与 `PYPI_TOKEN`。
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
```

`--package` 可选 `npm`、`wheel`、`zip` 或默认的 `all`。`--smoke` 与 Actions 保持一致；不加此参数可在本地运行完整制品验收。`tools/verify-linux.py` 的 Go 回归仅供本地按需执行。本地镜像由 `tools/Containerfile.validation` 组合，运行验收时断网。日志与 JSON 结果保存在已忽略的 `validation/`。

本地覆盖 Windows x64 和 Linux x64；macOS/ARM64 以 [moorefu/dairn 的 Actions](https://github.com/moorefu/dairn/actions) 对应提交结果为准。
