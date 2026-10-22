---
name: dairn-project-guidance
description: Dairn 项目文档建构与治理一致性 Skill；在新工程初始化、接入既有仓库、重构 README/AGENTS.md/docs、模块与入口变更时使用。基于已验证事实整理说明，不覆盖团队文档、不替代机器门禁。
dairn-stage: stable
---

# Project Guidance / Documentation Stewardship

**目标**：把项目事实转化为 AI 与开发者都能正确使用的工程导航。不要把 README、AGENTS.md 与 docs 重复写成三份规范。

## 何时触发

- `dairn init` 或 `dairn adopt` 后，用户要求整理项目资料与 Agent 指引；
- 技术栈、模块、测试入口、运行方式或关键架构变化导致文档可能过期；
- 团队明确要求生成项目文档、校验链接或梳理 Spec。

## 先盘点，后编辑

1. `dairn guide plan` 读取现有模块、已配置检查命令、存在的项目资料。`commands.verified=false` 仅表示配置，不能报告为已测试。
如已接入但缺少项目文档，可先运行 `dairn guide scaffold` 预览，再 `dairn guide scaffold --apply` 仅创建缺失的 README 和项目指南，不会覆盖已有内容。
2. 查阅实际模块清单、构建文件、源码入口、已有 README、设计文档、Makefile、CI；当信息不足时保留 `TODO: 待确认`，不臆测架构、运行命令或安全能力。
3. 先列出差异计划：文件、预期读者、信息来源、保留/新建/修改、冲突和待确认问题。先提出 Diff；未经授权不覆盖既有团队说明。
4. 每处新增事实尽量关联代码路径、测试命令或现有决策/Spec；只将**实测成功**写为“通过”。

## 职责分层

- `README.md`：一句话定位、模块地图、从零开始的环境与真实运行方法、最关键文档链接。面向人；避免粘贴治理细则。
- `AGENTS.md`：面向 AI 的简短操作顺序、入口、边界与验证方法，引用真实规范。只修改 Dairn 标记块外的团队段落（需团队审核）；**不得手动改动锁定的 Dairn 标记块**。
- `docs/PROJECT_GUIDE.md`：项目边界、架构事实、开发环境、验证、数据与安全信任边界及未知项。项目拥有此文档。
- `docs/specs/*.md`：真实的稳定契约，按主题拆分并拥有唯一 ID（例如 `project.payment.refund`）；**禁止复制** Dairn 内核 `dairn.*` 规则 ID，不得因导航方便制造第二套权威规范。
- `docs/GOVERNANCE_SPEC.md`：Dairn 的受管理导航文件，只引用，不自行重写。
- `.agents/notes/`：架构决策与取舍，遵循 Agent Notes 生命周期；不能让 README 代替决策记录。

## 项目规模适配

- 小型单模块 / G0–G1：默认 README + AGENTS + 一个 PROJECT_GUIDE，防止空目录与样板文档泛滥。
- 多模块 / G2–G3：确有独立契约时才追加 `docs/specs/` 主题文档、架构/运行手册、Glossary 与链接索引；不强制每个项目都有同样目录。

## 校验与完成标准

1. `dairn guide audit` 做非阻断发现；需要严格文档质量时使用 `dairn guide audit --strict`。
2. `dairn validate` 检查治理记录、Notes、SDCL、Skills 等；项目文档审计不代表人工审批。
3. 对每个声称可运行的命令实际测试，并记录失败、限制、工具链版本；检查链接和示例与当前项目一致。
4. 输出差异摘要和尚未验证的事实清单。不得声称 CLI 自动生成了真实架构设计；`init/adopt` 只生成最小脚手架。

**安全边界**：不写入或降低 `.dairn/governance/project.json` 的最低门禁，不回避 `.dairn/lock.json`，不自动覆盖 README、Makefile、CI 或团队 Agent 指令，绝不将 secret 写进示例或生成文档。

## Continuous project facts and documentation drift

Run `dairn guide facts` to inspect deterministic observed state: modules, manifest/dependency names and hashes, build/CI files, entrypoint paths, stable Spec IDs and hashes, configured checks (`verified=false` until run). On an **adopted** repo, review this information with the team and only then run `dairn guide facts --apply` to accept the first baseline.

Before editing project docs, run `dairn guide drift`; map `affected_docs` to files. Read each changed source and the current documentation before proposing text. No snapshot proves semantic correctness. NEVER use `--apply` to erase unresolved drift. Instead review and update affected docs, run relevant checks, then consciously approve the new baseline with `dairn guide facts --apply`. `dairn guide drift --strict` can be a separately protected CI requirement.

Project README and PROJECT_GUIDE are project-owned, not runtime locked; AGENTS managed block stays locked. The drift tool never edits docs. Record observed facts vs unverified claims explicitly; no invention.

## Impact-aware synchronization

After `dairn guide drift`, run `dairn guide impact --base <trusted-base>` where a trusted Git baseline exists. Review inferred source public surfaces/imports, dependency and Spec changes; propose document edits only where verified. `contract-impact` means mandatory human contract review, not proof that an API changed. Record `no-doc-change` decisions with a specific reason; do not auto-accept the facts baseline during CI checks.
