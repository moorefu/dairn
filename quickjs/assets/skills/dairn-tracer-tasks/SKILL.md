---
name: dairn-tracer-tasks
description: Explicit optional multi-session and multi-agent task planning; partition large specs into verifiable vertical slices with blocking edges, test seams and write scopes, then validate the graph.
dairn-stage: stable
disable-model-invocation: true
---

# Tracer Bullet Tasks

只在多人、多 Agent、跨会话的大型任务使用，规则用 `dairn docs show dairn.engineering.tasks` 加载。日常 G0/G1 修改不强制建票。

## 切什么

每个任务是一条**垂直切片的 tracer bullet**：贯通需求、接口、数据层与测试，窄但完整，完成后可独立验证。不要把一层做完再做下一层。

- 验收条件描述用户可观察行为，不写“重构了某模块”。
- 单票规模以一个新上下文窗口可完成为准；超出继续切。
- 先做使实现变简单的 prefactor，并作为独立票放在最前。
- 每票声明 `test_seams`（在公共接口层验证，缝隙越少越好）与 `write_scopes`（预计修改的目录或模块）。
- 不写具体文件行号与代码片段；实现者执行时重新定位。

## 阻塞与并行

- 每票声明 `blocked_by`：没有阻塞的票可以立即开始。
- 只有 `status: ready` 且前驱全部 `done` 的票进入 ready frontier；并行从 frontier 里挑，不从阻塞节点硬起。
- `write_scopes` 是 posix 相对路径，可用 `/` 结尾表示目录前缀；重叠、共享迁移顺序或共享可变配置时串行；DAG 已串行的任务不产生并行冲突告警，多 Agent 并行也不获得合并批准。
- 宽重构声明 `"strategy": "expand-migrate-contract"`，按 expand → migrate → contract 排序，最后一张集成验证票阻塞全部批次，green 只承诺在那里。

## 校验与记录

- `dairn tasks check` 校验字段、id 唯一性、文件名一致性、未知依赖、自依赖、环与写域重叠，输出 errors 与 warnings；`--strict` 把告警提升为失败。
- `dairn tasks ready` 列出可执行前沿与等待中的任务。
- 每个任务一个文件，文件名必须等于任务 ID：`.dairn/governance/tasks/<TASK-id>.json`；`kind` 取 `change`、`bugfix`、`refactor`、`docs`。
- slice 阶段用 `dairn work record <task-id> <task.json> --kind tasks` 记录单个任务对象；整张 DAG 仍由 `dairn tasks check` 校验。优先复用外部 Issue 的原生阻塞关系。
- 校验只证明结构自洽，不证明切片合理或验收充分。

交接材料用路径与提交引用，不复制全部上下文。任务记录、切片结果与 `done` 状态都不是审批，也不替代 Review、Synchronize 或受保护 CI。
