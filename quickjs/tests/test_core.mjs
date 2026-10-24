// 使用 QuickJS 原生接口验证策略和摘要；断言参考 Object.is 严格相等语义。
import { classify, requiresManifest } from '../core/policy.mjs';
import {sha256} from '../core/sha256.mjs';
import * as std from 'std';
const assert={equal(actual,expected){
  if(!Object.is(actual,expected))throw Error('断言失败：'+String(actual)+' != '+String(expected));
}};
assert.equal(sha256('abc'),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
assert.equal(sha256('中文😀'),'e973a1c1b41c5c9f4fbac31fcc311536dfffd003bfb914580455170a599953fa');
assert.equal(classify(['docs/readme.md']).risk,'L0');
assert.equal(classify(['src/main.go']).risk,'L1');
assert.equal(classify(['internal/auth/token.go']).risk,'L2');
assert.equal(classify(['.dairn/governance/project.json']).risk,'L2');
assert.equal(requiresManifest(['.github/workflows/test.yml']),true);
assert.equal(requiresManifest(['docs/help.md']),false);
print('QuickJS 原生策略与 SHA256 测试：通过');
std.exit(0);
