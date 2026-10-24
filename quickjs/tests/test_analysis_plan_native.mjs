// 能力驱动的分析需求与 Provider 选择：全部是纯函数，确定性、无模型、缺口显式。
// 该测试同时锁定“精度阶梯不可越过”和“缺 provider / 精度不足必须暴露为 gap”两条契约。
import {
  CAPABILITIES, PRECISION_LADDER, REQUIRED_PRECISION, precisionRank, isPrecision,
  isCapability, assertCapability, capabilityForQualityObjective, hasReferenceIntent,
  deriveNeeds, chooseProvider, describeProviders,
} from '../core/analysis-needs.mjs';
import * as std from 'std';

const assert = {
  equal(actual, expected) {
    if (!Object.is(actual, expected)) throw Error('断言失败：' + String(actual) + ' != ' + String(expected));
  },
  ok(value, message) { if (!value) throw Error('断言失败：' + (message || '')); },
  deepEqual(actual, expected) {
    const left = JSON.stringify(actual);
    const right = JSON.stringify(expected);
    if (left !== right) throw Error('断言失败：' + left + ' != ' + right);
  },
  throws(fn, part) {
    try { fn(); } catch (error) {
      if (part && String(error.message).indexOf(part) === -1) throw Error('断言失败：错误信息不含 ' + part + '：' + String(error.message));
      return;
    }
    throw Error('断言失败：预期抛出错误');
  },
};

// ---- 能力与精度阶梯 ----
assert.equal(CAPABILITIES.length, 14);
assert.equal(new Set(CAPABILITIES).size, CAPABILITIES.length);
assert.ok(CAPABILITIES.includes('surface.api-diff'), '必须包含 surface.api-diff');
assert.ok(CAPABILITIES.includes('contract.compatibility'), '必须包含 contract.compatibility');
assert.equal(PRECISION_LADDER.join(','), 'text,reported,heuristic,observed-static,syntax,semantic,contract');
assert.equal(precisionRank('text'), 0);
assert.equal(precisionRank('syntax'), 4);
assert.equal(precisionRank('semantic'), 5);
assert.ok(precisionRank('semantic') > precisionRank('heuristic'), '语义证据强于启发式');
assert.equal(isPrecision('observed-static'), true);
assert.equal(isPrecision('exact'), false);
assert.throws(() => precisionRank('deep'), 'Unknown analysis precision');
assert.equal(isCapability('change.impact'), true);
assert.equal(isCapability('grep.search'), false);
assert.throws(() => assertCapability('grep.search'), 'Unknown analysis capability');
assert.equal(REQUIRED_PRECISION['change.impact'], 'observed-static');
assert.equal(REQUIRED_PRECISION['surface.api-diff'], 'syntax');
assert.equal(REQUIRED_PRECISION['symbol.references'], 'semantic');
assert.equal(REQUIRED_PRECISION['coverage.summary'], 'reported');

// ---- 质量目标到能力 ----
assert.equal(capabilityForQualityObjective({attribute: 'coverage'}), 'coverage.summary');
assert.equal(capabilityForQualityObjective({attribute: 'compatibility'}), 'surface.api-diff');
assert.equal(capabilityForQualityObjective({metric: 'security.findings'}), 'security.scan');
assert.equal(capabilityForQualityObjective({metric: 'test.failed'}), 'test.quality');
assert.equal(capabilityForQualityObjective({metric: 'unknown.metric'}), null);
assert.equal(capabilityForQualityObjective(null), null);
assert.equal(hasReferenceIntent('who calls RefundService'), true);
assert.equal(hasReferenceIntent('谁在用退款'), true);
assert.equal(hasReferenceIntent('rename the readme'), false);

// ---- 需求推导：无信号即无需求 ----
assert.deepEqual(deriveNeeds(), []);
assert.deepEqual(deriveNeeds({change: {status: 'clean', impacts: [], downstream_modules: []}}), []);

const internal = deriveNeeds({change: {
  status: 'informational',
  impacts: [{path: 'pkg/retry.py', category: 'code-internal', module: 'pkg'}],
  downstream_modules: [],
}});
assert.deepEqual(internal.map(need => need.capability), ['change.impact', 'test.selection']);
assert.equal(internal[0].priority, 'required');
assert.equal(internal[1].priority, 'advisory');
assert.equal(internal[0].id, 'need-1');
assert.equal(internal[1].id, 'need-2');
assert.deepEqual(internal[0].scope.paths, ['pkg/retry.py']);
assert.deepEqual(internal[0].scope.modules, ['pkg']);

// 公共面变化 -> surface.api-diff 必需，精度语法级；下游依赖 -> 契约兼容必需。
const surface = deriveNeeds({change: {
  status: 'review-required',
  impacts: [
    {path: 'api/service.py', category: 'public-surface', module: 'app'},
    {path: 'api/schema.py', category: 'source-layout', module: 'app'},
  ],
  downstream_modules: ['consumer', 'gateway'],
}});
const byCapability = new Map(surface.map(need => [need.capability, need]));
assert.equal(byCapability.get('surface.api-diff').priority, 'required');
assert.equal(byCapability.get('surface.api-diff').required_precision, 'syntax');
assert.equal(byCapability.get('contract.compatibility').priority, 'required');
assert.deepEqual(byCapability.get('contract.compatibility').scope.modules, ['consumer', 'gateway']);
assert.deepEqual(byCapability.get('surface.api-diff').scope.paths, ['api/service.py']);
assert.equal(byCapability.get('change.impact').required_precision, 'observed-static');

// 仅布局变化时 surface.api-diff 只能是 advisory。
const layout = deriveNeeds({change: {
  status: 'informational', impacts: [{path: 'api/schema.py', category: 'source-layout', module: 'app'}], downstream_modules: [],
}});
assert.equal(layout.find(need => need.capability === 'surface.api-diff').priority, 'advisory');

// 查询符号 -> 定义必需；带引用意图 -> 引用必需（语义级）。
const symbols = deriveNeeds({
  symbols: [{path: 'src/refund.py', symbol: 'refund'}],
  query: 'who calls refund',
});
assert.deepEqual(symbols.map(need => need.capability), ['symbol.definition', 'symbol.references']);
assert.equal(symbols[1].required_precision, 'semantic');

// 强制质量目标推导 required 证据；advisory 目标被忽略。
const goals = deriveNeeds({goals: {objectives: [
  {id: 'cov', enforcement: 'required', attribute: 'coverage'},
  {id: 'sec', enforcement: 'advisory', attribute: 'security'},
]}});
assert.deepEqual(goals.map(need => need.capability), ['coverage.summary']);
assert.equal(goals[0].priority, 'required');

// trusted policy 的 required 条目按 when 生效，并只能抬升精度。
const policyChange = {capability: 'security.scan', when: 'change'};
assert.deepEqual(deriveNeeds({policy: {required: [policyChange]}}), []);
const withChange = deriveNeeds({change: {
  status: 'informational', impacts: [{path: 'pkg/a.py', category: 'code-internal', module: 'pkg'}], downstream_modules: [],
}, policy: {required: [policyChange]}});
assert.ok(withChange.some(need => need.capability === 'security.scan'), 'change 场景必须推导 security.scan');
const raised = deriveNeeds({policy: {required: [{capability: 'surface.api-diff', when: 'always', precision: 'semantic'}]}});
assert.equal(raised[0].required_precision, 'semantic');

// capabilityOnly 过滤 + 未知能力报错。
const only = deriveNeeds({change: {
  status: 'review-required', impacts: [{path: 'api/a.py', category: 'public-surface', module: 'app'}], downstream_modules: ['x'],
}, capabilityOnly: 'surface.api-diff'});
assert.deepEqual(only.map(need => need.capability), ['surface.api-diff']);
assert.throws(() => deriveNeeds({capabilityOnly: 'grep.search'}), 'Unknown analysis capability');

// ---- Provider 选择 ----
const need = {capability: 'change.impact', required_precision: 'observed-static'};
const noProvider = chooseProvider(need, []);
assert.equal(noProvider.provider, null);
assert.equal(noProvider.reason, 'NO_PROVIDER');
const tooWeak = chooseProvider(need, [{id: 'weak', kind: 'analyzer', precision: 'heuristic', capabilities: ['change.impact']}]);
assert.equal(tooWeak.provider, null);
assert.equal(tooWeak.reason, 'PRECISION_INSUFFICIENT');
const builtin = {id: 'builtin:static-facts', kind: 'builtin', precision: 'observed-static', capabilities: ['change.impact']};
const analyzer = {id: 'go-surface', kind: 'analyzer', precision: 'semantic', capabilities: ['change.impact'], auto_execute: true, timeout_seconds: 30};
const selected = chooseProvider(need, [analyzer, builtin]);
assert.equal(selected.provider.id, 'builtin:static-facts');
assert.equal(selected.reason, 'matched');
const fastest = chooseProvider({capability: 'test.quality', required_precision: 'reported'}, [
  {id: 'slow', kind: 'analyzer', precision: 'reported', capabilities: ['test.quality'], timeout_seconds: 120},
  {id: 'fast', kind: 'analyzer', precision: 'reported', capabilities: ['test.quality'], timeout_seconds: 30},
]);
assert.equal(fastest.provider.id, 'fast');
const allowlisted = chooseProvider({capability: 'test.quality', required_precision: 'reported'}, [
  {id: 'manual', kind: 'analyzer', precision: 'reported', capabilities: ['test.quality'], auto_execute: false},
  {id: 'auto', kind: 'analyzer', precision: 'reported', capabilities: ['test.quality'], auto_execute: true},
]);
assert.equal(allowlisted.provider.id, 'auto');
const described = describeProviders([{id: 'x', kind: 'analyzer', precision: 'syntax', capabilities: ['surface.api-diff'], auto_execute: true, extra: 'dropped'}]);
assert.deepEqual(described, [{id: 'x', kind: 'analyzer', mode: 'builtin', precision: 'syntax', capabilities: ['surface.api-diff'], auto_execute: true}]);

print('QuickJS 原生分析选择测试：通过');
std.exit(0);
