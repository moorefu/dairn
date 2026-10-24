/* Project-declared execution policy for capability-driven analysis.
 *
 * Trusted policy decides what Dairn is allowed to run on its own. Analyzers can
 * never lower a governance requirement: this file only lists read-only providers
 * that may be auto-executed under a bounded timeout, plus optional required
 * capabilities. Unknown keys fail closed so a typo cannot silently disable a
 * requirement.
 */
import {CAPABILITIES, PRECISION_LADDER, REQUIRED_PRECISION, assertCapability, isPrecision, precisionRank} from './analysis-needs.mjs';

export const ANALYSIS_POLICY_SCHEMA = 'dairn.analysis-policy.v1';
export const ANALYSIS_POLICY_PATH = '.dairn/governance/analysis.json';
const POLICY_KEYS = ['schema', 'auto_execute', 'max_timeout_seconds', 'reuse', 'required'];
const REQUIRED_KEYS = ['capability', 'when', 'precision'];
const WHEN_VALUES = ['always', 'change', 'surface-change', 'downstream-change'];
const ANALYZER_ID = /^[a-z][a-z0-9-]{1,48}$/;

function assert(condition, message) { if (!condition) throw Error('Analysis policy: ' + message); }

export function defaultAnalysisPolicy() {
  return {
    schema: ANALYSIS_POLICY_SCHEMA,
    source: 'default',
    path: null,
    auto_execute: [],
    max_timeout_seconds: 120,
    reuse: true,
    required: [],
  };
}

export function validateAnalysisPolicy(doc) {
  assert(doc && typeof doc === 'object' && !Array.isArray(doc), 'must be a JSON object');
  for (const key of Object.keys(doc)) {
    assert(POLICY_KEYS.includes(key), 'unknown key ' + JSON.stringify(key) + ' (allowed: ' + POLICY_KEYS.join(', ') + ')');
  }
  assert(doc.schema === ANALYSIS_POLICY_SCHEMA, 'schema must be ' + JSON.stringify(ANALYSIS_POLICY_SCHEMA));
  const auto = doc.auto_execute === undefined ? [] : doc.auto_execute;
  assert(Array.isArray(auto) && auto.length <= 24, 'auto_execute must be an array of at most 24 analyzer ids');
  const seen = new Set();
  for (const id of auto) {
    assert(typeof id === 'string' && ANALYZER_ID.test(id), 'invalid analyzer id in auto_execute: ' + JSON.stringify(id));
    assert(!seen.has(id), 'duplicate analyzer id in auto_execute: ' + id);
    seen.add(id);
  }
  const maxTimeout = doc.max_timeout_seconds === undefined ? 120 : doc.max_timeout_seconds;
  assert(Number.isInteger(maxTimeout) && maxTimeout >= 1 && maxTimeout <= 300, 'max_timeout_seconds must be an integer between 1 and 300');
  const reuse = doc.reuse === undefined ? true : doc.reuse;
  assert(typeof reuse === 'boolean', 'reuse must be a boolean');
  const required = doc.required === undefined ? [] : doc.required;
  assert(Array.isArray(required) && required.length <= 16, 'required must be an array of at most 16 entries');
  const requiredSeen = new Set();
  for (const entry of required) {
    assert(entry && typeof entry === 'object' && !Array.isArray(entry), 'required entries must be objects');
    for (const key of Object.keys(entry)) {
      assert(REQUIRED_KEYS.includes(key), 'unknown key ' + JSON.stringify(key) + ' in required entry (allowed: ' + REQUIRED_KEYS.join(', ') + ')');
    }
    assert(typeof entry.capability === 'string', 'required entry needs a capability');
    assertCapability(entry.capability);
    assert(typeof entry.when === 'string' && WHEN_VALUES.includes(entry.when), 'required entry when must be one of ' + WHEN_VALUES.join('|'));
    if (entry.precision !== undefined) {
      assert(isPrecision(entry.precision), 'unknown precision ' + JSON.stringify(entry.precision) + ' (allowed: ' + PRECISION_LADDER.join('|') + ')');
      assert(precisionRank(entry.precision) >= precisionRank(REQUIRED_PRECISION[entry.capability]),
        'required precision for ' + entry.capability + ' may only raise the default ' + REQUIRED_PRECISION[entry.capability]);
    }
    const key = entry.capability + '|' + entry.when;
    assert(!requiredSeen.has(key), 'duplicate required entry for ' + entry.capability + ' when=' + entry.when);
    requiredSeen.add(key);
  }
  return doc;
}

export function parseAnalysisPolicy(raw, source = 'project') {
  let doc;
  try { doc = JSON.parse(raw); } catch (error) { throw Error('Analysis policy: invalid JSON in ' + ANALYSIS_POLICY_PATH + ': ' + error.message); }
  validateAnalysisPolicy(doc);
  return {
    schema: ANALYSIS_POLICY_SCHEMA,
    source,
    path: source === 'project' ? ANALYSIS_POLICY_PATH : null,
    auto_execute: (doc.auto_execute || []).slice(),
    max_timeout_seconds: doc.max_timeout_seconds === undefined ? 120 : doc.max_timeout_seconds,
    reuse: doc.reuse === undefined ? true : doc.reuse,
    required: (doc.required || []).map(entry => Object.assign({}, entry)),
  };
}

function at(directory, name) { return directory.replace(/\/$/, '') + '/' + name; }

function assertNoSymlink(h, root, relative) {
  let current = root;
  for (const part of relative.split('/')) {
    current = at(current, part);
    assert(!h.isSymlink(current), 'symlinked path ' + relative);
  }
}

export function loadAnalysisPolicy(h, root) {
  const path = at(root, ANALYSIS_POLICY_PATH);
  if (!h.exists(path)) return defaultAnalysisPolicy();
  assertNoSymlink(h, root, ANALYSIS_POLICY_PATH);
  return parseAnalysisPolicy(h.read(path), 'project');
}

export const ANALYSIS_CAPABILITIES = CAPABILITIES;
