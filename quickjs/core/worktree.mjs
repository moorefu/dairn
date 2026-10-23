/* Complete declared-input snapshot for local checks. */
import {sha256, sha256Bytes} from './sha256.mjs';

const DATA_PREFIXES = [
  '.dairn/governance/changes/', '.dairn/governance/operations/',
  '.dairn/governance/evidence/', '.dairn/work/', '.dairn/facts/',
  '.dairn/cache/', '.dairn/tmp/'
];
const MAX_FILES = 20000;
const MAX_FILE_BYTES = 64 * 1024 * 1024;

function ok(value, message) { if (!value) throw Error(message); }
function join(root, path) { return root.replace(/\/$/, '') + '/' + path; }
function safePath(path) {
  return typeof path === 'string' && path.length > 0 && !path.startsWith('/') &&
    !path.startsWith('\\') && !/^[A-Za-z]:/.test(path) &&
    !path.split('/').some(x => !x || x === '.' || x === '..' || /[\r\n\0]/.test(x));
}
function git(h, root, args, timeout) {
  const result = h.run(['git', ...args], root, timeout);
  ok(!result.timedOut, 'Git command timed out: ' + args.join(' '));
  ok(result.code === 0, 'Git command failed: ' + args.join(' ') +
    (result.output ? '\n' + result.output.slice(0, 512) : ''));
  return result.output || '';
}
function insideRepo(h, root, timeout) {
  const probe = h.run(['git', 'rev-parse', '--is-inside-work-tree'], root, Math.min(timeout, 30));
  ok(!probe.timedOut, 'Git worktree probe timed out');
  const text = String(probe.output || '').trim();
  if (probe.code === 0 && /^true$/i.test(text)) return true;
  if (probe.code !== 0 && /not a git repository/i.test(text)) return false;
  throw Error('Cannot determine Git worktree state: ' + (text || 'git exit ' + probe.code));
}
function normalizedExclusions(exclude) {
  const result = [];
  const seen = new Set();
  for (const raw of [...DATA_PREFIXES, ...(Array.isArray(exclude) ? exclude : [])]) {
    if (typeof raw !== 'string' || !raw) continue;
    const value = raw.endsWith('/') ? raw.slice(0, -1) : raw;
    if (!safePath(value)) continue;
    const key = raw.endsWith('/') ? value + '/' : value;
    if (!seen.has(key)) { seen.add(key); result.push(key); }
  }
  return result;
}
function listed(h, root, args, timeout) {
  return git(h, root, args, timeout).split('\0').filter(Boolean);
}
function pathExcluded(path, exclusions) {
  return exclusions.some(prefix => prefix.endsWith('/') ?
    (path === prefix.slice(0, -1) || path.startsWith(prefix)) : path === prefix);
}
function fileEntry(h, root, path, status, indexPath) {
  ok(safePath(path), 'Unsafe input path: ' + JSON.stringify(path));
  const absolute = join(root, path);
  ok(!h.isSymlink(absolute), 'Snapshot refuses symlink input: ' + path);
  ok(h.exists(absolute) && !h.isDirectory(absolute), 'Snapshot input is not a regular file: ' + path);
  const bytes = h.readBytes(absolute, MAX_FILE_BYTES);
  return {path, type:'file', mode:null, size:bytes.length, sha256:sha256Bytes(bytes),
    status, index_path:indexPath || null};
}
function nonGitSnapshot() {
  const base = {schema:'dairn.snapshot.v1', source_commit:null, tree_sha:null,
    status:'non-git', input_coverage:'declared-complete', manifest:[], manifest_sha256:sha256('[]'),
    exclusions_sha256:sha256(JSON.stringify(DATA_PREFIXES)), file_count:0, tracked_count:0,
    untracked_count:0, declared_ignored_count:0, uncovered_inputs:[]};
  base.snapshot_sha256 = sha256(JSON.stringify(base));
  base.identity_sha256 = base.snapshot_sha256;
  return base;
}

/* Capture tracked bytes, non-ignored untracked bytes and declared ignored inputs. */
export function captureWorktree(h, root, timeout = 120, exclude = [], options = {}) {
  const opts = options && typeof options === 'object' ? options : {};
  if (!insideRepo(h, root, timeout)) return nonGitSnapshot();
  const exclusions = normalizedExclusions(exclude);
  const pathspec = exclusions.length ? ['--', ...exclusions.map(x => ':(exclude,literal)' + x)] : [];
  const tracked = listed(h, root, ['ls-files', '--cached', '-z', ...pathspec], timeout);
  const untracked = listed(h, root, ['ls-files', '--others', '--exclude-standard', '-z', ...pathspec], timeout);
  const ignoredAll = listed(h, root, ['ls-files', '--others', '--ignored', '--exclude-standard', '-z'], timeout);
  const globs = Array.isArray(opts.input_globs) ? opts.input_globs.filter(x => typeof x === 'string' && x) : [];
  const declaredIgnored = globs.length ? listed(h, root,
    ['ls-files', '--others', '--ignored', '--exclude-standard', '-z', '--', ...globs], timeout) : [];
  const allTracked = [...new Set(tracked)].sort();
  const allUntracked = [...new Set(untracked)].sort();
  const inputPaths = [...new Set([...allTracked, ...allUntracked, ...declaredIgnored])]
    .filter(path => !pathExcluded(path, exclusions)).sort();
  ok(inputPaths.length <= MAX_FILES, 'Snapshot input file count exceeds limit: ' + inputPaths.length);
  const status = git(h, root, ['status', '--porcelain=v1', '--untracked-files=all', '-z', ...pathspec], timeout);
  const entries = [];
  for (const path of inputPaths) {
    const isTracked = allTracked.includes(path);
    const isIgnored = declaredIgnored.includes(path) && !isTracked;
    entries.push(fileEntry(h, root, path, isIgnored ? 'ignored-declared' : isTracked ? 'tracked' : 'untracked',
      isTracked ? path : null));
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  const manifestText = JSON.stringify(entries);
  const uncovered = ignoredAll.filter(path => !declaredIgnored.includes(path)).sort();
  const coverage = uncovered.length ? 'incomplete' : 'declared-complete';
  let sourceCommit = null, treeSha = null;
  try { sourceCommit = git(h, root, ['rev-parse', 'HEAD'], timeout).trim(); } catch (_) {}
  try { treeSha = git(h, root, ['rev-parse', 'HEAD^{tree}'], timeout).trim(); } catch (_) {}
  const result = {
    schema: 'dairn.snapshot.v1', source_commit: sourceCommit, tree_sha: treeSha,
    status: status.length || entries.some(x => x.status !== 'tracked') ? 'dirty' : 'clean',
    input_coverage: coverage, manifest: entries, manifest_sha256: sha256(manifestText),
    exclusions, exclusions_sha256: sha256(JSON.stringify(exclusions)),
    file_count: entries.length, tracked_count: entries.filter(x => x.status === 'tracked').length,
    untracked_count: entries.filter(x => x.status === 'untracked').length,
    declared_ignored_count: entries.filter(x => x.status === 'ignored-declared').length,
    uncovered_inputs: uncovered
  };
  // 快照身份只由被检查的输入闭包决定：exclusions/exclusions_sha256 是调用方
  // 视角（任务证据会随推进增长），同一输入闭包在排除列表变化前后必须保持
  // 相同身份，否则按 sha 绑定的推进校验会自我失效。两者保留为审计元数据。
  const identity = { ...result };
  delete identity.exclusions;
  delete identity.exclusions_sha256;
  result.snapshot_sha256 = sha256(JSON.stringify(identity));
  result.identity_sha256 = result.snapshot_sha256;
  return result;
}

export function sameWorktree(a, b) {
  return !!a && !!b && a.schema === b.schema &&
    a.snapshot_sha256 === b.snapshot_sha256 && a.manifest_sha256 === b.manifest_sha256 &&
    a.input_coverage === b.input_coverage;
}

export function taskExclusions(task) {
  const paths = [];
  if (!task || typeof task !== 'object') return paths;
  for (const stage of task.stages || []) for (const evidence of stage?.evidence || [])
    if (typeof evidence?.path === 'string') paths.push(evidence.path);
  for (const anchor of task.session_anchors || []) if (typeof anchor?.path === 'string') paths.push(anchor.path);
  return paths;
}
