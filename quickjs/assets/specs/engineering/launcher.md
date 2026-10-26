---
id: dairn.engineering.launcher
title: Dairn 启动器、分发包与运行时调用契约
summary: 源码仓库、分发 ZIP 与项目根的同一对 dairn/dairn.cmd 启动器；唯一解析顺序 DAIRN_RUNTIME → 同目录 .dairn/runtime；DAIRN_RUNTIME_DIR 载荷复制、受管 launcher.json、upgrade 迁移与 Agent/CI 调用规则。
kind: spec
module: engineering
keywords: ["launcher", "DAIRN_RUNTIME", "DAIRN_RUNTIME_DIR", "vendored runtime", "分发包", "DAIRN_CI_BIN", "doctor"]
aliases: ["Launcher Contract", "调用入口契约", "Vendored Runtime"]
related: ["dairn.engineering.work-execution", "dairn.engineering.hooks", "dairn.ci.gates", "dairn.governance.distribution"]
symbols: ["dairn init", "dairn upgrade", "dairn doctor"]
---

# Dairn 启动器契约

源码仓库根、分发 ZIP 根与被治理项目根使用**同一对启动器**：POSIX 为 `dairn`（LF 行尾），Windows 为 `dairn.cmd`（CRLF 行尾）。文档与 Skill 示例中出现的 `dairn` 是这对启动器的简写，不代表存在全局安装。启动器只解析运行时并转发参数，治理判定全部由运行时内核完成。

## 唯一的启动器与放置位置

- 脚本正文的唯一源码位置是 `quickjs/assets/templates/project/launcher/`：源码仓库根的两个文件由 `tools/render-launchers.mjs` 从模板生成，项目根的两个文件由 `dairn init` / `dairn adopt` / `dairn upgrade --apply` 写入，分发包中的两个文件与源码仓库根文件字节一致。
- 项目根的 `dairn` / `dairn.cmd` 是**受管文件**：纳入项目 lock 的受管哈希，脚本头标注为生成文件。修改入口行为只能升级 Dairn 后重新生成，不能直接编辑。
- 两个脚本按行尾区分：POSIX 脚本必须保持 LF，Windows 脚本必须保持 CRLF。项目根 `.gitattributes` 与受管 `.dairn/.gitattributes` 负责在 `core.autocrlf=true` 的检出上保持稳定。
- POSIX 与 Windows 启动器统一命名为 `dairn` / `dairn.cmd`，旧版 POSIX 脚本名不再生成，项目启动器也不再放在 `.dairn/bin/`。旧版本生成的 `.dairn/bin/dairn` 与 `.dairn/bin/dairn.cmd` 是退役受管文件，由 `dairn upgrade --plan` 列出、`--apply` 删除。

## 解析顺序

启动器按固定顺序解析运行时，不做隐式安装、不联网下载、不静默回退到其他版本：

1. **显式 `DAIRN_RUNTIME`**（构建/验证新源码时使用）。相对路径按启动器所在目录解析；文件不存在时向 stderr 报告 `dairn: DAIRN_RUNTIME is not a file: <path>` 并以 **2** 退出。解析成功时导出 `DAIRN_RUNTIME_SOURCE=external`，`DAIRN_RUNTIME_DIR` 为运行时文件所在目录。
2. **启动器同目录 `.dairn/runtime/dairn-embedded.com`**（项目或解压出的发行包内 vendor 的运行时）。存在时导出 `DAIRN_RUNTIME_SOURCE=vendored`，`DAIRN_RUNTIME_DIR` 为 `.dairn/runtime`。
3. 两个位置都没有运行时：向 stderr 报告 `DAIRN_NOT_AVAILABLE: governance runtime not found`，并提示从解压的发行包运行、先用 `dairn init` / `dairn adopt` 创建项目，或在源码仓库设置 `DAIRN_RUNTIME` 指向新构建；以 **2** 退出。

POSIX 启动器使用按原运行时 SHA256 寻址的持久执行镜像。首次使用某个内容摘要时创建私有临时文件，复制并只给镜像设置 0700 权限，校验摘要后通过原子重命名发布；并发首次调用允许准备相同字节的镜像，发布过程不原地改写正在执行的文件。后续命中只读取原文件及镜像摘要，再通过 `exec /bin/sh` 执行镜像，不复制、不补权限、不删除。原运行时的字节与权限保持不变。

缓存目录按以下顺序选择，Windows 原生 APE 入口不使用这些 POSIX 镜像目录：

1. 显式设置 `DAIRN_CACHE_HOME`：镜像放其 `runtime-images-v1/` 子目录。配置必须为非空绝对路径；不安全或不可用都退出 2，不自动回退。
2. 未显式配置时使用 `${XDG_CACHE_HOME}/dairn/runtime-images-v1`；XDG 未设置时用 `$HOME/.cache/dairn/runtime-images-v1`。只有权限、只读文件系统或安全目录的创建/写入失败可以尝试下一候选。
3. 已识别项目的 `.dairn/cache/ape-exec/`：以启动器目录的普通 `.dairn/lock.json` 识别项目，安装适配层也可从当前工作目录向上查找。没有项目标记时不在任意目录创建本地缓存。

每个候选使用相同安全校验：缓存目录由当前用户拥有、权限 0700；已有逻辑路径拒绝用户可控符号链接，系统 root 拥有的 `/tmp`、`/var` 别名仍须校验真实路径；所有父目录须由当前用户或 root 拥有，拒绝非 sticky 的组/其他用户可写目录。镜像为 `<源文件摘要>.com`，必须为当前用户拥有、权限 0700 的普通文件，且 SHA256 与原始 Runtime 一致。检测到链接、异常所有权、类型、权限或摘要篡改时直接退出 2，不能以回退掩盖风险。缓存命中时校验现有镜像，不因目录只读而重新写入，也不执行原始载荷作为后备。

全部安全候选不可用时退出 2，输出 `DAIRN_RUNTIME_CACHE_UNAVAILABLE`，说明默认目录不可写、没有安全回退，并提示把 `DAIRN_CACHE_HOME` 设为私有、可写的绝对目录。成功回退不输出前一候选的 mkdir 噪声。缺少 SHA256 工具仍直接退出 2。

缓存只决定执行镜像位置，不提升信任级别，也不能替代外部 pin；`DAIRN_RUNTIME_DIR` 始终指向原始载荷目录。源 Runtime 升级后自然使用不同摘要的镜像，维护者可在没有相关命令运行时清理缓存目录。


参数、标准输入输出、工作目录、退出码和信号通过 `exec` 保持原生透传。缓存命中时没有额外的后台监护进程或退出清理。Windows 原生 PE 入口维持直接执行。任何位置都不再从 `runtime/` 目录隐式取运行时：源码仓库根的 `runtime/` 是旧构建遗留；新的源码验证由 with-built-runtime.py 管理隔离候选。

## 分发与安装时的目录结构

离线 ZIP 的根目录固定为：

```text
dairn
dairn.cmd
LICENSE
.dairn/runtime/dairn-embedded.com
.dairn/runtime/runtime-integrity.json
licenses/Cosmopolitan-ISC.txt
licenses/QuickJS-MIT.txt
```

把 ZIP 解压到目标项目后，启动器即可通过“同目录 vendored 运行时”解析。随后运行 `dairn init`（新项目）或 `dairn adopt`（既有项目）展开治理文件（`AGENTS.md`、`.agents/skills/`、`.dairn/governance/`、项目工具配置等）；已存在的 `.dairn/runtime/` 会被复用，不会重复复制。`LICENSE` 与 `licenses/` 只随发行包分发，不复制进项目。

npm / PyPI 安装提供同样的启动器与包内运行时。在项目目录中通过已安装的 CLI 运行 `dairn init` / `dairn adopt` 后：项目根生成 `dairn` / `dairn.cmd` 受管启动器，安装适配层设置的 `DAIRN_RUNTIME_DIR` 指向包内运行时目录，CLI 把该目录中的运行时二进制与完整性清单复制到项目的 `.dairn/runtime/`，并写入 vendored 模式的 `.dairn/launcher.json`。安装过程不会在项目里生成 `.dairn/bin/dairn*`，也不会复制 `LICENSE` / `licenses/`。

源码仓库日常使用项目 Pin；源码回归用 with-built-runtime.py 在独占目录构建、验证并清理候选。普通构建不写根 runtime 或项目 Pin。升级和回滚见 [运行时生命周期](runtime-lifecycle.md)。

## 传递给内核的环境变量

- `DAIRN_RUNTIME`：显式指定的运行时文件，优先级最高，仅供构建验证或显式切换。
- `DAIRN_RUNTIME_DIR`：启动器导出的**运行时所在目录**（vendored 为项目 `.dairn/runtime/`；external 为 `DAIRN_RUNTIME` 所在目录；安装适配层为包内运行时目录）。首次 init/adopt 与显式 Promotion 只把它当作待校验载荷目录；普通 upgrade 不复制载荷，不参与启动解析。
- `DAIRN_RUNTIME_SOURCE`：启动器导出的来源观察值，取 `vendored` 或 `external`，只用于 `dairn doctor` 报告，不参与身份判断。

`dairn doctor` 报告的 `runtime.source`（`vendored` / `external` / `unknown`）与 `runtime.freshness`（`current` / `outdated` / `unknown` / `not-source-repo`）只是观察字段：source 说明从哪调用，freshness 提示内嵌源码与工作树的陈旧关系；运行时身份仍以项目 lock 的 `runtime_sha256` 为准。旧 `DAIRN_FAST_RUNTIME` 转换开关不再使用；当前 `DAIRN_CACHE_HOME` 仅选择执行镜像缓存位置，不切换运行时来源。`DAIRN_RUNTIME_DIR` 始终指向原载荷目录，不指向镜像缓存。

## `.dairn/launcher.json`

**项目自有**配置 `launcher.json` 记录当前治理认可的 `mode` 与运行时身份，不参与受管哈希，不会被升级静默覆盖。启动器脚本本身只按文件是否存在解析；`dairn doctor` 会校验配置与实际解析结果一致。

```json
{
  "schema": 1,
  "launcher": "dairn",
  "windows_launcher": "dairn.cmd",
  "mode": "external",
  "runtime": null,
  "generated_by": "0.1.0-rc.1"
}
```

- `schema` 固定为 1；`launcher` 与 `windows_launcher` 必须分别等于受管的根启动器路径 `dairn` 与 `dairn.cmd`；旧路径配置在升级时迁移。
- `mode` 取 `external`（显式 `DAIRN_RUNTIME` 或安装适配层提供运行时）或 `vendored`（使用项目内 `.dairn/runtime/`）。
- `runtime` 在 `external` 模式下为 `null`；`vendored` 模式下必须是非空对象。
- `generated_by` 记录生成该配置的 Dairn 版本。

vendored 模式：

```json
{
  "schema": 1,
  "launcher": "dairn",
  "windows_launcher": "dairn.cmd",
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

`runtime` 的四个字段都必须非空；`sha256` 必须是 64 位小写十六进制；`version` 必须与执行注册命令的 Dairn 版本一致。若 `mode=external` 但 `.dairn/runtime/dairn-embedded.com` 存在，`doctor` 报告配置漂移，要求重新注册或移除运行时。

## 初始化、运行时复制与升级迁移

1. **新项目**：先放置官方运行时（解压分发包，或把官方 Release 的二进制与完整性清单放进 `.dairn/runtime/`），再运行 `dairn init`。存在 `DAIRN_RUNTIME_DIR` 载荷且版本匹配时，`init` 复制运行时并写入 vendored 配置；否则写入 external 配置并提示后续注册。
2. **接入既有项目**：`dairn adopt` 生成受管启动器与治理文件，同样可从 `DAIRN_RUNTIME_DIR` 复制运行时载荷。
3. **维护同一 vendored 身份**：`dairn upgrade --vendor-runtime .dairn/runtime --plan` 先规划，`--apply` 只维护与当前 Pin 相同的身份。不同身份必须使用显式 Runtime Promotion，不得先手工覆盖 Pin 再注册。`--vendor-runtime` 只接受仓库内相对路径 `.dairn/runtime` 或 `.dairn/runtime/dairn-embedded.com`，拒绝绝对路径、`..`、符号链接与越出项目根的位置；二进制与完整性清单缺一不可。
4. **注册校验**（fail closed）：完整性清单必须是 JSON，含 64 位小写 `sha256` 与非空 `engine_version`；实际二进制 SHA256 由 Dairn 内建实现直接读取并计算，仅在读取不可用时回退 `sha256sum` → `shasum -a 256` → `certutil -hashfile`；`engine_version` 与执行该命令的 Dairn 版本不一致即失败。任何一步失败都不写入 vendored 配置。
5. **从旧版本升级**：老项目运行 `dairn upgrade --plan`，计划中会出现退役的受管 `.dairn/bin/dairn`、`.dairn/bin/dairn.cmd`（状态 `remove`）以及新建的项目根启动器；`--apply` 删除退役文件、写入根启动器、把 `launcher.json` 的路径迁移为 `dairn` / `dairn.cmd`，；普通 upgrade 不复制载荷，不同身份须先审阅 Runtime Promotion。维护者必须审阅 Git diff 后再提交。
6. **版本不一致**：项目已 vendored 旧版本运行时、而执行的 CLI 是更新版本时，`upgrade --apply` 会被拒绝并提示使用显式 Runtime Promotion，不先覆写旧 Pin，避免启动器与新 lock 版本不一致。
7. **`dairn doctor` 复核**：两个根启动器文件存在、`launcher.json` 合法且路径等于受管路径；vendored 模式下还校验运行时与完整性文件存在、JSON 合法、清单摘要与配置摘要一致、实际二进制摘要与记录一致。任一项失败即报告问题并以 unready 退出（退出码 1）。
8. **`dairn doctor` 的 Runtime Lock 诊断**：运行时版本或摘要与项目 lock 不一致时，`doctor` 不阻断自身，而是输出 `status=drift` 与 `runtime_lock`（`dairn.runtime-lock.v1`：`drift[]` 的 `code/expected/actual`、`next_actions`），以退出码 4 报告漂移。ADVISORY 命令（`version`、`help`、`docs find`、`handoff` 等）在漂移下仍可只读执行；GATE 命令（`validate`、`check`、`analyze plan` 等）保持 fail closed，同样退出码 4 且错误为单行、不含内部堆栈。诊断与计划均不得写入 lock，`upgrade --apply` 仍需人工审阅。

`doctor` 同时探测 Git 与已声明技术栈的工具。Python 项目优先探测检查 argv 中实际配置的 Python 解释器；工具无法启动、退出码非零或探测超时都加入 `problems`。未显式设置 `TMPDIR` 且系统临时目录无法创建捕获文件时，已初始化项目自动回退到 `.dairn/tmp/`，拒绝符号链接或越界路径。显式 `TMPDIR` 不可用时直接失败；所有候选目录都失败时，错误给出路径和 `TMPDIR/TEMP` 提示，不得把探测失败当作环境就绪。

## Agent 与 CI 调用规则

- 仓库 `AGENTS.md` 的受管块记录启动器路径与简写声明；Agent 先按它调用，不假设全局 `dairn` 可用。
- 首次进入任务时运行启动器的 `dairn doctor`；失败时报告 `DAIRN_NOT_AVAILABLE` 或具体环境问题，**不要自行安装 Dairn**，也不要在仓库里写入或替换运行时。
- `dairn work next` 返回的 `invocation` 块给出 `posix`（`./dairn`）、`windows`（`dairn.cmd`）、`note` 与 `doctor` 命令；Agent 按报告值调用，不自行拼接其他路径。
- 项目生成的 CI 模板以 `${DAIRN_CI_BIN:-./dairn}` 为入口并用 `sh "$DAIRN_BIN_VALUE" …` 调用；`DAIRN_CI_BIN` 由管理员固定到受信启动器。受保护环境把解压后的发行包根放在检出目录之外（例如 `/opt/dairn`），使用 `DAIRN_CI_BIN=/opt/dairn/dairn`；此时启动器通过同目录 `.dairn/runtime/` 解析 vendored 运行时，不需要额外设置 `DAIRN_RUNTIME`。`DAIRN_CI_APE_PATH=/opt/dairn/.dairn/runtime/dairn-embedded.com` 只作为受保护脚本用外部 `DAIRN_EXPECTED_APE_SHA256` 校验收到的运行时，不是启动器输入。PR 流水线中的二进制不被信任。
- Hook 安装可把启动器路径写进脚本：`dairn hooks install --launcher <POSIX 绝对路径>`；默认值 `dairn` 仅在 `PATH` 可用时有效。

## 安全边界

- vendored 运行时是**可执行代码**：能读仓库、能执行项目命令的每个进程都应视为等同权限。
- 只接受官方发行版；注册前后都校验 SHA256 与版本；禁止自动更新覆盖。
- 受保护任务不得信任来自 PR 分支的二进制、启动器或摘要清单；可信基线必须来自受保护分支或外部配置。
- 启动器只解决“从哪调用”，不解决“是否可信”：调用成功不等于门禁通过、不等于人类批准，也不提升本地证据的信任级别。
- 分发包的 `LICENSE` 与 `licenses/` 只用于说明再分发条款；项目内运行时不改变项目自身许可证。

## 故障排查

| 现象 | 处理 |
| --- | --- |
| 退出 2 / `DAIRN_NOT_AVAILABLE` | 启动器同目录缺少 `.dairn/runtime/dairn-embedded.com`：解压分发包、用 `dairn init` / `dairn adopt` 展开项目，或在源码仓库设置 `DAIRN_RUNTIME` 指向新构建 |
| `dairn: DAIRN_RUNTIME is not a file` | 显式设置的运行时路径不存在；相对路径按启动器目录解析，改为正确的绝对路径或相对路径 |
| `doctor` 报 launcher missing | 运行 `dairn upgrade --apply` 生成项目根受管启动器 |
| `doctor` 报 launcher 配置漂移 | 先检查当前 Pin、Lock 与载荷身份；相同身份可用 upgrade 维护，不同身份使用 Runtime Promotion，不得以重新注册掩盖漂移 |
| `doctor` 报摘要不匹配 | 重新放置官方发行版与对应完整性清单；不要修改清单去迁就二进制 |
| `doctor` 报工具不可用或超时 | 核对报告中的具体命令、退出码和 PATH；Python 命令须与项目检查配置一致 |
| `Cannot open command output` | 将 `TMPDIR`（或 `TEMP`）设置为当前进程可写的临时目录后重试；不要绕过工具探测 |
| Windows 弹窗或退出码 `0xC0000142` | 子进程初始化失败，不等于工具未安装；核对进程权限、DLL 和执行环境。Windows 宿主通过 QuickJS Worker 同时排空 stdout/stderr 管道，避免 Cosmopolitan 文件句柄重定向问题；初始化失败仍以非零退出，不反复重试 |
| Windows 下嵌套 APE 输出为空或退出码 `0xC0000005` | Cosmopolitan 用 `_COSMO_FDS_V2` 传递 fd 表；原生工具（Python/Node 等）再启动 APE 孙进程时该变量指向未继承句柄。在会派生 APE 的原生检查入口清除 `_COSMO_FDS_V2`/`_COSMO_FDS` 后再启动子进程；不要重试或把空日志当作通过 |
| `Runtime assets differ from project lock` | 当前 CLI 内嵌资产与项目 lock 不一致；用已验证的对应运行时执行 `upgrade --plan`，审阅后 `upgrade --apply`。不同载荷须通过显式 Runtime Promotion，不要先手工覆盖 Pin 或修改 lock 摘要 |
| `Runtime Lock drift: …` / 退出码 4 | 运行时不匹配项目 lock 时的可诊断失败：先跑 `dairn doctor --json` 查看 `runtime_lock.drift`（`code/expected/actual`）与 `next_actions`；只读诊断不写 lock，需人工审阅后执行 `upgrade --plan`/`upgrade --apply`；`validate`/`check` 等 GATE 不会因诊断能力放行 |
| 运行时版本与执行的 Dairn 版本不一致 | 改用与当前 Dairn 版本匹配的官方发行版重新注册，不要手动改 `version` 字段 |
| 离线 / 无网络环境 | 从离线发行包获取运行时与完整性清单；启动器不会联网补齐 |
| Hook 脚本找不到命令 | 用 `dairn hooks install --launcher <绝对路径>` 重新生成 Hook |

所有失败都按 fail-closed 处理：报告原因并停止，不用编辑清单、替换二进制或绕过启动器的方式“修好”。
