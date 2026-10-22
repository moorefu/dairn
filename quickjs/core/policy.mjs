/* Dairn QuickJS portable governance policy: no Node/Python imports. */
export const levels = ['L0', 'L1', 'L2'];
export const governance = ['G0', 'G1', 'G2', 'G3'];
export const minimumChecks = {L0:['lint'], L1:['lint','unit'], L2:['lint','unit','integration','build']};
export const profiles = ['openresty', 'java', 'spring-boot', 'vue', 'python', 'rust', 'go', 'generic'];
const n = /^[a-z][a-z0-9-]*$/;
export function invariant(b, msg) { if (!b) throw new Error(msg); }
export function relative(p, dot = false) {
  invariant(typeof p === 'string' && p.length && (p !== '.' || dot) && !p.startsWith('/') && !p.includes('\\') && !/^[A-Za-z]:/.test(p) && !p.split('/').some(x => x === '..' || x === ''), 'Unsafe relative path: ' + JSON.stringify(p));
  return p;
}
export function policyValidate(data) {
  const errors = [];
  const check = (b, err) => { if (!b) errors.push(err); };
  check(data && typeof data === 'object' && !Array.isArray(data) && data.schema_version === 1, 'schema_version must be 1');
  const mods = data?.modules;
  check(Array.isArray(mods) && mods.length > 0, 'modules must be a nonempty array');
  const names = new Set();
  if (Array.isArray(mods)) for (const [i, m] of mods.entries()) {
    const prefix = 'modules[' + i + ']';
    if (!m || typeof m !== 'object' || Array.isArray(m)) { errors.push(prefix + ' must be object'); continue; }
    check(typeof m.name === 'string' && n.test(m.name), prefix + '.name invalid');
    if (names.has(m.name)) errors.push(prefix + '.name duplicate');
    names.add(m.name);
    try { relative(m.path, true); } catch (e) { errors.push(prefix + '.path ' + e.message); }
    check(Array.isArray(m.profiles) && m.profiles.length > 0 && m.profiles.every(p => profiles.includes(p)), prefix + '.profiles invalid');
    const cs = m.checks;
    if (!cs || typeof cs !== 'object' || Array.isArray(cs) || !Object.keys(cs).length) { errors.push(prefix + '.checks missing'); continue; }
    for (const [k, cfg] of Object.entries(cs)) {
      check(n.test(k), prefix + '.checks invalid name ' + k);
      if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) { errors.push(prefix + '.checks.' + k + ' invalid'); continue; }
      check(Array.isArray(cfg.argv) && cfg.argv.length > 0 && cfg.argv.every(s => typeof s === 'string' && s.length > 0), prefix + '.checks.' + k + '.argv must be nonempty array');
      try { relative(cfg.cwd ?? m.path, true); } catch (e) { errors.push(prefix + '.checks.' + k + '.cwd ' + e.message); }
    }
  }
  check(data?.required_checks && typeof data.required_checks === 'object' && !Array.isArray(data.required_checks) && JSON.stringify(Object.keys(data.required_checks).sort()) === JSON.stringify(levels.slice().sort()), 'required_checks must contain L0,L1,L2 exactly');
  if (data?.required_checks) for (const level of levels) {
    const checks = data.required_checks[level];
    check(Array.isArray(checks) && checks.length > 0 && checks.every(s => typeof s === 'string' && s.length > 0), 'required_checks.' + level + ' invalid');
    if (Array.isArray(checks)) for (const required of minimumChecks[level])
      check(checks.includes(required), 'required_checks.'+level+' cannot omit built-in minimum: '+required);
  }
  return errors;
}
const riskHigh = /(?:^|[/_.-])(?:auth|security|permission|protocol|wire|migration|schema|transaction|payment|crypto|state.?machine|persistence|database|session|credential|access.?control)(?:[/_.-]|$)/i;
const govPrefixes = ['quickjs/', 'dairn/', 'scripts/', '.agents/skills/', '.github/workflows/', '.gitlab/', 'docs/specs/governance/', 'docs/specs/ci/'];
const dataPaths = ['.dairn/governance/changes/', '.dairn/governance/operations/', '.dairn/governance/evidence/', '.dairn/work/', '.dairn/facts/', '.dairn/cache/'];
export function isCritical(p) {
  return p.startsWith('.dairn/') && !dataPaths.some(x => p.startsWith(x)) ||
    ['AGENTS.md', 'Makefile', '.gitlab-ci.yml'].includes(p) || govPrefixes.some(x => p.startsWith(x));
}
export function classify(paths, readJsonIfExists = () => null) {
  let risk = 'L0', mode = 'G0'; const reasons = [];
  for (const p of paths) {
    if (isCritical(p)) { risk = 'L2'; mode = 'G2'; reasons.push('governance-critical:' + p); }
    else if (riskHigh.test(p) && !['docs/', '.agents/notes/', ...dataPaths].some(x => p.startsWith(x))) {
      risk = 'L2'; mode = 'G2'; reasons.push('high-risk-path:' + p);
    } else if (!(p.endsWith('.md') || ['docs/', '.agents/notes/', ...dataPaths].some(x => p.startsWith(x)))) {
      if (risk === 'L0') risk = 'L1'; if (mode === 'G0') mode = 'G1';
    }
  }
  for (const p of paths) {
    if (/^\.dairn\/governance\/operations\/incident\/INC-\d{8}-\d{3,}\.json$/.test(p)) {
      const incident = readJsonIfExists(p);
      if (incident && ['SEV1','SEV2'].includes(incident.severity)) { mode = 'G3'; reasons.push('major-incident:' + p); }
    }
  }
  return {risk, governance_mode: mode, risk_triggers: [...new Set(reasons)].sort()};
}
export function moduleSelection(policy, paths) {
  const globalChange = paths.some(p => p.startsWith('.dairn/') && !dataPaths.some(x => p.startsWith(x)) ||
    ['.agents/skills/', 'quickjs/', 'dairn/', 'scripts/', '.github/workflows/', '.gitlab/'].some(x => p.startsWith(x)) ||
    ['AGENTS.md', 'Makefile', '.gitlab-ci.yml'].includes(p));
  if (globalChange) return policy.modules;
  return policy.modules.filter(m => paths.some(p => m.path === '.' || p === m.path || p.startsWith(m.path.replace(/\/$/, '') + '/')));
}
export function manifestValidate(m, lower) {
  invariant(m && levels.includes(m.risk), 'Manifest risk invalid');
  invariant(typeof m.summary === 'string' && !!m.summary.trim(), 'Manifest summary required');
  invariant(typeof m.rationale === 'string' && !!m.rationale.trim(), 'Manifest rationale required');
  invariant(Array.isArray(m.verification) && !!m.verification.length, 'Manifest verification required');
  invariant(levels.indexOf(m.risk) >= levels.indexOf(lower.risk), 'Manifest risk cannot decrease detected floor: ' + lower.risk);
  invariant(!m.decision_note || (typeof m.decision_note === 'string' && m.decision_note.startsWith('.agents/notes/') && relative(m.decision_note)), 'Invalid decision_note');
  invariant(m.durable_decision !== true || !!m.decision_note, 'Durable decision requires decision_note');
  invariant(m.risk !== 'L2' || m.requires_human_approval === true, 'L2 requires_human_approval=true');
  invariant(!m.governance_mode || governance.includes(m.governance_mode), 'Invalid governance_mode');
  if (m.governance_mode) invariant(governance.indexOf(m.governance_mode) >= governance.indexOf(lower.governance_mode), 'governance_mode below floor');
  const implied = m.risk === 'L2' ? 'G2' : m.risk === 'L1' ? 'G1' : 'G0';
  return { ...m, source: 'manifest', governance_mode: [m.governance_mode || 'G0', lower.governance_mode, implied].sort((a,b)=>governance.indexOf(b)-governance.indexOf(a))[0],
    durable_decision: m.durable_decision ?? !!m.decision_note,
    risk_triggers: lower.risk_triggers, review_pending: m.risk === 'L2' };
}
export function requiresManifest(paths) {
  return paths.some(p => p.startsWith('.github/workflows/') || (!p.startsWith('docs/') && !p.startsWith('.github/') && !p.startsWith('.agents/notes/') && !p.startsWith('.dairn/governance/operations/') && !p.startsWith('.dairn/work/') && !p.startsWith('.dairn/facts/') && !p.endsWith('.md')));
}
