/* The single deterministic Governance Planner (consolidated plan §5/§7).
 * Given a trusted policy, a change and project context it synthesizes the
 * minimum sufficient assurance plan — requirements, executors, local/CI
 * phasing, advisory workflow and gaps — as `dairn.governance-plan.v1`.
 * Pure: no shell, no network, no work ledger; the only host dependency is
 * read-only Git access for the change scope. Plans are explanations of work
 * to be done, never claims that gates passed (§4.2). */
import {sha256} from './sha256.mjs';
import {classify, moduleSelection, manifestValidate, relative} from './policy.mjs';
import {resolvePolicy, requiredChecksFor, approvalPolicyFor} from './policy-resolver.mjs';
import {projectContextOf, readRefactorContracts, contractAppliesTo} from './project-context.mjs';

const RISK_ORDER = ['L0', 'L1', 'L2'];
/* Cheap-by-convention checks are offered for local fast feedback; everything
 * required still runs in CI. A module may override phasing via check config. */
const LOCAL_FAST_HINTS = ['lint', 'unit', 'test'];

function ok(value, message) { if (!value) throw Error('GovernancePlan: ' + message); }
function join(root, path) { return root.replace(/\/$/, '') + '/' + path; }
const maxRisk = (a, b) => RISK_ORDER.indexOf(a) >= RISK_ORDER.indexOf(b) ? a : b;

function git(h, root, args, timeout) {
  const result = h.run(['git', ...args], root, timeout);
  ok(!result.timedOut, 'git timed out: ' + args.join(' '));
  ok(result.code === 0, 'git failed: ' + args.join(' '));
  return String(result.output || '');
}

/* Deterministic canonical serialization for plan identity: sorted keys, no
 * whitespace, LF — the hash lives OUTSIDE the plan (envelope), so it never
 * references itself (§5.5). */
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}

/* Minimal read-only scope: changed paths base..head, policy classification and
 * an optional change manifest. CI PR metadata belongs to the enforcing check,
 * not to an explanation-only plan (§5.2 step 2 keeps the conservative floor). */
export function scopeFor(h, root, policyJson, {base, head = 'HEAD', timeout = 30} = {}) {
  const headSha = git(h, root, ['rev-parse', '--verify', head + '^{commit}'], timeout).trim();
  const treeSha = git(h, root, ['rev-parse', head + '^{tree}'], timeout).trim();
  const baseSha = base ? git(h, root, ['rev-parse', '--verify', base + '^{commit}'], timeout).trim() : null;
  const paths = baseSha
    ? git(h, root, ['diff', '--name-only', '-z', '--diff-filter=ACDMRT', baseSha, headSha], timeout).split('\0').filter(Boolean)
    : [];
  for (const p of paths) relative(p);
  const floor = classify(paths, p => {
    try { return JSON.parse(h.read(join(root, p))); } catch (_) { return null; }
  });
  const manifests = paths.filter(p => /^\.dairn\/governance\/changes\/[a-z0-9][a-z0-9-]*\.json$/.test(p));
  ok(manifests.length <= 1, 'Multiple change manifests found');
  let meta = {source: 'git-local-or-branch', ...floor};
  if (manifests.length) meta = manifestValidate(JSON.parse(h.read(join(root, manifests[0]))), floor);
  return {paths, modules: moduleSelection(policyJson, paths), risk: meta.risk,
    governance_mode: meta.governance_mode, triggers: meta.risk_triggers || [],
    record_source: meta.source, base: baseSha, head: headSha, tree: treeSha};
}

export function planGovernance({trustedPolicy, projectContext, change, refactorContracts = []}) {
  ok(trustedPolicy && typeof trustedPolicy === 'object', 'trustedPolicy required');
  ok(change && Array.isArray(change.paths), 'change with paths required');
  const policy = resolvePolicy(trustedPolicy);
  ok(policy, 'trusted policy missing or invalid');
  const context = projectContext || {modules: []};
  /* 1. Conservative risk floor: the trusted policy's view of the change can
   *    only raise what the caller reports, never lower it (T06). */
  const floor = change.risk_floor || change.risk || 'L0';
  const declared = maxRisk(floor, change.risk || floor);
  const reasons = [...(change.triggers || []).map(rule => ({rule, source: 'trusted-policy'}))];
  const risk = maxRisk(declared, 'L0');
  ok(RISK_ORDER.includes(risk), 'invalid risk: ' + risk);
  let effectiveRisk = risk;
  /* 2. Project context may only add requirements: high-criticality modules
   *    lift the effective risk to at least L1 (§5.1 — context never weakens). */
  const moduleCriticality = new Map((context.modules || []).map(m => [m.name, m]));
  for (const module of change.modules || []) {
    const info = moduleCriticality.get(module.name);
    if (info?.criticality === 'high') {
      if (RISK_ORDER.indexOf(effectiveRisk) < RISK_ORDER.indexOf('L1')) {
        effectiveRisk = 'L1';
        reasons.push({rule: 'module-criticality:' + module.name, source: 'project-context'});
      }
    }
  }
  /* 3. Approved refactor contracts covering this change append their required
   *    contract checks; a refactor intent never downgrades risk (§13.4). */
  const appliedContracts = (refactorContracts || []).filter(c => contractAppliesTo(c, change.paths));
  /* 4. Requirements: (module × required check) for the effective risk, plus
   *    contract requirements — exact pairing, no cross-module coverage (T34). */
  const requiredIds = requiredChecksFor(policy, effectiveRisk);
  const requirements = [];
  for (const module of change.modules || []) for (const id of requiredIds)
    requirements.push({id: module.name + '.' + id, module_id: module.name, check_id: id, required: true,
      origin: 'risk-' + effectiveRisk});
  for (const contract of appliedContracts)
    for (const id of contract.baseline.contracts)
      requirements.push({id: contract.id + '.' + id, module_id: null, check_id: id, required: true,
        origin: 'approved-refactor-contract:' + contract.id, refactor: contract.id});
  /* 5. Executors from the module's own check configurations; a missing argv is
   *    a capability GAP, never a silently dropped requirement (T08). */
  const executors = [];
  const gaps = [];
  const configured = (module, id) => module?.checks?.[id] && Array.isArray(module.checks[id].argv) ? module.checks[id] : null;
  for (const req of requirements) {
    if (req.module_id === null) continue;
    const module = (change.modules || []).find(m => m.name === req.module_id);
    const cfg = configured(module, req.check_id);
    if (!cfg) {
      gaps.push({kind: 'MISSING_CAPABILITY', module_id: req.module_id, check_id: req.check_id,
        reason: 'no executor configured in project.json for ' + req.module_id + ':' + req.check_id});
      continue;
    }
    const phase = typeof cfg.phase === 'string' && ['local-and-ci', 'ci-required', 'local-only'].includes(cfg.phase)
      ? cfg.phase : null;
    const fast = phase ? phase.includes('local') : LOCAL_FAST_HINTS.includes(req.check_id);
    executors.push({module_id: req.module_id, check_id: req.check_id,
      implementation_digest: sha256(canonical(cfg.argv)), phase: phase || (fast ? 'local-and-ci' : 'ci-required')});
  }
  /* 6. Execution split: local fast feedback is advisory speed; CI required is
   *    the complete assurance set — deferred-to-ci is never "passed". */
  const localFast = executors.filter(x => x.phase.includes('local')).map(x => x.module_id + '.' + x.check_id);
  const ciRequired = [...requirements.filter(x => x.required).map(x => x.id)];
  const approvals = [];
  const approvalPolicy = approvalPolicyFor(policy, effectiveRisk);
  const approvalNeeded = approvalPolicy.required !== false || Number(approvalPolicy.min_count || 0) > 0;
  if (approvalNeeded)
    approvals.push({authority: 'scm-native', natural_person: true, required: true,
      origin: 'risk-' + effectiveRisk});
  /* 7. Advisory workflow: suggestions only, zero items is valid (§0 principle 1). */
  const advisory = effectiveRisk === 'L2' ? ['specify', 'implement', 'review']
    : effectiveRisk === 'L1' ? ['implement', 'review'] : [];
  for (const contract of appliedContracts) advisory.push('refactor:' + contract.id);
  const plan = {
    schema: 'dairn.governance-plan.v1',
    subject: change.subject || null,
    /* The plan binds the change scope it was computed for (§5.5): the same
     * requirement set is never reusable for a different set of paths. */
    change_paths: [...change.paths].sort(),
    authority: {policy_sha256: change.policy_sha256 || null, runtime_sha256: change.runtime_sha256 || null,
      source: change.authority_source || 'protected-base'},
    classification: {intent: change.intent || null, risk_floor: floor, effective_risk: effectiveRisk,
      governance_mode: change.governance_mode || null, impact_confidence: change.impact_confidence || 'partial',
      reasons: [...new Map(reasons.map(r => [r.rule + '|' + r.source, r])).values()]},
    requirements, executors, approvals,
    execution: {local_fast: [...new Set(localFast)], ci_required: ciRequired},
    advisory_workflow: [...new Set(advisory)],
    work_required: false,
    gaps,
    status: gaps.length ? 'missing-capability' : 'ready-to-execute',
  };
  /* ready-to-execute only means dispatch is arranged — results live in runs. */
  return {plan, plan_sha256: sha256('dairn.governance-plan.v1\n' + canonical(plan))};
}

/* Host-bound entry: read the trusted policy, scope the change and plan. */
export function planForChange(h, root, {base, head = 'HEAD', timeout = 30, policyJson = null, policyRaw = null} = {}) {
  const raw = policyRaw ?? h.read(join(root, '.dairn/governance/project.json'));
  const policyJsonValue = policyJson ?? JSON.parse(raw);
  const scope = scopeFor(h, root, policyJsonValue, {base, head, timeout});
  const context = projectContextOf(policyJsonValue);
  const contracts = readRefactorContracts(h, root);
  const subject = {schema: 'dairn.subject.v1', repository: change_repository(h, root, timeout), kind: 'git-commit',
    source_commit: scope.head, tree_sha: scope.tree, base_commit: scope.base, comparison: 'base-to-source'};
  return planGovernance({trustedPolicy: policyJsonValue, projectContext: context,
    change: {paths: scope.paths, modules: scope.modules, risk: scope.risk, risk_floor: scope.risk,
      governance_mode: scope.governance_mode, triggers: scope.triggers, subject,
      policy_sha256: sha256(raw), authority_source: 'project-config'},
    refactorContracts: contracts});
}

function change_repository(h, root, timeout) {
  const probe = h.run(['git', 'config', '--get', 'remote.origin.url'], root, Math.min(timeout, 30));
  if (!probe.timedOut && probe.code === 0 && probe.output) {
    const value = probe.output.trim().replace(/\.git$/, '');
    const match = /^(?:https?:\/\/|ssh:\/\/|git@)(?:[^/:]+[/:])?(.+)$/.exec(value);
    return match ? match[1] : value;
  }
  return 'local/repository';
}
