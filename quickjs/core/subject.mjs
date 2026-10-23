/* Source Subject is a Git/SCM fact and deliberately does not know Work. */
import {sha256} from './sha256.mjs';

const HEX = /^[0-9a-f]{40,64}$/i;
function ok(value, message) { if (!value) throw Error('Subject: ' + message); }
function git(h, root, args, timeout = 30, optional = false) {
  const result = h.run(['git', ...args], root, timeout);
  if (optional && (result.code !== 0 || result.timedOut)) return null;
  ok(!result.timedOut && result.code === 0, 'Git command failed: ' + args.join(' '));
  return String(result.output || '').trim();
}
function repositoryFromRemote(remote) {
  if (!remote) return null;
  const value = remote.trim().replace(/\.git$/, '');
  const match = /^(?:https?:\/\/|ssh:\/\/|git@)(?:[^/:]+[/:])?(.+)$/.exec(value);
  return match ? match[1] : value;
}
export function validateSubject(subject) {
  const errors = [];
  const check = (value, message) => { if (!value) errors.push(message); };
  check(subject && subject.schema === 'dairn.subject.v1', 'schema must be dairn.subject.v1');
  check(typeof subject?.repository === 'string' && subject.repository.length > 0, 'repository required');
  check(subject?.kind === 'git-commit', 'kind must be git-commit');
  check(HEX.test(subject?.source_commit || ''), 'source_commit must be a full Git SHA');
  check(HEX.test(subject?.tree_sha || ''), 'tree_sha must be a Git tree SHA');
  check(!subject?.base_commit || HEX.test(subject.base_commit), 'base_commit must be a Git SHA');
  check(subject?.comparison === 'base-to-source', 'comparison must be base-to-source');
  if (subject?.change != null) check(typeof subject.change === 'object' && !Array.isArray(subject.change), 'change must be object');
  return errors;
}
export function subjectFromGit(h, root, {base = null, change = null, repository = null, timeout = 30} = {}) {
  const sourceCommit = git(h, root, ['rev-parse', 'HEAD'], timeout);
  const treeSha = git(h, root, ['rev-parse', 'HEAD^{tree}'], timeout);
  const baseCommit = base ? git(h, root, ['rev-parse', '--verify', base + '^{commit}'], timeout) : null;
  const repo = repository || h.env?.('DAIRN_CI_REPOSITORY') ||
    repositoryFromRemote(git(h, root, ['config', '--get', 'remote.origin.url'], timeout, true)) || 'local/repository';
  const subject = {schema:'dairn.subject.v1', repository:repo, kind:'git-commit',
    source_commit:sourceCommit, tree_sha:treeSha, base_commit:baseCommit,
    comparison:'base-to-source'};
  if (change) subject.change = change;
  const errors = validateSubject(subject);
  ok(!errors.length, errors.join('; '));
  return subject;
}
export function subjectDigest(subject) {
  const errors = validateSubject(subject); ok(!errors.length, errors.join('; '));
  return sha256(JSON.stringify(subject));
}
