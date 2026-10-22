# 构建与验证

仓库提供 Python PEP 517 和 npm 入口，版本与源码范围由 `packaging/release.json` 管理。

## 三类发布制品

| 制品 | 内容 |
| --- | --- |
| `dairn-1.1.0-rc.9.tgz` | npm 启动器、`runtime/`、元数据、README 与许可证 |
| `dairn-1.1.0rc9-py3-none-any.whl` | Python 启动器、`dairn/runtime/`、元数据与许可证 |
| `dairn-1.1.0rc9.zip` | `dairn.cmd`、`dairn.sh`、`runtime/` 与许可证，不含完整源码 |

三者携带相同 APE，治理代码、模板、规则、技能与 manifest 全部嵌入 `/zip/quickjs/`。Wheel 不依赖 CPython 扩展 ABI；实际运行范围仍由下面的平台矩阵验证。`checksums.json` 是三类制品的校验清单。PEP 517 后端保留内部 sdist 协议兼容性，发布流程不生成或上传 sdist。

## 打包与自举

```sh
python tools/build.py          # Python 3.10+，生成 Wheel 和 ZIP
npm run build                 # Node.js 18+，生成 npm tarball 和同一 ZIP
python tools/checksums.py      # 校验发布目录仅有三类制品并写入清单
```

两种入口支持 `--out`，不要求同时安装 Python 和 Node。PEP 517 可用 `python -m build --wheel` 或 `python -m pip wheel --no-deps .`，后端无第三方依赖。根目录直接 `npm pack` 会通过 `prepack` 生成 `runtime/`；正式 npm 包没有安装脚本。

在仓库中，Windows 执行 `build.cmd`，POSIX 执行 `sh build.sh`，仅使用自带 QuickJS 生成运行 ZIP，重复构建字节一致；修改 JS/资源后会重新嵌入 APE。ZIP 解压即可运行，不携带源码或构建脚本；源码自举需使用仓库。Python/npm 使用内部暂存区构建，不依赖 ZIP 携带源码，普通打包不改写仓库引导 APE。

POSIX 首次启动需要 `uname`、`mkdir`、`dd`、`gzip`、`chmod`、`mv` 初始化加载器缓存；macOS ARM64 还需要系统 `cc`。自举验收先测空缓存首次启动，再清空 PATH，验证构建本身不调用 Python、Node 或外部 ZIP 工具。

## 从 QuickJS 源码重建 APE

使用 Linux/WSL、Python 3.10+（含 SSL、lzma）、POSIX shell 和 GNU 基础工具。临时目录须支持可执行文件与符号链接，建议预留 4 GiB 内存、3 GiB 磁盘。cosmocc 自带编译器和链接器。

```sh
python3 tools/build-runtime.py --quickjs-version 2026-06-04
```

脚本从 [Bellard](https://bellard.org/quickjs/) 下载源码并校验 SHA256，应用 Windows 补丁，使用 cosmocc 编译双架构 APE，运行上游测试，再嵌入资源。此步骤更新仓库引导 APE、manifest 和 `packaging/quickjs-build.json`；每次打包另生成 `packaging/runtime-build.json`。

默认 QuickJS `2026-06-04`、cosmocc `4.0.2` 的地址与校验值固定在 `packaging/quickjs-sources.json`。新 QuickJS 版本须提供 `--source-sha256`，可用 `--source-url` 覆盖下载地址；`--cache DIR --offline` 使用已校验缓存。其余参数见 `--help`。补丁上下文不匹配会失败；`windows-cosmo-v1` 依赖 cosmocc 4.0.2 内部布局，升级工具链须同步适配补丁。上游二进制 ZIP 不包含这些 C 代码修复。

Linux 可在 `python:3.12-bookworm` 容器中执行该脚本。Windows Podman 若无法挂载工作盘，使用 `podman cp` 复制工程和缓存，运行后取回 APE、manifest 与构建记录。

## GitHub Actions：3 × 6 矩阵

[发布工作流](.github/workflows/release.yml) 在 Ubuntu 构建一次，后续按制品和 runner 展开 **18 个独立任务**，全部下载同一个 artifact 并校验指纹。

| 系统 | 架构 | runner | 必测制品 |
| --- | --- | --- | --- |
| Windows | x64 | `windows-2025` | npm、Wheel、ZIP |
| Windows | ARM64 | `windows-11-arm` | npm、Wheel、ZIP |
| Linux | x64 | `ubuntu-24.04` | npm、Wheel、ZIP |
| Linux | ARM64 | `ubuntu-24.04-arm` | npm、Wheel、ZIP |
| macOS | x64 | `macos-15-intel` | npm、Wheel、ZIP |
| macOS | ARM64 | `macos-15` | npm、Wheel、ZIP |

npm/Wheel 任务离线安装各自制品；ZIP 任务检查运行文件白名单，解压并使用自身启动器。三类均检查版本、失败退出码、中文/空格路径下的初始化和项目校验。npm 另测损坏拒绝；Wheel 另测 RECORD 与源码重建；ZIP 另测原生宿主、策略、空 PATH 运行与自举、源码变更重嵌入。构建回归从 checkout 暂存源码并装入本次发布的 APE；Linux ZIP 任务补充完整治理与 Go race 回归。

各任务独立保存结果，不跳过失败；18 个任务全部成功后汇总才通过。Windows ARM64 由系统兼容层执行 APE 的 Windows x64 入口。流程支持 push、PR 和手动版本参数，上传制品但不自动发布注册表包。

## 本地复核

```sh
python -B -X utf8 tools/verify-packages.py
python tools/checksums.py
python -B -X utf8 tools/verify-packages.py --artifacts dist --package npm --out validation/distribution/windows-npm
python -B -X utf8 tools/verify-podman.py --image localhost/dairn-validation:2026-10-22 --artifacts dist --package zip --out validation/distribution/linux-zip
```

`--package` 可选 `npm`、`wheel`、`zip` 或默认的 `all`。本地完整镜像由 `tools/Containerfile.validation` 组合官方 Python、Node、Go 镜像；运行验收时断网。日志与 JSON 结果保存在 `validation/`，不再另外维护 Markdown 验收报告。

本地覆盖 Windows x64 和 Linux x64；macOS/ARM64 需以远程 Actions 结果为准。按当前要求尚未推送或运行远程矩阵，目标仓库为 [moorefu/dairn](https://github.com/moorefu/dairn)。
