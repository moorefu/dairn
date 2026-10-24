---
id: dairn.engineering.evidence-snapshot
title: 检查输入快照与策略级生成物排除
summary: Check Run 只对可证明的输入闭包负责：未声明的忽略文件会让证据失效，项目可在受信策略中用 snapshot_exclusions 声明生成物与缓存边界。
kind: spec
module: engineering
keywords: ["snapshot", "input coverage", "snapshot_exclusions", "ignored inputs", "evidence", "快照", "输入覆盖率"]
aliases: ["input closure", "快照排除", "生成物排除"]
related: ["dairn.engineering.work-execution", "dairn.governance.risk", "dairn.ci.gates"]
symbols: ["dairn check --all", "dairn evidence inspect --run"]
---

# Evidence Snapshot Input Closure

`dairn check` 在运行技术检查前后捕获 Git 工作树快照，把当前输入闭包的摘要写入 Run 证据。快照回答“这次检查看到了哪些输入”，不证明检查通过、不证明输入语义正确，也不替代合并批准或受保护的 CI 证据链。

## 输入闭包

默认闭包由三部分组成：

1. Git 已跟踪文件的当前字节；
2. 未被忽略的未跟踪文件；
3. 通过内部 `input_globs` 声明的忽略输入（由调用方声明并参与哈希）。

Dairn 自己的运行数据（`.dairn/governance/evidence/`、`.dairn/cache/`、`.dairn/tmp/`、`.dairn/work/` 等）固定排除，不属于项目输入。任务证据路径是调用方视角的排除项，也不进入闭包。

每次捕获记录 `input_coverage`：

| 值 | 含义 | Run 结果影响 |
| --- | --- | --- |
| `declared-complete` | 所有忽略输入都被声明为输入或排除 | 不影响结果 |
| `incomplete` | 存在未声明的忽略输入 | Run 状态记为 `invalidated` |

`incomplete` 时 Run 附带未覆盖输入清单，并输出 `ERROR: snapshot input coverage incomplete` 诊断。覆盖率问题是证据完整性错误：即使技术检查都通过，Run 也不会被标记为 `passed`，不能继续作为 Work 推进、门禁或签名的通过证据。

## 项目策略中的 snapshot_exclusions

生成物、缓存和构建输出通常被 `.gitignore` 忽略，却并非检查输入。项目可在 `.dairn/governance/project.json` 中声明：

```json
{
  "snapshot_exclusions": ["/build/", "/dist/", ".cache/", "__pycache__/", "*.pyc"]
}
```

语义与 `.gitignore` 接近，但有明确边界：

- **只允许排除被 Git 忽略的路径。** 模式匹配到已跟踪文件或未被忽略的未跟踪文件时 fail closed，检查不会开始，错误为 `Snapshot exclusion matches tracked input` 或 `Snapshot exclusion matches untracked input`。
- 目录模式必须以 `/` 结尾（如 `build/`），匹配目录自身的内容；文件模式匹配文件路径。
- 前导 `/` 或含 `/` 的模式锚定仓库根（`/build/` 只匹配仓库根目录下的 `build/`）；不含 `/` 的模式匹配任意层级的同名目录或文件基名（`__pycache__/`、`*.pyc`）。
- 支持 `*`、`?`、`**`；不支持 `!` 取反、盘符路径、`..`、反斜杠或行分隔符；过宽模式（`*`、`**`）被拒绝。
- 重复模式去重；非法模式使 `dairn doctor`、`dairn validate` 与 `dairn check` 失败，而不是被静默忽略。
- 该字段只影响本地检查证据的输入闭包与覆盖率，不改变风险分级、必需检查集合或 gate 判定。

`snapshot_exclusions` 是受信项目策略的一部分，其内容进入 Run 记录的 `policy_sha256`。外部固定 `DAIRN_EXPECTED_POLICY_SHA256` 的 CI 中，修改排除项必须走策略审阅，不能用它隐藏源码、测试或配置改动。

## 证据字段与身份

Run 的 `execution` 记录 `input_coverage` 与快照摘要。快照自身包含：

- `manifest`：闭包内文件的路径、大小与 SHA256；
- `uncovered_inputs`：未覆盖的忽略输入清单；
- `exclusions`：调用方（任务证据）排除项；
- `snapshot_exclusions`：策略声明的生成物边界，作为审计元数据记录。

快照身份只由输入闭包决定：调用方排除项与策略排除项的元数据不影响身份，因此任务推进、证据比较不会因为声明清单本身的表述变化而失效。反过来，声明生效后闭包发生变化时，身份随之变化，旧 Run 的快照不再匹配当前工作树。

生成物既可能被检查读取，也可能只是构建副作用：前者应作为输入声明并哈希（`input_globs`），后者应通过 `snapshot_exclusions` 排除。把真正的输入误排除会让证据少看文件，属于策略错误，Dairn 不做语义猜测。

## 非目标

- 不判断排除项是否“合理”，只校验模式安全性与是否隐藏真实输入。
- 不允许排除 Dairn 固定保护的数据目录，也不接受取反或通配全部。
- 不把覆盖率完整当作检查通过、合并批准或发布验收。

## 相关命令

```sh
dairn check --all
dairn check --base origin/main
dairn evidence inspect --run <run-id>
dairn docs show dairn.engineering.evidence-snapshot
```
