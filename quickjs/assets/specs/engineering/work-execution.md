---
id: dairn.engineering.work-execution
title: 可恢复的 AI 工程任务执行记录
summary: Dairn work 命令记录任务阶段、Skill 路由与证据摘要，但不替代 Agent、真实质量检查和人工批准。
kind: spec
module: engineering
keywords: ["task", "work", "resume", "evidence", "任务", "恢复", "工作流"]
aliases: ["dairn work", "task ledger"]
related: ["dairn.engineering.workflow", "dairn.engineering.review"]
symbols: ["dairn work start", "dairn work verify"]
---

# Work Execution Contract

`dairn work` 是**持久化过程记录器**，不是 Agent 调度器。一个任务有稳定 ID、分类、顺序阶段、当前 Skill 与状态。简单任务按推荐路由跳过不适用阶段；多会话通过 `.dairn/work/<id>.json` 恢复上下文。CLI 不自动执行 AI，不声称人类已审批。文件由项目所有，不参与核心运行时的受管理文件哈希。

## 生命周期

- `start <title> --id <id>`：新建任务，返回第一个阶段；重复 ID 拒绝覆盖。
- `status`、`next`：输出阶段、Skill、已记录的证据和下一步，不改变状态。
- `record <id> <path> --kind <kind>`：仅接收仓库内现有证据文件并记录 SHA256；拒绝符号链接、越界、空文件和超过 1 MiB 的制品；不保证该证据是真实的执行记录。
- `verify`：重新计算证据 SHA256；证据丢失或被修改时失败。
- `advance`：当前阶段至少有一份证据且完整性通过才可进入下一阶段。
- `finish`：只有最后阶段才能完成，结果为 `recorded-complete`，不是生产或审查批准。

`implement` 需要 `test` / `machine-evidence` 类型记录；`review` 需要独立 JSON，分别给出 `standards`、`spec_fidelity`、`spec_ref`。没有权威 Spec 时 Fidelity 只能是 `not-applicable`，不得声称 Spec 通过。所有测试与门禁仍必须独立执行 `dairn validate`、`dairn check`，并在受保护的 CI 与审批中完成合并决策。

## 安全边界

项目任务文件不得自我引用为证据；不执行证据文件，不信任未经验证的用户声明。Dairn work 文件不作为质量门禁的可信授权输入。只有组织受保护的 CI 策略能够确定是否允许合并。
