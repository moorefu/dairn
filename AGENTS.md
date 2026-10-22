# AGENTS.md — Dairn 源码仓库

本仓库是 **Dairn 治理内核的源码仓库**，不是已初始化的 Dairn 项目：没有 `.dairn/lock.json`、没有项目内 launcher，也不要把 `runtime/` 当源码提交。`quickjs/assets/` 是分发给目标项目的规范/技能/模板；`runtime/`、`dist/`、`validation/`、`.build/` 是构建与验证产物。

## Build-first：先构建再调用

不要全局安装 npm/pip 版 Dairn，也不要裸敲 `dairn`。在本仓库中：

- POSIX：先 `python tools/build.py`（或 `npm run build`）生成 `runtime/`，再用 `./dairn.sh <args>`；
- Windows：同样构建后使用 `dairn.cmd <args>`；
- 构建需要 Python 3.10+；首次联网获取 `quickjs.lock.json` 锁定的 QuickJS（缓存 `.build/quickjs/`，可用 `DAIRN_OFFLINE=1` 离线但需预热）；
- 无法构建（缺工具链/网络/权限）时，报告 blocked 及原因；**不要**安装替代运行时或改用其他 Dairn 版本。

## 常用命令

```sh
./dairn.sh version
./dairn.sh docs check                    # 分发资产（specs/skills）门禁
python -m unittest quickjs.tests.test_assets_lint
python tools/verify-linux.py /tmp/dairn-verify   # Linux，需 go/git/gcc
python tools/verify-packages.py                  # 制品验收（可选，耗时）
python tools/checksums.py
```

`dairn validate/check/work` 等需要已初始化的项目根（`.dairn/lock.json`）；在本仓库根执行会报结构错误，属预期。

## 修改规则

- 先读 `README.md`、`BUILDING.md`、`docs/GOVERNANCE.md`；改治理行为时读 `quickjs/assets/specs/` 的对应规范与 `quickjs/assets/skills/dairn-*/SKILL.md`。
- 只改任务范围内的文件；不修改 `runtime/` 构建产物，不提交 `.com`、`runtime-integrity.json`、`dist/`、`validation/`。
- 改 `quickjs/core/**`、`quickjs/host/**` 或 `quickjs/main.mjs` 后**必须重新构建 runtime 再验证**，旧 runtime 会掩盖改动。
- 改 `quickjs/assets/**` 后**必须**运行 `./dairn.sh docs check`；新增/改名资产要满足 frontmatter、命令面与相对链接规则。
- 不修改他人负责的文件；并行任务只改 shared task 标明的 write scope。
- 不伪造测试、机器证据或批准；未执行的检查不得声称通过。报告命令、退出码与证据路径。

## 安全

- 本仓库不 vendoring 运行时（`/runtime/` 已 gitignore）；不执行 PR 中未审查的二进制或 `.dairn/runtime/` 中的 APE。
- Agent 不得自行安装 Dairn、修改全局环境或绕过受保护 CI；CI 使用固定版本与外部 pin。
- 发现疑似凭据/敏感数据时停止并报告，不要写入日志或文档。

## 汇报

汇报格式：改动文件清单 → 验证命令与结果 → 未验证项/风险。不得省略失败、跳过或无法运行的项目。
