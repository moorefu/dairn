// Node-only policy-level smoke tests. NOT evidence of native qjs compatibility.
import assert from 'node:assert/strict';
import { classify, requiresManifest } from '../core/policy.mjs';
import {sha256} from '../core/sha256.mjs';
assert.equal(sha256('abc'),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
assert.equal(sha256('中文😀'),'e973a1c1b41c5c9f4fbac31fcc311536dfffd003bfb914580455170a599953fa');
assert.equal(classify(['docs/readme.md']).risk,'L0');
assert.equal(classify(['src/main.go']).risk,'L1');
assert.equal(classify(['internal/auth/token.go']).risk,'L2');
assert.equal(classify(['.dairn/governance/project.json']).risk,'L2');
assert.equal(requiresManifest(['.github/workflows/test.yml']),true);
assert.equal(requiresManifest(['docs/help.md']),false);
console.log('Node JS policy smoke: PASS (NOT native Cosmopolitan validation)');
