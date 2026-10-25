# 命令执行摩擦审计与修复

唯一任务记录：command-friction。风险 L2，涉及 POSIX 启动器安全校验和本地证据生命周期；本次不发布、不创建 PR。摩擦修复验收后，维护者又明确授权更新项目 Pin，使用同轮已验收制品执行显式提升事务，而非手改二进制或摘要。扫描对象是仓库实际存在的 validation 目录，本仓库没有 validate 目录。完整逐文件索引保留在 validation/friction-log-inventory.json，日志行号为原始证据，不改写历史日志。

## 已确认问题与验收行为

| 来源 | 原因 | 修复及验收 |
| --- | --- | --- |
| rt01-lint.log、linux-dedup-tools.log 中默认缓存 mkdir 被拒绝 | 启动器将默认缓存的普通权限失败当成终止条件 | 显式 DAIRN_CACHE_HOME 严格遵守；默认 XDG/HOME 不可用时尝试已识别项目的 .dairn/cache/ape-exec。全部不可用退出 2 并输出 DAIRN_RUNTIME_CACHE_UNAVAILABLE |
| 会话中 integrated-v1、linux-verify-dedup 任务缺少 implement | 标题中的架构、文档、PR 关键词先于实现意图路由 | 明确实现意图采用包含 implement 的流程；仅评审和仅设计仍保留短流程；start --kind 可显式指定，revise --kind 可纠正已有误分类 |
| 会话中 orient/specify 证据摘要变化后无法继续 | 摘要失效是正确防护，但没有重新修订入口 | revise --stage 归档旧账本并重开最早受影响阶段及全部后续阶段，清空当前证据和机器关联，重新执行；归档篡改仍拒绝验证 |
| docs find 多主题搜索无命中且退出 1 | 多参数是 AND，单个引号参数按短语匹配，原输出没有解释 | 保持匹配和退出码契约，补充减少条件或逐个主题检索的诊断提示 |
| 扩大回归发现 Review HEAD 不匹配、git show JSON 解析失败 | macOS Git 成功退出时也可能输出 Xcode 环境警告；POSIX 宿主混合 stderr 和 stdout | 成功 Git 调用只返回 stdout；非零退出仍合并 stderr，普通执行器保持原合并输出契约 |
| 会话中任务完成后调用 hook turn-end 报 No active Dairn task | Work 锚点需要活跃任务，调用顺序错误 | 保留失败约束，在技能中明确先锚定再 finish；无 Work 的过程观测使用独立桥，不伪造任务 |

缓存安全规则不因回退放宽：目录所有权和权限异常、符号链接、非普通镜像或摘要不一致均立即拒绝。Windows 的 dairn.cmd 保持原生 APE 直接执行，文件字节不变。

## 不应通过放宽防护解决的历史错误

- v1-integration.log 的输入快照不完整、不同 Pin 载荷 apply 拒绝：输入声明及只读计划行为已在上一轮修复，最终一体化门禁已重跑通过。本轮保留真实输入变更与升级边界的拒绝行为。
- v1-unit-next/safe/coverage.log 的 Gate 或伪造验签结果失败：属于协议加固后的旧断言与回归修复历史，不恢复普通 JSON 的平台授权能力。
- source-checks/integration/2 的 invalid-command 和 uncovered ignored inputs：是刻意验证的负向场景，不能把其非零日志当成产品故障抹去。
- ci-fix-red.log 和历史 Linux 快速缓存测试失败：旧测试假设已修复；当前需保留缓存复用和原始载荷字节、权限不变的行为。
- rc8-codex-review.log 的应用服务权限限制、Podman overlay 存储 I/O 错误、GitHub 403 和登录限制：属于外部执行环境，不能通过改 Dairn 权限或伪造审查结果绕过。
- shell 通配符无匹配、查找不存在源码文件、工具脚本转义错误属于本会话工具调用问题；不修改程序接口来迁就错误路径。

## 验证缝隙

- quickjs/tests/test_root_launcher.py：默认权限回退、显式配置不回退、XDG 优先级、无项目/全部不可用、符号链接与摘要篡改拒绝，以及并发、信号和原载荷不变。
- quickjs/tests/test_work_intelligence.py：旧摘要拒绝、显式修订、原账本归档、下游失效、误分类纠正、历史归档篡改拒绝。
- quickjs/tests/test_integrated_native.mjs：实现意图、纯设计/评审、显式任务类型。
- quickjs/tests/test_docs_retrieval.py：无命中提示不改变 AND、排序及退出码语义。
- quickjs/tests/test_host_native.mjs：成功 Git 的 stderr 警告不污染机器数据；失败诊断仍保留。本机缺少 Go 工具链，真实 Go 基线必须明确跳过，不能冒充通过。

红信号：validation/friction-cache-red.log 的 4 项失败，以及 validation/friction-work-red.log 的 2 项失败。最终绿信号另存 friction-final-check、friction-focused-final 和分发验收日志；未运行平台验证不得宣称通过。
