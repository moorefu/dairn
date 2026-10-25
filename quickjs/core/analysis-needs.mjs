/* Capability-driven analysis needs and deterministic provider selection.
 *
 * Dairn Core decides WHAT evidence is needed and WHICH declared provider can
 * produce it at the required precision. It never embeds a language parser, never
 * installs tools and never calls a model here: every input is observed project
 * state, every output is a pure function of that state.
 *
 * Precision is a fixed ladder; a provider may not be used below the precision a
 * need requires. Gaps are explicit and machine readable instead of being skipped.
 */

export const CAPABILITIES = Object.freeze([
  'change.impact', 'symbol.definition', 'symbol.references', 'surface.api-diff',
  'contract.compatibility', 'dependency.impact', 'architecture.rules',
  'complexity.metrics', 'test.selection', 'test.quality', 'coverage.summary',
  'security.scan', 'performance.benchmark', 'reliability.checks',
]);

/* Coarse, ordered evidence precision. Higher rank is stronger evidence. */
export const PRECISION_LADDER = Object.freeze([
  'text', 'reported', 'heuristic', 'observed-static', 'syntax', 'semantic', 'contract',
]);

const CAPABILITY_INDEX = new Map(CAPABILITIES.map((name, index) => [name, index]));
const PRECISION_RANK = new Map(PRECISION_LADDER.map((name, index) => [name, index]));

/* Minimum precision a capability need requires unless a policy raises it. */
export const REQUIRED_PRECISION = Object.freeze({
  'change.impact': 'observed-static',
  'symbol.definition': 'observed-static',
  'symbol.references': 'semantic',
  'surface.api-diff': 'syntax',
  'contract.compatibility': 'semantic',
  'dependency.impact': 'observed-static',
  'architecture.rules': 'syntax',
  'complexity.metrics': 'syntax',
  'test.selection': 'observed-static',
  'test.quality': 'reported',
  'coverage.summary': 'reported',
  'security.scan': 'reported',
  'performance.benchmark': 'observed-static',
  'reliability.checks': 'syntax',
});

/* Quality Fitness objectives may require a capability as enforced evidence. */
export const QUALITY_ATTRIBUTE_CAPABILITY = Object.freeze({
  security: 'security.scan',
  coverage: 'coverage.summary',
  compatibility: 'surface.api-diff',
  test: 'test.quality',
  tests: 'test.quality',
  performance: 'performance.benchmark',
  reliability: 'reliability.checks',
  complexity: 'complexity.metrics',
  architecture: 'architecture.rules',
  dependency: 'dependency.impact',
  dependencies: 'dependency.impact',
  contract: 'contract.compatibility',
});

const METRIC_PREFIX_CAPABILITY = Object.freeze([
  ['security.', 'security.scan'],
  ['compatibility.', 'surface.api-diff'],
  ['coverage.', 'coverage.summary'],
  ['coverage', 'coverage.summary'],
  ['test.', 'test.quality'],
  ['complexity.', 'complexity.metrics'],
  ['quality.surface.', 'surface.api-diff'],
  ['architecture.', 'architecture.rules'],
  ['dependency.', 'dependency.impact'],
  ['performance.', 'performance.benchmark'],
  ['reliability.', 'reliability.checks'],
]);

const REFERENCE_INTENT = /(?:\b(?:call(?:ers?|s|ed)?|references?|usages?|who\s+uses|used\s+by|impact(?:ed)?|dependenc(?:y|ies)|downstream)\b|调用\s*方?|引用|谁(?:在)?用|使用方|影响面|依赖)/i;

export function precisionRank(name) {
  const rank = PRECISION_RANK.get(name);
  if (rank === undefined) throw Error('Unknown analysis precision: ' + name + ' (allowed: ' + PRECISION_LADDER.join('|') + ')');
  return rank;
}

export function isPrecision(name) { return PRECISION_RANK.has(name); }

export function isCapability(name) { return CAPABILITY_INDEX.has(name); }

export function assertCapability(name) {
  if (!isCapability(name)) throw Error('Unknown analysis capability: ' + name + ' (allowed: ' + CAPABILITIES.join('|') + ')');
  return name;
}

export function capabilityForQualityObjective(objective) {
  if (!objective || typeof objective !== 'object') return null;
  const attribute = typeof objective.attribute === 'string' ? objective.attribute.toLowerCase() : '';
  if (attribute && QUALITY_ATTRIBUTE_CAPABILITY[attribute]) return QUALITY_ATTRIBUTE_CAPABILITY[attribute];
  const metric = typeof objective.metric === 'string' ? objective.metric.toLowerCase() : '';
  for (const pair of METRIC_PREFIX_CAPABILITY) if (metric.startsWith(pair[0])) return pair[1];
  return null;
}

export function hasReferenceIntent(text) { return REFERENCE_INTENT.test(String(text || '')); }

function blankScope() { return {paths: [], modules: []}; }

function addScope(scope, paths, modules) {
  for (const path of paths || []) {
    if (typeof path === 'string' && path.length > 0 && scope.paths.length < 50 && !scope.paths.includes(path)) scope.paths.push(path);
  }
  for (const module of modules || []) {
    if (typeof module === 'string' && module.length > 0 && scope.modules.length < 20 && !scope.modules.includes(module)) scope.modules.push(module);
  }
}

function addReason(need, reason) {
  if (typeof reason !== 'string' || reason.length === 0) return;
  if (need.reasons.length < 12 && !need.reasons.includes(reason)) need.reasons.push(reason);
}

function ensureNeed(needs, capability, priority) {
  assertCapability(capability);
  const key = capability + '|' + priority;
  let need = needs.get(key);
  if (need) return need;
  need = {
    id: null,
    capability,
    required_precision: REQUIRED_PRECISION[capability],
    priority,
    scope: blankScope(),
    reasons: [],
  };
  needs.set(key, need);
  return need;
}

function requireNeed(needs, capability) {
  const required = needs.get(capability + '|required');
  if (required) return required;
  const advisory = needs.get(capability + '|advisory');
  if (advisory) needs.delete(capability + '|advisory');
  return ensureNeed(needs, capability, 'required');
}

/**
 * Derive ordered analysis needs from observed project state.
 * The result is a deterministic array; it never depends on wall-clock time,
 * the environment, or a model.
 */
export function deriveNeeds(signals = {}) {
  const needs = new Map();
  const change = signals.change && typeof signals.change === 'object' ? signals.change : null;
  const impacts = change && Array.isArray(change.impacts) ? change.impacts : [];
  const downstream = change && Array.isArray(change.downstream_modules) ? change.downstream_modules : [];
  const changedPaths = impacts.map(impact => impact.path);
  const changedModules = impacts.map(impact => impact.module).filter(Boolean);
  const anyChange = impacts.length > 0;
  const unbaselined = !!change && change.status === 'unbaselined';

  if (anyChange) {
    const need = requireNeed(needs, 'change.impact');
    addScope(need.scope, changedPaths, changedModules);
    addReason(need, 'changed-paths-observed');
  } else if (unbaselined) {
    const need = requireNeed(needs, 'change.impact');
    addReason(need, 'baseline-facts-unavailable');
  }

  const surfaceImpacts = impacts.filter(impact => impact.category === 'public-surface');
  const layoutImpacts = impacts.filter(impact => impact.category === 'source-layout');
  if (surfaceImpacts.length > 0) {
    const need = requireNeed(needs, 'surface.api-diff');
    addScope(need.scope, surfaceImpacts.map(impact => impact.path), surfaceImpacts.map(impact => impact.module));
    addReason(need, 'observed-public-surface-change');
  } else if (layoutImpacts.length > 0) {
    const need = ensureNeed(needs, 'surface.api-diff', 'advisory');
    addScope(need.scope, layoutImpacts.map(impact => impact.path), layoutImpacts.map(impact => impact.module));
    addReason(need, 'observed-source-layout-change');
  }

  if (downstream.length > 0) {
    const need = requireNeed(needs, 'contract.compatibility');
    addScope(need.scope, [], downstream);
    addReason(need, 'observed-downstream-dependents:' + downstream.length);
  }

  if (impacts.some(impact => impact.category === 'dependencies')) {
    const need = ensureNeed(needs, 'dependency.impact', 'advisory');
    addReason(need, 'observed-dependency-manifest-change');
  }
  if (impacts.some(impact => impact.category === 'spec')) {
    const need = ensureNeed(needs, 'architecture.rules', 'advisory');
    addReason(need, 'observed-spec-change');
  }
  if (anyChange) {
    const need = ensureNeed(needs, 'test.selection', 'advisory');
    addScope(need.scope, changedPaths, changedModules);
    addReason(need, 'changed-code-tests-unknown');
  }

  const symbols = Array.isArray(signals.symbols) ? signals.symbols : [];
  if (symbols.length > 0) {
    const need = requireNeed(needs, 'symbol.definition');
    addScope(need.scope, symbols.map(entry => entry.path), []);
    addReason(need, 'query-symbols:' + symbols.length);
    if (hasReferenceIntent(signals.query)) {
      const refs = requireNeed(needs, 'symbol.references');
      addScope(refs.scope, symbols.map(entry => entry.path), []);
      addReason(refs, 'reference-intent');
    }
  }

  const objectives = signals.goals && Array.isArray(signals.goals.objectives) ? signals.goals.objectives : [];
  for (const objective of objectives) {
    if (!objective || objective.enforcement !== 'required') continue;
    const capability = capabilityForQualityObjective(objective);
    if (!capability) continue;
    const need = requireNeed(needs, capability);
    addReason(need, 'quality-objective:' + String(objective.id));
  }

  const policy = signals.policy && typeof signals.policy === 'object' ? signals.policy : {};
  const observedSurface = surfaceImpacts.length > 0 || layoutImpacts.length > 0;
  for (const entry of Array.isArray(policy.required) ? policy.required : []) {
    if (!entry || !isCapability(entry.capability)) continue;
    const when = entry.when || 'always';
    if (when === 'change' && !anyChange && !unbaselined) continue;
    if (when === 'surface-change' && !observedSurface) continue;
    if (when === 'downstream-change' && downstream.length === 0) continue;
    const need = requireNeed(needs, entry.capability);
    if (entry.precision) need.required_precision = entry.precision;
    addReason(need, 'policy-required:' + when);
  }

  const only = signals.capabilityOnly || null;
  if (only) assertCapability(only);

  const ordered = [...needs.values()]
    .filter(need => !only || need.capability === only)
    .sort((a, b) => {
      const cap = CAPABILITY_INDEX.get(a.capability) - CAPABILITY_INDEX.get(b.capability);
      if (cap !== 0) return cap;
      if (a.priority !== b.priority) return a.priority === 'required' ? -1 : 1;
      return 0;
    });
  ordered.forEach((need, index) => {
    need.id = 'need-' + (index + 1);
    need.scope.paths.sort();
    need.scope.modules.sort();
  });
  return ordered;
}

function providerRank(provider, need) {
  const kind = provider.kind === 'builtin' ? 0 : 1;
  const auto = provider.auto_execute ? 0 : 1;
  const timeout = typeof provider.timeout_seconds === 'number' ? provider.timeout_seconds : 120;
  return [kind, auto, timeout, provider.id];
}

/**
 * Pick the strongest available provider for one need.
 * A provider that cannot reach the required precision is never chosen; the
 * returned gap says why. Import-mode analyzers are not on-demand providers.
 */
export function chooseProvider(need, providers) {
  const candidates = (providers || []).filter(provider =>
    Array.isArray(provider.capabilities) && provider.capabilities.includes(need.capability));
  if (candidates.length === 0) {
    return {provider: null, reason: 'NO_PROVIDER', detail: 'no declared provider for ' + need.capability};
  }
  const capable = candidates.filter(provider => precisionRank(provider.precision) >= precisionRank(need.required_precision));
  if (capable.length === 0) {
    const best = candidates.map(provider => provider.precision).sort((a, b) => precisionRank(b) - precisionRank(a))[0];
    return {
      provider: null,
      reason: 'PRECISION_INSUFFICIENT',
      detail: 'best available precision ' + best + ' < required ' + need.required_precision,
    };
  }
  capable.sort((a, b) => {
    const left = providerRank(a, need);
    const right = providerRank(b, need);
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] < right[index]) return -1;
      if (left[index] > right[index]) return 1;
    }
    return 0;
  });
  const provider = capable[0];
  return {
    provider,
    reason: 'matched',
    detail: provider.kind + ' provider ' + provider.id + ' at precision ' + provider.precision,
  };
}

export function describeProviders(providers) {
  return (providers || []).map(provider => ({
    id: provider.id,
    kind: provider.kind,
    mode: provider.mode || 'builtin',
    precision: provider.precision,
    capabilities: (provider.capabilities || []).slice(),
    auto_execute: !!provider.auto_execute,
  }));
}
