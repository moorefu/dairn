# Agent Note: Agent 侧摩擦的机器契约：Runtime 诊断、跨平台入口、Docs 检索精度

Status: proposed

## Problem

外部复盘《Dairn Teammate 轨迹复盘》提出：Dairn 治理验证已被真实使用证明有价值，但 Agent 常在到达治理能力之前被启动、运行时一致性与错误恢复摩擦阻断，因此不能只按 Context/Handoff 调用率判断能力价值。本 Note 只对该复盘中可在本仓库核实的行为负责；三 teammate 的调用次数、失败细节等外部轨迹数据无法在仓库内验证，不作为证据使用。

核实基线：HEAD 8058191（复盘引用 e7e174a，相差 2 个提交），`dairn` 0.1.0-nightly.20261024123943（vendored 运行时，doctor freshness=current）。三份只读验证报告在仓库外生成：`D:\Worksapce\YHAF\dairn-ux-verify\ux01-runtime-lock.md`、`ux02-launcher-help.md`、`ux03-docs-context.md`；验证期间 `git status` 干净，未运行任何 `--apply`。

已核实的可复现摩擦（源码行号 + 真实 CLI）：

- Runtime Lock 漂移不可诊断：`verifyRuntimeLock`（`quickjs/core/project.mjs:350-364`）在 `analyze`（`:977`）、`quality`、`capability`、`work`、`hooks`、`notes`、`analyzers` 前置硬校验；`doctor` 自身首行即 `verifyRuntimeLock(required=true)`（`:523`），漂移时 exit 2、仅一行 `Dairn ERROR: …`，不并列 expected/actual，无 JSON；`upgrade --plan` 虽可绕开（`:423` 仅 `lockRead`），但实测 sha-only 漂移时输出与干净项目完全相同（actions:[]、exit 0），version-only 漂移仅字段不同、无警告，只有受管编辑才报 conflict/exit 2。结果是 Agent 在“不能继续”时既拿不到原因，也拿不到安全恢复路径；而 `check`/`validate`/`scope` 漂移时被 `engine.mjs:428` 前置阻断并打印 JS 堆栈。
- Windows/Git Bash 入口失败：Git Bash 下 `./dairn version` rc=126，stderr 为 `…/dairn-embedded.com: line 65: /c/Users/moore/.ape-1.10: cannot execute binary file: Exec format error`；根因是 POSIX 启动器 `dairn:33` 用 `/bin/sh` 执行 APE，APE 尾部 sh loader 按 `uname -m` 选 ELF 在 MSYS 下不可执行。`./dairn.cmd version`、`pwsh & '.\dairn.cmd'`、`cmd //c ".\dairn version"` 均 rc=0。启动器模板 `quickjs/assets/templates/project/launcher/dairn.sh`、`launcher-scripts.mjs`、`render-launchers.mjs` 及全部契约文档（AGENTS.md:9/55、CLAUDE.md:4、launcher spec、AGENT_INTEGRATION §4、dairn-agent-workflow SKILL）均无 MSYS/MINGW/CYGWIN 检测或 Git Bash 指引，只写“`./dairn`（Windows: `dairn.cmd`）”，agent 会先试 `./dairn`。
- CLI 帮助与错误不可行动：30 个子命令中 26 个 project 路由的 `--help` 统一 rc=2、单行 `Dairn ERROR: Unknown option: --help`；仅 `validate/scope/check/hook --help` 落到 engine 全局帮助；`help check` 也报未知命令；全局帮助缺 `workflow/context/approval/version/validate-core` 且 0 次提及 `--help`；`--help` 位置敏感。错误侧 engine 打 `ERROR: Error: …` 加 3 行 JS 堆栈（`engine.mjs:465`），project 打 `Dairn ERROR: …`（`project.mjs:1069`），两套前缀且无 `Run 'dairn help'` 类提示。
- Docs 检索实现落后于自身规范：`docCmd`（`project.mjs:493-521`）只对 id/path/全文做 lowercase 子串过滤、slice 30、无排序/score/相关性解释，`--json` 被静默忽略，多词只取首个词；`docs find note` 命中 21/40 specs（仅 2 条 ID 含 note），`docs find risk` 中精确 ID `dairn.governance.risk` 排第 6/7；`docs show` 只接受精确 ID 并整篇输出（launcher spec 9105 字符），无 `--section`/`--lines`；`docs context` 超 8000 字符按字符硬切（有截断 marker）。这与 `quickjs/assets/specs/knowledge/discovery.md:31,35,43` 已承诺的“只返回元数据与相关性解释”“精确 ID→alias/symbols→keywords→title/summary→章节/正文词法打分”不一致，属实现缺口而非规范缺失。
- Context/Handoff 无自然触发点：`work.mjs` 无 handoff/context 引用；hooks 只有 turn-end session anchor；`context-intelligence.md:111` 将 harness 集成列为 Phase 4 Planned，仓库无实现；`handoff --json` 无 trust/advisory 字段，`not evidence` 只出现在 `--out` 的提示文本（`project.mjs:717`）。
- PCC 现状：受信 CI 形状已存在（`docs/GOVERNANCE.md`、`ci/templates/github-protected.yml`、`ci/protected/{build,sign,publish}-*.sh`、外部 pin：ape/runtime/policy/analyzers SHA + trusted base），但本仓库 `.github/workflows/` 只有 release/registry 发布流，真实部署与签名验收仍待完成；复盘“PCC v1 未实现”应判为 Partly：内核与模板已有，生产部署验收未完成。

影响：Agent 在 lock 漂移、Windows 环境、错误分支上重试或放弃，高价值治理能力被前置摩擦掩盖；但不能用跳过 SHA、放宽 gate 或新增放行开关解决，也不能把 Context/Handoff 调用率当作成功指标。

## Proposal

总原则：把行为分成两类——GATE（必需保障，漂移时 fail-closed）与 ADVISORY（只读诊断/检索，可降级但必须可解释、可恢复、只读）。诊断输出只提供建议（suggested command），不自动执行、不授予审批；修复仍须人工审阅 `upgrade --apply`。UX 改动不得改变 `.dairn/governance/project.json` 策略语义、不得新增覆盖/豁免开关、不得降低 required check/evidence/gate 严格度。

### S0 诊断基元（被 S1/S2 复用，先行）

- 抽出纯函数 `runtimeLockReport(h,root)`，返回 `dairn.runtime-lock.v1`，作为 `verifyRuntimeLock`、`doctor`、`upgrade --plan` 的单一事实源，避免行为漂移。
- Schema：`{schema, status: ok|drift|missing|uninitialized, root, lock:{version,runtime_sha256}, actual:{version,runtime_sha256}, launcher:{mode,version,binary_sha256,integrity_sha256}, drift:[{code: runtime.version|runtime.sha256|managed.missing|managed.edited|lock.schema, path?, expected?, actual?}], managed:{checked,drifted}, next_actions:[…], read_only:true}`。必须并列两个 sha 身份：`lock.runtime_sha256` 是内嵌资产清单摘要（cb0a0c51…），`launcher.runtime.sha256` 是 APE 二进制摘要（ed88cbf4…），禁止混用。
- 稳定错误契约：GATE 失败 stderr 单行 `Runtime Lock drift: <code>`，无 JS 堆栈（`DAIRN_DEBUG=1` 时才输出 details）；新增 exit code 4 = drift/blocked-by-drift（当前 CLI 未使用 4；`quickjs/ci/accept-official-cosmo.sh` 的 4 不属于 CLI 契约），0/1/2/3 语义不变。`next_actions` 只建议如 `dairn upgrade --plan --json`、`dairn doctor --json`、`report-blocker`，不包含自动 apply。

### S1 UX-01：Runtime 诊断与恢复（收益最高）

- `doctor` 降级为只读诊断通道：不再因漂移先抛错；输出 `dairn.runtime-lock.v1`（文本 + `--json`）。status=ok exit 0；drift exit 4；uninitialized/missing 按只读语义报告。保留 doctor 现有 launcher/runtime freshness 检查项。
- `upgrade --plan` 输出增加 `runtime_lock` 字段（复用 S0）与 `next_actions`：sha-only/version-only 漂移不再静默（exit 4），受管编辑保留 conflict/exit 2 并附 path；`actions` 仍只列可升级受管内容，不隐藏受管差异。
- GATE 命令集合不变（check/validate/scope/hook/analyze plan/quality/capability/work/hooks/notes/analyzers）：漂移时 exit 4、稳定单行消息、无堆栈。ADVISORY 命令（version/help/docs find|show|context/handoff/governance/context）现状即不阻断，加回归测试锁定该边界。
- 文档：`docs/AGENT_INTEGRATION.md` §4 与 launcher spec 故障表新增 runtime lock 行——先用 `dairn doctor --json` 定位 code/expected/actual，再人工批准 `dairn upgrade --apply`；说明 exit 4。

### S2 UX-02：跨平台入口与 CLI help

- 启动器模板 `quickjs/assets/templates/project/launcher/dairn.sh`（加 `tools/render-launchers.mjs` 生成物）在 exec APE 前做平台判定：`uname -s` 匹配 `MINGW*|MSYS*|CYGWIN*` 时，若同目录存在 `dairn.cmd` 则受限委托 `cmd.exe //c dairn.cmd "$@"`；否则 stderr 一行 `dairn: Git Bash/MSYS cannot execute the POSIX APE; use ./dairn.cmd` + exit 2。不联网、不安装、不静默回退、不拼接复杂 shell 转发；委托实现需真实 argv 矩阵复核（空格、中文、引号、退出码）。
- 文档契约：AGENTS.md 根受管块与模板 `agents-navigation.md`、CLAUDE.md、launcher spec、AGENT_INTEGRATION §4、dairn-agent-workflow SKILL 统一写明“POSIX shell：`./dairn`；Windows 任意 shell（含 Git Bash/MSYS）：`./dairn.cmd`”；launcher 故障表增加 `Exec format error` 行（处理：改用 `./dairn.cmd`，不要改二进制）。
- help：把 `engine.mjs:426` 的全局帮助抽为唯一文本来源；`main.mjs` 在路由前拦截 `--help|-h` 与 `help [cmd]`，按命令输出 usage/options/example（补齐 workflow/context/approval/version/validate-core），rc=0；`--help` 位置不敏感。
- 错误：统一前缀为 `Dairn ERROR: Unknown option/command: x`，未知项追加第二行 `Run 'dairn help' for usage.`；engine 侧去掉 `Error: ` 与堆栈（`DAIRN_DEBUG=1` 才输出 details）；project 侧 usage 类错误同步附指引。
- 边界：help/错误提示必须在 runtime 内（engine/project/main）；平台分支放在启动器模板——这是唯一对所有宿主生效的一层，不依赖单个 harness 适配层。启动器属 criticalPaths（`test_native.mjs:19` 含 `dairn`/`dairn.cmd`），须评审 + 机器门禁。

### S3 UX-03：Docs 检索精度（对齐既有 discovery 契约）

- `docs find`：默认 stdout 保持 `id<TAB>path` 兼容；实现 `discovery.md:43` 的 v1 打分（exact ID 100 > alias 80 > symbols/keywords 60 > title/summary 40 > body 10；同分按 id 字典序）；新增 `--json` → `dairn.docs-find.v1`（`query/terms/hits[{id,path,fields,score,rank_reason}],truncated,next`）；多词 AND 而非只取首词；无命中 exit 1；stderr 追加 `Next: dairn docs show <id>`，stdout 保持纯净。
- `docs show`：新增 `--section <heading>` 与 `--lines A-B`（与默认全文互斥；未知 section/越界 exit 1/2 并列出可用标题）、`--json` → `dairn.docs-show.v1`（含 path/line_range）；权威正文与相对链接保持不变。
- `docs context`：8000 截断改为按行边界（可略超 1 行），保留显式 marker；空 query 返回 usage（exit 2）而非 status ok。
- Context/Handoff 触发：不做自动注入；在 `discovery.md` 渐进查找协议、`context-intelligence.md` 与 dairn-spec-discovery SKILL 增加“触发时机表”（初查 find→show；接手未完成任务/长会话压缩后 `handoff --json`；需要任务上下文时 `context "<terms>" --json`），受管导航模板加一行按需提示；`handoff --json` 增加顶层 `advisory:true`/`evidence:false` 字段，不改变内容来源、不写入证据树。
- 与 S2 边界：新 flag 需同步 `argsParse` 的 `VALUE_OPTIONS`/`FLAG_OPTIONS`（同文件），两个切片串行，S2 先落 help 框架。

### S4 顺序与 PCC 衔接

交付顺序：S0 → S1（UX-01，最高收益）→ S2（UX-02，首次可达性）→ S3（UX-03，精度）。每切片独立 PR + 回归测试；S2 触及 criticalPaths，单独评审。PCC-01/02（受信 Policy → Required Checks → Evidence → Gate）不因 UX 修复推迟：本 Note 明确 UX 切片不改策略与保障语义，PCC 的真实部署验收（受保护分支、外部 pin、隔离签名、publish 校验）另立任务推进；现状参见 docs/GOVERNANCE.md 的“Current — 需真实部署验收”。

## Alternatives considered

- 跳过/放宽 SHA 校验，或诊断命令自动 `upgrade --apply`：拒绝。破坏可信运行时契约并掩盖篡改；与复盘“不应通过跳过 SHA 修复”一致。诊断只读，修复须人工批准。
- 只修 harness 适配层（DSH/Codex/Claude Code）：拒绝。只覆盖单宿主且不能改仓库契约；Git Bash 问题在 POSIX 启动器模板层修一次即对所有宿主生效。
- POSIX 启动器用复杂 shell 参数拼接转发到 cmd.exe：拒绝为默认方案。路径、引号、退出码转换易错；采用受限委托（固定 `cmd //c dairn.cmd "$@"`）并配真实 argv 矩阵测试，失败时清晰报错。
- 给所有子代理自动注入 handoff/context：拒绝。复盘仅证明按需使用可能有效（docs-layout 自愿使用），全量注入造成重复 token 消耗；handoff 内容本就非可信证据。只在上下文断裂场景（接手、长会话压缩后、HEAD 变化）提示。
- 把 read/grep/docs show 等调研轨迹写入可信 Evidence：拒绝。读取不能证明理解，调用流水账不能证明决策正确；轨迹只适合遥测。需要知识依赖时只保存结构化引用（Decision → Spec Revision → Implemented Change → Required Test）。
- 以 Context/Handoff 调用次数作为 KPI：拒绝。PCC 保障应独立于 Agent 是否调用辅助工具（复盘第四节结论）。
- 新增“诊断模式”放行命令或 override 环境变量：拒绝。任何“绕过一致性”的开关都会侵蚀治理信任；只允许只读诊断与建议。

## Acceptance criteria

每条均可由本仓库命令复现；测试放置遵循现有门禁（`tools/check-source.py` 的 lint/unit/integration 阶段，Windows 用 `dairn.cmd`）。

UX-01（新增 `quickjs/tests/test_runtime_lock_diagnostic.py`，复用 `test_project_lifecycle.py` 的 temp init + CLI 模式；注册进 `tools/check-source.py:60-65` integration 与 `tools/verify-linux.py`）：

1. sha-only 漂移（临时项目篡改 `lock.runtime_sha256`）：`dairn doctor --json` 输出合法 JSON，`status=drift`，`drift[0].code=runtime.sha256` 且并列 expected/actual；exit 4；stderr 无 `at ` 堆栈。
2. 同环境下 `dairn upgrade --plan --json` 含 `runtime_lock` drift 条目与 `next_actions`（只含建议命令），exit 4；干净项目仍 exit 0、`actions:[]` 不变。
3. version 漂移：doctor/plan 报 `runtime.version`，并列 lock.version 与 actual.version。
4. 受管编辑：plan 保留 conflict/exit 2，JSON 含 `managed.edited` + path；doctor exit 4 并列 path。
5. GATE 边界：`check`/`validate`/`scope`/`analyze plan` 漂移时 exit 4、stderr 恰一行 `Runtime Lock drift:` 前缀、无堆栈；不存在任何 `--apply` 或 override 路径。
6. ADVISORY 边界：`version`、`help`、`docs find`、`handoff --json`、`governance`、`context` 漂移时仍 exit 0，`--json` stdout 为纯 JSON。
7. 回归：`python -m unittest quickjs.tests.test_runtime_lock_diagnostic -v` 与 `python tools/check-source.py integration` 通过；`./dairn check --all --timeout 3600`（维护者）不因本切片变红。

UX-02：

1. 真实 Git Bash 下 `bash ./dairn version`：委托成功时 rc 0 且输出与 `./dairn.cmd version` 一致；不可委托时 rc 2 且 stderr 含 `dairn.cmd` 指引。用 argv 矩阵验证 `docs find "evidence snapshot"`、含空格/中文/引号参数透传与退出码。
2. 启动器变更闭环：`node tools/render-launchers.mjs --check` 通过；`test_launcher_native.mjs`、`test_root_launcher.py`、`test_windows.py` 全绿；`dairn`/`dairn.cmd`/`AGENTS.md` 的 criticalPaths 变更经评审 + 机器门禁。
3. 子命令 help：init/adopt/detect/version/doctor/upgrade/docs/skills/guide/workflow/work/analyzers/analyze/context/quality/capability/tasks/hooks/notes/evidence/gate/attest/approval/handoff/governance/refactor 的 `--help` 全部 rc 0，stdout 含该命令 usage、参数与至少一个示例；`help check` rc 0；`--help` 位置不敏感（`docs check --help` 与 `check --base HEAD --help` 行为一致）。
4. 错误：`dairn frobnicate`、`dairn check --bogus`、`dairn scope --base`、`dairn docs show` 统一前缀（恰一行）+ rc 2，stderr 不含 `at <file>` 堆栈；未知命令/选项追加 `Run 'dairn help' for usage.`；`DAIRN_DEBUG=1` 时才输出 details。
5. 文档一致性：AGENTS.md/CLAUDE.md/launcher spec/AGENT_INTEGRATION/dairn-agent-workflow SKILL 更新后 `./dairn docs check` PASS；launcher 故障表含 `Exec format error` → 改用 `./dairn.cmd` 行。
6. 固定回归场景（纳入 test_windows.py 或 integration）：Git Bash 首次调用 Dairn 不出现连续试错（首轮即得到可用入口或明确指引）。

UX-03：

1. `dairn docs find note --json` 输出合法 `dairn.docs-find.v1`，排序符合 exact ID/alias/symbols/keywords/title/summary/body 顺序；`docs find risk` 首位为 `dairn.governance.risk`；`docs find note format` 呈 AND（两词均需匹配）。
2. `dairn docs show dairn.engineering.launcher --section <heading>` 只返回目标节；`--lines` 越界 exit 2；`--json` 可解析且含 path/line_range；默认全文输出与现输出正文一致（兼容）。
3. 检索效率：固定任务“找 Note 格式规范”在 2 次调用内（find + show --section）命中，输出总量 ≤ 8000 字符；对照当前（find 21 条 + show 整篇）显著下降。
4. `docs context` 截断落在行边界且保留 marker；空 query 返回 usage（exit 2）。
5. `handoff --json` 含 `advisory:true`、`evidence:false`；仓库中不存在自动注入路径（断言 work/hook 不因会话开始隐式调用 handoff）。
6. 现有测试不破：`test_assets_lint.py`、`test_project_lifecycle.py`、`test_core.mjs`、`test_handoff_native.mjs`、`test_context_command.py`；`./dairn docs check` PASS、`python tools/check-source.py unit|integration` 通过。

PCC 边界（所有切片）：

7. UX 改动不修改 `.dairn/governance/project.json` 策略语义、不新增覆盖/豁免开关、不降低 required check/evidence/gate 严格度；同一 base/head 下 `dairn governance plan --base <ref>` 的 requirements 不变。
8. 复盘的外部轨迹数据（三 teammate 调用次数、失败细节）不作为验收依据；验收只使用本仓库可复现行为与上述命令级断言。

## Risks

- exit 2→4 兼容性：脚本/CI 可能依赖 exit 2；缓解为稳定消息前缀 + 文档化 + schema 版本，且仅新增 4，不改变 0/1/2/3 语义。
- doctor 改为报告模式后，忽略 exit/status 的调用方可能漏报漂移；缓解为 GATE 命令仍 fail-closed、drift 输出显著标注、回归测试断言 exit 4。
- 两类 sha 身份混用会误诊：`lock.runtime_sha256`（资产清单摘要）≠ `launcher.runtime.sha256`（APE 二进制摘要）；schema 分 `lock`/`launcher` 两组并在文档解释。
- 启动器平台分支风险：MSYS→cmd.exe 的 argv 透传（空格、中文、引号、退出码）可能不可靠；缓解为真实矩阵测试，失败时输出清晰指引而非静默回退，不采用复杂参数拼接。
- criticalPaths 风险：`dairn`/`dairn.cmd`/`AGENTS.md` 属 L2 治理-critical 受管面，改错会破坏 init/upgrade/lock 语义；必须评审 + 机器门禁，禁止手改受管副本二进制或摘要。
- docs 排序/输出变化可能影响下游脚本与现有测试；缓解为默认 stdout 兼容、`--json` 作为正式契约、已核实现有断言只包含 ID 无顺序依赖（`test_assets_lint.py:33`、`test_project_lifecycle.py:28`）。
- `show --section/--lines` 需与 i18n（`.zh.md`/`.i18n.yaml`）及相对链接校验共存；未知 section 不得静默降级为全文（fail visible），改动后必须跑 `dairn docs check`。
- 范围蔓延：UX 切片不得推迟 PCC-01/02；本 Note 约束 UX 不改策略与保障语义，PCC 部署验收另立任务。
- 外部复盘不可核对：三 teammate 轨迹与调用次数无法在仓库验证；本 Note 的动机仅基于可复现摩擦，避免把外部数据当作证据。
