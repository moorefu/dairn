---
id: dairn.engineering.tasks
title: 任务切片与依赖图治理
summary: 把跨会话、多 Agent 的工程拆成可单独验证的垂直切片；规定任务 JSON 字段、写域与测试缝隙、阻塞 DAG、ready frontier 与 expand-migrate-contract 策略。
kind: spec
module: engineering
keywords: ["tracer bullet", "任务图", "多 Agent", "依赖", "slice", "write scopes", "test seams", "任务拆分"]
aliases: ["Tracer Bullet", "任务依赖图", "Ticket 切片"]
related: ["dairn.engineering.workflow", "dairn.engineering.grill", "dairn.engineering.feedback", "dairn.governance.modes"]
symbols: ["dairn tasks check", "dairn tasks ready"]
---

# 任务切片与依赖图治理

只在项目跨多次会话、多 Agent 或多工作项时建立任务记录。日常 G0/G1 修改不强制建票：切片成本高于收益时不切片，但也不假装已经计划过。

## 适用范围与存放

- 优先复用 GitHub/GitLab 原生 Issue 的阻塞关系；没有外部工单系统时使用 `.dairn/governance/tasks/*.json`。
- 每个任务一个文件，文件名必须等于任务 ID：`<TASK-id>.json`；全部任务合并起来是一张 DAG。
- 一个项目只保留一套现行任务记录；外部 Issue 与本地文件不要同时维护两份互相冲突的 DAG。
- 任务记录只描述**要做与依赖什么**，不写实现细节；文件路径与代码片段易过期，由实现者在执行时重新定位。

## 切片规则

每个任务是一条**垂直切片的 tracer bullet**：

- 贯通需求、接口、数据层与测试，窄但完整；禁止按层横向切分（先做完全部 schema 再做全部界面）。
- 完成后可独立演示或验证；验收条件（`acceptance`）描述用户可观察行为，不写“重构了某模块”。
- 验收条件超过 400 字符会被提示收紧或拆票；规模以单个全新上下文窗口可完成为准。
- 切片前允许先做使实现变简单的 prefactor，并把它作为独立任务放在最前。
- 每个任务声明测试缝隙（`test_seams`）：在公共接口层验证，缝隙越少越好；缺失会产生告警。
- 每个任务声明写域（`write_scopes`）：预计修改的目录或模块。写域是 posix 相对路径，允许以 `/` 结尾表示目录前缀；禁止绝对路径、`..`、反斜杠、空段与重复项。缺失会产生告警。
- 写域超过 6 条且没有声明 `strategy` 时提示拆小切片；并行写域重叠会产生告警。

### 宽重构例外

一次机械改动（重命名列、改共享类型）的爆炸半径覆盖全仓库时，垂直切片无法保持 green。此时声明 `strategy: "expand-migrate-contract"` 并按 **expand → migrate → contract** 排序：

1. expand：新增形态与旧形态并存，不做破坏性替换；
2. migrate：按爆炸半径分批迁移调用点，每批一个任务，阻塞于 expand；
3. contract：删除旧形态，阻塞于所有迁移批次。

迁移批次之间无法独立保持 green 时，允许共用一个集成分支，但必须有一个阻塞全部批次的任务做集成验证；green 只承诺在该任务上。

## 任务 JSON

```json
{
  "id": "TASK-07",
  "title": "订单页显示重试状态",
  "status": "ready",
  "acceptance": "用户在订单页能看到重试次数与最终失败原因，失败后可手动重试",
  "blocked_by": ["TASK-03", "TASK-05"],
  "write_scopes": ["src/orders/ui/", "src/orders/api/"],
  "test_seams": ["OrderStatusQuery", "orders.ui.OrdersPage"],
  "kind": "change"
}
```

- `id` 形如 `TASK-<字母数字下划线短横>`，全项目唯一，且必须与文件名一致。
- `status` 只允许 `ready`、`in-progress`、`done`、`blocked`。
- `title` 与 `acceptance` 必填；`acceptance` 写成可观察结果，不写实现步骤。
- `blocked_by` 是前置任务 id 数组，不允许自引用、重复或未知 id，也不允许成环。
- `write_scopes`、`test_seams`、`kind`、`strategy`、`owner` 可选；`kind` 取 `change`、`bugfix`、`refactor`、`docs`，`strategy` 目前只接受 `expand-migrate-contract`。
- 任务记录不写具体文件行号与代码片段；需要原型片段时引用原型产物路径。

宽重构任务额外带 `"strategy": "expand-migrate-contract"`。

## 校验、前沿与记录

- `dairn tasks check`：校验字段、id 唯一性、文件名一致性、未知依赖、自依赖、环与写域重叠，输出 errors 与 warnings；`dairn tasks check --strict` 把告警提升为失败。
- `dairn tasks ready`：列出 `status: ready` 且所有前驱 `done` 的任务，即 ready frontier，同时给出被阻塞任务及等待对象。缺口在结构，不在排序。
- `dairn validate` 也会执行任务结构、DAG 与文件名校验，供日常门禁复用。
- slice 阶段用 `dairn work record <task-id> <task.json> --kind tasks` 记录**单个任务对象**；整张 DAG 的校验仍用 `dairn tasks check`。
- 写域重叠、共享迁移顺序或共享可变配置时，frontier 任务仍需串行；DAG 已串行的任务不产生并行冲突告警，多 Agent 并行也不因此获得合并批准。

## 与其他阶段的关系

- 切片消费 Grill 的已决议问题与 Specify 的测试缝隙；出现新决策时回到 Grill 追加问题，而不是在票里默认选择。
- 实现阶段的机器证据绑定到任务与当前 HEAD；任务 `done` 不替代 Review、Synchronize 或受保护 CI。
- 任务记录是过程证据，不是审批记录；完成账本不等于合并批准。
