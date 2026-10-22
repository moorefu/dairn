---
id: dairn.governance.distribution
title: Dairn 安装、接入、锁定与升级契约
summary: 独立 Dairn CLI 如何安装、发现模块、非破坏性接入业务项目、执行真实门禁和安全升级。
kind: spec
module: governance
keywords: ["Dairn CLI", "项目初始化", "非破坏接入", "版本锁", "安全升级", "developer experience"]
aliases: ["Dairn 开箱即用", "Dairn 安装", "dairn upgrade", "dairn adopt"]
related: ["dairn.governance.core", "dairn.governance.modes", "dairn.ci.gates", "dairn.docs.discovery"]
symbols: ["dairn init", "dairn adopt", "dairn detect", "dairn doctor", "dairn check", "dairn upgrade --plan"]
---

# Dairn v1.0.0 发行及项目接入契约

## 发行边界

Dairn Core 由独立、可版本固定的 Python `dairn` 分发，提供 `dairn` 命令。核心检查器、Skill 模板及主题规范归属发行包；业务工程只保存项目专属规则、少量 Agent Skills、Notes 空目录和 `.dairn/lock.json`。不要再复制参考仓库测试与完整文档到业务仓库。

CLI 的默认安装方式为从可信本地 Wheel、组织包仓库或批准的不可变源进行 `pip install`。v1.0.0 项目生成的 CI 工作流需要用户提供批准的 `DAIRN_INSTALL_SPEC`：它不把尚未发布的公共 PyPI 名称当成可用的远程依赖。发布到企业仓库之前必须明确许可、签名与供应链审查要求。

## 初次接入

`dairn detect` 从明确的构建清单定位 Go、Rust、Python、Vue、Java、Spring Boot 和 OpenResty 模块，可识别多个模块；标记不足时使用 `--stack`，不能通过虚构工具或测试脚本满足门禁。`dairn init` 专门面向新建的空目录，`dairn adopt` 专门面向已有工程。二者首先生成文件计划；发现托管路径冲突不得产生部分写入。

不要覆盖已有的 README、Makefile、AGENTS.md 或现有 CI 文件。`AGENTS.md` 中只追加一段起止标记明确的导航块；现有业务 Makefile 原样保留，新入口为 `dairn` CLI 或 `make -f .dairn/Makefile`。

## 版本锁与升级

`.dairn/lock.json` 保存 CLI 版本、核心运行时哈希、生成配置和 Dairn 管理文件的哈希。`dairn check` / `dairn validate` / `dairn scope` 在锁与运行时不一致时拒绝运行；必须先运行 `dairn upgrade --plan [--diff]`。升级计划报告 create/update/unchanged/conflict，`--apply` 在任何冲突存在时整体拒绝写入。受管理文件只在内容仍与锁记录一致时更新；AGENTS.md 使用单独的管理块哈希，保留块外的全部自定义规则。

业务自维护的 `.dairn/governance/project.json`、真实 Notes、发布与故障记录不被自动升级覆盖。受管文件退出发行包时默认保留，不会自动删除用户文件；这些文件需要显式迁移。该实现是严格冲突阻断，不宣称可自动解决任意三方合并。

## 验证与可信边界

不指定 Git 基线的 `dairn check` 运行静态治理检查及全部 L2 四项业务检查，并把证据标为 *baseline*，不能冒充 PR/MR 的风险门禁。指定 `--base` 时由固定版本治理执行器校验 Git 变更路径、风险下限、所需检查及证据，并实际运行各模块工具。新建仓库至少需完成第一次 Git 提交，PR/MR 前再对真实 base 执行 `dairn check --base <sha>`。

CI 对 PR 提供的命令按不可信代码执行，必须使用无生产密钥的隔离 Runner；分支保护、代码所有者审查、密钥策略、生产审批与外部工具链安装不由 Dairn 自动替代。`.dairn/` 内锁文件和管理入口属于 L2/G2 治理变更，规则不能被同一 PR 自行降低。项目配置修改必须经过可信 CI 权限边界保护。

## 实际演练要求

维护者发布新的 CLI 版本时，应在独立的 Wheel 安装环境中验证：空仓库 init、已有项目 adopt 保留文件、七栈识别、真实工具链检查、L2 Git 差异检查、升级冲突不落盘、未改变的升级幂等、版本锁失配阻断以及运行时构建的 SHA256 可复现性。真实 GitHub/GitLab Runner 需另外验收，不得把本地演练等同远程分支保护有效。
