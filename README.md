# Dairn — AI-Native Software Engineering Toolkit

Dairn 运行在开发者和 AI Agent 之间，把“改代码”变成**按需治理、可验证交付**：它判断改动需要哪些真实检查、在受保护 CI 中生成可验证证据、在多人/多 Agent 交接时保留工程上下文。Dairn 本体是一个确定性 CLI，**内部不调用模型**，也不接管宿主的权限与工具。

一句话：**把分层、可验证、有审计证据的治理能力交付给 AI Agent，而不是替代 Agent。**

## 为什么

- **依赖上下文，而不是治理上下文**：Agent 能生成代码，却常常看不见测试矩阵、契约和真实 CI 状态。Dairn 把这些变成机器可读、可执行的输入。
- **执行机制，而不是文档建议**：规范落到命令、退出码和证据上；“建议跑测试”不等于“测试被跑了”。
- **受保护的信任边界**：本地 CLI 负责快速反馈；发布级证据来自受保护 CI 使用外部固定的运行时与策略生成的签名与快照。
- **工程记忆而非会话记忆**：任务、Run、评审、质量与交接信息随仓库演化，换 Agent 或换人都能接手。
- **Agent 无关**：Codex、Claude Code、DeepSeek Harness、Cursor 或自定义 Agent 都通过同样的文件与 CLI 接入。

## 核心能力

| 领域 | 现在能做什么 | 深入 |
| --- | --- | --- |
| 治理决策 | `governance plan/check` 按 L/G 模式与风险等级决定真实门禁、审批与证据 | [ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| 受保护 CI | 外部固定运行时 + 策略、签名证据、证据发布（需真实部署验收） | [GOVERNANCE.md](docs/GOVERNANCE.md) |
| 按需分析 | `dairn analyzers`、能力驱动的 Analyzer Selection、SARIF/JUnit/Coverage 导入 | [ANALYZERS.md](docs/ANALYZERS.md) |
| 工程记忆 | `handoff`、`context`、`guide impact`、`work next` 提供带来源的最小上下文 | [ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Agent 接入 | AGENTS.md/CLAUDE.md、`skills add`、hooks 与各宿主加载方式 | [AGENT_INTEGRATION.md](docs/AGENT_INTEGRATION.md) |
| 路线图 | 分阶段目标、Context Intelligence 计划与试点建议 | [ROADMAP.md](docs/ROADMAP.md) |

## 安装

选择一种渠道，然后在**项目根目录**运行 `init`（新项目）或 `adopt`（已有项目）。CLI 命令名为 `dairn`；npm 包为 [`@moorefu/dairn`](https://www.npmjs.com/package/@moorefu/dairn)（unscoped `dairn` 曾被 npm 拒绝），PyPI 包为 [`dairn`](https://pypi.org/project/dairn/)。

| 渠道 | 命令 | 说明 |
| --- | --- | --- |
| npm | `npm install -D @moorefu/dairn` | 预发布用 `@moorefu/dairn@next`；安装后在项目根运行 `npx dairn init` / `npx dairn adopt` |
| PyPI | `python -m pip install dairn` | 预发布加 `--pre`；安装后在项目根运行 `dairn init` / `dairn adopt` |
| GitHub Release | 下载并解压 `dairn-latest.zip` | 解压目录含 `dairn`、`dairn.cmd` 与 `.dairn/runtime/`；在项目根解压后运行 `./dairn init`（Windows `dairn.cmd init`） |
| 源码构建 | 见 [BUILDING.md](BUILDING.md) | 构建根启动器与 `runtime/`，并可打包 ZIP/Wheel/npm |

安装命令不代表对应版本一定已发布；建议固定精确版本并校验制品摘要。

**启动器与运行时**：POSIX 用 `./dairn`（可执行位已设置），Windows 用 `dairn.cmd`。启动器按以下顺序定位运行时：

1. `DAIRN_RUNTIME` 显式指定的 APE（构建/验证用，相对路径相对启动器目录解析）；
2. 启动器同目录的 `.dairn/runtime/dairn-embedded.com`（发行包与 `init`/`adopt` 项目自带）；
3. 两者都不存在时报错并以退出码 2 提示：解压发行包、或在项目根运行 `./dairn init`/`./dairn adopt` 以绑定运行时。

解析顺序与 `.dairn/runtime/` 的完整契约见 [launcher 规范](quickjs/assets/specs/engineering/launcher.md)。本仓库根的 `runtime/` 只是构建产物，不参与日常启动；源码仓库开发方式见 [BUILDING.md](BUILDING.md)。

## 最小用法（可复制）

```sh
./dairn handoff --json                 # 只读接手摘要（任意 Git 仓库可用）
./dairn init                           # 新项目：初始化治理配置并生成启动器
./dairn adopt                          # 已有项目：接入 Dairn
./dairn governance plan --base <sha>   # 计算本次变更的治理计划
./dairn check --base <trusted-ref>     # 运行必跑检查与门禁
./dairn doctor                         # 环境与配置自检
./dairn validate                       # 校验受管资源与配置
```

## Agent 与 Harness

Dairn 的集成面全部是普通文件：`AGENTS.md`（Codex/通用入口）、`CLAUDE.md`（Claude Code 导航）、`.agents/skills/*/SKILL.md`（按需加载的 Skill）、`.dairn/hooks/*`（回合末/推送前 hook）。宿主负责读取这些文件；Dairn 不要求安装任何额外扫描组件。

| 宿主 | 仓库内提供的入口 | 需要宿主侧配置 |
| --- | --- | --- |
| Codex | `AGENTS.md`、`.agents/skills/*/agents/openai.yaml` | `config.toml` 的 `notify` 接线 |
| Claude Code | `CLAUDE.md`、`.agents/skills/*/SKILL.md` | `Stop` hook 接线；Skill 显式加载 |
| DeepSeek Harness | `AGENTS.md`/`CLAUDE.md` 注入、Skill 按需加载 | 插件 hook 接线（`DSH_SESSION_ID`） |
| Cursor / 其他 | `AGENTS.md` 等普通文件 | 项目规则引用；Skill/hooks 不自动生效 |

各宿主的仓库事实、宿主约定与排查方法见 [AGENT_INTEGRATION.md](docs/AGENT_INTEGRATION.md)。

## 文档地图

| 文档 | 内容 |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 定位、设计原则、分层与整体架构、治理模式、安全边界 |
| [docs/ANALYZERS.md](docs/ANALYZERS.md) | Analyzer 工具、模板、协议、按需分析选择与 Quality Fitness |
| [docs/AGENT_INTEGRATION.md](docs/AGENT_INTEGRATION.md) | Skill 生命周期、各宿主加载契约与排查 |
| [docs/ROADMAP.md](docs/ROADMAP.md) | 演进方向、目标命令、Context Intelligence、试点计划 |
| [AGENTS.md](AGENTS.md) | Agent 与维护者的仓库入口（命令、规则、安全） |
| [docs/PROJECT_GUIDE.md](docs/PROJECT_GUIDE.md) | 本仓库的开发、门禁、发布与证据边界 |
| [docs/GOVERNANCE.md](docs/GOVERNANCE.md) | 治理配置、hooks、受保护 CI 与模板 |
| [BUILDING.md](BUILDING.md) | 构建、打包、制品结构与本地复核 |
| [quickjs/assets/specs](quickjs/assets/specs) | 权威规范源（`dairn docs find/show` 读取） |

## 安全边界

- **本地 CLI 不调用模型**，不需要 API Key；所有判定基于仓库事实、策略与真实命令输出。
- 本地检查与 hook 只产生**本机可见**的证据锚点；发布级信任来自受保护 CI 的外部固定运行时与策略，本地运行不构成受保护 CI 的信任证明。
- Agent 不得安装 Dairn、修改全局环境或绕过受保护 CI；启动器缺失时停止并报告。
- 受管文件（`AGENTS.md` 导航块、`.dairn/lock.json`、`.dairn/runtime/`、受管 Skill）只能由 `init`/`adopt`/`upgrade` 更新，并审阅差异。
- 第三方 Skill、报告与仓库内文本按不可信输入处理。

## 贡献

见 [ROADMAP.md](docs/ROADMAP.md) 的参与方向与试点计划；开发与提交流程见 [AGENTS.md](AGENTS.md) 与 [BUILDING.md](BUILDING.md)。提交前请运行 `./dairn check --base <trusted-ref>` 与 `python -m unittest`，不要伪造证据或批准。

## 许可证

Dairn 以 [MIT License](LICENSE) 发布。发行包内的第三方组件声明见 `licenses/`（Cosmopolitan ISC、QuickJS MIT）。
