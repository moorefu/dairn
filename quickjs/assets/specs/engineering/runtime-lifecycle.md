---
id: dairn.engineering.runtime-lifecycle
title: 固定运行时、临时候选与显式提升事务
summary: 治理 Pin 与测试 Candidate 的隔离，源码构建不写固定载荷，提升计划、内容绑定、事务恢复与回滚的边界。
kind: spec
module: engineering
keywords: ["runtime", "candidate", "promotion", "rollback", "临时构建", "固定版本"]
aliases: ["Runtime Lifecycle v1"]
related: ["dairn.engineering.launcher", "dairn.engineering.observability"]
symbols: ["dairn runtime inspect", "dairn runtime promote", "dairn runtime rollback", "dairn runtime recover", "dairn upgrade"]
---

# Runtime Lifecycle v1

`.dairn/runtime/` 是持久 Pin；开发构建使用 `.build/runs/` 独占候选，发行制品保存在 dist 或指定输出目录。根 runtime 是旧构建遗留，不参与新构建或测试解析，不自动删除维护者遗留文件。

源码回归用 `python tools/with-built-runtime.py -- python tools/check-source.py unit`；包装器构建并校验候选，只向子进程传入 DAIRN_TEST_RUNTIME、DAIRN_RUNTIME、DAIRN_QJS_BIN，结束清理候选并保存 validation/runtime-builds 的日志、摘要与退出码。也可用 --from-zip 读取唯一发行 ZIP，CI 使用此路径。普通打包不会导出持久候选；低层 --runtime-out 只能指向尚不存在的独占目录，调用方负责清理。

源码目录直接 npm pack 会因 prepack 拒绝，指引 npm run build 在私有暂存区生成包；不能为预打包覆盖项目 Pin。PEP 517、Python 和 npm 暂存区各自拥有，完成后清理；发行制品保留。

普通 upgrade --apply 仅用于当前 Pin 身份的受管资源维护，不复制安装载荷。不同身份返回 RUNTIME_PROMOTION_REQUIRED；只读 upgrade --plan 继续提供漂移诊断。vendor-runtime 不能绕过提升绑定。

从显式选择的已验证安装入口执行 `dairn runtime inspect|promote --source installed --plan --json`。source installed 指当前入口的载荷目录，内容必须匹配完整性清单和运行中的版本；PATH 名称不提供权威。计划包含目标指纹、from/to、内容摘要、受管迁移、输入快照、回滚可用性与授权提示，使用规范化 JSON 计算计划摘要。

`runtime promote --source installed --apply --plan-sha256 <已审阅摘要>` 重新生成计划，拒绝目标、候选或工作区变化。摘要绑定不是人类批准证明。事务通过互斥文件、持久 journal、旧文件备份、受管升级和身份自检完成；异常恢复旧内容，恢复失败保留 recovery-required 和互斥标记。

`runtime rollback --to <旧 Runtime 身份> --plan` 生成回滚计划，--apply 同样需要 --plan-sha256；只允许唯一已提交事务，保留回滚前备份。`runtime recover --transaction <id>` 检查中断事务，--apply 仅恢复旧快照；所有者仍活动或存活状态未知时拒绝恢复。Windows 占用导致恢复失败须保留 journal，不强杀进程或将未知结果伪装成功。

上述事务是本地维护机制，不是 SCM Review、安装包签名或受保护 CI 的证明。实际提升由维护者独立授权；Agent 不把计划 hash 当作批准。
