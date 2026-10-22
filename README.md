# Dairn

Dairn 是供 AI Agent 调用的开发治理内核，提供项目初始化、确定性检查、工作流状态、影响分析和证据验证。治理逻辑运行于自带的 Cosmopolitan QuickJS APE；Dairn 不调用模型。

## 安装

npm 包名、PyPI 分发名与模块名都是 `dairn`，包内自带 APE 和校验信息，安装时无需另外下载运行时。版本由发布标签决定：正式版进入默认通道，预发布进入 npm 的 `next` dist-tag 与 PyPI 的预发布通道。

| 渠道 | 安装方式 | 环境 |
| --- | --- | --- |
| npm（[npmjs.com](https://www.npmjs.com/package/dairn)） | `npm install dairn`；预发布 `npm install dairn@next` | Node.js 18+、npm |
| PyPI（[pypi.org](https://pypi.org/project/dairn/)） | `python -m pip install dairn`；预发布 `python -m pip install --pre dairn` | Python 3.10+ |
| 离线 tgz（[dairn-latest.tgz](https://github.com/moorefu/dairn/releases/download/latest/dairn-latest.tgz)） | `npm install --offline --ignore-scripts ./dairn-latest.tgz` | Node.js 18+、npm |
| 离线 Wheel（[安装索引 wheels.html](https://github.com/moorefu/dairn/releases/download/latest/wheels.html)） | `python -m pip install --upgrade --pre --no-index --find-links ./wheels.html dairn` | Python 3.10+ |
| 离线 ZIP（[dairn-latest.zip](https://github.com/moorefu/dairn/releases/download/latest/dairn-latest.zip)） | 解压后使用 `dairn.cmd` 或 `sh dairn.sh` | 自带 QuickJS 运行时 |

如果默认通道还没有正式版（例如当前只有预发布版本），上面的 `npm install dairn` / `pip install dairn` 会找不到可安装版本，请改用 `@next` / `--pre`；也可以固定到具体版本：`npm install dairn@<版本>`、`python -m pip install dairn==<PEP 440 版本>`。

npm 本地安装后用 `npx dairn` 调用，全局安装后可直接 `dairn`。`latest` 是离线下载入口，包内保留真实版本；Wheel 按规范保留版本文件名，下载索引后 pip 会获取其中指定的 Wheel 并校验 SHA256；需要固定版本时使用 [历史 Release](https://github.com/moorefu/dairn/releases)。

## 使用

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

两个入口先按根目录 `quickjs.lock.json` 获取并校验 [moorefu/quickjs-cosmo](https://github.com/moorefu/quickjs-cosmo/releases) 的现成 QuickJS，再自举生成 Wheel + ZIP 或 npm + ZIP。生成的运行时位于 `runtime/`，`.com` 作为构建产物管理。Windows 的 `build.cmd` 或 POSIX 的 `sh build.sh` 通过 QuickJS 自举 ZIP。ZIP 只含启动器、`runtime/` 与许可证。Python 包源码位于 `src/dairn/`，根目录 `pyproject.toml` 提供标准构建入口。

发布由 `v<版本>` 标签触发：标签版本会写入三类制品，矩阵验证通过后先发布 GitHub Release，再通过手动工作流把同一套已验证字节发布到 npm 与 PyPI。下载环境、六种平台的制品矩阵和注册表发布步骤见 [构建指南](https://github.com/moorefu/dairn/blob/main/BUILDING.md)；模板、工作流和受保护 CI 见 [治理指南](https://github.com/moorefu/dairn/blob/main/docs/GOVERNANCE.md)。

仓库自身的文档集中在这三处。`quickjs/assets/` 下的 Markdown 是分发给目标项目的规则与技能资源。项目目前为 `UNLICENSED`，第三方声明位于 `licenses/`。
