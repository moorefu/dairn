/* 治理计划/能力/重构/反馈原生单测（统一方案 §5/§12/§13/§15）：
 * GOV（Planner 确定性与不降级）/ CAP（能力分级）/ RFB（债务基线与阶段关闭）/
 * FBK（有证据的建议与样本不足）。全部纯语义，不触网、不跑耗时检查。 */
import * as os from 'os';
import * as std from 'std';
import {host as realHost} from '../host/qjs.mjs';
import {planGovernance} from '../core/governance-plan.mjs';
import {projectContextOf, validateRefactorContract, readRefactorContracts} from '../core/project-context.mjs';
import {assessCapabilities} from '../core/capabilities.mjs';
import {compareDebt, verifyExitConditions} from '../core/refactor.mjs';
import {recommendAdaptations} from '../core/governance-feedback.mjs';
import {sha256} from '../core/sha256.mjs';

const base = (std.getenv('TMPDIR') || std.getenv('TEMP') || std.getenv('TMP') || realHost.cwd()).replace(/\\/g, '/') + '/dairn-gov-' + os.getpid() + '-' + Date.now();
realHost.mkdirs(base);
const tests = [];
let failures = 0;
function test(label, fn) {
  try { fn(); tests.push({name: label, status: 'passed'}); print('PASS ' + label); }
  catch (error) { failures++; tests.push({name: label, status: 'failed', reason: String(error)}); std.err.puts('FAIL ' + label + ': ' + String(error) + '\n'); }
}
function assert(okCond, why) { if (!okCond) throw new Error(why); }
function workdir(name) { const dir = base + '/' + name; realHost.mkdirs(dir); return dir; }

/* ---- fixtures ---- */
const checks = ids => Object.fromEntries(ids.map(id => [id, {argv: ['echo', id]}]));
const POLICY = {schema_version: 1, project: 'svc', modules: [
    {name: 'app', path: '.', checks: checks(['lint', 'unit', 'integration', 'build'])},
    {name: 'lib', path: 'lib', checks: checks(['lint', 'unit'])}],
  required_checks: {L0: ['lint'], L1: ['lint', 'unit'], L2: ['lint', 'unit', 'integration', 'build']}};
const ctx = projectContextOf(POLICY);
const change = (paths, modules, risk, extra = {}) => ({paths, modules, risk, risk_floor: risk,
  governance_mode: 'G1', triggers: [], ...extra});

test('GOV-01 an L0 docs change plans the minimum with zero ceremony', () => {
  const {plan} = planGovernance({trustedPolicy: POLICY, projectContext: ctx,
    change: change(['docs/readme.md'], POLICY.modules, 'L0')});
  assert(plan.schema === 'dairn.governance-plan.v1', 'schema wrong');
  assert(plan.requirements.length === 2 && plan.requirements.every(r => r.check_id === 'lint'), 'L0 must require lint only: ' + JSON.stringify(plan.requirements));
  assert(plan.advisory_workflow.length === 0, 'L0 must not force ceremony');
  assert(plan.work_required === false, 'work must never be required');
  /* Approval defaults conservative (same formula as the gate): a policy that
   * is silent on approvals still gets scm-native listed, never dropped. */
  assert(plan.human_approval==='delegated-to-scm'&&plan.approvals===undefined,'审批委托缺失');
});

test('GOV-02 an L2 critical change plans the full matrix and scm-native approval', () => {
  const {plan} = planGovernance({trustedPolicy: POLICY, projectContext: ctx,
    change: change(['quickjs/core/engine.mjs'], POLICY.modules, 'L2', {triggers: ['governance-critical:quickjs/core/engine.mjs']})});
  assert(plan.classification.effective_risk === 'L2', 'risk wrong');
  assert(plan.requirements.length === 8, 'full matrix over 2 modules: ' + plan.requirements.length);
  assert(plan.human_approval==='delegated-to-scm'&&plan.merge_eligibility==='not-evaluated','审批委托或范围错误');
  assert(JSON.stringify(plan.advisory_workflow) === JSON.stringify(['specify', 'implement', 'review']), 'advisory wrong');
});

test('GOV-03/T06 a caller cannot lower the trusted risk floor', () => {
  const {plan} = planGovernance({trustedPolicy: POLICY, projectContext: ctx,
    change: {paths: ['ci/protected/build.sh'], modules: POLICY.modules, risk: 'L0', risk_floor: 'L2'}});
  assert(plan.classification.effective_risk === 'L2' && plan.classification.risk_floor === 'L2', 'floor lowered');
  assert(plan.requirements.some(r => r.check_id === 'integration'), 'L2 checks missing');
});

test('GOV-04/T21 high-criticality modules add assurance; experimental ones do not relax it', () => {
  const withCriticality = {schema_version: 1, project: 'svc', modules: [
      {name: 'app', path: '.', criticality: 'high', checks: checks(['lint', 'unit', 'integration', 'build'])},
      {name: 'lib', path: 'lib', criticality: 'low', lifecycle: 'experimental', checks: checks(['lint', 'unit'])}],
    required_checks: POLICY.required_checks};
  const context = projectContextOf(withCriticality);
  const {plan} = planGovernance({trustedPolicy: withCriticality, projectContext: context,
    change: change(['lib/util.js'], [withCriticality.modules[1]], 'L0')});
  assert(plan.classification.effective_risk === 'L0', 'experimental module must not raise risk');
  const raised = planGovernance({trustedPolicy: withCriticality, projectContext: context,
    change: change(['index.js'], [withCriticality.modules[0]], 'L0')});
  assert(raised.plan.classification.effective_risk === 'L1', 'high-criticality module must raise the floor to L1');
  assert(raised.plan.classification.reasons.some(r => r.rule.startsWith('module-criticality:')), 'reason chain missing');
});

test('GOV-05/T08 a missing executor is a capability gap, never a dropped requirement', () => {
  const sparse = {schema_version: 1, project: 'svc', modules: [{name: 'app', path: '.', checks: checks(['lint', 'unit'])}],
    required_checks: POLICY.required_checks};
  const {plan} = planGovernance({trustedPolicy: sparse, projectContext: projectContextOf(sparse),
    change: change(['src/main.go'], sparse.modules, 'L2')});
  assert(plan.gaps.length === 2 && plan.gaps.every(g => g.kind === 'MISSING_CAPABILITY'), 'gaps wrong: ' + JSON.stringify(plan.gaps));
  assert(plan.status === 'missing-capability', 'plan must not look ready');
  assert(plan.execution.ci_required.length === 4, 'required set must stay complete in CI');
});

test('GOV-06 the plan hash is stable for identical input and moves with content', () => {
  const input = {trustedPolicy: POLICY, projectContext: ctx, change: change(['a.js'], POLICY.modules, 'L1')};
  const one = planGovernance(input);
  const two = planGovernance(input);
  assert(one.plan_sha256 === two.plan_sha256, 'hash not stable');
  const other = planGovernance({...input, change: change(['b.js'], POLICY.modules, 'L1')});
  assert(other.plan_sha256 !== one.plan_sha256, 'hash ignored content');
  assert(!JSON.stringify(one.plan).includes(one.plan_sha256), 'plan hash must not be self-referential');
});

test('GOV-07/T23 an approved refactor contract adds requirements and never downgrades risk', () => {
  const contract = {schema: 'dairn.refactor.v1', id: 'decouple-check-work', intent: 'behavior-preserving',
    baseline: {source_commit: 'a'.repeat(40), contracts: ['contract', 'arch-rule']},
    target: {properties: ['check-without-task']}, migration: {strategy: 'incremental', exit_conditions: ['no-new-failures-beyond-baseline']},
    debt: {allowed_transitional_items: [], known_failures: []}, paths: ['quickjs/core/checks.mjs']};
  const {plan} = planGovernance({trustedPolicy: POLICY, projectContext: ctx,
    change: change(['quickjs/core/checks.mjs'], POLICY.modules, 'L2'), refactorContracts: [contract]});
  assert(plan.classification.effective_risk === 'L2', 'refactor must not lower risk');
  assert(plan.requirements.some(r => r.origin === 'approved-refactor-contract:decouple-check-work' && r.check_id === 'contract'), 'contract requirements missing');
  assert(plan.advisory_workflow.includes('refactor:decouple-check-work'), 'refactor advisory missing');
  const untouched = planGovernance({trustedPolicy: POLICY, projectContext: ctx,
    change: change(['docs/x.md'], POLICY.modules, 'L0'), refactorContracts: [contract]});
  assert(!untouched.plan.requirements.some(r => r.refactor), 'contract applied outside its paths');
});

test('GOV-08 local fast is speed advice; the CI required set stays complete', () => {
  const {plan} = planGovernance({trustedPolicy: POLICY, projectContext: ctx,
    change: change(['src/main.go'], POLICY.modules, 'L2')});
  const fast = new Set(plan.execution.local_fast);
  assert(fast.has('app.lint') && fast.has('app.unit'), 'lint/unit should be local-fast candidates');
  assert(!fast.has('app.integration') && !fast.has('app.build'), 'integration/build default to ci-required');
  assert(plan.execution.ci_required.length === 8, 'CI set must cover every requirement');
  const phaseCfg = {schema_version: 1, project: 'svc', modules: [{name: 'app', path: '.',
      checks: {lint: {argv: ['echo'], phase: 'ci-required'}, unit: {argv: ['echo'], phase: 'local-only'},
        integration: {argv: ['echo']}, build: {argv: ['echo']}}}],
    required_checks: POLICY.required_checks};
  const phased = planGovernance({trustedPolicy: phaseCfg, projectContext: projectContextOf(phaseCfg),
    change: change(['a.js'], phaseCfg.modules, 'L2')}).plan;
  assert(!phased.execution.local_fast.includes('app.lint'), 'ci-required phase must keep lint out of local-fast');
  assert(phased.executors.find(e => e.check_id === 'unit').phase === 'local-only', 'phase config ignored');
});

test('GOV-09 mixed-protocol or invalid policies are refused by the planner', () => {
  let threw = null;
  try { planGovernance({trustedPolicy: {schema: 'dairn.policy.v1', schema_version: 1}, projectContext: ctx,
    change: change(['a.js'], POLICY.modules, 'L1')}); } catch (e) { threw = e; }
  assert(threw, 'mixed-protocol policy accepted by the planner');
});

/* ---------- Capabilities（§12） ---------- */
test('CAP-01/T05 capabilities are graded declared/detected/missing — never invented', () => {
  const policy = {schema_version: 1, project: 'svc', modules: [{name: 'app', path: '.',
      checks: {lint: {argv: ['dairn', 'stack-check', 'go', 'lint']}, // built-in: detected
        unit: {argv: ['definitely-not-a-command-xyz']}}}],
    required_checks: {L0: ['lint'], L1: ['lint', 'unit'], L2: ['lint', 'unit', 'integration']}};
  const report = assessCapabilities(realHost, workdir('cap1'), policy, {risk: 'L2'});
  const byId = Object.fromEntries(report.modules[0].checks.map(c => [c.check_id, c]));
  assert(byId.lint.status === 'detected', 'built-in lint not detected: ' + byId.lint.status);
  assert(byId.unit.status === 'missing-tool', 'phantom command graded available');
  assert(report.modules[0].checks.some(c => c.check_id === 'integration' && c.status === 'unconfigured'), 'unconfigured check missing');
  assert(report.gaps.some(g => g.check_id === 'unit' && g.kind === 'MISSING_CAPABILITY'), 'required gap not reported');
  assert(!JSON.stringify(report).includes('"ci-verified"'), 'assessment must never self-certify ci-verified');
});

test('CAP-02 context declarations must be valid or fail loudly', () => {
  let threw = null;
  try { projectContextOf({modules: [{name: 'app', lifecycle: 'beta'}]}); } catch (e) { threw = e; }
  assert(threw && String(threw.message).includes('lifecycle'), 'invalid lifecycle silently accepted');
});

/* ---------- Refactor（§13） ---------- */
const CONTRACT = {schema: 'dairn.refactor.v1', id: 'decouple-check-work', intent: 'behavior-preserving',
  baseline: {source_commit: 'a'.repeat(40), contracts: ['contract']},
  target: {properties: ['check-without-task']},
  migration: {strategy: 'incremental', exit_conditions: ['no-new-failures-beyond-baseline', 'no-legacy-callers']},
  debt: {allowed_transitional_items: [], known_failures: [
    {check_id: 'integration', module: 'legacy', signature: sha256('old race in legacy suite').slice(0, 16)}]},
  paths: ['legacy/']};
const run = failing => ({run_id: 'run-rfb-' + '0'.repeat(8), checks: [
  {id: 'lint', module: 'app', status: 'passed'},
  {id: 'integration', module: 'legacy', status: 'failed', reason: 'old race in legacy suite'},
  ...(failing === 'fresh' ? [{id: 'unit', module: 'app', status: 'failed', reason: 'new regression'}] : []),
  ...(failing === 'drift' ? [{id: 'integration', module: 'legacy', status: 'failed', reason: 'a completely different failure now'}] : []),
  ...(failing === 'retired' ? [] : [])]});

test('RFB-01 a matching baseline failure stays known debt', () => {
  const report = compareDebt(CONTRACT, run(null));
  assert(report.status === 'within-baseline', 'status: ' + report.status);
  assert(report.known_failures.length === 1 && report.known_failures[0].check_id === 'integration', 'known debt wrong');
  assert(report.new_failures.length === 0, 'baseline failure misclassified as new');
});

test('RFB-02/T26 new failures beyond the baseline never merge into known debt', () => {
  const report = compareDebt(CONTRACT, run('fresh'));
  assert(report.status === 'new-failures', 'status: ' + report.status);
  assert(report.new_failures.length === 1 && report.new_failures[0].check_id === 'unit', 'new failure swallowed');
});

test('RFB-03 a changed failure shape is drift, not silently-known debt', () => {
  const report = compareDebt({...CONTRACT, debt: {known_failures: [
      {check_id: 'integration', module: 'legacy', signature: sha256('old race in legacy suite').slice(0, 16)}]}},
    run('drift'));
  assert(report.status === 'signature-drift', 'status: ' + report.status);
  assert(report.signature_drift.length === 1, 'drift not surfaced');
});

test('RFB-04/T25 unverifiable exit conditions are needs-review, never a silent pass', () => {
  const comparison = compareDebt(CONTRACT, run(null));
  const verdict = verifyExitConditions(CONTRACT, run(null), comparison);
  assert(verdict.status === 'needs-review', 'status: ' + verdict.status);
  assert(verdict.checked.length === 1 && verdict.checked[0].status === 'pass', 'local condition wrong');
  assert(verdict.unverified.some(u => u.condition === 'no-legacy-callers'), 'unverifiable condition hidden');
});

test('RFB-05 contract validation rejects malformed baselines', () => {
  let threw = null;
  try { validateRefactorContract({...CONTRACT, id: 'Bad_Id'}, 'x.json'); } catch (e) { threw = e; }
  assert(threw, 'bad id accepted');
  threw = null;
  try { validateRefactorContract({...CONTRACT, debt: {known_failures: [{check_id: 'unit'}]}}, 'x.json'); } catch (e) { threw = e; }
  assert(threw, 'signature-less known failure accepted');
});

test('RFB-06 contracts on disk are read and validated in full', () => {
  const dir = workdir('rfb6');
  realHost.mkdirs(dir + '/.dairn/governance/refactors');
  realHost.write(dir + '/.dairn/governance/refactors/' + CONTRACT.id + '.json', JSON.stringify(CONTRACT));
  const read = readRefactorContracts(realHost, dir);
  assert(read.length === 1 && read[0].id === CONTRACT.id, 'contract not read');
  realHost.write(dir + '/.dairn/governance/refactors/broken.json', '{"schema":"nope"}');
  let threw = null;
  try { readRefactorContracts(realHost, dir); } catch (e) { threw = e; }
  assert(threw, 'broken contract silently ignored');
});

/* ---------- Feedback（§15） ---------- */
const history = (n, mutate) => Array.from({length: n}, (_, i) => ({
  run_id: 'run-fbk-' + i, subject_commit: 'c'.repeat(40), created_at: '2026-10-0' + (i % 9 + 1) + 'T00:00:00Z',
  status: 'passed', checks: [{id: 'integration', module: 'app', status: 'passed',
    duration_sec: 200 + i}]}));

test('FBK-01/T31 thin history yields insufficient-evidence, not fabricated savings', () => {
  const report = recommendAdaptations({runs: history(3), minSamples: 10});
  assert(report.status === 'insufficient-evidence', 'status: ' + report.status);
  assert(report.recommendations.length === 0 && report.note.includes('not enough'), 'claims without evidence');
});

test('FBK-02 a consistently slow check is proposed for analysis, never removal', () => {
  const report = recommendAdaptations({runs: history(12), minSamples: 10, slowMs: 120000});
  const slow = report.recommendations.find(r => r.kind === 'CI_SLOW');
  assert(slow, 'slow check not flagged');
  assert(slow.requires_approval === true && slow.requirements_preserved.includes('app:integration'), 'assurance not preserved');
});

test('FBK-03 healthy history recommends no action', () => {
  const quiet = Array.from({length: 12}, (_, i) => ({run_id: 'run-q-' + i, subject_commit: 'c'.repeat(40),
    status: 'passed', checks: [{id: 'lint', module: 'app', status: 'passed', duration_sec: 2}]}));
  const report = recommendAdaptations({runs: quiet, minSamples: 10});
  assert(report.status === 'no-action', 'noise invented: ' + report.status);
  assert(report.recommendations.length === 0, 'healthy history produced recommendations');
});

test('FBK-04 high failure frequency without equivalent inputs is not flaky', () => {
  const flaky = Array.from({length: 12}, (_, i) => ({run_id: 'run-f-' + i, subject_commit: 'd'.repeat(40),
    status: i % 4 === 0 ? 'failed' : 'passed',
    checks: [{id: 'unit', module: 'app', status: i % 4 === 0 ? 'failed' : 'passed', duration_sec: 3}]}));
  const report = recommendAdaptations({runs: flaky, minSamples: 10});
  const noise = report.recommendations.find(r => r.kind === 'FREQUENT_FAILURE');
  assert(noise, 'flaky check not flagged');
  assert(noise.proposed_action.includes('不得自动删除') && noise.requirements_preserved.includes('app:unit'), 'noise advice drops assurance');
});

print('DAIRN_NATIVE_GOV_RESULT ' + JSON.stringify({engine: 'native-qjs', platform: os.platform, passed: tests.length - failures, failed: failures, tests}));
try { realHost.remove(base); } catch (_) { /* disposable temp dir */ }
std.exit(failures ? 1 : 0);
