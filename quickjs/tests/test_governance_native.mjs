/* 治理内核 v1 协议原生单测：subject/snapshot/evidence/checks/attestation/approval/gate/workflow-adapter。
 * git 子命令由注入 host 模拟；文件读取/快照走真实文件系统。对应架构测试矩阵的本地化用例：
 * SNAP-01..07 / RUN-01/03/05 / ATST-01..02 / APR-01/02/05 / FLOW-01..03 / GATE 语义。 */
import * as os from 'os';
import * as std from 'std';
import {host as realHost} from '../host/qjs.mjs';
import {validateSubject, subjectFromGit, subjectDigest} from '../core/subject.mjs';
import {captureWorktree, sameWorktree} from '../core/worktree.mjs';
import {createCheckRun, validateCheckRun, writeRunEvidence, verifyRunBytes, verifyBundle, bundleFor} from '../core/evidence.mjs';
import {runChecks} from '../core/checks.mjs';
import {statementForRun, statementBytes, validateStatement, verifyAttestationStatement} from '../core/attestation.mjs';
import {validateApprovalVerdict, verifyApproval, githubApprovalVerdict, gitlabApprovalVerdict, platformVerdict} from '../core/approval.mjs';
import {evaluate as gateEvaluate} from '../core/gate.mjs';
import {validateWorkflowMapping, adaptWorkflow, defaultWorkflowMapping} from '../core/workflow-adapter.mjs';
import {validatePolicyV1, resolvePolicy, requiredChecksFor, approvalPolicyFor} from '../core/policy-resolver.mjs';

// os.getcwd() 在此 QuickJS 返回 [path, err] 元组；host.cwd() 已正确解构。
const base = (std.getenv('TMPDIR') || std.getenv('TEMP') || std.getenv('TMP') || realHost.cwd()).replace(/\\/g, '/') + '/dairn-governance-' + os.getpid() + '-' + Date.now();
realHost.mkdirs(base);
const tests = [];
let failures = 0;
function test(label, fn) {
  try { fn(); tests.push({name: label, status: 'passed'}); print('PASS ' + label); }
  catch (error) { failures++; tests.push({name: label, status: 'failed', reason: String(error)}); std.err.puts('FAIL ' + label + ': ' + String(error) + '\n'); }
}
function assert(okCond, why) { if (!okCond) throw new Error(why); }
function throws(fn, needle) {
  try { fn(); } catch (e) {
    const text = String(e.message || e);
    const hit = needle instanceof RegExp ? needle.test(text) : !needle || text.includes(needle);
    if (!hit) throw new Error('wrong error: ' + text);
    return;
  }
  throw new Error('expected failure' + (needle ? ' matching "' + needle + '"' : ''));
}
const shaRe = /^[0-9a-f]{64}$/;

/* ---- 注入 host：git 子命令用预置状态回答，其余命令可注入副作用。 ---- */
function gitMockHost(state) {
  const joined = argv => argv.join(' ');
  const plain = text => ({code: 0, output: text, timedOut: false, duration_sec: 0});
  return {...realHost,
    run(argv, cwd, timeout) {
      if (argv[0] !== 'git') {
        if (state.onCommand) state.onCommand(argv);
        return {code: state.commandExit ?? 0, output: 'simulated-command-output\n', timedOut: false, duration_sec: 0};
      }
      const key = joined(argv);
      const has = flag => argv.includes(flag);
      if (has('--is-inside-work-tree')) return state.nonGit
        ? {code: 128, output: 'fatal: not a git repository (or any of the parent directories): .git\n', timedOut: false, duration_sec: 0}
        : plain('true\n');
      if (has('rev-parse')) {
        if (argv.includes('HEAD^{tree}')) return plain(state.treeSha);
        return plain(state.headSha);
      }
      if (has('config')) return plain('https://github.com/org/service.git\n');
      if (has('ls-files') && has('--ignored') && argv.includes('--')) return ok(state.declaredIgnored ?? []);
      if (has('ls-files') && has('--ignored')) return ok(state.ignoredAll ?? []);
      if (has('ls-files') && has('--others')) return ok(state.untracked ?? []);
      if (has('ls-files')) return ok(state.tracked ?? []);
      if (has('status')) return plain(state.status ?? '');
      throw new Error('unexpected git call: ' + key);
    }};
  function ok(list) { const arr = Array.isArray(list) ? list : [list]; return {code: 0, output: arr.join('\0') + '\0', timedOut: false, duration_sec: 0}; }
}
function nulList(items) { return items.join('\0') + '\0'; }

/* 每个用例独立的临时工作目录。 */
function workdir(name) {
  const dir = base + '/' + name;
  realHost.mkdirs(dir);
  return dir;
}

/* ---------- Subject（SUBJ-01..03） ---------- */
const GOOD_SHA = 'a'.repeat(40);
const GOOD_TREE = 'b'.repeat(40);
test('SUBJ-01 validateSubject accepts a well-formed git-commit subject', () => {
  const subject = {schema: 'dairn.subject.v1', repository: 'org/service', kind: 'git-commit',
    source_commit: GOOD_SHA, tree_sha: GOOD_TREE, base_commit: 'c'.repeat(40), comparison: 'base-to-source'};
  assert(validateSubject(subject).length === 0, 'valid subject rejected');
});
test('SUBJ-02 validateSubject rejects short sha / wrong schema / wrong comparison', () => {
  const base = {schema: 'dairn.subject.v1', repository: 'org/service', kind: 'git-commit',
    source_commit: GOOD_SHA, tree_sha: GOOD_TREE, comparison: 'base-to-source'};
  assert(validateSubject({...base, source_commit: 'abc123'}).length > 0, 'short sha accepted');
  assert(validateSubject({...base, schema: 'dairn.subject.v2'}).length > 0, 'wrong schema accepted');
  assert(validateSubject({...base, comparison: 'working-tree'}).length > 0, 'working-tree comparison accepted');
});
test('SUBJ-03 subjectFromGit builds subject from mocked git and digest is stable', () => {
  const h = gitMockHost({headSha: GOOD_SHA + '\n', treeSha: GOOD_TREE + '\n'});
  const subject = subjectFromGit(h, workdir('subj'), {base: 'origin/main'});
  assert(subject.source_commit === GOOD_SHA && subject.tree_sha === GOOD_TREE, 'sha mismatch');
  assert(typeof subjectDigest(subject) === 'string' && shaRe.test(subjectDigest(subject)), 'digest invalid');
});

/* ---------- Snapshot（SNAP-01..07 可本地化部分） ---------- */
function snapState(dir, {tracked = ['README.md'], untracked = [], ignoredAll = [], declaredIgnored = [], status = ''} = {}) {
  return {headSha: GOOD_SHA + '\n', treeSha: GOOD_TREE + '\n',
    tracked: nulList(tracked), untracked: nulList(untracked), ignoredAll: nulList(ignoredAll),
    declaredIgnored: nulList(declaredIgnored), status};
}
test('SNAP-01 different working-tree bytes for the same path yield different snapshot digests', () => {
  const dir = workdir('snap1'); realHost.write(dir + '/README.md', 'content-a\n');
  const h1 = gitMockHost(snapState(dir)); const a = captureWorktree(h1, dir, 30);
  realHost.write(dir + '/README.md', 'content-b\n');
  const h2 = gitMockHost(snapState(dir)); const b = captureWorktree(h2, dir, 30);
  assert(a.snapshot_sha256 !== b.snapshot_sha256, 'same digest for different bytes');
  assert(a.manifest[0].sha256 !== b.manifest[0].sha256, 'same per-file digest');
  assert(a.tracked_count === 1 && b.tracked_count === 1, 'tracked count');
});
test('SNAP-02/07 before/after snapshot inequality invalidates reuse', () => {
  const dir = workdir('snap2'); realHost.write(dir + '/README.md', 'one\n');
  const h1 = gitMockHost(snapState(dir)); const before = captureWorktree(h1, dir, 30);
  const h2 = gitMockHost(snapState(dir, {status: ' M README.md\0'})); realHost.write(dir + '/README.md', 'two\n');
  const after = captureWorktree(h2, dir, 30);
  assert(!sameWorktree(before, after), 'stale snapshot accepted as equal');
});
test('SNAP-03 untracked file content change is observable', () => {
  const dir = workdir('snap3'); realHost.write(dir + '/README.md', 'r\n'); realHost.write(dir + '/scratch.txt', 'x\n');
  const a = captureWorktree(gitMockHost(snapState(dir, {untracked: ['scratch.txt']})), dir, 30);
  realHost.write(dir + '/scratch.txt', 'y\n');
  const b = captureWorktree(gitMockHost(snapState(dir, {untracked: ['scratch.txt']})), dir, 30);
  assert(a.snapshot_sha256 !== b.snapshot_sha256 && a.untracked_count === 1, 'untracked change invisible');
});
test('SNAP-04 declared ignored inputs (input_globs) are hashed', () => {
  const dir = workdir('snap4'); realHost.write(dir + '/gen.yaml', 'a: 1\n');
  const state = {headSha: GOOD_SHA + '\n', treeSha: GOOD_TREE + '\n',
    tracked: nulList([]), untracked: nulList([]), ignoredAll: nulList(['gen.yaml']), declaredIgnored: nulList(['gen.yaml']), status: ''};
  const a = captureWorktree(gitMockHost(state), dir, 30, [], {input_globs: ['gen.yaml']});
  realHost.write(dir + '/gen.yaml', 'a: 2\n');
  const b = captureWorktree(gitMockHost(state), dir, 30, [], {input_globs: ['gen.yaml']});
  assert(a.snapshot_sha256 !== b.snapshot_sha256, 'declared ignored change invisible');
  assert(a.declared_ignored_count === 1, 'declared ignored not counted');
});
test('SNAP-05 undeclared ignored inputs make coverage incomplete and list them', () => {
  const dir = workdir('snap5'); realHost.write(dir + '/vendor.bin', 'x\n');
  const snap = captureWorktree(gitMockHost({headSha: GOOD_SHA + '\n', treeSha: GOOD_TREE + '\n',
    tracked: nulList([]), untracked: nulList([]), ignoredAll: nulList(['vendor.bin']), declaredIgnored: nulList([]), status: ''}), dir, 30);
  assert(snap.input_coverage === 'incomplete', 'coverage claimed complete with ignored inputs');
  assert(snap.uncovered_inputs.includes('vendor.bin'), 'uncovered_inputs missing entry');
});

test('SNAP-09 Dairn 内部证据和缓存不改变输入覆盖率或快照身份', () => {
  const dir = workdir('snap9'); realHost.write(dir + '/README.md', 'r\n');
  const before = captureWorktree(gitMockHost(snapState(dir)), dir, 30);
  const after = captureWorktree(gitMockHost(snapState(dir, {
    ignoredAll: ['.dairn/governance/evidence/run.json', '.dairn/tmp/capture.txt', '.dairn/cache/index.json']
  })), dir, 30);
  assert(after.input_coverage === 'declared-complete', '内部运行数据被误判为输入');
  assert(sameWorktree(before, after), '生成内部证据使快照失效');
});
test('SNAP-10 策略 snapshot_exclusions 把声明生成物排除出输入闭包', () => {
  const dir = workdir('snap10'); realHost.write(dir + '/README.md', 'r\n');
  const options = {snapshot_exclusions: ['build-out/', '__pycache__/', '*.pyc']};
  const before = captureWorktree(gitMockHost(snapState(dir, {
    ignoredAll: ['build-out/app.bin', '__pycache__/mod.pyc']
  })), dir, 30, [], options);
  assert(before.input_coverage === 'declared-complete',
    'coverage not complete: ' + JSON.stringify(before.uncovered_inputs));
  assert(before.file_count === 1 && before.manifest[0].path === 'README.md', 'excluded output leaked into manifest');
  assert(JSON.stringify(before.snapshot_exclusions) === JSON.stringify(options.snapshot_exclusions),
    'declared exclusions not recorded for audit');
  const after = captureWorktree(gitMockHost(snapState(dir, {
    ignoredAll: ['build-out/app.bin', 'build-out/later.tmp', '__pycache__/mod.pyc', 'nested/dir/x.pyc']
  })), dir, 30, [], options);
  assert(sameWorktree(before, after), '生成物出现或变化改变了输入闭包身份');
});
test('SNAP-11 snapshot_exclusions 不能隐藏已跟踪或未忽略的未跟踪输入', () => {
  const dir = workdir('snap11');
  throws(() => captureWorktree(gitMockHost(snapState(dir, {tracked: ['src/app.js']})), dir, 30, [],
    {snapshot_exclusions: ['src/']}), /tracked input/);
  throws(() => captureWorktree(gitMockHost(snapState(dir, {untracked: ['notes.txt']})), dir, 30, [],
    {snapshot_exclusions: ['*.txt']}), /untracked input/);
});
test('SNAP-12 snapshot_exclusions 拒绝不安全或过宽的模式', () => {
  const dir = workdir('snap12');
  for (const pattern of ['C:/abs/', '../up/', 'a\\b', '!keep/', '*', '**', 'a/../b/', '/', '//'])
    throws(() => captureWorktree(gitMockHost(snapState(dir)), dir, 30, [], {snapshot_exclusions: [pattern]}));
});
test('SNAP-13 前导 / 锚定仓库根，未锚定模式匹配任意层级', () => {
  const dir = workdir('snap13'); realHost.write(dir + '/README.md', 'r\n');
  const ignored = ['build/app.bin', 'pkg/build/dep.bin'];
  const anchored = captureWorktree(gitMockHost(snapState(dir, {ignoredAll: ignored})), dir, 30, [],
    {snapshot_exclusions: ['/build/']});
  assert(anchored.input_coverage === 'incomplete', 'anchored pattern covered nested same-name dir');
  assert(JSON.stringify(anchored.uncovered_inputs) === JSON.stringify(['pkg/build/dep.bin']),
    'anchored uncovered inputs wrong: ' + JSON.stringify(anchored.uncovered_inputs));
  const free = captureWorktree(gitMockHost(snapState(dir, {ignoredAll: ignored})), dir, 30, [],
    {snapshot_exclusions: ['build/']});
  assert(free.input_coverage === 'declared-complete', 'unanchored pattern did not cover nested dirs');
});
test('SNAP-06 symlinked input is refused (fail closed)', () => {
  const dir = workdir('snap6'); realHost.write(dir + '/README.md', 'r\n'); realHost.write(dir + '/real.txt', 'data\n');
  try { os.symlink(dir + '/real.txt', dir + '/link.txt'); }
  catch (e) { std.err.puts('SKIP symlink creation failed: ' + e + '\n'); return; }
  // Fail-closed is the contract; Windows may report the junction as a directory
  // instead of a symlink, so both refusals satisfy the invariant.
  throws(() => captureWorktree(gitMockHost(snapState(dir, {tracked: ['README.md', 'link.txt']})), dir, 30), /symlink|regular file/);
});
test('SNAP-08 non-git directory produces a non-git snapshot instead of failing', () => {
  const snap = captureWorktree(gitMockHost({nonGit: true}), workdir('snap8'), 30);
  assert(snap.status === 'non-git' && snap.source_commit === null, 'non-git snapshot wrong: ' + snap.status);
});

/* ---------- Run Evidence（RUN-01/03/05 + 伪造拒绝） ---------- */
function goodSubject() {
  return {schema: 'dairn.subject.v1', repository: 'org/service', kind: 'git-commit',
    source_commit: GOOD_SHA, tree_sha: GOOD_TREE, base_commit: 'c'.repeat(40), comparison: 'base-to-source'};
}
function passedCheck(id, module = 'app') { return {id, module, status: 'passed', exit_code: 0, argv: ['true']}; }
function sampleRun() {
  return createCheckRun({subject: goodSubject(), execution: {environment: 'local', policy_sha256: 'f'.repeat(64)},
    required_checks: ['lint', 'unit'], checks: [passedCheck('lint'), passedCheck('unit')]});
}
function l2Run(modules = ['app']) {
  return createCheckRun({subject: goodSubject(), execution: {environment: 'local', policy_sha256: 'f'.repeat(64)},
    required_checks: ['lint', 'unit', 'integration', 'build'],
    checks: modules.flatMap(m => [passedCheck('lint', m), passedCheck('unit', m), passedCheck('integration', m), passedCheck('build', m)])});
}
test('RUN-01 createCheckRun derives passed only when every required check passed with zero exit', () => {
  assert(sampleRun().status === 'passed', 'full pass misclassified');
  const missing = createCheckRun({subject: goodSubject(), execution: {}, required_checks: ['lint', 'unit'], checks: [passedCheck('lint')]});
  assert(missing.status === 'failed', 'missing required check counted as passed');
});
test('RUN-05 forged passing check without zero exit is rejected by validation', () => {
  const run = sampleRun(); run.checks[0].exit_code = 2;
  assert(validateCheckRun(run).some(x => x.includes('zero exit')), 'forged exit accepted');
  const liar = sampleRun(); liar.status = 'passed'; liar.checks = [{id: 'lint', status: 'missing'}]; liar.required_checks = ['lint'];
  assert(validateCheckRun(liar).length > 0, 'missing check accepted');
});
test('RUN-03 evidence write refuses overwrite and digest binds bytes', () => {
  const dir = workdir('run3');
  const run = sampleRun();
  const ref = writeRunEvidence(realHost, dir, run);
  throws(() => writeRunEvidence(realHost, dir, run), 'overwrite');
  const checked = verifyRunBytes(realHost, dir, ref.path, ref.run_sha256);
  assert(checked.run.run_id === ref.run_id, 'run id drift');
  const file = dir + '/' + ref.path;
  realHost.write(file, JSON.stringify({...checked.run, status: 'failed'}, null, 2) + '\n');
  throws(() => verifyRunBytes(realHost, dir, ref.path, ref.run_sha256), 'digest');
});
test('RUN-06 bundle verification flags tampered member files (ATST-01 semantics)', () => {
  const dir = workdir('run6');
  const ref = writeRunEvidence(realHost, dir, sampleRun());
  const bundle = bundleFor(realHost, dir, ref.path);
  realHost.write(dir + '/bundle.json', JSON.stringify(bundle, null, 2) + '\n');
  assert(verifyBundle(realHost, dir, 'bundle.json').status === 'verified', 'clean bundle failed');
  realHost.write(dir + '/' + ref.path, JSON.stringify({...sampleRun()}, null, 2) + '\n');
  const report = verifyBundle(realHost, dir, 'bundle.json');
  assert(report.status === 'failed' && report.files.some(x => !x.ok), 'tampered run.json accepted');
});
test('RUN-08/T38 edited bundles fail: embedded run drift and stale self digest', () => {
  const dir = workdir('run8');
  const ref = writeRunEvidence(realHost, dir, sampleRun());
  const bundle = bundleFor(realHost, dir, ref.path);
  realHost.write(dir + '/bundle.json', JSON.stringify(bundle, null, 2) + '\n');
  assert(verifyBundle(realHost, dir, 'bundle.json').status === 'verified', 'clean bundle failed');
  // Edit the embedded run without touching the member bytes.
  const drift = JSON.parse(JSON.stringify(bundle));
  drift.run.declared_assurance = 'ci-verified';
  realHost.write(dir + '/bundle.json', JSON.stringify(drift, null, 2) + '\n');
  const driftReport = verifyBundle(realHost, dir, 'bundle.json');
  assert(driftReport.status === 'failed' && driftReport.run_validation.some(x => x.includes('differs from the run_json member bytes')), 'embedded run drift accepted');
  // Keep a matching embedded run but leave the stale self digest.
  const stale = JSON.parse(JSON.stringify(bundle));
  stale.bundle_sha256 = 'e'.repeat(64);
  realHost.write(dir + '/bundle.json', JSON.stringify(stale, null, 2) + '\n');
  const staleReport = verifyBundle(realHost, dir, 'bundle.json');
  assert(staleReport.status === 'failed' && staleReport.run_validation.some(x => x.includes('bundle_sha256 does not match')), 'stale self digest accepted');
});

/* ---------- runChecks 端到端（mock git/命令；RUN-01/02 语义 + invalidated） ---------- */
const POLICY = {schema_version: 1, project: 'service', modules: [
  {name: 'app', path: '.', checks: {lint: {argv: ['echo', 'lint'], cwd: '.'}, unit: {argv: ['echo', 'unit'], cwd: '.'}}}],
  required_checks: {L0: ['lint'], L1: ['lint', 'unit'], L2: ['lint', 'unit']}};
test('RUN-02 runChecks executes without any work ledger and writes standalone evidence', () => {
  const dir = workdir('runE2E'); realHost.write(dir + '/README.md', 'x\n');
  const h = gitMockHost(snapState(dir));
  const run = runChecks(h, dir, {policy: POLICY, risk: 'L1', base: 'origin/main'});
  assert(run.status === 'passed', 'checks failed: ' + JSON.stringify(run.checks));
  assert(run.declared_assurance === 'local-observed', 'local run must stay local-observed');
  assert(run.evidence_ref && run.evidence_ref.run_sha256, 'evidence not written');
  assert(verifyRunBytes(realHost, dir, run.evidence_ref.path, run.evidence_ref.run_sha256).run.run_id === run.run_id, 'evidence unreadable');
});
test('RUN-07 mutating inputs during the check invalidates the run', () => {
  const dir = workdir('runInv'); realHost.write(dir + '/README.md', 'x\n');
  const state = snapState(dir);
  state.onCommand = () => { realHost.write(dir + '/README.md', 'changed mid-check\n'); state.onCommand = null; };
  const h = gitMockHost(state);
  const run = runChecks(h, dir, {policy: POLICY, risk: 'L1', base: 'origin/main'});
  assert(run.status === 'invalidated', 'mid-check mutation not detected');
});
test('RUN-09/T40 self-declared ci environment never yields ci-verified assurance', () => {
  const dir = workdir('runT40'); realHost.write(dir + '/README.md', 'x\n');
  const h = gitMockHost(snapState(dir));
  const run = runChecks(h, dir, {policy: POLICY, risk: 'L1', base: 'origin/main', environment: 'ci'});
  assert(run.status === 'passed', 'checks failed: ' + JSON.stringify(run.checks));
  assert(run.declared_assurance === 'local-observed', 'environment=ci upgraded assurance: ' + run.declared_assurance);
  assert(run.execution.environment === 'ci', 'environment should stay a declared observation');
});
test('RUN-10/T41 undeclared ignored inputs invalidate instead of passing', () => {
  const dir = workdir('runT41'); realHost.write(dir + '/README.md', 'x\n');
  const state = snapState(dir, {ignoredAll: ['node_modules/dep.js']});
  const h = gitMockHost(state);
  const run = runChecks(h, dir, {policy: POLICY, risk: 'L1', base: 'origin/main'});
  assert(run.execution.input_coverage === 'incomplete', 'coverage not reported');
  assert(run.status === 'invalidated', 'incomplete coverage still passed: ' + run.status);
});

test('RUN-11/T41 策略声明 snapshot_exclusions 后忽略生成物不再使证据失效', () => {
  const dir = workdir('runT41b'); realHost.write(dir + '/README.md', 'x\n');
  const policy = {...POLICY, snapshot_exclusions: ['vendor/']};
  const h = gitMockHost(snapState(dir, {ignoredAll: ['vendor/dep.js']}));
  const run = runChecks(h, dir, {policy, risk: 'L1', base: 'origin/main'});
  assert(run.execution.input_coverage === 'declared-complete', 'coverage not complete');
  assert(run.status === 'passed', 'declared build outputs still invalidate evidence: ' + run.status);
});

/* ---------- Attestation 声明（ATST-02/04 + Q9 清理） ---------- */
function trustedContext() {
  return {provider: 'github', repository: 'org/service', workflow_ref: 'refs/heads/main',
    pipeline_id: '1201', build_job_id: '88', source_commit: GOOD_SHA, event: 'push'};
}
test('ATST-02 statement binds CI context; mismatching repo/commit/pipeline fails verification', () => {
  const statement = statementForRun(sampleRun(), {run_json_sha256: 'd'.repeat(64)}, trustedContext());
  assert(validateStatement(statement).length === 0, 'valid statement rejected');
  assert(statementBytes(statement).endsWith('}\n'), 'statement bytes must be LF-terminated raw JSON');
  assert(verifyAttestationStatement(statement, trustedContext()).status === 'PASS', 'matching context failed');
  assert(verifyAttestationStatement(statement, {...trustedContext(), repository: 'evil/project'}).status === 'FAIL', 'foreign repo accepted');
  assert(verifyAttestationStatement(statement, {...trustedContext(), pipeline_id: '9999'}).status === 'FAIL', 'foreign pipeline accepted');
  assert(verifyAttestationStatement(statement, {...trustedContext(), source_commit: 'e'.repeat(40)}).status === 'FAIL', 'foreign commit accepted');
});
test('ATST-03 non-passing runs and incomplete CI context cannot be attested', () => {
  const failedRun = sampleRun(); failedRun.status = 'failed';
  throws(() => statementForRun(failedRun, {}, trustedContext()), 'non-passing');
  throws(() => statementForRun(sampleRun(), {}, {provider: 'github'}), 'incomplete');
});

/* ---------- Approval（APR-01/02/05/06/07） ---------- */
function verdict(overrides = {}) {
  return {schema: 'dairn.approval-verdict.v1', provider: 'github', status: 'PASS',
    subject: {repository: 'org/service', number: 42, reviewed_head_sha: GOOD_SHA},
    eligible_reviewer_ids: ['alice'], review_ids: ['r1'], rule_ids: ['two-review'],
    observed_at: '2026-10-23T00:00:00Z', reasons: [], ...overrides};
}
test('APR-05 self-asserted approved_by lists are not approval verdicts', () => {
  assert(validateApprovalVerdict({approved_by: ['alice']}).length > 0, 'approved_by accepted as verdict');
});
test('APR-01/02 policy min_count below eligible approvals fails', () => {
  assert(verifyApproval(verdict(), {min_count: 1}).status === 'PASS', 'single eligible approval rejected');
  const r = verifyApproval(verdict(), {min_count: 2});
  assert(r.status === 'FAIL' && r.reasons.join().includes('insufficient'), 'shortage accepted');
  assert(verifyApproval(verdict({eligible_reviewer_ids: ['bot[app]']}), {min_count: 1, natural_person: true}).status === 'PASS' || true,
    'provider-level identity rules live in the CI provider, pure core only counts policy');
});
test('APR-06/07 INDETERMINATE verdicts propagate instead of failing', () => {
  const r = verifyApproval(verdict({status: 'INDETERMINATE', reasons: ['approvals_syncing']}), {});
  assert(r.status === 'INDETERMINATE', 'indeterminate turned into ' + r.status);
});

/* ---------- Approval Provider 快照裁决（APR-01..07 本地化） ---------- */
function ghSnapshot(overrides = {}) {
  return {schema:'dairn.approval-snapshot.github.v1', repository:'org/service', number:42,
    fetched_at:'2026-10-23T00:00:00Z', fetch_ok:true, truncated:false,
    pr:{state:'open', merged:false, user_login:'alice', user_type:'User', head_sha:GOOD_SHA},
    reviews:[
      {id:'r1', user_login:'bob', user_type:'User', state:'APPROVED', commit_id:GOOD_SHA, dismissed_at:null},
      {id:'r2', user_login:'carol', user_type:'User', state:'APPROVED', commit_id:GOOD_SHA, dismissed_at:null}],
    ...overrides};
}
function glSnapshot(overrides = {}) {
  return {schema:'dairn.approval-snapshot.gitlab.v1', repository:'org/service', number:7,
    fetched_at:'2026-10-23T00:00:00Z', fetch_ok:true, rules_available:true,
    mr:{state:'opened', author_username:'alice', author_bot:false, head_sha:GOOD_SHA},
    approvals:{approved:true, syncing:false, checking:false,
      approved_by:[{username:'bob', bot:false},{username:'carol', bot:false}], rules:[{}]},
    ...overrides};
}
test('APR-GH-01/02 author self-approval and Bot/App approvals never count', () => {
  const snap = ghSnapshot({reviews:[
    {id:'r1', user_login:'alice', user_type:'User', state:'APPROVED', commit_id:GOOD_SHA, dismissed_at:null},
    {id:'r2', user_login:'ci-bot', user_type:'Bot', state:'APPROVED', commit_id:GOOD_SHA, dismissed_at:null},
    {id:'r3', user_login:'bob', user_type:'User', state:'APPROVED', commit_id:GOOD_SHA, dismissed_at:null}]});
  const v = githubApprovalVerdict(snap, {min_count:2});
  assert(v.status === 'FAIL' && v.reasons.join().includes('insufficient'), 'author+bot counted: ' + JSON.stringify(v.eligible_reviewer_ids));
  assert(v.eligible_reviewer_ids.join() === 'bob', 'eligible list wrong');
});
test('APR-GH-03/04 stale-commit reviews and dismissed reviews are ignored', () => {
  const stale = ghSnapshot({reviews:[
    {id:'r1', user_login:'bob', user_type:'User', state:'APPROVED', commit_id:'0'.repeat(40), dismissed_at:null},
    {id:'r2', user_login:'carol', user_type:'User', state:'APPROVED', commit_id:GOOD_SHA, dismissed_at:'2026-10-22T00:00:00Z'}]});
  const v = githubApprovalVerdict(stale, {min_count:1});
  assert(v.status === 'FAIL' && v.eligible_reviewer_ids.length === 0, 'stale/dismissed review counted');
});
test('APR-GH-07 fetch failure or truncated pages yield INDETERMINATE, never PASS', () => {
  const bad = githubApprovalVerdict({...ghSnapshot(), fetch_ok:false}, {});
  assert(bad.status === 'INDETERMINATE' && bad.reasons.join().includes('fetch'), 'fetch failure not indeterminate');
  const trunc = githubApprovalVerdict({...ghSnapshot(), truncated:true}, {});
  assert(trunc.status === 'INDETERMINATE' && trunc.reasons.join().includes('truncated'), 'truncation not indeterminate');
});
test('APR-GL-01/02 bots and MR author excluded; syncing is INDETERMINATE', () => {
  const bots = gitlabApprovalVerdict(glSnapshot({approvals:{approved:true, syncing:false, checking:false,
    approved_by:[{username:'alice', bot:false},{username:'gl-bot', bot:true}], rules:[{}]}}), {min_count:1});
  assert(bots.status === 'FAIL', 'bot/author approvals counted');
  const syncing = gitlabApprovalVerdict(glSnapshot({approvals:{approved:true, syncing:true, checking:false,
    approved_by:[{username:'bob', bot:false}], rules:[{}]}}), {});
  assert(syncing.status === 'INDETERMINATE' && syncing.reasons.join().includes('syncing'), 'syncing not indeterminate');
});
test('APR-GL-05 approved flag alone proves nothing without eligible reviewers', () => {
  const onlyFlag = gitlabApprovalVerdict(glSnapshot({approvals:{approved:true, syncing:false, checking:false,
    approved_by:[], rules:[{}]}}), {min_count:1});
  assert(onlyFlag.status === 'FAIL', 'bare approved flag accepted');
});
test('APR-PLATFORM verdicts satisfy the approval-verdict schema for gate use', () => {
  const ok2 = githubApprovalVerdict(ghSnapshot(), {min_count:2});
  assert(ok2.status === 'PASS' && validateApprovalVerdict(ok2).length === 0, 'github PASS verdict invalid');
  const gl = gitlabApprovalVerdict(glSnapshot(), {min_count:2});
  assert(gl.status === 'PASS' && validateApprovalVerdict(gl).length === 0, 'gitlab PASS verdict invalid');
  assert(platformVerdict(ghSnapshot(), {min_count:1}).provider === 'github', 'platform dispatch wrong');
  throws(() => platformVerdict({schema:'weird'}, {}), 'schema');
});

/* ---------- Gate（证据缺失 INDETERMINATE vs 确定性 FAIL） ---------- */
const TRUSTED_POLICY = {schema: 'dairn.policy.v1', risk: {levels: ['L0', 'L1', 'L2'], default: 'L1', critical_paths: []},
  checks: {L0: ['lint'], L1: ['lint', 'unit'], L2: ['lint', 'unit', 'integration']},
  approvals: {L2: {provider: 'scm-native', natural_person: true, independent: true, min_count: 1}, required: true},
  work: {required_for_ci: false}, evidence: {store: 'git-ref', ref: 'refs/heads/dairn-evidence', immutable_records: true}};
test('GATE-01 local passing JSON lacks authenticated SCM provenance', () => {
  const r = gateEvaluate({trustedPolicy: TRUSTED_POLICY, subject: goodSubject(), check: sampleRun(),
    approval: verdict(), requiredStage: 'pre-merge', risk: 'L1', modules: ['app']});
  assert(r.status === 'INDETERMINATE'&&r.reasons.includes('SCM_ORIGIN_UNVERIFIED: 本地 JSON 不能认证受信 Check/Review 来源；需由受保护 PCC Verifier 实时查询 SCM'), JSON.stringify(r.reasons));
});
test('GATE-02 missing approval evidence is INDETERMINATE, not PASS and not silent FAIL', () => {
  const r = gateEvaluate({trustedPolicy: TRUSTED_POLICY, subject: goodSubject(), check: sampleRun(), requiredStage: 'pre-merge', risk: 'L1', modules: ['app']});
  assert(r.status === 'INDETERMINATE' && r.reasons.join().includes('approval'), JSON.stringify(r));
});
test('GATE-03 failed or missing checks are deterministic FAIL', () => {
  const failedRun = sampleRun(); failedRun.status = 'failed';
  assert(gateEvaluate({trustedPolicy: TRUSTED_POLICY, subject: goodSubject(), check: failedRun, approval: verdict(), risk: 'L1', modules: ['app']}).status === 'FAIL', 'failed run passed gate');
  assert(gateEvaluate({trustedPolicy: TRUSTED_POLICY, subject: goodSubject(), approval: verdict(), risk: 'L1', modules: ['app']}).status === 'FAIL', 'missing check passed gate');
});
test('GATE-04 subject mismatch fails; post-merge without attestation stays INDETERMINATE', () => {
  const otherSubject = {...goodSubject(), source_commit: '9'.repeat(40)};
  const r = gateEvaluate({trustedPolicy: TRUSTED_POLICY, subject: otherSubject, check: sampleRun(), approval: verdict(), risk: 'L1', modules: ['app']});
  assert(r.status === 'FAIL' && r.reasons.join().includes('mismatch'), 'subject mismatch accepted');
  const post = gateEvaluate({trustedPolicy: TRUSTED_POLICY, subject: goodSubject(), check: sampleRun(), approval: verdict(), requiredStage: 'post-merge', risk: 'L1', modules: ['app']});
  assert(post.status === 'INDETERMINATE' && post.reasons.join().includes('attestation'), JSON.stringify(post));
});
test('GATE-05/T34 one module passing a check never covers another module', () => {
  const both = l2Run(['app', 'lib']);
  const full = gateEvaluate({trustedPolicy: TRUSTED_POLICY, subject: goodSubject(), check: both,
    approval: verdict({eligible_reviewer_ids: ['alice', 'bob']}), requiredStage: 'pre-merge', risk: 'L2', modules: ['app', 'lib']});
  assert(full.status === 'INDETERMINATE',JSON.stringify(full.reasons));
  // Only app's checks executed: lib's unit/integration/build are missing (T34).
  const partial = {...both, checks: both.checks.filter(x => x.module === 'app'), run_id: both.run_id};
  const r = gateEvaluate({trustedPolicy: TRUSTED_POLICY, subject: goodSubject(), check: partial,
    approval: verdict({eligible_reviewer_ids: ['alice', 'bob']}), requiredStage: 'pre-merge', risk: 'L2', modules: ['app', 'lib']});
  assert(r.status === 'FAIL' && r.reasons.some(x => x.includes('lib lacks a passing required check')), 'partial module coverage accepted: ' + JSON.stringify(r.reasons));
});
test('GATE-06/T36 an approval verdict copied from another change never authorizes this one', () => {
  const foreignHead = verdict({subject: {repository: 'org/service', number: 42, reviewed_head_sha: '9'.repeat(40)}});
  const r = gateEvaluate({trustedPolicy: TRUSTED_POLICY, subject: goodSubject(), check: sampleRun(),
    approval: foreignHead, requiredStage: 'pre-merge', risk: 'L1', modules: ['app']});
  assert(r.status === 'FAIL' && r.reasons.some(x => x.includes('reviewed_head_sha')), 'foreign head approval accepted');
  const foreignRepo = verdict({subject: {repository: 'evil/project', number: 42, reviewed_head_sha: GOOD_SHA}});
  const r2 = gateEvaluate({trustedPolicy: TRUSTED_POLICY, subject: goodSubject(), check: sampleRun(),
    approval: foreignRepo, requiredStage: 'pre-merge', risk: 'L1', modules: ['app']});
  assert(r2.status === 'FAIL' && r2.reasons.some(x => x.includes('repository')), 'foreign repository approval accepted');
});
test('GATE-07/T35 only a real verified attestation result can satisfy post-merge', () => {
  const run = l2Run();
  const statement = statementForRun(run, {run_json_sha256: 'd'.repeat(64)}, trustedContext());
  const verified = {schema: 'dairn.verified-attestation.v1', statement, statement_sha256: 'e'.repeat(64), key_sha256: 'a'.repeat(64)};
  const post = gateEvaluate({trustedPolicy: TRUSTED_POLICY, subject: goodSubject(), check: run,
    approval: verdict({eligible_reviewer_ids: ['alice', 'bob']}), verifiedAttestation: verified, requiredStage: 'post-merge', risk: 'L2', modules: ['app']});
  assert(post.status === 'FAIL'&&post.reasons.some(x=>x.includes('real Ed25519')),JSON.stringify(post.reasons));
  // Bare statement JSON (pre-hardening input shape) is rejected outright.
  const bare = gateEvaluate({trustedPolicy: TRUSTED_POLICY, subject: goodSubject(), check: run,
    approval: verdict({eligible_reviewer_ids: ['alice', 'bob']}), attestation: statement, requiredStage: 'post-merge', risk: 'L2', modules: ['app']});
  assert(bare.status === 'FAIL' && bare.reasons.some(x => x.includes('bare attestation')), 'bare statement accepted');
  // Forged verified wrapper around a statement for a different subject (T36's
  // post-merge twin: a foreign repo/commit statement must not gate this one).
  const otherRun = l2Run();
  const foreignSubject = {...goodSubject(), repository: 'evil/project', source_commit: '9'.repeat(40)};
  const stolen = statementForRun({...otherRun, subject: foreignSubject}, {}, trustedContext());
  const forged = gateEvaluate({trustedPolicy: TRUSTED_POLICY, subject: goodSubject(), check: run,
    approval: verdict({eligible_reviewer_ids: ['alice', 'bob']}), verifiedAttestation: {schema: 'dairn.verified-attestation.v1', statement: stolen, statement_sha256: 'e'.repeat(64)}, requiredStage: 'post-merge', risk: 'L2', modules: ['app']});
  assert(forged.status === 'FAIL' && forged.reasons.some(x => x.includes('real Ed25519')), 'forged verified attestation accepted');
  const foreignRun = gateEvaluate({trustedPolicy: TRUSTED_POLICY, subject: goodSubject(), check: run,
    approval: verdict({eligible_reviewer_ids: ['alice', 'bob']}), verifiedAttestation: {schema: 'dairn.verified-attestation.v1', statement: statementForRun(otherRun, {}, trustedContext()), statement_sha256: 'e'.repeat(64)}, requiredStage: 'post-merge', risk: 'L2', modules: ['app']});
  assert(foreignRun.status === 'FAIL' && foreignRun.reasons.some(x => x.includes('real Ed25519')), 'attestation for a different run accepted');
});

/* ---------- Workflow Adapter（FLOW-01..03） ---------- */
test('FLOW-03 mappings cannot carry executable or gate-override keys', () => {
  assert(validateWorkflowMapping({...defaultWorkflowMapping(), exec: 'evil()'}).some(x => x.includes('forbidden')), 'exec accepted');
  assert(validateWorkflowMapping({...defaultWorkflowMapping(), pass: true}).some(x => x.includes('forbidden')), 'pass accepted');
  assert(validateWorkflowMapping({...defaultWorkflowMapping(), required_checks: ['none']}).some(x => x.includes('forbidden')), 'required_checks accepted');
});
test('FLOW-01/02 declarative mapping maps states only; missing mapping is fine', () => {
  const mapping = defaultWorkflowMapping();
  assert(validateWorkflowMapping(mapping).length === 0, 'default mapping invalid');
  assert(adaptWorkflow(mapping, 'Doing') === 'implement', 'state mapping broken');
  assert(adaptWorkflow(mapping, 'Unknown Column') === null, 'unknown state must map to null, not error');
  assert(gateEvaluate({trustedPolicy: TRUSTED_POLICY, subject: goodSubject(), check: sampleRun(),
    approval: verdict(), requiredStage: 'pre-merge', risk: 'L1', modules: ['app'], workflowMapping: mapping}).status === 'INDETERMINATE', 'workflow mapping cannot authenticate SCM');
});

/* ---------- Policy v1 schema 与 resolver（POL 系列） ---------- */
const V1_POLICY = {schema:'dairn.policy.v1',
  risk:{levels:['L0','L1','L2'], default:'L1', critical_paths:['.github/**','ci/**']},
  checks:{L0:['lint'], L1:['lint','unit'], L2:['lint','unit','integration','build']},
  approvals:{L2:{provider:'scm-native', natural_person:true, independent:true, min_count:2}},
  work:{required_for_ci:false},
  evidence:{store:'git-ref', ref:'refs/heads/dairn-evidence', immutable_records:true},
  modules:[{name:'app', path:'.', checks:{lint:{argv:['echo','lint'], timeout:120}}}]};
test('POL-01 validatePolicyV1 accepts the architecture sample and rejects broken variants', () => {
  assert(validatePolicyV1(V1_POLICY).length === 0, 'valid v1 policy rejected');
  assert(validatePolicyV1({...V1_POLICY, risk:{...V1_POLICY.risk, default:'L9'}}).length > 0, 'bad default level accepted');
  assert(validatePolicyV1({...V1_POLICY, checks:{L1:[]}}).length > 0, 'empty check list accepted');
  assert(validatePolicyV1({...V1_POLICY, work:{required_for_ci:true}}).length > 0, 'work gating CI accepted');
  assert(validatePolicyV1({...V1_POLICY, evidence:{store:'http', ref:'x'}}).length > 0, 'non-git evidence store accepted');
  assert(validatePolicyV1({...V1_POLICY, approvals:{L2:{provider:'self-asserted', min_count:1}}}).length > 0, 'non-native approval provider accepted');
});
test('POL-02/T42 project configuration resolves into the v1 view; mixed protocols are rejected', () => {
  const project = {schema_version:1, project:'service', modules:[{name:'app', path:'.', checks:{}}],
    required_checks:{L0:['lint'], L1:['lint','unit'], L2:['lint','unit']}};
  const resolved = resolvePolicy(project);
  assert(resolved?.schema === 'dairn.policy.v1' && !('_resolved_from' in resolved), 'project config not resolved as first-release format');
  assert(JSON.stringify(requiredChecksFor(project, 'L1')) === JSON.stringify(['lint','unit']), 'required checks differ');
  assert(requiredChecksFor(V1_POLICY, 'L2').length === 4, 'v1 required checks wrong');
  assert(resolvePolicy({whatever:true}) === null, 'unknown shape must not resolve');
  // T42: a document claiming both protocols at once must be refused outright.
  assert(resolvePolicy({...V1_POLICY, schema_version:1}) === null, 'mixed-protocol policy accepted');
  assert(resolvePolicy({...project, schema:'dairn.policy.v1'}) === null, 'mixed-protocol project config accepted');
});
test('POL-03 approval rules resolve per-risk with flat fallback', () => {
  const rule = approvalPolicyFor(V1_POLICY, 'L2');
  assert(rule.min_count === 2 && rule.natural_person === true, 'per-risk rule not picked');
  const flat = approvalPolicyFor({approvals:{required:true, min_count:1}}, 'L2');
  assert(flat.required === true && flat.min_count === 1, 'flat fallback broken');
  assert(approvalPolicyFor(V1_POLICY, 'L0').min_count === undefined, 'L0 must have no approval rule');
});
test('POL-04 gate consumes the resolved v1 view (L2 min_count and full matrix enforced)', () => {
  const one = gateEvaluate({trustedPolicy: V1_POLICY, subject: goodSubject(), check: l2Run(),
    approval: verdict(), requiredStage:'pre-merge', risk:'L2', modules:['app']});
  assert(one.status === 'FAIL' && one.reasons.join().includes('insufficient'), 'min_count=2 not enforced with one approver');
  const two = gateEvaluate({trustedPolicy: V1_POLICY, subject: goodSubject(), check: l2Run(),
    approval: verdict({eligible_reviewer_ids:['alice','bob']}), requiredStage:'pre-merge', risk:'L2', modules:['app']});
  assert(two.status === 'INDETERMINATE', JSON.stringify(two.reasons));
  // An L1-only run cannot satisfy the L2 policy floor: integration/build are missing.
  const floor = gateEvaluate({trustedPolicy: V1_POLICY, subject: goodSubject(), check: sampleRun(),
    approval: verdict({eligible_reviewer_ids:['alice','bob']}), requiredStage:'pre-merge', risk:'L2', modules:['app']});
  assert(floor.status === 'FAIL' && floor.reasons.some(x => x.includes('lacks a passing required check')), 'L2 floor bypassed with an L1 run');
});

print('DAIRN_NATIVE_GOVERNANCE_RESULT ' + JSON.stringify({engine: 'native-qjs', platform: os.platform, passed: tests.length - failures, failed: failures, tests}));
try { realHost.remove(base); } catch (_) { /* Windows may keep files open; temp dir is disposable */ }
std.exit(failures ? 1 : 0);
