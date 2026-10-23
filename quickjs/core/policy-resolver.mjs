/* dairn.policy.v1 schema validation and normalization.
 * The first-release protocol policy is declarative (architecture §10.1):
 * risk levels with a floor that can only be raised, per-level required checks,
 * per-level approval rules and evidence store settings. Legacy schema_version 1
 * project policies resolve into the same read-only view so gate/attestation
 * consume one shape; the legacy engine keeps its own classifier. */
const LEVELS = ['L0', 'L1', 'L2'];
function isNonEmptyStringArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every(x => typeof x === 'string' && x.length > 0);
}
export function validatePolicyV1(policy) {
  const errors = [];
  const check = (value, message) => { if (!value) errors.push(message); };
  check(policy?.schema === 'dairn.policy.v1', 'schema must be dairn.policy.v1');
  check(Array.isArray(policy?.risk?.levels) && policy.risk.levels.every(l => LEVELS.includes(l)) && policy.risk.levels.length > 0,
    'risk.levels must be a nonempty subset of ' + LEVELS.join('|'));
  check(LEVELS.includes(policy?.risk?.default), 'risk.default invalid');
  if (policy?.risk?.critical_paths !== undefined && policy.risk.critical_paths !== null)
    check(isNonEmptyStringArray(policy.risk.critical_paths), 'risk.critical_paths must be string[]');
  check(policy?.checks && typeof policy.checks === 'object' && !Array.isArray(policy.checks), 'checks map required');
  if (policy?.checks) for (const [level, list] of Object.entries(policy.checks)) {
    check(LEVELS.includes(level), 'unknown check level: ' + level);
    check(isNonEmptyStringArray(list), 'checks.' + level + ' must be a nonempty string array');
  }
  if (policy?.approvals !== undefined) {
    check(typeof policy.approvals === 'object' && !Array.isArray(policy.approvals), 'approvals must be object');
    for (const [level, rule] of Object.entries(policy.approvals || {})) {
      if (level === 'required') continue; // flat flag used by gate pre-merge default
      check(LEVELS.includes(level), 'unknown approval level: ' + level);
      check(rule && typeof rule === 'object', 'approvals.' + level + ' must be object');
      if (rule?.min_count !== undefined) check(Number.isInteger(rule.min_count) && rule.min_count >= 0, 'approvals.' + level + '.min_count invalid');
      if (rule?.provider !== undefined) check(rule.provider === 'scm-native', 'approvals.' + level + '.provider must be scm-native');
    }
  }
  if (policy?.modules !== undefined) {
    check(Array.isArray(policy.modules), 'modules must be array');
    for (const m of policy.modules || []) {
      check(typeof m?.name === 'string' && m.name.length > 0, 'module name required');
      for (const [id, cfg] of Object.entries(m?.checks || {})) {
        check(Array.isArray(cfg?.argv) && cfg.argv.length > 0 && cfg.argv.every(x => typeof x === 'string'),
          'module ' + m.name + ' check ' + id + ' argv must be string[]');
        if (cfg?.timeout !== undefined) check(Number.isFinite(cfg.timeout) && cfg.timeout > 0, 'module check timeout invalid');
      }
    }
  }
  if (policy?.work !== undefined) check(policy.work.required_for_ci === false, 'work.required_for_ci must be false (work never gates CI)');
  if (policy?.evidence !== undefined) {
    check(policy.evidence.store === 'git-ref', 'evidence.store must be git-ref');
    check(typeof policy.evidence.ref === 'string' && policy.evidence.ref.startsWith('refs/'), 'evidence.ref must be a git ref');
  }
  return errors;
}
/* Normalize legacy schema_version 1 project policies into the v1 read view.
 * Legacy risk classification stays with the legacy engine; the resolved view
 * marks it so no consumer mistakes the absence of critical_paths for "no
 * critical paths exist". */
export function resolvePolicy(policy) {
  if (!policy || typeof policy !== 'object') return null;
  if (policy.schema === 'dairn.policy.v1') return policy;
  if (policy.schema_version === 1 && policy.required_checks) {
    const checks = {};
    for (const level of LEVELS) if (Array.isArray(policy.required_checks[level])) checks[level] = [...policy.required_checks[level]];
    return {schema:'dairn.policy.v1', _resolved_from:'legacy-schema-1',
      risk:{levels:[...LEVELS], default:'L1', critical_paths:null,
        note:'legacy policy: risk floor enforced by the legacy classifier in policy.mjs'},
      checks, approvals:{}, work:{required_for_ci:false},
      evidence:{store:'git-ref', ref:'refs/heads/dairn-evidence', immutable_records:true},
      modules:policy.modules || []};
  }
  return null;
}
export function requiredChecksFor(policy, risk) {
  const resolved = resolvePolicy(policy) || {};
  const list = resolved.checks?.[risk];
  if (!isNonEmptyStringArray(list)) throw Error('policy has no required checks for risk ' + risk);
  return [...list];
}
/* Approval rule lookup: per-risk first (v1), flat fallback (legacy/gate default). */
export function approvalPolicyFor(policy, risk = 'L2') {
  const resolved = resolvePolicy(policy) || (policy && typeof policy === 'object' ? policy : {});
  const approvals = resolved.approvals || {};
  if (approvals[risk] && typeof approvals[risk] === 'object') return approvals[risk];
  const flat = {};
  for (const key of ['required','min_count','natural_person','independent','provider','rules_required'])
    if (approvals[key] !== undefined) flat[key] = approvals[key];
  return flat;
}
