---
id: dairn.engineering.launcher
title: 项目 Launcher 与运行时调用契约
summary: 项目内唯一推荐入口的解析顺序、受管 launcher 脚本与项目自有 launcher.json、vendored 运行时注册方式、Agent/CI 调用规则与安全边界。
kind: spec
module: engineering
keywords: ["launcher", "DAIRN_BIN", "vendored runtime", "调用入口", "离线", "DAIRN_CI_BIN", "doctor"]
aliases: ["Launcher Contract", "调用入口契约", "Vendored Runtime"]
related: ["dairn.engineering.work-execution", "dairn.engineering.hooks", "dairn.ci.gates", "dairn.governance.distribution"]
symbols: ["dairn init", "dairn upgrade", "dairn doctor"]
---

# 项目 Launcher 契约

项目为被采纳的仓库提供一个**唯一推荐调用入口**，Agent 与 CI 都从这里调用 Dairn。文档与 Skill 示例中出现的 `dairn` 是 launcher 的简写，不代表存在全局安装。

## 入口与解析顺序

- POSIX：`.dairn/bin/dairn`；Windows：`.dairn/bin/dairn.cmd`。
- 两个脚本是**受管文件**：由 `dairn init` / `dairn adopt` / `dairn upgrade --apply` 生成，纳入受管哈希，脚本头明确标注不要手改。修改入口行为只能通过升级 Dairn 并重新生成，不能直接编辑。
- 解析顺序固定为：`DAIRN_BIN` → `.dairn/runtime/dairn-embedded.com`（vendored 运行时）→ `PATH` 上的 `dairn` → 失败。
- 全部解析失败时向 stderr 报错并以 **127** 退出：报告 `DAIRN_NOT_AVAILABLE`，由项目维护者启用 vendored 运行时或设置 `DAIRN_BIN`；launcher **不自动下载、不自动安装、不静默回退**到其他版本。

launcher 自身不实现治理逻辑：它把参数转交给解析到的运行时，判定仍由运行时完成。直接调用运行时二进制与调用 launcher 等价，但只有 launcher 承诺上述解析顺序。

## `.dairn/launcher.json`

launcher 脚本按“文件是否存在”执行解析（`DAIRN_BIN` → vendored 二进制 → PATH）；**项目自有**配置 `launcher.json` 记录当前治理认可的 `mode` 与运行时身份，不参与受管哈希、不会被升级静默覆盖。`doctor` 会校验两者一致：`mode=external` 但 `.dairn/runtime/dairn-embedded.com` 存在时报告配置漂移，要求重新注册或移除运行时。

```json
{
  "schema": 1,
  "launcher": ".dairn/bin/dairn",
  "windows_launcher": ".dairn/bin/dairn.cmd",
  "mode": "external",
  "runtime": null,
  "generated_by": "0.1.0-rc.1"
}
```

- `schema` 固定为 1；`launcher` 与 `windows_launcher` 必须分别等于受管的两个路径。
- `mode` 取 `external`（解析到 `DAIRN_BIN` 或 `PATH`）或 `vendored`（使用项目内运行时）；它必须与实际解析结果一致，`doctor` 会拒绝不一致的配置。
- `runtime` 在 `external` 模式下为 `null`；`vendored` 模式下必须是非空对象，见下。
- `generated_by` 记录生成该配置的 Dairn 版本。

vendored 模式：

```json
{
  "schema": 1,
  "launcher": ".dairn/bin/dairn",
  "windows_launcher": ".dairn/bin/dairn.cmd",
  "mode": "vendored",
  "runtime": {
    "path": ".dairn/runtime/dairn-embedded.com",
    "integrity": ".dairn/runtime/runtime-integrity.json",
    "version": "0.1.0-rc.1",
    "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  },
  "generated_by": "0.1.0-rc.1"
}
```

`runtime` 的四个字段都必须非空；`sha256` 必须是 64 位小写十六进制；`version` 必须与执行注册命令的 Dairn 版本一致（`upgrade --vendor-runtime` 会同时更新项目 lock）。

## 启用、注册与升级

1. 放置官方产物：把官方发行的运行时二进制放到 `.dairn/runtime/dairn-embedded.com`，把对应完整性清单放到 `.dairn/runtime/runtime-integrity.json`。只接受官方 Release 产物，不放本地构建或来源不明的二进制。
2. 首次启用：先 `dairn init`（或 `dairn adopt`）生成 `external` 模式 launcher；把运行时放入 `.dairn/runtime/` 后运行 `dairn upgrade --vendor-runtime .dairn/runtime --apply`。`init` 要求空目录，无法在初始化前放置运行时，因此不要对 `init` 使用 `--vendor-runtime`；`adopt` 在运行时已就位时可直接带 `--vendor-runtime`。
3. 切换或升级：`dairn upgrade --vendor-runtime .dairn/runtime --apply`；不带 `--apply` 时只规划。老项目缺少 launcher 文件时，`dairn doctor` 会提示 `run dairn upgrade --apply` 生成受管入口。若项目已 vendored 旧版本运行时、而执行的 CLI 是更新版本，`upgrade --apply` 会被拒绝并提示先替换 `.dairn/runtime` 再带 `--vendor-runtime` 注册，避免 launcher 与新 lock 版本不一致。
4. `--vendor-runtime` 只接受仓库内相对路径 `.dairn/runtime` 或 `.dairn/runtime/dairn-embedded.com`；拒绝绝对路径、`..`、符号链接与越出项目根的位置。二进制与完整性清单缺一不可。
5. 注册时校验：完整性清单必须是 JSON，含 64 位小写 `sha256` 与非空 `engine_version`；实际二进制 SHA256 由 Dairn 内建实现直接读取二进制计算（不依赖外部工具），仅在二进制读取不可用时回退 `sha256sum` → `shasum -a 256` → `certutil -hashfile`，并与清单比对；`engine_version` 与执行该命令的 Dairn 版本不一致即失败。任何一步失败都不会写入 vendored 配置。
6. `dairn doctor` 复核：两个 launcher 文件存在、`launcher.json` 合法且路径等于受管路径；vendored 模式下还校验运行时与完整性文件存在、JSON 合法、清单摘要与配置摘要一致、实际二进制摘要与记录一致。任一项失败即报告问题。

## Agent 与 CI 调用规则

- 仓库 `AGENTS.md` 的受管块记录 launcher 路径与简写声明；Agent 先按它调用，不假设全局 `dairn` 可用。
- 首次进入任务时运行 launcher 的 `doctor`；失败时报告 `DAIRN_NOT_AVAILABLE`，**不要自行安装 Dairn**，也不要在仓库里写入运行时。
- `dairn work next` 返回 `invocation` 块（`posix`、`windows`、`note`、`doctor`）；`dairn work verify` 额外返回 launcher 摘要。Agent 按 `invocation.posix` / `invocation.windows` 调用，不自行拼接路径。
- CI 使用 `${DAIRN_CI_BIN:-./.dairn/bin/dairn}` 调用，避免依赖 Runner 的 PATH 布局；受保护环境额外用外部配置的 `DAIRN_EXPECTED_APE_SHA256` 校验实际执行的运行时。PR 流水线中的二进制不被信任。
- Hook 安装可把 launcher 路径写进脚本：`dairn hooks install --launcher <POSIX 绝对路径>`；默认值 `dairn` 仅在 PATH 可用时有效。

## 安全边界

- vendored 运行时是**可执行代码**：能读仓库、能执行项目命令的每个进程都应视为等同权限。
- 只接受官方发行版；注册前后都校验 SHA256 与版本；禁止自动更新覆盖。
- 受保护任务不得信任来自 PR 分支的二进制、launcher 或摘要清单；可信基线必须来自受保护分支或外部配置。
- launcher 只解决“从哪调用”，不解决“是否可信”：调用成功不等于门禁通过、不等于人类批准，也不提升本地证据的信任级别。

## 故障排查

| 现象 | 处理 |
| --- | --- |
| 退出 127 / `DAIRN_NOT_AVAILABLE` | 检查 `DAIRN_BIN`、`.dairn/launcher.json`、`.dairn/bin/dairn` 是否可执行；让维护者启用 vendored 运行时或设置 `DAIRN_BIN` |
| `doctor` 报 launcher missing | 运行 `dairn upgrade --apply` 生成受管 launcher 文件 |
| `doctor` 报摘要不匹配 | 重新放置官方发行版与对应完整性清单；不要修改清单去迁就二进制 |
| 运行时版本与执行的 Dairn 版本不一致 | 改用与当前 Dairn 版本匹配的官方发行版重新注册，不要手动改 `version` 字段 |
| 离线 / 无网络环境 | 从离线发行包获取运行时与完整性清单；launcher 不会联网补齐 |
| Hook 脚本找不到命令 | 用 `dairn hooks install --launcher <绝对路径>` 重新生成 Hook |

所有失败都按 fail-closed 处理：报告原因并停止，不用编辑清单、替换二进制或绕过 launcher 的方式“修好”。
