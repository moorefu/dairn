# 受保护发布验收清单

本文记录 Dairn 发布链路中必须由仓库管理员和 CI 平台实际配置、实际运行并留存证据的控制项。源码测试通过不能替代这些平台控制；本文件与 `.github/rulesets/*.json` 只是可导入的配置物料，**导入、启用和平台生效必须在 GitHub 上由管理员执行并留存证据**。

> 历史快照（2026-10-23）：当时 `main.protected=false`，仓库 rulesets 列表为空，签名模板未部署。本轮未取得可认证的最新平台状态（2026-10-24，匿名 API 限流），不能据此断言当前保护状态。以下条目在真实平台上执行并留存新证据前，不得标记为已验收。

## 一、GitHub 平台保护物料

仓库内的规则文件（三个独立 ruleset，按保护面分别导入）：

| 文件 | ruleset 名称 | target | 条件 | 规则 |
| --- | --- | --- | --- | --- |
| `.github/rulesets/main-branch.json` | `dairn-main-protection` | branch | `refs/heads/main` | deletion、non_fast_forward、pull_request（1 个批准 + 过期审查失效 + 评论解决）、required_status_checks（strict） |
| `.github/rulesets/release-tags-versioned.json` | `dairn-release-version-tags-protection` | tag | `refs/tags/v*` | creation、update、deletion、non_fast_forward |
| `.github/rulesets/release-tags-latest.json` | `dairn-release-latest-tag-protection` | tag | `refs/tags/latest` | deletion、non_fast_forward |

`main` ruleset 的 `pull_request` 里 `require_code_owner_review` 为 `true`，但当前仓库没有 `CODEOWNERS`，该子项空转（见 1.2）。三个 JSON 都按 GitHub Rulesets REST API（`POST /repos/{owner}/{repo}/rulesets`）的请求体格式编写，`enforcement` 均为 `active`。**字段结构只能对照 API 文档静态校验，导入是否被接受、规则是否实际生效，必须先在测试仓库 dry-run 验证。**

为什么 `v*` 与 `latest` 拆成两个 ruleset：`v*` 由维护者创建、release.yml 不会移动它，因此可以安全启用 creation/update/deletion/non_fast_forward 全套保护；`latest` 由 release.yml 的 `publish` job 用 `secrets.GITHUB_TOKEN` 创建并向前移动，而 `github-actions` 无法作为 ruleset 的 bypass actor，所以 latest 只保留 deletion/non_fast_forward（禁止删除与回退），不阻塞正常发布。详见 1.3。

### 1.1 导入命令（需要仓库管理员权限）

rulesets 的创建/修改/删除需要仓库 **admin** 权限（组织仓库还需组织所有者或授权团队）；`GITHUB_TOKEN` 没有仓库管理权限，**不能在 Actions 工作流里完成导入**。用管理员身份登录 `gh` 后执行：

```bash
# 管理员 PAT（fine-grained: Administration=write，或 classic: repo + 仓库 admin 角色）
export GH_TOKEN=<repo-admin-token>
export GITHUB_REPOSITORY=moorefu/dairn   # 按实际仓库修改
gh auth status

# 1) 版本标签 v*：可由维护者创建、release.yml 不会移动它，可启用完整保护
gh api --method POST "repos/$GITHUB_REPOSITORY/rulesets" \
  --input .github/rulesets/release-tags-versioned.json

# 2) latest：只禁止删除/回退，允许 release.yml 正常创建与向前移动
gh api --method POST "repos/$GITHUB_REPOSITORY/rulesets" \
  --input .github/rulesets/release-tags-latest.json

# 3) main 分支保护：启用前必须先确认至少有一名独立审批人（见 1.2 单人维护风险）
gh api --method POST "repos/$GITHUB_REPOSITORY/rulesets" \
  --input .github/rulesets/main-branch.json
```

若暂时无法满足 `main` 的独立审批人条件，可先以 `disabled` 导入 main ruleset（标签 ruleset 不受影响，可直接激活），确认第二审批人后再激活：

```bash
jq '.enforcement = "disabled"' .github/rulesets/main-branch.json > /tmp/main-branch-disabled.json
gh api --method POST "repos/$GITHUB_REPOSITORY/rulesets" --input /tmp/main-branch-disabled.json

# 确认审批人可用后，用完整 JSON 激活（PUT 会整体替换该 ruleset）
MAIN_RULESET_ID=$(gh api "repos/$GITHUB_REPOSITORY/rulesets" --jq '.[] | select(.name=="dairn-main-protection") | .id')
gh api --method PUT "repos/$GITHUB_REPOSITORY/rulesets/$MAIN_RULESET_ID" \
  --input .github/rulesets/main-branch.json
```

回滚：`gh api --method DELETE "repos/$GITHUB_REPOSITORY/rulesets/<id>"`；两个标签 ruleset 与 main ruleset 都用 GET 列表里的 id 操作，互不影响。

### 1.2 `main` 必需检查的精确名称

release.yml 中聚合 job 的名称是 **`全部矩阵通过`**（`.github/workflows/release.yml:215`）。它是唯一需要绑定为 Required Check 的上下文：

- `accepted` job 的 `needs: [build, test, test-python, test-python-windows]`，并用 `test "$BUILD_RESULT" = success && …` 要求四个依赖全部成功；
- `test` 是 6 个 runner 的矩阵（Linux x64/ARM64、Windows x64/ARM64、macOS Intel/ARM64 的 npm/Wheel/ZIP 冒烟）；
- `publish` 又 `needs: [build, test, accepted]`。

因此 `全部矩阵通过` 一个 context 就覆盖构建、六平台冒烟、Linux/Windows 集成回归与 Go 门禁；把它设为必需检查即可，不需要再逐个绑定矩阵 job（矩阵 job 的 check 名称带 runner 后缀，逐个绑定既易漏又难维护）。

注意：

- context 必须与 job `name:` **逐字符一致**（含中文）；改 release.yml 的 job 名称会导致 PR 永久缺 check，必须同步更新 ruleset 并留记录。该 check 来自 `pull_request` 触发（release.yml 已配置 `pull_request:`）；若以后改成只由 push 触发，required check 会永远缺失，PR 无法合并。
- ruleset 的 `strict_required_status_checks_policy=true` 表示“分支必须与 main 同步后才能合并”，会增加一次重新构建，属预期代价。
- **单人维护风险（启用前必须确认）**：`bypass_actors=[]` + `required_approving_review_count=1` 要求每个 PR 至少获得 1 个独立批准；GitHub 不允许作者批准自己的 PR，且规则没有旁路。**单人维护的仓库在这个规则下无法合并自己的 PR**。启用 main ruleset 前必须确认已有第二名可审批的维护者；若没有，只能先不导入、或导入为 `disabled` 并留审计记录，待有共同维护者后再激活。禁用期间不得宣称 main 已受平台保护；规则修改本身有 GitHub 审计日志。
- `require_code_owner_review=true` 只有在仓库存在 `CODEOWNERS` 时才起作用；**当前仓库没有 `CODEOWNERS`**，该子项实际空转。**本任务刻意不新增 `CODEOWNERS`**：单人仓库把关键文件设为 code owner 后又无人可批准，会形成合并死锁。等出现共同维护者后，再新增 `.github/CODEOWNERS` 把签名/发布/CI/规则文件列入 owner，并重新演练。
- `bypass_actors` 为空：没有个人或 App 能绕过 main 规则；管理员紧急修复也必须先经审查 PR 或显式修改 ruleset，不能靠“管理员身份直接推”。

### 1.3 `v*` 与 `latest` 标签保护（两个独立 ruleset）

标签保护拆成两个 ruleset，避免保护规则阻塞现有发布流水线：

**A. `release-tags-versioned.json` → `dairn-release-version-tags-protection`（`refs/tags/v*`）**

- rules：creation、update、deletion、non_fast_forward；`enforcement: active`。
- 语义：只有 bypass 列表中的身份能创建、移动、删除或回退版本标签。`v*` 标签由维护者在受保护 main 的已合并提交上创建；release.yml 发布流程不会移动 `v*`（它只创建 Release、移动 `latest`），因此该 ruleset 激活后**不会阻塞现有发布流水线**。
- bypass：`RepositoryRole` actor_id `5`（仓库 admin）——发布经理必须有 admin 角色才能创建 `v*` 标签（write/maintain 角色不能）；可选加入 `DeployKey`（对 `git push` 生效）便于将来自动创建标签。组织仓库可另加 `OrganizationAdmin`；个人仓库不支持该 actor。若放宽到 maintain（actor_id `4`），所有 maintainer 都能创建/移动标签，需评审。
- 残余风险：bypass 身份的凭据等同于“可发布”权限，必须按发布密钥管理（最小暴露、可轮换、双人复核）。

**B. `release-tags-latest.json` → `dairn-release-latest-tag-protection`（`refs/tags/latest`）**

- rules：deletion、non_fast_forward；`enforcement: active`。
- 语义：禁止删除 `latest`、禁止向后/强推回退，但**允许 release.yml 的 `publish` job 首次创建和正常向前移动**。
- 为什么只保留这两条：`.github/workflows/release.yml:228-253` 的 `publish` job 用 `secrets.GITHUB_TOKEN`（`github-actions` 身份）调用 `tools/publish-release.py`，通过 `gh api` 创建/向前移动 `latest`（`POST /git/refs`、`PATCH /git/refs/tags/latest`）。**`github-actions` 是平台内置身份，不能加入 ruleset 的 bypass_actors**：社区实证（2026 年多份规则集实践记录）显示 Rulesets API 对 `{"actor_type":"Integration","actor_id":15368}` 返回 422（“Actor GitHub Actions integration must be part of the ruleset source or owner organization”），该结论需在测试仓库复现确认。若给 latest 加 creation/update，publish job 会在版本 Release 创建后失败、latest 停止更新，所以 latest 的保护面只到“禁止删除与回退”。
- 残余风险：deletion/non_fast_forward 不能阻止**向前**移动；任何拥有 `contents: write` 的身份（含 GITHUB_TOKEN、写权限用户）仍可把 `latest` 指到更晚的提交而不更新 Release。latest 的“内容不可篡改”尚未由平台强制。
- 后续强化项（列入第六节未验证清单）：把 publish 凭据迁移到**可作 bypass 的安装版 GitHub App installation token**（App 以 `Integration` 加入 bypass），或改用**部署密钥的 git push 路径**（部署密钥只对 SSH push 生效，`gh api` 不受其旁路影响，需把 `publish-release.py` 的 latest 移动改成 git push）。完成迁移后再给 `release-tags-latest.json` 增加 creation、update，并重新演练一次完整 Release 的 latest 移动。

其他验收要求：

- `v*` 标签应由发布经理在受保护 main 的已合并提交上创建；`latest` 只允许发布流水线移动。
- 任何 tag 规则变更都属于发布信任链变更，需要 admin 操作 + 双人复核；旧的两合一 `release-tags.json` 已删除，如仓库里再出现该文件名，**不要导入**。

### 1.4 平台生效证据（管理员/审计执行）

```bash
# ruleset 列表：应有 dairn-main-protection / dairn-release-version-tags-protection / dairn-release-latest-tag-protection
gh api "repos/$GITHUB_REPOSITORY/rulesets" --jq '.[] | {id, name, target, enforcement}'
MAIN_RULESET_ID=$(gh api "repos/$GITHUB_REPOSITORY/rulesets" --jq '.[] | select(.name=="dairn-main-protection") | .id')
VERSION_TAG_RULESET_ID=$(gh api "repos/$GITHUB_REPOSITORY/rulesets" --jq '.[] | select(.name=="dairn-release-version-tags-protection") | .id')
LATEST_TAG_RULESET_ID=$(gh api "repos/$GITHUB_REPOSITORY/rulesets" --jq '.[] | select(.name=="dairn-release-latest-tag-protection") | .id')

# 逐条核对 main 的规则、条件、旁路（bypass_actors 应为空）
gh api "repos/$GITHUB_REPOSITORY/rulesets/$MAIN_RULESET_ID" \
  --jq '{name, target, enforcement, conditions, rules, bypass_actors}'

# v*：应含 creation/update/deletion/non_fast_forward，条件仅 refs/tags/v*
gh api "repos/$GITHUB_REPOSITORY/rulesets/$VERSION_TAG_RULESET_ID" \
  --jq '{name, target, enforcement, conditions, rules, bypass_actors}'

# latest：应含 deletion/non_fast_forward，条件仅 refs/tags/latest（这是刻意的保护面）
gh api "repos/$GITHUB_REPOSITORY/rulesets/$LATEST_TAG_RULESET_ID" \
  --jq '{name, target, enforcement, conditions, rules, bypass_actors}'

# 分支保护辅助证据（ruleset 生效时以 rulesets 列表 + 实际拒绝演练为准）
gh api "repos/$GITHUB_REPOSITORY/branches/main" --jq '{name, protected, protection}'

# 必需检查确实出现在 main 提交上（context 应为“全部矩阵通过”且 conclusion=success）
SHA=$(gh api "repos/$GITHUB_REPOSITORY/commits/main" --jq .sha)
gh api "repos/$GITHUB_REPOSITORY/commits/$SHA/check-runs" \
  --jq '.check_runs[] | select(.name=="全部矩阵通过") | {name, conclusion, app: .app.slug}'

# 标签保护演练：全部由【不在 bypass 列表中的身份】执行，期望非零退出
# v*：先在测试仓库用 bypass(admin) 身份建 v0.0.0-protection-drill，再用非旁路身份执行：
git push origin --delete v0.0.0-protection-drill                          # deletion 应拒绝
git push --force origin "$(git rev-parse main~1):refs/tags/v0.0.0-protection-drill"  # update/回退应拒绝
git push origin "$(git rev-parse main):refs/tags/v0.0.0-creation-drill"   # creation 应拒绝
# latest（生产仓库；非旁路身份；仅在 latest 已存在时执行回退探测）
git push origin --delete latest                                                  # deletion 应拒绝
git push --force origin "$(git rev-parse 'latest~1'):refs/tags/latest"           # 回退到父提交应被 non_fast_forward 拒绝
# 注意：不要用 main~1 之类“可能比 latest 新”的提交做探测，那属于前进移动，非旁路身份也会成功并真正改变 latest。
```

注意：向 `v*` 推标签会触发 release.yml（`on.push.tags: ['v*']`），因此 `v*` 的创建类演练应在测试仓库做；生产仓库只用非旁路身份做 latest 的删除/回退探测。**latest 探测必须由不在 bypass 列表中的身份执行，否则会真正删除/移动 `latest`**。任何演练产生的 tag 都要用有旁路权限的身份清理并留审计记录。

## 二、受保护构建与签名

- 构建任务使用管理员提供的外部 `DAIRN_CI_BIN`、固定 `DAIRN_EXPECTED_APE_SHA256`、`DAIRN_EXPECTED_RUNTIME_SHA256` 和 `DAIRN_EXPECTED_POLICY_SHA256`。
- 受保护构建检出必须洁净；`ci/protected/build-protected.sh` 会拒绝未提交改动或未追踪文件，并把同一流水线的来源写入 `ci-build-origin.json`。
- 签名任务同样要求源检出洁净，只从同一流水线恢复 `.dairn/governance/evidence/` artifact；`ci/protected/sign-protected.sh` 复核 bundle 成员摘要、独立检查记录与构建来源，不依赖 `.dairn/work/` 任务账本。脚本的洁净检查允许证据数据目录，其余未提交改动或未追踪文件仍拒绝签名。
- 签名任务使用独立 runner 或 HSM/KMS 挂载私钥。签名 runner 不运行项目测试或分析器，只验证同一流水线的来源、机器证据、提交和外部 pin。
- 通过 GitHub Environment、runner 组和审批规则限制签名任务；PR、普通 push 和 fork 无法读取私钥。
- 以真实受保护分支 push 演练构建、签名、验签和失败路径，保存 workflow、job、artifact 摘要与签名声明。环境变量模拟不构成生产验收。

### 2.1 作为 Required Checks 的绑定方式

`ci/templates/github-protected.yml` 的 job 名是 `pr-quality`、`protected-build`、`protected-sign`（job id 即 check context）。但 `protected-build`/`protected-sign` 的 `if` 只允许 `push` 且 `github.ref_protected`，**不会在 pull request 上产生 check**；把它们直接写进 main ruleset 的 required_status_checks 会让所有 PR 永久缺 check、无法合并。

正确绑定分两层：

1. **合并前（main ruleset）**：只绑定 release.yml 的 `全部矩阵通过`（已写入 `main-branch.json`）。签名相关的 PR 审查由人工审批承担（CODEOWNERS 待有共同维护者后再加，见 1.2）。
2. **合并后（发布证据）**：把签名模板部署为真实工作流后，用以下机制绑定：
   - `protected-sign` 使用 `environment: dairn-attestation`，Environment 上配置 required reviewers + 仅允许受保护分支部署；这样“拿到密钥签名”= 平台强制的人工发布审批；
   - `protected-build` 与 `protected-sign` 之间用 `needs` + artifact 传递，签名的 `ci-build-origin.json` 校验同一 pipeline（脚本已实现），不依赖人工转述；
   - 如需把签名证据进一步前移到合并门禁，另建一个 **PR 可运行、无密钥** 的检查 job（例如静态校验 workflow pin、模板摘要、受保护 job 定义与外部 pin 是否齐全），把它的 job 名称作为 required context 加入 `main-branch.json`；不要把需要密钥的 job 改成 PR 可运行。

将来部署签名工作流并新增必需检查时，用全量 `PUT` 更新 ruleset（`PUT` 会整体替换，必须先 GET 现状）：

```bash
gh api "repos/$GITHUB_REPOSITORY/rulesets/$MAIN_RULESET_ID" > /tmp/main-ruleset.json
jq '.rules |= map(if .type=="required_status_checks"
  then .parameters.required_status_checks += [{"context":"<新的必需检查 job 名称>"}]
  else . end)' /tmp/main-ruleset.json > /tmp/main-ruleset-updated.json
gh api --method PUT "repos/$GITHUB_REPOSITORY/rulesets/$MAIN_RULESET_ID" --input /tmp/main-ruleset-updated.json
```

## 三、注册表发布（npm / PyPI）身份校验流程

`.github/workflows/registry-publish.yml` 在执行任何发布前先运行 `validate` job（`permissions: contents: read`，输出已通过的 `tag`/`commit`）；`npm`/`pypi` job 都 `needs: [validate]`，且 workflow_dispatch 输入只经 `env RELEASE_TAG` 进入脚本，`run` 块内不出现 `${{ inputs.* }}` 插值。

`validate` job 的校验顺序（失败即退出）：

1. `inputs.tag` 经 env 传入，用版本标签正则校验（拒绝 `latest` 等别名）。
2. `actions/checkout@v4` `ref: main`、`fetch-depth: 0`、`persist-credentials: false`：无论从哪个 ref 手动触发，历史判断都基于受保护 main（workflow_dispatch 不能把信任基座切到分支）。
3. `gh release view "$RELEASE_TAG" --json tagName,isDraft,targetCommitish,assets`：Release 必须存在、`tagName` 与输入一致、**非草稿**，并记录资产清单。
4. `gh api repos/$GITHUB_REPOSITORY/git/ref/tags/$RELEASE_TAG`：解析 ref 对象；annotated tag 逐层 peel（`git/tags/<sha>` 的 `object`）直到 commit，取 `TAG_COMMIT`。
5. `TAG_COMMIT` 必须等于 Release `targetCommitish` 解析出的提交，并且 `git merge-base --is-ancestor "$TAG_COMMIT" origin/main` 成立（标签提交必须已在受保护 main 历史内）。
6. 下载 Release 的全部资产：必须有 `checksums.json` 且格式合法（`artifacts` 恰为三件制品的名称到 64 位 sha256 映射，`ape_sha256` 合法）；Release 资产集合必须恰好等于“三件制品 + `checksums.json`（共四个资产）”；逐文件 `sha256` 必须与 `checksums.json` 一致；Release 资产返回 `digest` 时必须与 `checksums.json` 一致（旧资产没有 digest 时降级为实际下载字节校验并 `::warning::` 记录）。
7. `npm`/`pypi` 下载后各自再取 `checksums.json`，对 `*.tgz`/`*.whl` 计算 SHA256 并 `sha256sum -c` 复核，不一致即退出；之后才进入原有的幂等跳过、错误提示与 `environment: npm`/`environment: pypi` 发布逻辑。

仍需的平台前提（本文件只给出配置要求，不能由代码替代）：

- 两个 Environment 必须配置 required reviewers、限制可部署分支、保护 secrets；审核者应同时核对受保护构建/签名证据后再批准。
- `workflow_dispatch` 只允许有 write 权限的维护者触发；建议用 Environment 审批与分支限制把“点按钮”也纳入双人控制。
- 本文档描述的校验只证明“注册表发布的是受保护 main 历史内、已发布 Release 上的同名制品”；它不证明签名私钥隔离、runner 完整性或人工审批已经发生。

## 四、许可证

2026-10-23 维护者决定 **Dairn 自有代码采用 MIT 许可证**，版权署名为 `moorefu <chengmu.fu@gmail.com>`；根目录 `LICENSE` 为授权文本，`licenses/` 仅保留 Cosmopolitan/QuickJS 等第三方声明。以下同步点已在源码中完成：

- `package.json` `license: "MIT"`、`author: "moorefu <chengmu.fu@gmail.com>"`；npm tarball 自动包含根 `LICENSE`。
- `pyproject.toml` 声明 MIT、MIT classifier 与 authors；Wheel METADATA 写入 `License: MIT`、MIT classifier、`Author`/`Author-email`，并在 `dist-info/licenses/LICENSE` 附带授权文本；ZIP 根目录携带 `LICENSE`。
- README 增加许可证章节；`tools/release.json` 的源码白名单包含 `LICENSE`；`tools/verify-packages.py` 对 npm tarball、Wheel METADATA/`dist-info/licenses/LICENSE`、ZIP `LICENSE` 做字节与声明校验。

仍需平台/发布侧证据（未完成前不得宣称已完成生产发布验收）：

- 合并后 `GET /repos/{owner}/{repo}` 的 `license.spdx_id` 应为 `MIT`（GitHub 许可证检测）；当前仓库尚未推送该提交，API 仍可能显示为空。
- 下一个版本标签产出的三类制品必须携带同一 `LICENSE` 文本并通过矩阵验收；历史 Release（如 `v0.1.0-rc.4`）仍是旧许可证元数据，不能沿用为 MIT 证据。
- npm/PyPI 页面的许可证元数据在下次发布后核对；第三方声明文件不等于对第三方组件重新授权。

## 五、验收记录格式

每次生产演练记录日期、提交和标签、规则/Environment 标识、构建与签名 job、制品 SHA256、验签结果、失败路径和复核者。记录只引用实际平台输出（`gh api` 原始 JSON、workflow run URL、job 日志、artifact 摘要），不用本地模拟结果替代。

## 六、未验证项（必须由管理员在真实平台完成）

- [ ] 在测试仓库 dry-run 导入三个 rulesets，确认 API 接受全部字段（tag target 上 `creation`/`update` 的接受度、`RepositoryRole`/`DeployKey` bypass、中文 context）。
- [ ] 测试仓库验证 `v*` 的创建/移动/删除对非旁路身份全部被拒绝；验证 `latest` 的删除/回退被拒绝、正常向前更新不被拒绝。
- [ ] 测试仓库验证 main 必需检查 `全部矩阵通过` 能正常产生并在缺失时阻塞合并。
- [ ] 启用 main ruleset 前确认至少有一名独立审批人（当前单人维护仓库不自审、无 bypass）；不满足时先不导入或 `disabled` 导入并留审计记录，**不要**为此新增 `CODEOWNERS`（单人仓库会死锁）。
- [ ] 后续强化项：把 publish 凭据迁移到可作 bypass 的安装版 GitHub App installation token（或部署密钥 git push 路径），再给 `release-tags-latest.json` 增加 creation、update，并演练一次完整 Release 的 latest 移动。
- [ ] 部署 `ci/templates/github-protected.yml` 到真实工作流与受保护 runner，完成构建/签名/验签及失败路径演练，保存 evidence artifact 与签名声明。
- [ ] 为 npm/PyPI Environment 配置 reviewers、分支限制与 secrets，停用长期令牌前重新演练失败与重跑路径。
- [x] 选定许可证（MIT）并在源码中同步 `LICENSE`、`package.json`、`pyproject.toml`、Wheel METADATA/`dist-info/licenses`、ZIP 与 npm tarball、README、源码白名单与制品验收断言（2026-10-23，本地构建/制品验收已覆盖）。
- [ ] 合并后核对 GitHub `license.spdx_id == MIT`、下一版本 Release 制品携带 MIT `LICENSE`、npm/PyPI 页面元数据同步；历史 Release 不得作为 MIT 证据。
