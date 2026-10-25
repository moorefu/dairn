---
id: dairn.project.rc8-cache-correctness
title: RC.8 正确性与运行时缓存镜像验收规格
summary: 本仓库 RC.8 修补批次的缓存复用、输入透传、报告一致性与 CI 必需测试覆盖验收。
kind: spec
module: engineering
keywords: ["RC.8", "运行时镜像", "缓存复用", "正确性", "测试覆盖"]
aliases: ["RC.8 任务验收"]
related: []
---

# RC.8 正确性与运行时缓存镜像验收规格

本规格依据 2026-10-25 发布后审查报告批次 A，以及用户提出的“避免运行时修改 Git 文件、避免逐次复制和删除”要求。范围与后续批次边界见 [变更计划](../../changes/rc8-correctness.md)，通用启动器契约见 [发行规范](../../../quickjs/assets/specs/engineering/launcher.md)。

## 必需行为

1. POSIX 启动器保持原运行时的字节与权限。以源文件 SHA256 寻址执行镜像；首次准备时校验后原子发布，后续命中不复制、chmod 或删除镜像。
2. 每次执行校验源文件和镜像摘要。缓存目录及镜像由当前用户拥有且权限为 0700；解析物理父路径后拒绝其他用户拥有或非 sticky 的组/其他用户可写祖先目录。异常不得回退执行源文件。
3. 原载荷目录通过 `DAIRN_RUNTIME_DIR` 传递。参数、stdin/stdout/stderr、cwd、退出码和终止信号通过直接 exec 透传；不引入后台监护进程。
4. 并发首次发布不原地覆盖运行中的文件。相同内容可复用同一镜像；新内容使用新摘要，旧镜像由维护者在空闲时清理。
5. 本地与 Linux/Windows CI 共用源码必需测试目录，记录 Check-ID；缺项、重复和失败均拒绝聚合成功。
6. JUnit 结构或计数矛盾、非法字符以及 JSON findings/metrics/changes 越限必须拒绝；Fitness 无可用观测时为 UNKNOWN。
7. Import Analyzer 的 Doctor 不读取不存在的 execution；混合 Suite 按模式分派，报告失败不能中断后续项或提升来源信任。
8. SHA256 实现通过 Python hashlib、Node crypto 与 QuickJS/Node 的独立交叉断言；修正文档中写死的发行版本及过期平台状态。

## 验收证据

- 缓存命中 inode/mtime/ctime 保持、并发发布、权限及摘要篡改、符号链接、可写父路径、真实 APE 与输入/信号回归：`quickjs/tests/test_root_launcher.py`。
- 报告与 Import/Fitness：`quickjs/tests/test_report_adapters_native.mjs`、`quickjs/tests/test_analyze_quality.py`。
- 必需目录缺项故障注入与独立摘要向量：`tools/tests/test_check_catalog.py`、`tools/tests/test_sha256.py`。
- 最终提交执行项目配置的 lint/unit/integration/build 四项门禁，并保存真实 Run 与输入快照覆盖；Linux/Windows 实机和发行包矩阵由该 PR 的平台 CI 验证。

本规格不授予合并或发布批准，不将本地缓存、覆盖记录或独立 AI 审查升级为 PCC 受信证据链。保护策略、Requirement 闭合、Signer/Publisher 部署仍属于后续批次。
