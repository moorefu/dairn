/* Handoff 原生单测（§23 / HND 系列）：git 由注入 host 模拟，文件系统真实。
 * 覆盖：HND-01 无 .dairn 仓库、HND-02 三类工作区状态区分、HND-03 基线即 HEAD、
 * HND-04 detached/无 base、HND-05 特殊路径、HND-06 本地证据分级、HND-07 work 账本降级、
 * HND-10 渲染预算截断、HND-11 指纹随内容变化、HND-15 输出无平台指令。 */
import * as os from 'os';
import * as std from 'std';
import {host as realHost} from '../host/qjs.mjs';
import {captureHandoff} from '../core/handoff.mjs';
import {renderHandoff} from '../core/handoff-render.mjs';

const base = (std.getenv('TMPDIR') || std.getenv('TEMP') || std.getenv('TMP') || realHost.cwd()).replace(/\\/g, '/') + '/dairn-handoff-' + os.getpid() + '-' + Date.now();
realHost.mkdirs(base);
const tests = [];
let failures = 0;
function test(label, fn) {
  try { fn(); tests.push({name: label, status: 'passed'}); print('PASS ' + label); }
  catch (error) { failures++; tests.push({name: label, status: 'failed', reason: String(error)}); std.err.puts('FAIL ' + label + ': ' + String(error) + '\n'); }
}
function assert(okCond, why) { if (!okCond) throw new Error(why); }

const HEAD = 'a'.repeat(40);
const OTHER = '9'.repeat(40);
function plain(text) { return {code: 0, output: text, timedOut: false, duration_sec: 0}; }
function handoffHost(state) {
  return {...realHost,
    run(argv, cwd, timeout) {
      if (argv[0] !== 'git') return {code: 0, output: '', timedOut: false, duration_sec: 0};
      const has = f => argv.includes(f);
      if (has('rev-parse')) {
        if (has('--abbrev-ref')) return plain((state.branch ?? 'feature/x') + '\n');
        if (has('--is-shallow-repository')) return plain((state.shallow ? 'true' : 'false') + '\n');
        if (has('--verify')) {
          if (argv.includes('no-such-ref^{commit}')) return {code: 128, output: 'fatal: bad revision', timedOut: false, duration_sec: 0};
          if (argv.some(x => x.startsWith('HEAD'))) return plain((state.headSha ?? HEAD) + '\n');
          return plain((state.baseSha ?? HEAD) + '\n');
        }
        return plain((state.headSha ?? HEAD) + '\n');
      }
      if (has('merge-base')) return state.mergeBase ? plain(state.mergeBase + '\n') : {code: 1, output: '', timedOut: false, duration_sec: 0};
      if (has('log')) return plain(state.log ?? '');
      if (argv.includes('--name-status')) return plain(state.nameStatus ?? '');
      if (has('status')) return plain(state.status ?? '');
      if (argv.includes('--cached')) return plain(state.stagedDiff ?? '');
      if (has('diff')) return plain(state.unstagedDiff ?? '');
      if (has('config')) return plain(state.remote ?? '');
      throw new Error('unexpected git call: ' + argv.join(' '));
    }};
}
function workdir(name) { const dir = base + '/' + name; realHost.mkdirs(dir); return dir; }
const nul = s => s.split('|').join('\0');
function defaultState(overrides = {}) {
  return {headSha: HEAD, branch: 'feature/x', mergeBase: null, status: '', log: '', nameStatus: '',
    stagedDiff: '', unstagedDiff: '', remote: 'https://github.com/org/repo.git\n', ...overrides};
}

test('HND-01 handoff works in a plain git repo with no .dairn at all', () => {
  const view = captureHandoff(handoffHost(defaultState()), workdir('hnd1'), {});
  assert(view.schema === 'dairn.handoff.v1', 'schema wrong');
  assert(view.repository.head_sha === HEAD, 'head wrong');
  assert(view.workspace.status === 'clean', 'clean misdetected');
  assert(view.references.tasks.length === 0 && view.verification.local_observed.length === 0, 'phantom references');
  assert(view.limitations.some(x => x.includes('no --base')), 'missing-base limitation absent');
});

test('HND-02 staged/unstaged/untracked are separated; untracked paths only, no contents', () => {
  const dir = workdir('hnd2');
  realHost.write(dir + '/c.txt', 'untracked content\n');
  const view = captureHandoff(handoffHost(defaultState({
    status: nul('M  a.txt| M b.txt|R  new.txt|old.txt|?? c.txt|') })), dir, {});
  assert(view.workspace.status === 'dirty', 'dirty misdetected');
  assert(JSON.stringify(view.workspace.staged) === JSON.stringify([{path: 'a.txt'}, {path: 'old.txt -> new.txt', rename: true}]), 'staged wrong: ' + JSON.stringify(view.workspace.staged));
  assert(JSON.stringify(view.workspace.unstaged) === JSON.stringify([{path: 'b.txt'}]), 'unstaged wrong');
  assert(JSON.stringify(view.workspace.untracked) === JSON.stringify(['c.txt']), 'untracked wrong');
  const md = renderHandoff(view, {}).text;
  assert(!md.includes('untracked content'), 'untracked contents leaked into markdown');
});

test('HND-03 HEAD equal to the base shows a bounded recent window, not an empty summary', () => {
  const view = captureHandoff(handoffHost(defaultState({
    mergeBase: HEAD, log: HEAD + '\0abcdef1\0last commit\0' })), workdir('hnd3'), {});
  assert(view.activity.range === 'recent-commits', 'range wrong: ' + view.activity.range);
  assert(view.activity.commits.length === 1 && view.activity.commits[0].subject === 'last commit', 'commits wrong');
  assert(view.repository.base_sha === HEAD && view.repository.base_source === 'merge-base:origin/main', 'base wrong');
  assert(view.limitations.some(x => x.includes('equals the resolved base')), 'activity-window note missing');
});

test('HND-04 detached HEAD and no merge-base degrade to explicit unknowns', () => {
  const view = captureHandoff(handoffHost(defaultState({branch: 'HEAD', mergeBase: null})), workdir('hnd4'), {});
  assert(view.repository.detached === true && view.repository.branch === null, 'detached not detected');
  assert(view.repository.base_sha === null && view.activity.range === 'recent-commits', 'base invented');
  assert(view.limitations.some(x => x.includes('detached')), 'detached limitation missing');
  let threw = null;
  try { captureHandoff(handoffHost(defaultState()), workdir('hnd4b'), {base: 'no-such-ref'}); }
  catch (e) { threw = e; }
  assert(threw && String(threw.message).includes('--base'), 'unresolvable base must fail loudly');
});

test('HND-05 CJK paths, spaces and renames parse exactly', () => {
  const other = '1'.repeat(40);
  const view = captureHandoff(handoffHost(defaultState({
    mergeBase: other,
    status: nul('?? 中文 目录/文件 名.txt|?? with space.txt|'),
    nameStatus: nul('R100|renamed-new.go|renamed-old.go|') })), workdir('hnd5'), {});
  assert(JSON.stringify(view.workspace.untracked) === JSON.stringify(['中文 目录/文件 名.txt', 'with space.txt']), 'cjk/space paths wrong: ' + JSON.stringify(view.workspace.untracked));
  assert(view.activity.range === 'since-base', 'expected a since-base range');
  assert(view.activity.changes[0].path === 'renamed-new.go' && view.activity.changes[0].from === 'renamed-old.go', 'rename wrong');
});

test('HND-06 local evidence is graded: current / stale / unreadable, never ci-verified', () => {
  const dir = workdir('hnd6');
  const mk = (commit, runId, status) => {
    const p = dir + '/.dairn/governance/evidence/runs/' + commit + '/' + runId;
    realHost.mkdirs(p);
    realHost.write(p + '/run.json', JSON.stringify({schema: 'dairn.check-run.v1', run_id: runId,
      status, declared_assurance: 'local-observed'}));
  };
  mk(HEAD, 'run-current-0001', 'passed');
  mk(OTHER, 'run-stale-0002', 'passed');
  const p = dir + '/.dairn/governance/evidence/runs/' + OTHER + '/run-broken-003';
  realHost.mkdirs(p);
  realHost.write(p + '/run.json', 'not json at all');
  const view = captureHandoff(handoffHost(defaultState()), dir, {});
  assert(view.verification.local_observed.length === 1 && view.verification.local_observed[0].run_id === 'run-current-0001', 'current run wrong');
  assert(view.verification.stale.some(x => x.run_id === 'run-stale-0002'), 'stale run not graded');
  assert(view.verification.unknown.some(x => x.run_id === 'run-broken-003'), 'broken run not unknown');
  assert(!JSON.stringify(view.verification).includes('ci-verified'), 'handoff fabricated ci-verified');
});

test('HND-07 a broken work ledger degrades without breaking the git view', () => {
  const dir = workdir('hnd7');
  realHost.mkdirs(dir + '/.dairn/work');
  realHost.write(dir + '/.dairn/work/auth.json', '{broken json');
  const view = captureHandoff(handoffHost(defaultState()), dir, {task: 'auth'});
  assert(view.repository.head_sha === HEAD, 'git part failed');
  assert(view.references.tasks[0].status === 'unreadable', 'ledger not graded');
  assert(view.limitations.some(x => x.includes('unreadable')), 'ledger limitation missing');
  assert(view.limitations.some(x => x.includes('task not found')), 'task resolution missing');
});

test('HND-10 the render budget truncates explicitly and keeps provenance', () => {
  const view = captureHandoff(handoffHost(defaultState({
    log: Array.from({length: 40}, (_, i) => HEAD + '\0abc' + i + '\0subject number ' + i + ' with some length').join('\n') })), workdir('hnd10'), {});
  const out = renderHandoff(view, {maxChars: 2000});
  assert(out.truncated === true, 'truncation not flagged');
  assert(out.text.length <= 2100, 'budget ignored: ' + out.text.length);
  assert(out.text.includes('truncated at 2000'), 'truncation note missing');
  assert(out.text.includes('## 7. Provenance'), 'provenance dropped');
  assert(out.text.includes('HEAD=' + HEAD), 'core fact dropped');
});

test('HND-11 the fingerprint changes when untracked content changes', () => {
  const dir = workdir('hnd11');
  realHost.write(dir + '/note.txt', 'version one\n');
  const state = () => defaultState({status: nul('?? note.txt|')});
  const first = captureHandoff(handoffHost(state()), dir, {});
  realHost.write(dir + '/note.txt', 'version two with different bytes\n');
  const second = captureHandoff(handoffHost(state()), dir, {});
  assert(first.workspace.handoff_fingerprint_sha256 !== second.workspace.handoff_fingerprint_sha256, 'fingerprint ignored content');
  const third = captureHandoff(handoffHost(defaultState({status: ''})), dir, {});
  assert(second.workspace.handoff_fingerprint_sha256 !== third.workspace.handoff_fingerprint_sha256, 'fingerprint ignored paths');
});

test('HND-14 sensitive untracked paths are listed but never hashed or read', () => {
  const dir = workdir('hnd14');
  realHost.write(dir + '/.env.local', 'SECRET=1\n');
  const view = captureHandoff(handoffHost(defaultState({status: nul('?? .env.local|')})), dir, {});
  assert(view.workspace.untracked.includes('.env.local'), 'path hidden');
  assert(view.limitations.some(x => x.includes('sensitive-looking')), 'sensitive note missing');
  const md = renderHandoff(view, {}).text;
  assert(!md.includes('SECRET=1'), 'secret content leaked');
});

test('HND-15 output is harness-neutral and structurally stable', () => {
  const view = captureHandoff(handoffHost(defaultState()), workdir('hnd15'), {note: 'remember the flaky test'});
  const md = renderHandoff(view, {}).text;
  for (const banned of ['claude', 'codex', 'deepseek', '<system', 'instructions:'])
    assert(!md.toLowerCase().includes(banned), 'platform/injection marker in output: ' + banned);
  assert(md.includes('user-supplied/advisory'), 'note not labelled advisory');
  for (const key of ['schema', 'repository', 'workspace', 'activity', 'references', 'verification', 'blockers', 'suggestions', 'sources', 'limitations', 'generated_at'])
    assert(key in view, 'schema key missing: ' + key);
  assert(view.suggestions.every(s => s.inferred === true), 'suggestions not labelled inferred');
});

print('DAIRN_NATIVE_HANDOFF_RESULT ' + JSON.stringify({engine: 'native-qjs', platform: os.platform, passed: tests.length - failures, failed: failures, tests}));
try { realHost.remove(base); } catch (_) { /* disposable temp dir */ }
std.exit(failures ? 1 : 0);
