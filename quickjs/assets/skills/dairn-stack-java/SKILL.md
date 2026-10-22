---
name: dairn-stack-java
description: Java 通用项目治理适配 Skill。涉及 Java 类库、模块、并发、构建、JVM 内存与 API 契约时激活，可与 Spring Boot Profile 叠加。
dairn-stage: stable
---

# Java Development Profile

## 必查项

- Java 版本/JDK/编译参数与锁定依赖版本相符；在 CI 执行可复现构建。
- API 契约：空值、异常类型、泛型约束、序列化格式、二进制兼容（对发布的 library）。
- 并发与资源：线程池边界、阻塞/死锁、关闭生命周期、interrupt 与取消传播、连接/文件句柄释放。
- 安全：反序列化、路径遍历、注入、凭据泄漏与依赖漏洞；对影响面选择扫描工具。
- 测试：JUnit 5/JUnit 4 按既有标准，Mockito/集成测试按项目实际环境；Maven Surefire/Failsafe 或 Gradle Test 与构建命令必须确认。
- 涉及持久化或跨服务 API 时与消费者共同做契约和回归测试，不能只测试本类。

## 常见机械门禁候选

Maven Wrapper `./mvnw -B -ntp test`、`./mvnw -B -ntp verify`；Gradle Wrapper `./gradlew test`、`./gradlew build`；Checkstyle/SpotBugs/JaCoCo 如已有配置，可作为 lint/quality。**不要将 Maven 与 Gradle 命令不加区分地混用**。

跨模块接口/数据模型修改及高影响并发状态机默认 L2，明确版本升级与回滚影响。

## Dairn 当前发行版最佳实践检查表

在修改代码、编写测试和 PR review 时阅读项目自有的 `docs/best-practices/java.md`（若存在）；引用其中的规则 ID，区分可机械验证项与必须人工评审的语义检查。没有执行相应测试不得宣称满足规则。
