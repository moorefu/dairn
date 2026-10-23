# 受保护 CI 演练与首次发行验收清单

对应架构 §14/§15 的 Done 定义。本清单是执行手册：每一项都必须有**真实平台日志/截图/命令输出**作为证据，不得以本地环境变量模拟替代。未完成的项保持 `unverified`，不得宣称可信治理已发布。

## 前置资源（管理员准备）

- [ ] 测试组织与仓库（GitHub + GitLab 各一），`main` 分支开启保护：required check `dairn-quality`、required reviews、禁止 force-push
- [ ] 三个分离 Runner 组：`dairn-protected-build`（无密钥）、`dairn-protected-sign`（挂 Ed25519 私钥）、`dairn-evidence-publisher`（仅 Evidence ref 写身份）
- [ ] 固定 `/opt/dairn` 发行版（APE + runtime-integrity.json），记录 `DAIRN_EXPECTED_APE_SHA256` / `DAIRN_EXPECTED_RUNTIME_SHA256` / `DAIRN_EXPECTED_POLICY_SHA256` 到仓库变量
- [ ] 创建并保护 `refs/heads/dairn-evidence`：仅发布身份可写、拒绝非快进、禁止删除

## CI 链路正向演练

- [ ] CI-正向-1：向 `main` push 一次正常变更，三条链（build→sign→publish）全绿；`evidence-published` 出现在 workflow 结论中
- [ ] CI-正向-2：从 Evidence 分支 `evidence/runs/<sha>/<run-id>/` 读回 `statement.json`+`statement.sig`，在仓库外用 `dairn attest verify` 独立验签通过
- [ ] CI-正向-3：PR 流程（fork 与普通贡献者各一）：`dairn-quality` required check 阻断未过审合并

## 负向攻防演练（架构 §14）

- [ ] CI-01：Agent 不使用 Dairn 直接 PR 修改 `.dairn/governance/project.json` → required check 失败
- [ ] CI-02：PR 修改 `ci/protected/*.sh` 或 workflow 试图减少检查 → 变更不参与受保护链路（脚本来自 `/opt/dairn`），流水线不受影响并有记录
- [ ] CI-03：PR 构建脚本尝试读取 `DAIRN_SIGNING_PRIVATE_KEY_PATH` → 无密钥 Build Runner 中该变量不存在
- [ ] CI-04：伪造 `GITHUB_ACTIONS=true` 环境变量在本地调用 sign-protected.sh → 无受信 CI 上下文拒绝（exit 2）
- [ ] CI-05：临时关闭分支保护后本地全绿 push → 平台侧合并审计告警（验证监控存在）
- [ ] ATST-03：手工把另一流水线的 origin.json 混入证据目录 → Signer 的 pipeline/job 绑定校验拒绝
- [ ] ATST-05：两个并发 push 制造 Evidence 分支非快进 → Publisher CAS 重试且旧 Bundle 未被覆盖（比对两次发布的 run-id）
- [ ] ATST-06：人为破坏 publish（如吊销发布身份）→ `evidence-published` 未产生，Signer 成功不被当作链路完成
- [ ] ATST-07：篡改 Evidence 分支 `index/` 或 bundle.json → `dairn evidence verify --bundle` 独立发现摘要不匹配
- [ ] ATST-08：轮换签名密钥 → 旧公钥验签失败且不静默 PASS，按 §17 POLICY-UPDATE 决议处理
- [ ] APR-01..08：在测试仓库用真实账号/机器人按矩阵逐项执行 `ci/providers/fetch-*-approval.sh` + `dairn approval evaluate`，核对 verdict 与平台 UI 一致
- [ ] SNAP-08（CI 侧）：受保护 build 在 dirty 工作树（手工放置未追踪文件）→ build-protected.sh clean 校验拒绝

## 发行验收

- [ ] INIT-01..03：六平台/npm/Wheel/ZIP 交叉安装，runtime 指纹一致（复用 `tools/verify-packages.py`）
- [ ] 六平台矩阵 + `tools/verify-linux.py` + `tools/verify-windows.py`（含 `test_governance_native.mjs`）全绿
- [ ] 密钥轮换/撤销路径成文（§17），信任锚 Pin 更新流程经管理员批准
- [ ] RETENTION：Evidence 分支大小限额与日志脱敏策略成文

## 结果记录

每项记录：仓库、commit SHA、流水线 URL、执行人、日期、原始输出片段。任何未执行项在发行说明中保持 `unverified` 列表。
