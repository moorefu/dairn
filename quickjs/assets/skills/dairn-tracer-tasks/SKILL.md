---
name: dairn-tracer-tasks
description: Explicit optional multi-session and multi-agent task planning; partition large specs into verifiable vertical slices with blocking edges and merge-safe handoffs.
dairn-stage: stable
disable-model-invocation: true
---

# Tracer Bullet Tasks

只在多人、多 Agent、跨会话的大型任务使用，读取 `dairn.engineering.tasks`。

每个任务垂直交付可独立验证的行为，包括验收条件、约束和依赖；阻塞关系优先使用 GitHub/GitLab 原生 Issue，缺少外部系统时使用 `.dairn/governance/tasks/*.json`。

用 `make tasks-check` 阻断循环/丢失依赖，`make tasks-ready` 枚举可执行前沿。并行仅供独立路径；共享关键文件或协议/迁移顺序冲突需要串行。交接材料用路径和提交引用，不复制全部上下文。
