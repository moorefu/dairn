---
id: dairn.engineering.hooks
title: Agent Hook 与会话锚定证据契约
summary: pre-push 与 turn-end Hook 的命令面、事件来源、环境变量、锚点 JSON 字段与失败策略；锚点只是 local-unattributed 过程证据。
kind: spec
module: engineering
keywords: ["hook", "pre-push", "turn-end", "session anchor", "会话锚定", "Claude Code", "Codex", "DSH"]
aliases: ["Agent Hook 契约", "会话锚点", "Session Anchor"]
related: ["dairn.engineering.work-execution", "dairn.engineering.agent-execution-protocol", "dairn.ci.gates", "dairn.governance.modes"]
symbols: ["dairn hooks install", "dairn hook pre-push", "dairn hook turn-end"]
---

# Agent Hook 契约

Hook 把 Agent 会话的**过程事实**记录成可追溯证据，并在推送前复跑本地检查。它不提升任何信任级别：锚点与推送检查都是本地证据，与受保护 CI 的签名声明相差一个信任层级。

## 命令面

- `dairn hooks install`：规划 Hook 文件，`--apply` 才写入 `.dairn/hooks/`；`--git` 另外安装 `.git/hooks/pre-push`，`--force` 才允许覆盖冲突文件。`--launcher <POSIX 绝对路径>` 供 npm 本地安装等 PATH 中没有 `dairn` 的场景写入可执行 launcher（Windows 反斜杠路径不可直接用于 POSIX sh hook）。重复执行不会覆盖已存在的项目 Hook 文件；git worktree（`.git` 为文件）会跳过 git hook 安装并给出警告。
- `dairn hook pre-push`：推送前依次执行基线解析、结构治理、风险门禁与活跃任务证据校验。`--no-check` 只跳过风险门禁。
- `dairn hook turn-end`：回合结束时把会话锚定到活跃任务。

安装生成的文件是项目自有的可审查脚本：`.dairn/hooks/pre-push`、`turn-end.sh`、`turn-end-codex.sh`、`turn-end-dsh.sh` 与 `README.md`。脚本只转调 CLI，不复制判定逻辑。

## pre-push 契约

1. **基线解析**：按 `--base`、`DAIRN_TRUSTED_BASE_REF`、`git merge-base HEAD origin/main`、`HEAD^` 的顺序解析可信差异基线；全部不可得时失败。
2. **结构治理**：运行文档与治理配置校验，错误立即非零退出。
3. **风险门禁**：未指定 `--no-check` 时按风险执行必需检查，并把本次结果写成 `.dairn/governance/evidence/pre-push-<时间戳>-checks.json`（`trust: local-unattested`，不是风险门禁完成记录）。
4. **活跃任务证据**：校验活跃任务证据是否仍对应当前状态；失败返回非零。

`--no-check` 只跳过第 3 步，基线解析、结构治理与活跃任务证据仍然执行。pre-push 是本地信号：它证明本机在推送时执行了这些命令，不证明受保护分支上的检查已通过，也不替代人工审批。

## turn-end 契约

1. **事件来源**：`--stdin` 从标准输入读取事件 JSON（上限 64 KiB），或 `--payload` 直接传事件 JSON 文本；无 payload 时按空对象处理。
2. **任务**：`--task` 指定；未指定时要求恰好一个活跃任务，多个活跃任务报错。
3. **provider**：`--provider` 优先，其次事件 JSON 的 `provider`，再次环境变量探测。
4. **session_id**：`--session` 优先，其次事件 JSON 的 `session_id` / `sessionId` / `thread-id`，再次环境变量。
5. **event**：`--event` 优先，其次事件 JSON 的 `hook_event_name` / `type`，默认 `turn-end`。
6. **HEAD**：解析当前提交，必须是 40 或 64 位十六进制。
7. **身份缺失**：provider 或 session 无法确定时默认失败；只有显式 `--allow-unattributed` 才写入未归属锚点。

锚点文件写到 `.dairn/governance/evidence/session/<task>-<UTC 时间戳>-<6 位十六进制>.json`，同时在任务账本的 `session_anchors` 登记 `path`、`sha256`、`provider`、`session_id`、`head`、`event`、`created_at`。同一路径不可重复登记，每个任务最多 200 条锚点。

### 锚点 JSON

```json
{
  "schema": 1,
  "task_id": "task-42",
  "provider": "dsh",
  "session_id": "dsh-0001",
  "event": "turn-end",
  "turn": null,
  "transcript": null,
  "head": "0123456789abcdef0123456789abcdef01234567",
  "attribution": "attributed",
  "created_at": "2026-01-01T00:00:00Z"
}
```

- `attribution` 取 `attributed` 或 `unattributed`；未归属锚点的 provider 记为 `unattributed`、session_id 记为 `none`。
- `turn`、`transcript` 允许为 `null`，其余字段必须存在且非空。
- `head` 必须与写锚点时的当前提交一致；之后 HEAD 变化不会修改旧锚点，旧锚点只作为历史过程证据。

### provider 探测与环境变量

| 变量 | 用途 |
| --- | --- |
| `DAIRN_SESSION_PROVIDER` | 显式 provider，优先于自动探测 |
| `DAIRN_SESSION_ID` | 通用会话 ID，优先于各 harness 变量 |
| `DSH_SESSION_ID` | DSH 会话 ID；存在时探测为 `dsh` |
| `CLAUDE_SESSION_ID` / `CLAUDE_CODE_SESSION_ID` | Claude Code 会话 ID；存在时探测为 `claude` |
| `CODEX_SESSION_ID` | Codex 会话 ID；存在时探测为 `codex` |
| `DSH_HOOK_EVENT` | DSH 接线脚本覆盖事件名 |
| `DAIRN_TRUSTED_BASE_REF` | pre-push 未给 `--base` 时使用的可信基线 |

## 三种 harness 接线

| Harness | 接线方式 |
| --- | --- |
| Claude Code | `.claude/settings.json` 的 Stop hook 执行 `turn-end.sh`，事件 JSON 从 stdin 传入 |
| Codex | `config.toml` 的 `notify` 执行 `turn-end-codex.sh`，事件 JSON 作为最后一个 argv |
| DSH | 插件 hook 点执行 `turn-end-dsh.sh`，由宿主注入 `DSH_SESSION_ID`，事件名可用 `DSH_HOOK_EVENT` 覆盖 |

接线脚本只负责把事件转成命令行参数；判定逻辑留在 CLI。任一 harness 无法提供会话身份时同样是失败，而不是静默忽略。

## 信任边界

- 锚点证明“某会话在某 HEAD 上结束”，不证明动作合理、测试通过或经过审批。
- `dairn work verify --require-session-anchor` 只检查该任务是否登记过锚点，不证明锚点内容可信。
- 受保护 CI 的 Ed25519 声明由独立签名任务针对机器证据生成，见 `../ci/protected-attestation.md`；本地 Hook 证据不可替代它。

## 失败策略

- **fail-closed**：基线不可解析、结构治理失败、检查失败、证据过期、活跃任务冲突、会话身份缺失，全部非零退出并阻断后续动作。
- 不得为了推送成功而跳过检查、伪造锚点或改写账本；失败记录保留原样，修复后重新执行。
- Hook 未安装或被绕过时，结论只能是“没有本地证据”，不得写成“已通过”。
