---
name: dairn-stack-vue
description: Vue 3/Vite 前端项目治理适配 Skill。涉及组件、路由、Pinia、TypeScript、无障碍、前端状态、安全与构建发布时激活。
dairn-stage: stable
---

# Vue / Frontend Profile

## 检查重点

- 明确 Vue 版本、TS strict 设置、组件 API 与 props/emits、响应式边界、watch/computed 副作用和卸载清理。
- 异步请求：竞态、取消、重复提交、错误可见性、乐观更新回滚、缓存失效；权限/角色显示只是 UX，不是后端授权。
- 前端安全：XSS / `v-html` 来源、token 暴露、动态 URL/重定向、依赖可信度、客户端配置含敏感信息。
- 用户体验：加载/空状态/失败状态、键盘可访问性、焦点管理、ARIA、i18n、响应式布局和浏览器兼容。
- 质量门禁：ESLint、vue-tsc、Vitest、`vite build`；用户关键路径做 Playwright/Cypress e2e（在 CI 配好浏览器）。
- API 联动：前后端通过契约或生成 client 验证字段/错误/兼容；不把 mock 测试当真服务集成测试。

公共路由/安全敏感页面/高影响状态同步/数据可见性改变默认至少做专项评审；涉及安全或跨系统承诺可升 L2。

## Dairn 当前发行版最佳实践检查表

在修改代码、编写测试和 PR review 时阅读项目自有的 `docs/best-practices/vue.md`（若存在）；引用其中的规则 ID，区分可机械验证项与必须人工评审的语义检查。没有执行相应测试不得宣称满足规则。
