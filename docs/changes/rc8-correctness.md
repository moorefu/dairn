# RC.8 正确性修补与运行时副本启动

本轮以 `689e43c107b278bb254d5b46802d36cf5fc1525e` 为基线，落实 2026-10-25 发布后综合审查报告的批次 A，并加入用户要求的 POSIX 运行时副本启动。风险为 L2，治理深度为 G2；独立人工审批由 PR 平台完成。本文件记录变更范围与验收条件，不构成审批或 CI 证明。

## 范围与验收

| 项目 | 可观察行为 | 验证入口 |
| --- | --- | --- |
| T-01 必需测试覆盖 | 本地与 Linux/Windows CI 调用同一源码门禁；记录必需和已执行 Check-ID；缺任意项不得聚合成功 | `tools/tests/test_check_catalog.py`、`tools/check-source.py`、两个平台验收脚本 |
| T-05 JUnit | XML 结构、suite/testcase 数量或失败计数矛盾时拒绝报告；Fitness 显示 UNKNOWN | `quickjs/tests/test_report_adapters_native.mjs`、`quickjs/tests/test_analyze_quality.py` |
| T-06 JSON 超限 | findings、metrics、surface changes 越限报错，不截断 | 同上原生适配器测试 |
| T-09 Import Analyzer | Doctor 的 argv/cwd 为 null；混合 Suite 按模式导入或执行，导入失败记录 report-error 后继续其他项 | `quickjs/tests/test_analyze_quality.py` |
| T-11 SHA256 | QuickJS、Node 实现与 Python hashlib、Node crypto 独立结果相同 | `tools/tests/test_sha256.py` |
| T-12 文档状态 | 版本由标签确定；历史平台状态不写成当前事实 | 治理与架构文档审阅 |
| 运行时副本 | 每次 POSIX 调用执行独立临时副本，保留原文件字节和权限；参数、stdin、cwd、退出码透传，结束后清理；复制失败退出 2 | `quickjs/tests/test_root_launcher.py`、Python 包适配层测试 |

启动器模板位于 `quickjs/assets/templates/project/launcher/`；根脚本由 `node tools/render-launchers.mjs` 生成。`DAIRN_RUNTIME_DIR` 始终指向原载荷目录。Windows 启动器继续使用原生 PE 入口；POSIX APE 的加载与权限问题通过副本隔离。POSIX 的 SIGINT 取消向后台进程发送 TERM，启动器返回 130，避免后台进程继承忽略 INT 后持续等待。SIGKILL、断电等不可捕获终止可能留下系统临时副本，由系统临时目录回收。

JUnit 继续只支持受限的扁平 testsuites/testsuite 子树和 testcase 结果节点；每个 testsuite 必须显式给出 tests/failures/errors/skipped，且与子节点一致。未知结构和不支持的 XML 构造按报告错误处理。此兼容边界须在使用者文档中说明。

## 边界

不将本地 Check-ID 清单或测试故障注入宣称为 PCC 受信 Gate 已部署。T-02/T-03/T-04 的受信策略、Requirement 闭合、隔离签名与发布器继续按后续批次推进；T-07/T-08/T-10/T-13 不在本轮修补范围。发行版本由维护者决定标签，不手动刷新 `package.json`。

现有 `.dairn/runtime/dairn-embedded.com` 工作区差异经逐字节比较确认内容未变化，仅由 0644 变为 0755。验证日志和运行记录保存在忽略目录 `validation/` 与 `.dairn/`；未执行的平台验收须在 PR 中明确标注。
