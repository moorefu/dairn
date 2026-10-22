---
name: dairn-stack-spring-boot
description: Spring Boot 项目开发治理适配 Skill。涉及 Controller、Security、JPA/事务、配置、Actuator、迁移或发布时激活，并同时应用 Java Profile。
dairn-stage: stable
---

# Spring Boot Profile (on top of Java)

必须同时加载 `dairn-stack-java`。Spring Boot 是被治理的应用技术对象，不是治理平台。

## 检查重点

- HTTP 契约：请求校验、序列化、错误返回、全局异常处理、开放 API / OpenAPI、向后兼容。
- 安全链：Spring Security filter chain 匹配顺序、鉴权/授权默认拒绝、CSRF/CORS 适用场景、敏感 Actuator 暴露与认证绕过。
- 数据一致性：`@Transactional` 事务边界、自调用代理陷阱、重试幂等、JPA N+1、懒加载、连接池/超时。
- 配置与密钥：profiles、属性默认值、环境覆盖、启动即校验配置、脱敏日志。
- 生命周期：线程/调度任务关闭，容器 graceful shutdown，readiness/liveness 语义区分。
- 数据库迁移：Flyway/Liquibase 的前向兼容、读写共存和不可逆迁移，属于 L2。
- 验证：Spring Boot Test 切片/集成，必要时 Testcontainers（需 CI 容器支持），MockMvc/WebTestClient，真实 DB/队列/HTTP 依赖的 contract tests。

在 CI 中按现有 Maven/Gradle 工程设置命令，禁止因为测试环境不可用就将集成测试“视为通过”。

## Dairn 当前发行版最佳实践检查表

在修改代码、编写测试和 PR review 时阅读项目自有的 `docs/best-practices/spring-boot.md`（若存在）；引用其中的规则 ID，区分可机械验证项与必须人工评审的语义检查。没有执行相应测试不得宣称满足规则。
