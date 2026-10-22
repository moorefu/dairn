/* 使用 qjs 执行原生运行时检查。 */
import {sha256} from '../core/sha256.mjs';
import {classify,policyValidate,manifestValidate} from '../core/policy.mjs';
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
print('PASS: QuickJS native portable policy cases');
std.exit(0);
