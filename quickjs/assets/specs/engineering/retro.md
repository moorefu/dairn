---
id: dairn.engineering.retro
title: Retro v1 多项改进、回放与效果复评
summary: 人工发起的 dairn.retro.v1，七类改进、无建议状态、本地引用完整性、回放与可比效果；记录不授予门禁或升级权限。
kind: spec
module: engineering
keywords: ["retro", "复盘", "reflect", "回放", "prune", "效果"]
aliases: ["Reflect 阶段", "会话复盘"]
related: ["dairn.engineering.review", "dairn.engineering.feedback", "dairn.skills.lifecycle", "dairn.engineering.workflow"]
symbols: ["dairn work record", "dairn validate", "dairn observe suggest"]
---

# Retro v1

由人显式发起；只读 Detector 可以提出 Episode，不能自动批准或改写治理环境。普通任务不要求 Reflect。协议只使用 `schema: dairn.retro.v1`；旧 `schema: 1` 草案显式拒绝，迁移时补齐真实来源，不把旧布尔值当作新证明。

顶层包含 `retro_id`、可选 `task_id`、`scope`、`status`、`findings`。scope 包含 repository、完整 base_commit/head_commit、UTC window.start/end 以及 cli/harness/ci coverage。coverage 取 complete、partial、available、unknown、unavailable。未知顶层和 Finding 字段拒绝，扩展放 extensions。

`no-action` 与 `insufficient-evidence` 是合法顶层状态，findings 必须为空；其他状态至少一条 Finding。每条包含唯一 id、独立 status、category、severity、observed、sources、confidence、hypothesis、resolution、verification_plan，后续可有 decision、implementation、verification、follow_up。混合状态顶层用 proposed，同一状态可聚合为该状态。

resolution.kind 与 category 一致，只能是 check、review-standard、navigation、tooling、harness-integration、information-access、prune。resolution.action 描述实际环境动作。verification_plan 包含 method、fixture、success_metric、target 和非空 guardrails。不能把 none 写成 Finding。

sources 引用 observation-event、check-run、scm-reference 或 document。本地路径拒绝越界和链接，文件与事件必须存在；可带 sha256。SCM HTTPS 引用为尚未认证的线索，不能据此宣称平台已批准。

状态为 proposed、accepted、deferred、rejected、implemented、verified、monitoring、effective、ineffective、retained、revised、retired。accepted 之后要有 decision 的 accepted 状态、actor 和 reference；实施后要有 implementation.commit 与 reference。ineffective/revised/retired 必须提供同状态的 follow_up.status 和非空 follow_up.reason，保留来源、决定和实施引用；实施验证失败可从 implemented 进入 revised，再进入 retired，无需伪造绿色验证。这些都是本地自述，不能授权 Runtime/Policy 写入或 SCM Gate。

verified/monitoring/effective/retained 等成功结论不能用 verification.passed 布尔值自证，必须有可核对的成功验证。check 类型须有 red/green 运行引用，引用含 path、sha256、module、check_id，解析 dairn.check-run.v1、精确检查退出码、argv 及日志摘要。其他类型提供 replay.path/sha256，内容为 dairn.retro-replay.v1、status passed、非空且至多 1000 条 trials；每次试验包含非空字符串 argv、零 exit_code、项目内相对 output_path 与 output_sha256，并核对真实输出文件摘要。预期失败的场景由回放驱动程序验证后零退出，不能直接把非零命令记录为成功回放。文件完整性仍不证明受信 CI 来源。

effective/retained 还要求 follow_up 引用真实 baseline/experiment 的路径与 SHA256，内容为 dairn.retro-cohort.v1。每组至少 10 个可验证样本，输入夹具、仓库、策略、Runtime、工具链、完整必需保障及其执行配置相同，按 criteria 的数值阈值重算改善，同时记录 limitations 和 side_effects。样本需含计划摘要、declared-complete 输入覆盖及一致的运行前后快照；改善前后的提交和快照可变化，Subject 绑定不计入执行契约的等价比较。每个必需项都须唯一匹配结果和包含 argv/cwd/timeout/implementation_digest 的执行配置，实际 argv/cwd 必须一致。duration_ms 只接受全部必需保障成功且 Run passed 的样本，不能把失败提前退出当作耗时收益；failure_rate 允许目标检查的确定非零失败，其余必需保障仍须成功。字段不全或契约漂移返回 insufficient-evidence。比较只给出可比样本的描述性差异，不证明因果关系；普通 CI 变绿不能代替效果观察。prune 只能提出撤销建议，不能自动删除 Required Check。

用 `dairn work record <id> <path> --kind retro` 在 Reflect 阶段记录。Work 只校验结构与引用，不证明收益或人类身份，也不增加 Gate 特权。
