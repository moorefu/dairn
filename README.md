# Dairn

Dairn 是供 AI Agent 调用的开发治理内核，提供项目初始化、确定性检查、工作流状态、影响分析和证据验证。治理逻辑运行于自带的 Cosmopolitan QuickJS APE；Dairn 不调用模型。

## 安装与使用

发布三类制品，均使用同一份内嵌治理代码和资源的 APE：

| 制品 | 安装方式 | 环境 |
| --- | --- | --- |
| npm `.tgz` | `npm install --offline --ignore-scripts ./dist/dairn-1.1.0-rc.9.tgz` | Node.js 18+、npm |
| Wheel `.whl` | `python -m pip install --no-index ./dist/dairn-1.1.0rc9-py3-none-any.whl` | Python 3.10+ |
| `.zip` | 解压后使用 `dairn.cmd` 或 `sh dairn.sh` | 无需 Python/Node |

Python 分发名、模块名和 npm 包名均为 `dairn`。安装包的 `runtime/` 包含 APE 和校验信息，安装无需下载运行时。npm 本地安装后通过 `npx --offline --no-install dairn` 调用；Wheel 安装后可直接使用：

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

分别生成 Wheel + ZIP、npm + ZIP。ZIP 只含启动器、`runtime/` 与许可证；在仓库中执行 Windows 的 `build.cmd` 或 POSIX 的 `sh build.sh` 可通过自带 QuickJS 构建 ZIP。构建和六种平台的制品矩阵见 [构建指南](https://github.com/moorefu/dairn/blob/main/BUILDING.md)；模板、工作流和受保护 CI 见 [治理指南](https://github.com/moorefu/dairn/blob/main/docs/GOVERNANCE.md)。

仓库自身的文档集中在这三处。`quickjs/assets/` 下的 Markdown 是分发给目标项目的规则与技能资源。项目目前为 `UNLICENSED`，第三方声明位于 `licenses/`。
