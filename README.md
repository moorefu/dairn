# Dairn

Dairn 是供 AI Agent 调用的开发治理内核，提供项目初始化、确定性检查、工作流状态、影响分析和证据验证。治理逻辑运行于自带的 Cosmopolitan QuickJS APE；Dairn 不调用模型。

## 安装与使用

[latest](https://github.com/moorefu/dairn/releases/tag/latest) 始终提供最近通过全部平台验证的三类制品，包括当前预发布版本。点击下表链接下载到当前目录后使用：

| 制品 | 安装方式 | 环境 |
| --- | --- | --- |
| [dairn-latest.tgz](https://github.com/moorefu/dairn/releases/download/latest/dairn-latest.tgz) | `npm install --offline --ignore-scripts ./dairn-latest.tgz` | Node.js 18+、npm |
| Wheel [安装索引 wheels.html](https://github.com/moorefu/dairn/releases/download/latest/wheels.html) | `python -m pip install --upgrade --pre --no-index --find-links ./wheels.html dairn` | Python 3.10+ |
| [dairn-latest.zip](https://github.com/moorefu/dairn/releases/download/latest/dairn-latest.zip) | 解压后使用 `dairn.cmd` 或 `sh dairn.sh` | 自带 QuickJS 运行时 |

`latest` 是下载入口，包内保留真实版本。Wheel 按规范保留版本文件名；下载索引后，pip 获取其中指定的 Wheel 并校验 SHA256。需要固定版本时使用 [历史 Release](https://github.com/moorefu/dairn/releases)。

Python 分发名、模块名和 npm 包名均为 `dairn`。安装包的 `runtime/` 包含 APE 和校验信息，安装无需另行下载运行时。npm 本地安装后通过 `npx --offline --no-install dairn` 调用；Wheel 安装后可直接使用：

```sh
dairn version
dairn init --root "示例 项目" --name demo --stack go --sample
dairn validate --root "示例 项目"
dairn check --root "示例 项目" --all
```

项目检查需要项目自己的工具链；Go `-race` 需要 CGO 和 C 编译器。Windows 支持中文和空格路径，拒绝目录联接与符号链接；批处理门禁需显式配置 `cmd.exe`。POSIX 首次启动 APE 使用系统基础命令初始化加载器，macOS ARM64 还需 Xcode Command Line Tools 的 `cc`。

## 构建与维护

```sh
python tools/build.py
npm run build
```

两个入口先按根目录 `quickjs.lock.json` 获取并校验 [moorefu/quickjs-cosmo](https://github.com/moorefu/quickjs-cosmo/releases) 的现成 QuickJS，再自举生成 Wheel + ZIP 或 npm + ZIP。生成的运行时位于 `runtime/`，`.com` 作为构建产物管理。Windows 的 `build.cmd` 或 POSIX 的 `sh build.sh` 通过 QuickJS 自举 ZIP。ZIP 只含启动器、`runtime/` 与许可证。Python 包源码位于 `src/dairn/`，根目录 `pyproject.toml` 提供标准构建入口。下载环境和六种平台的制品矩阵见 [构建指南](https://github.com/moorefu/dairn/blob/main/BUILDING.md)；模板、工作流和受保护 CI 见 [治理指南](https://github.com/moorefu/dairn/blob/main/docs/GOVERNANCE.md)。

仓库自身的文档集中在这三处。`quickjs/assets/` 下的 Markdown 是分发给目标项目的规则与技能资源。项目目前为 `UNLICENSED`，第三方声明位于 `licenses/`。
