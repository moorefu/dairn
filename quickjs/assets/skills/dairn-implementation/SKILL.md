---
name: dairn-implementation
description: 受治理约束的代码实现与测试技能。编码、修 bug、重构时使用；保持最小改动、真实验证、失败路径与文档同步。
dairn-stage: stable
---

# Implement & Verify

1. 读取 `dairn-governance` 确认风险和模块，再加载命中的技术栈 Skill。
2. 阅读调用方/被调方与现有测试；对缺陷先构造可重复失败的回归用例（可行时），对新功能先确定可观察验收点。
3. 以小步提交实现；同时更新 API、配置、协议或数据库格式的消费者及对应文档。
4. 审查每个异常处理与状态所有者：捕获异常不意味着恢复成功；必须明确副作用提交状态、重试是否幂等、超时边界及清理完成。
5. 执行相关单元/集成/契约测试。环境问题只允许用证据说明，不能静默跳过、降低阈值或手写通过结果。
6. 变更完成后同步 change.json 和有长期价值的 Agent Note；若已交付，Note 使用 implemented 的正文，不保留未执行的计划作为既成事实。
7. 先 `make scope BASE=<base>`，再 `make gate BASE=<base>` 对准当前已提交的 HEAD；局部调试可使用 `make lint/test/integration/build BASE=<base>`，但单项成功不得冒充完整门禁。把命令、退出码、失败、遗漏与报告路径写入 PR。

**防止无关工作**：不改未经批准的项目管理/发布设置，不进行无必要兼容层、推测性重构或横向扩展。


## Defect-originated changes

For changes initiated by a `BUG-*` or `INC-*` record, read `dairn.operations.defect`: capture a focused failing regression where practical, link verification output and follow the original report to deployed/observed behavior. Do not call a production defect closed merely because the unit test passed or a PR merged.

## Engineering feedback discipline

For new behavior use the `dairn-tdd` Skill at an observable test seam when feasible. Run focused checks frequently and `make gate BASE=...` once at the proper review point; do not force a blanket red-green ritual on mechanical changes. Consult `GLOSSARY.md` only if the repo uses one; read relevant L2 Note rationale if it governs a changed interface. Keep tests and implementation in small vertical slices and require a Standards + Spec Fidelity Review before handing off. Avoid manual-only Skills without explicit human invocation.
