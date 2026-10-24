/* 使用 qjs 执行原生运行时检查。 */
import {sha256} from '../core/sha256.mjs';
import {classify,moduleSelection,policyValidate,manifestValidate} from '../core/policy.mjs';
import * as std from 'std';
function eq(a,b) {if(JSON.stringify(a)!==JSON.stringify(b))throw new Error(JSON.stringify(a)+' != '+JSON.stringify(b));}
eq(sha256('abc'),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
eq(sha256('中文😀'),'e973a1c1b41c5c9f4fbac31fcc311536dfffd003bfb914580455170a599953fa');
eq(classify(['internal/auth/token.go']).risk,'L2');
eq(classify(['docs/design.md']).risk,'L0');
eq(classify(['src/main.go']).risk,'L1');
eq(classify(['.dairn/governance/project.json']).governance_mode,'G2');
let failed=false;
try{manifestValidate({risk:'L0',summary:'s',rationale:'r',verification:['unit']},classify(['auth/session.go']));}
catch(e){failed=true;}
if(!failed)throw new Error('Risk downgrade accepted');
// 安全敏感入口（构建/启动/发布/受保护 CI/规则文件）必须是治理-critical：
// risk=L2、governance_mode=G2、risk_triggers 含 governance-critical，且
// moduleSelection 必须返回全部模块；普通低信任工具/示例保持 L1，数据目录仍为 L0。
const criticalPaths=['ci/protected/build-protected.sh','ci/templates/github-protected.yml','tools/bootstrap.sh','tools/bootstrap.ps1','tools/build.py','tools/build.cjs','tools/build-npm.sh','tools/build-zip.mjs','tools/zip.mjs','tools/dairn_build_backend.py','tools/release_config.py','tools/release.json','tools/publish-release.py','bin/dairn.cjs','dairn.sh','dairn.cmd','build.sh','build.cmd','install.sh','package.json','pyproject.toml','src/dairn/cli.py','src/dairn/__init__.py','quickjs.lock.json','AGENTS.md','Makefile','.gitlab-ci.yml','.github/rulesets/main-branch.json'];
const ordinaryPaths=['tools/verify-linux.py','tools/verify-packages.py','tools/verify-podman.py','tools/verify-windows.py','tools/checksums.py','tools/prepare-regression.py','tools/source_workspace.py','examples/analyzers/go-surface/main.go','examples/review-record.json'];
const dataPaths=['.dairn/governance/evidence/run-qjs-checks.json','.dairn/work/task-1.json'];
const selectPolicy={schema_version:1,modules:[{path:'.'},{path:'tools'}]};
for(const p of criticalPaths) {
  const c=classify([p]);
  eq(c.risk,'L2'); eq(c.governance_mode,'G2');
  if(!c.risk_triggers.includes('governance-critical:'+p))throw new Error('missing governance-critical trigger: '+p);
  eq(moduleSelection(selectPolicy,[p]).length,selectPolicy.modules.length);
}
for(const p of ordinaryPaths) {
  const c=classify([p]);
  eq(c.risk,'L1'); eq(c.governance_mode,'G1');
  if(c.risk_triggers.length)throw new Error('ordinary path unexpectedly critical: '+p);
}
for(const p of dataPaths) {const c=classify([p]);eq(c.risk,'L0');eq(c.governance_mode,'G0');}
// 普通模块内改动只选择相关模块，不应误触发全模块检查。
if(moduleSelection(selectPolicy,['examples/analyzer.go']).length>=selectPolicy.modules.length)throw new Error('ordinary change selected all modules');
// 策略级快照排除：合法生成物模式通过；非数组、越界、过宽或非字符串模式拒绝。
const validPolicy={schema_version:1,project:'service',modules:[{name:'app',path:'.',profiles:['generic'],
  checks:{lint:{argv:['true']},unit:{argv:['true']},integration:{argv:['true']},build:{argv:['true']}}}],
  required_checks:{L0:['lint'],L1:['lint','unit'],L2:['lint','unit','integration','build']}};
if(policyValidate(validPolicy).length)throw new Error('baseline policy rejected: '+policyValidate(validPolicy).join('; '));
if(policyValidate({...validPolicy,snapshot_exclusions:['/dist/','__pycache__/','*.pyc']}).length)throw new Error('valid snapshot_exclusions rejected');
if(policyValidate({...validPolicy,snapshot_exclusions:null}).length)throw new Error('null snapshot_exclusions rejected');
for(const bad of ['dist/','../escape/',['C:/absolute/'],['*'],['a\\b'],[42],[],['/']]){
  if(!policyValidate({...validPolicy,snapshot_exclusions:bad}).length)throw new Error('invalid snapshot_exclusions accepted: '+JSON.stringify(bad));
}
print('PASS: QuickJS native portable policy cases');
std.exit(0);
