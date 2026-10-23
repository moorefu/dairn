/* Agent handoff (consolidated plan §23): a read-only, offline, derived view
 * of Git facts for whoever picks up the work next. It creates no files,
 * mutates nothing, requires no .dairn/lock.json and no work ledger, never
 * touches the network, and never promotes its own output into evidence —
 * it only references facts whose authoritative home is elsewhere (Git, run
 * evidence files, the SCM platform). Unsaved editor buffers are explicitly
 * out of scope (HND-13). */
import {sha256, sha256Bytes} from './sha256.mjs';

const MAX_COMMITS = 50;
const RECENT_COMMITS = 20;
const MAX_UNTRACKED_FINGERPRINT = 200;
const MAX_FILE_BYTES = 64 * 1024;
const SENSITIVE = [/(^|\/)\.env($|\.)/i, /(^|\/)(id_rsa|id_ed25519|\.npmrc|\.netrc|credentials?|secrets?)(\.|$|\/)/i, /\.(pem|key|p12|pfx)$/i];

function join(root, path) { return root.replace(/\/$/, '') + '/' + path; }
function ok(value, message) { if (!value) throw Error('Handoff: ' + message); }
function isSensitive(path) { return SENSITIVE.some(re => re.test(path)); }

/* Only-read Git access: every failure degrades to null (best effort) unless
 * the caller explicitly demanded the value. */
function git(h, root, args, timeout, required = false) {
  const result = h.run(['git', ...args], root, timeout);
  if (result.timedOut) { if (required) ok(false, 'git timed out: ' + args.join(' ')); return null; }
  if (result.code !== 0) { if (required) ok(false, 'git failed: ' + args.join(' ') + ' — ' + String(result.output || '').slice(0, 200)); return null; }
  return String(result.output || '');
}

/* `git status --porcelain=v1 -z`: entries are `XY <path>\0` and renames carry
 * the original path as a second NUL-terminated field. */
function parseStatus(raw) {
  const staged = [], unstaged = [], untracked = [];
  const parts = String(raw || '').split('\0');
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (!entry) continue;
    const x = entry[0], y = entry[1], path = entry.slice(3);
    if (!path) continue;
    if (x === 'R' || y === 'R') {
      const origin = parts[++i] || '';
      staged.push({path: origin + ' -> ' + path, rename: true});
      continue;
    }
    if (entry.startsWith('??')) { untracked.push(path); continue; }
    if (x !== ' ' && x !== '?') staged.push({path});
    if (y !== ' ' && y !== '?') unstaged.push({path});
  }
  return {staged, unstaged, untracked};
}

/* `git log --pretty=format:%H%x00%h%x00%s`: one commit per line, NUL between
 * the fields inside a line (a subject is a single line by definition). */
function parseLog(raw) {
  return String(raw || '').split('\n').filter(Boolean).map(line => {
    const [sha, short, subject] = line.split('\0');
    return sha ? {sha, short: short || sha.slice(0, 7), subject: subject || ''} : null;
  }).filter(Boolean);
}

/* `git diff --name-status -z`: plain entries are `A\0path\0`; renames are
 * `R<score>\0<old>\0<new>\0` — the OLD path comes first here, the opposite
 * of `git status --porcelain -z` rename records. */
function parseNameStatus(raw) {
  const out = [];
  const parts = String(raw || '').split('\0');
  for (let i = 0; i < parts.length; i++) {
    const status = parts[i];
    if (!status) continue;
    if (status[0] === 'R' || status[0] === 'C') {
      const origin = parts[i + 1], next = parts[i + 2];
      if (origin != null && next != null) { out.push({status: status[0], path: next, from: origin}); i += 2; continue; }
    }
    const next = parts[i + 1];
    if (next == null) break;
    out.push({status: status[0], path: next});
    i += 1;
  }
  return out;
}

/* Lightweight workspace fingerprint: HEAD + the actual staged/unstaged diff
 * digests + bounded content digests of untracked files. This is NOT a check
 * snapshot and never a CI attestation; re-running handoff and comparing
 * fingerprints is how the next agent detects staleness (HND-11). */
function fingerprint(h, root, head, status, timeout, limitations) {
  const stagedDiff = git(h, root, ['diff', '--cached', '--binary', 'HEAD'], timeout) ?? '';
  const unstagedDiff = git(h, root, ['diff', '--binary', 'HEAD'], timeout) ?? '';
  const untracked = [];
  let coverage = 'complete';
  const list = [...status.untracked].sort();
  if (list.length > MAX_UNTRACKED_FINGERPRINT) {
    coverage = 'partial';
    limitations.push('untracked fingerprint truncated at ' + MAX_UNTRACKED_FINGERPRINT + ' of ' + list.length + ' files');
  }
  for (const path of list.slice(0, MAX_UNTRACKED_FINGERPRINT)) {
    try {
      const absolute = join(root, path);
      ok(!h.isSymlink(absolute), 'refusing symlinked untracked input: ' + path);
      if (isSensitive(path)) { untracked.push({path, sha256: null, redacted: true}); continue; }
      const bytes = h.readBytes(absolute, MAX_FILE_BYTES);
      untracked.push({path, sha256: sha256Bytes(bytes)});
    } catch (e) { coverage = 'partial'; }
  }
  const value = JSON.stringify({head, staged: sha256(stagedDiff), unstaged: sha256(unstagedDiff), untracked});
  return {handoff_fingerprint_sha256: sha256(value), coverage};
}

/* Local run evidence: distinguish observed-locally from stale from unknown.
 * Handoff never claims verified/ci-verified — that is the signed chain's call. */
function verificationView(h, root, head, limitations) {
  const runsDir = join(root, '.dairn/governance/evidence/runs');
  const result = {local_observed: [], stale: [], unknown: []};
  if (!h.exists(runsDir)) return result;
  const commits = (h.list(runsDir) || []).filter(x => /^[0-9a-f]{40,64}$/i.test(x));
  for (const commit of commits) {
    const dir = join(runsDir, commit);
    if (!h.isDirectory(dir)) continue;
    for (const runId of h.list(dir) || []) {
      const file = join(dir, runId + '/run.json');
      if (!h.exists(file)) continue;
      try {
        const run = JSON.parse(h.read(file));
        const item = {run_id: run.run_id || runId, status: run.status || 'unknown',
          declared_assurance: run.declared_assurance || null};
        if (commit === head) result.local_observed.push(item);
        else { item.subject_commit = commit; result.stale.push(item); }
      } catch (e) {
        result.unknown.push({run_id: runId, subject_commit: commit, reason: 'unreadable run evidence'});
      }
    }
  }
  if (result.stale.length > 5) { result.stale = result.stale.slice(0, 5); limitations.push('stale run list truncated to 5 of more'); }
  return result;
}

function referencesView(h, root, taskId, limitations) {
  const refs = {specs: [], tasks: [], refactors: [], evidence: [], pr: []};
  const changes = join(root, '.dairn/governance/changes');
  if (h.exists(changes)) for (const name of h.list(changes) || [])
    if (name.endsWith('.json')) refs.specs.push('.dairn/governance/changes/' + name);
  const work = join(root, '.dairn/work');
  if (h.exists(work)) for (const name of h.list(work) || []) {
    if (!name.endsWith('.json')) continue;
    const rel = '.dairn/work/' + name;
    let item = {path: rel, status: 'unreadable'};
    try {
      const task = JSON.parse(h.read(join(root, rel)));
      item = {id: task.id || name.replace(/\.json$/, ''), path: rel,
        stage: (task.stages || []).find(s => s.status === 'active')?.id || null,
        status: task.status || 'active'};
    } catch (_) { limitations.push('work ledger unreadable: ' + rel); }
    if (taskId ? item.id === taskId || name === taskId + '.json' : true) refs.tasks.push(item);
  }
  else if (taskId) limitations.push('no work ledger directory; --task ' + taskId + ' cannot be resolved');
  if (taskId && !refs.tasks.some(x => x.id === taskId)) limitations.push('task not found: ' + taskId);
  const refactors = join(root, '.dairn/governance/refactors');
  if (h.exists(refactors)) for (const name of h.list(refactors) || [])
    if (name.endsWith('.json')) refs.refactors.push('.dairn/governance/refactors/' + name);
  return refs;
}

export function captureHandoff(h, root, {base = null, task = null, note = null, timeout = 30} = {}) {
  const limitations = [];
  const sources = ['git-local'];
  const head = git(h, root, ['rev-parse', '--verify', 'HEAD^{commit}'], timeout, true).trim();
  const branchRaw = git(h, root, ['rev-parse', '--abbrev-ref', 'HEAD'], timeout);
  const branch = branchRaw ? branchRaw.trim() : null;
  const detached = branch === 'HEAD';
  if (detached) limitations.push('detached HEAD: branch name unavailable');
  /* Base resolution (§23.4): explicit --base must resolve; otherwise try the
   * common upstream defaults' merge-base; never guess a range silently. */
  let baseSha = null, baseSource = 'unavailable';
  if (base) {
    const resolved = git(h, root, ['rev-parse', '--verify', base + '^{commit}'], timeout);
    ok(resolved, '--base must resolve to an existing commit: ' + base);
    baseSha = resolved.trim();
    baseSource = 'explicit';
  } else {
    for (const ref of ['origin/main', 'origin/master']) {
      const mergeBase = git(h, root, ['merge-base', 'HEAD', ref], timeout);
      if (mergeBase && mergeBase.trim()) { baseSha = mergeBase.trim(); baseSource = 'merge-base:' + ref; sources.push('git-local'); break; }
    }
    if (!baseSha) limitations.push('no --base given and no origin/main (origin/master) merge-base; showing recent commits only');
  }
  /* Committed activity: since-base changes, or a bounded recent window when
   * HEAD already sits on the base (prevents an empty summary on main). */
  let commits = [], changes = [], range = 'unavailable';
  if (baseSha && baseSha !== head) {
    range = 'since-base';
    commits = parseLog(git(h, root, ['log', '--pretty=format:%H%x00%h%x00%s', '-n', String(MAX_COMMITS), baseSha + '..' + head], timeout));
    changes = parseNameStatus(git(h, root, ['diff', '--name-status', '-z', '--diff-filter=ACDMRT', baseSha, head], timeout));
  } else {
    range = baseSha === head ? 'recent-commits' : 'recent-commits';
    commits = parseLog(git(h, root, ['log', '--pretty=format:%H%x00%h%x00%s', '-n', String(RECENT_COMMITS), head], timeout));
    if (baseSha === head) limitations.push('HEAD equals the resolved base; listing recent commits instead of a base-to-head range');
  }
  const shallow = git(h, root, ['rev-parse', '--is-shallow-repository'], timeout);
  if (shallow && shallow.trim() === 'true') limitations.push('shallow clone: history may be incomplete');
  /* Working tree: paths only, never contents. */
  const status = parseStatus(git(h, root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], timeout, true));
  const fp = fingerprint(h, root, head, status, timeout, limitations);
  if (status.untracked.some(isSensitive))
    limitations.push('sensitive-looking untracked paths present; contents were neither read nor hashed');
  const verification = verificationView(h, root, head, limitations);
  const references = referencesView(h, root, task, limitations);
  /* Blockers are evidence-backed only; suggestions are inferred and labelled. */
  const blockers = [];
  const latest = verification.local_observed[verification.local_observed.length - 1];
  if (latest && latest.status === 'failed')
    blockers.push({reason: 'latest local run evidence for this HEAD failed', run_id: latest.run_id});
  const suggestions = [];
  if (status.staged.length || status.unstaged.length || status.untracked.length)
    suggestions.push('inspect the dirty working tree before building on it: git status / git diff');
  if (!verification.local_observed.length)
    suggestions.push('no local check evidence for this HEAD; run dairn check (or the project equivalent) when a change is ready');
  if (baseSha && baseSha !== head)
    suggestions.push('review committed changes since ' + baseSha.slice(0, 12) + ' before continuing');
  const remote = git(h, root, ['config', '--get', 'remote.origin.url'], timeout);
  const handoff = {
    schema: 'dairn.handoff.v1',
    repository: {remote: remote ? remote.trim() : null, branch: detached ? null : branch,
      head_sha: head, base_sha: baseSha, base_source: baseSource, detached},
    workspace: {status: (status.staged.length + status.unstaged.length + status.untracked.length) ? 'dirty' : 'clean',
      handoff_fingerprint_sha256: fp.handoff_fingerprint_sha256, coverage: fp.coverage,
      staged: status.staged, unstaged: status.unstaged, untracked: [...status.untracked]},
    activity: {range, commits, changes},
    references, verification, blockers,
    suggestions: suggestions.map(text => ({text, kind: 'suggestion', inferred: true})),
    note: note ? {text: String(note), trust: 'user-supplied/advisory'} : null,
    sources, limitations,
    generated_at: h.now(),
  };
  return handoff;
}
