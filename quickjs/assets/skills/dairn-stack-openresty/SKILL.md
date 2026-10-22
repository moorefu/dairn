---
name: dairn-stack-openresty
description: OpenResty/Lua 项目开发适配 Skill。涉及 ngx API、cosocket、worker 生命周期、shared dict、HTTP/SSE/隧道时加载；定义专属风险和测试建议，不在运行时执行治理。
dairn-stage: stable
---

# OpenResty / Lua Development Profile

OpenResty 只是项目的**Lua/Nginx 运行环境**；治理在仓库、测试与 CI 中发生。

## 必查项

- 明确 Nginx 请求处理 phase；检查 `init_by_lua` / `init_worker_by_lua` / `access_by_lua` / `content_by_lua` / `log_by_lua` 等阶段中 API 的合法性。
- 请求路径禁止阻塞 I/O；cosocket 需清晰的 connect/send/read 超时、错误归属、keepalive/关闭清理。注意各阶段 cosocket 可用性不同。
- 共享状态：`ngx.shared.DICT` 的内存淘汰、容量上限、并发操作原子性与 `nil`/`no memory` 处理；worker 内状态不等于多 worker 一致状态。
- 长连接、SSE、TCP/隧道：背压、关闭检测、半开连接、超时/重连语义、fd/resource 泄漏、异常 worker 退出后的恢复限制。
- Nginx 配置：`openresty -t` 或对应 `nginx -t` 在真实部署配置下校验；热点路径用性能基准验证变化。
- 安全：请求走私、header 注入、鉴权前转发、来源校验、敏感日志泄漏和 TLS 边界。

## 可选验证技术（按项目现有工具替换）

Lua 静态检查 luacheck、单测 busted、OpenResty Test::Nginx 集成测试（通常 `prove`）、在 CI 启动真实 OpenResty 的端到端测试、wrk/hey 与 profile 性能回归。**有测试框架不代表所有项目都已安装它**。配置前逐一确认工具命令、测试目录和目标版本。

## 高风险升级

涉及认证、网络协议兼容、worker 共享状态、连接调度或线上限流/熔断逻辑时，默认 L2 且需独立评审。相关测试覆盖并发、资源清理和错误分支，不仅覆盖 happy path。

## Dairn v1.2 最佳实践检查表

在修改代码、编写测试和 PR review 时阅读 [`docs/best-practices/openresty.md`](../../../docs/best-practices/openresty.md)；引用其中的规则 ID，区分可机械验证项与必须人工评审的语义检查。没有执行相应测试不得宣称满足规则。
