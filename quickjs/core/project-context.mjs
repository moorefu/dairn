/* Project context (consolidated plan §4.1/§6.1): module lifecycle, criticality
 * and compatibility declarations read from project.json, plus approved refactor
 * contracts. These are ADVISORY inputs to the planner — they may only ADD
 * assurance requirements, never weaken the trusted policy floor. Invalid
 * declarations fail loudly instead of silently degrading. */

const CRITICALITY = ['low', 'medium', 'high'];
const LIFECYCLE = ['experimental', 'active-development', 'stabilizing', 'production', 'maintenance', 'retiring'];
const COMPATIBILITY = ['loose', 'normal', 'strict'];

function ok(value, message) { if (!value) throw Error('ProjectContext: ' + message); }

export function projectContextOf(policyJson) {
  ok(policyJson && typeof policyJson === 'object', 'policy required');
  const modules = [];
  for (const m of policyJson.modules || []) {
    const name = m?.name;
    ok(typeof name === 'string' && name.length > 0, 'module name required');
    const pick = (value, allowed, field) => {
      if (value === undefined || value === null) return null;
      ok(allowed.includes(value), 'module ' + name + ' ' + field + ' invalid: ' + JSON.stringify(value) +
        ' (expected ' + allowed.join('|') + ')');
      return value;
    };
    modules.push({name,
      criticality: pick(m.criticality, CRITICALITY, 'criticality'),
      lifecycle: pick(m.lifecycle, LIFECYCLE, 'lifecycle'),
      compatibility: pick(m.compatibility, COMPATIBILITY, 'compatibility')});
  }
  return {modules};
}

export function validateRefactorContract(contract, label = 'contract') {
  ok(contract && contract.schema === 'dairn.refactor.v1', label + ': schema must be dairn.refactor.v1');
  ok(typeof contract.id === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(contract.id), label + ': id must be kebab-case');
  ok(['behavior-preserving', 'behavior-evolving', 'migration'].includes(contract.intent), label + ': intent invalid');
  ok(contract.baseline && typeof contract.baseline.source_commit === 'string', label + ': baseline.source_commit required');
  ok(Array.isArray(contract.baseline.contracts) && contract.baseline.contracts.length > 0, label + ': baseline.contracts required');
  ok(contract.target && typeof contract.target === 'object', label + ': target required');
  ok(contract.migration && ['incremental', 'big-bang'].includes(contract.migration.strategy), label + ': migration.strategy invalid');
  ok(Array.isArray((contract.debt || {}).allowed_transitional_items), label + ': debt.allowed_transitional_items must be array');
  ok(Array.isArray((contract.debt || {}).known_failures), label + ': debt.known_failures must be array');
  for (const failure of (contract.debt || {}).known_failures || []) {
    ok(failure && typeof failure.check_id === 'string' && /^[0-9a-f]{16,64}$/.test(String(failure.signature || '')),
      label + ': known failure needs check_id + signature digest');
  }
  ok(contract.paths === undefined || (Array.isArray(contract.paths) && contract.paths.length > 0), label + ': paths must be a nonempty array when present');
  return contract;
}

/* Approved refactor contracts live in .dairn/governance/refactors/<id>.json
 * (§13.2). Reading is tolerant of an absent directory; a malformed contract
 * fails loudly — a broken contract must never silently drop its guarantees. */
export function readRefactorContracts(h, root) {
  const dir = root.replace(/\/$/, '') + '/.dairn/governance/refactors';
  if (!h.exists(dir)) return [];
  const contracts = [];
  for (const name of h.list(dir) || []) {
    if (!name.endsWith('.json')) continue;
    const path = dir + '/' + name;
    ok(!h.isSymlink(path), 'refuse symlinked refactor contract: ' + name);
    const contract = validateRefactorContract(JSON.parse(h.read(path)), name);
    contracts.push(contract);
  }
  return contracts;
}

export function contractAppliesTo(contract, paths) {
  if (!Array.isArray(contract.paths) || !contract.paths.length) return false;
  const prefixes = contract.paths.map(x => String(x).replace(/\/$/, ''));
  return paths.some(p => prefixes.some(prefix =>
    p === prefix || p.startsWith(prefix + '/') || prefix === '.'));
}
