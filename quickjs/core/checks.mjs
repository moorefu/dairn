/* Independent Check Plan -> execution -> Run Evidence implementation. */
import {sha256} from './sha256.mjs';
import {subjectFromGit} from './subject.mjs';
import {captureWorktree, sameWorktree} from './worktree.mjs';
import {createCheckRun, writeRunEvidence} from './evidence.mjs';

function ok(value, message) { if (!value) throw Error('Check: ' + message); }
function join(root, path) { return root.replace(/\/$/, '') + '/' + path; }
function policyChecks(policy, risk = 'L1') {
  const values = policy?.required_checks?.[risk] || policy?.checks?.[risk] || [];
  ok(Array.isArray(values) && values.length > 0, 'trusted policy has no required checks for ' + risk);
  return [...values];
}
function runOne(h, root, module, id, timeout) {
  const cfg = module?.checks?.[id];
  if (!cfg || !Array.isArray(cfg.argv)) return {id, module:module?.name || null, status:'missing', exit_code:null, argv:null};
  const cwd = join(root, cfg.cwd || module.path || '.');
  const result = h.run(cfg.argv, cwd, timeout);
  return {id, module:module.name, status:result.timedOut ? 'timeout' : result.code === 0 ? 'passed' : 'failed',
    exit_code:result.code, argv:cfg.argv, cwd:cfg.cwd || module.path || '.', duration_sec:result.duration_sec,
    log_sha256:sha256(result.output || ''), reason:result.code === 0 ? null : String(result.output || '').slice(0, 1024)};
}
export function checkPlan(policy, modules, risk = 'L1') {
  const required = policyChecks(policy, risk);
  return {schema:'dairn.check-plan.v1', risk, required_checks:required,
    modules:(modules || policy.modules || []).map(x => ({name:x.name, path:x.path, checks:required}))};
}
export function runChecks(h, root, {policy, modules = null, risk = 'L1', base = null, timeout = 120,
  environment = 'local', input_globs = [], write = true, repository = null, change = null} = {}) {
  ok(policy && typeof policy === 'object', 'policy required');
  const selected = modules || policy.modules || [];
  const plan = checkPlan(policy, selected, risk);
  const subject = subjectFromGit(h, root, {base, repository, change, timeout});
  const before = captureWorktree(h, root, timeout, [], {input_globs});
  const checks = [];
  for (const module of selected) for (const id of plan.required_checks) checks.push(runOne(h, root, module, id, timeout));
  const after = captureWorktree(h, root, timeout, [], {input_globs});
  const stable = sameWorktree(before, after) && before.source_commit === after.source_commit;
  const status = stable ? (checks.length > 0 && checks.every(x => x.status === 'passed' && x.exit_code === 0) ? 'passed' : 'failed') : 'invalidated';
  const execution = {environment, runtime_sha256:null, policy_sha256:sha256(JSON.stringify(policy)),
    check_plan_sha256:sha256(JSON.stringify(plan)), toolchain_sha256:null,
    snapshot_before_sha256:before.snapshot_sha256, snapshot_after_sha256:after.snapshot_sha256,
    input_coverage:before.input_coverage, uncovered_inputs:before.uncovered_inputs};
  const run = createCheckRun({subject, execution, required_checks:plan.required_checks, checks,
    status, declared_assurance:environment === 'ci' ? 'ci-verified' : 'local-observed', now:h.now()});
  if (write) {
    h.mkdirs(join(root, '.dairn/governance/evidence/runs/' + subject.source_commit + '/' + run.run_id));
    const rel = '.dairn/governance/evidence/runs/' + subject.source_commit + '/' + run.run_id + '/run.json';
    return {...run, evidence_ref:writeRunEvidence(h, root, run, {path:rel})};
  }
  return run;
}
