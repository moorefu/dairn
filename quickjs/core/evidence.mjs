/* Immutable Check Run and Evidence Bundle helpers. */
import {sha256} from './sha256.mjs';
import {validateSubject} from './subject.mjs';

const HEX = /^[0-9a-f]{64}$/;
const ID = /^run-[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/;
function ok(value, message) { if (!value) throw Error('Evidence: ' + message); }
function safeRel(path) { return typeof path === 'string' && path.length > 0 && !path.startsWith('/') &&
  !path.includes('\\') && !path.split('/').some(x => !x || x === '.' || x === '..'); }
function filePath(h, root, path) {
  ok(safeRel(path), 'unsafe evidence path'); let current = root;
  for (const part of path.split('/')) { current = current.replace(/\/$/, '') + '/' + part; ok(!h.isSymlink(current), 'symlinked evidence path'); }
  return current;
}
function uniqueRunId() { return 'run-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12); }
export function validateCheckRun(run, {policy = null} = {}) {
  const errors = [];
  const check = (value, message) => { if (!value) errors.push(message); };
  check(run && run.schema === 'dairn.check-run.v1', 'schema must be dairn.check-run.v1');
  check(ID.test(run?.run_id || ''), 'run_id invalid');
  const subjectErrors = validateSubject(run?.subject);
  errors.push(...subjectErrors.map(x => 'subject: ' + x));
  check(run?.execution && typeof run.execution === 'object', 'execution required');
  check(['passed','failed','invalidated'].includes(run?.status), 'status invalid');
  check(['local-observed','ci-verified'].includes(run?.declared_assurance), 'declared_assurance invalid');
  check(Array.isArray(run?.required_checks), 'required_checks must be array');
  check(Array.isArray(run?.checks), 'checks must be array');
  // Self-consistency independent of any policy: a run claiming success must
  // actually contain a passing record for every check it declares required.
  if (run?.status === 'passed' && Array.isArray(run?.checks) && Array.isArray(run?.required_checks))
    for (const required of run.required_checks)
      check(run.checks.some(x => x.id === required && x.status === 'passed'), 'passed run lacks a passing required check: ' + required);
  if (Array.isArray(run?.checks)) for (const item of run.checks) {
    check(item && typeof item.id === 'string' && item.id.length > 0, 'check id required');
    check(['passed','failed','missing','timeout','error'].includes(item?.status), 'check status invalid');
    if (item?.status === 'passed') check(item.exit_code === 0 || item.returncode === 0, 'passed check must have zero exit');
  }
  if (policy && Array.isArray(run.required_checks)) for (const required of policy) {
    const matches = run.checks.filter(x => x.id === required);
    check(matches.length === 1 && matches[0].status === 'passed', 'required check missing or failed: ' + required);
  }
  return errors;
}
export function newRunId() { return uniqueRunId(); }
export function createCheckRun({subject, execution, required_checks = [], checks = [], status = null,
  declared_assurance = 'local-observed', related_tasks = [], run_id = null, now = null} = {}) {
  const passed = checks.length > 0 && checks.every(x => x.status === 'passed' && (x.exit_code ?? x.returncode) === 0) &&
    required_checks.every(id => checks.some(x => x.id === id && x.status === 'passed'));
  const run = {schema:'dairn.check-run.v1', run_id:run_id || uniqueRunId(), subject,
    execution, required_checks:[...required_checks], checks:[...checks],
    status:status || (passed ? 'passed' : 'failed'), declared_assurance,
    related_tasks:Array.isArray(related_tasks) ? [...related_tasks] : []};
  if (now) run.created_at = now;
  const errors = validateCheckRun(run); ok(!errors.length, errors.join('; '));
  return run;
}
export function writeRunEvidence(h, root, run, {path = null, overwrite = false} = {}) {
  const errors = validateCheckRun(run); ok(!errors.length, errors.join('; '));
  const rel = path || '.dairn/governance/evidence/runs/' + run.subject.source_commit + '/' + run.run_id + '/run.json';
  const absolute = filePath(h, root, rel); ok(overwrite || !h.exists(absolute), 'refuse to overwrite run evidence');
  h.mkdirs(absolute.slice(0, absolute.lastIndexOf('/')));
  const raw = JSON.stringify(run, null, 2) + '\n';
  if (overwrite) h.write(absolute, raw); else h.writeExclusive(absolute, raw);
  return {path:rel, run_id:run.run_id, run_sha256:sha256(raw), status:run.status};
}
export function verifyRunBytes(h, root, path, expectedSha = null) {
  const absolute = filePath(h, root, path); ok(h.exists(absolute), 'missing evidence: ' + path);
  const raw = h.read(absolute); if (expectedSha) ok(sha256(raw) === expectedSha, 'evidence digest changed');
  const run = JSON.parse(raw); const errors = validateCheckRun(run); ok(!errors.length, errors.join('; '));
  return {run, raw, sha256:sha256(raw)};
}
export function bundleFor(h, root, runPath, extras = {}) {
  const checked = verifyRunBytes(h, root, runPath);
  const bundle = {schema:'dairn.evidence-bundle.v1', run:checked.run, files:{run_json:{path:runPath, sha256:checked.sha256}}, ...extras};
  bundle.bundle_sha256 = sha256(JSON.stringify(bundle));
  return bundle;
}
/* Independent bundle verification: every listed file must exist with the exact
 * recorded digest (ATST-01); the index itself grants no trust (ATST-07). */
export function verifyBundle(h, root, bundlePath) {
  const absolute = filePath(h, root, bundlePath);
  ok(h.exists(absolute), 'missing bundle: ' + bundlePath);
  const bundle = JSON.parse(h.read(absolute));
  ok(bundle?.schema === 'dairn.evidence-bundle.v1', 'invalid bundle schema');
  const files = [];
  let valid = true;
  for (const [name, entry] of Object.entries(bundle.files || {})) {
    const item = {name, path:entry?.path || null, expected:entry?.sha256 || null, ok:false};
    try {
      ok(typeof item.path === 'string' && safeRel(item.path), 'unsafe path in bundle: ' + name);
      ok(typeof item.expected === 'string' && /^[0-9a-f]{64}$/.test(item.expected), 'invalid digest in bundle: ' + name);
      const file = filePath(h, root, item.path);
      ok(h.exists(file), 'missing file: ' + item.path);
      item.ok = sha256(h.read(file)) === item.expected;
      if (!item.ok) item.reason = 'digest mismatch';
    } catch (e) { item.reason = e.message; }
    valid = valid && item.ok;
    files.push(item);
  }
  const runEntry = files.find(x => x.name === 'run_json');
  let runErrors = [];
  if (runEntry?.ok) { try { runErrors = validateCheckRun(JSON.parse(h.read(filePath(h, root, runEntry.path)))); } catch (e) { runErrors = [String(e.message || e)]; } }
  else runErrors = ['run evidence not verifiable'];
  return {schema:'dairn.evidence-bundle.v1', status: valid && !runErrors.length ? 'verified' : 'failed',
    run_id: bundle.run?.run_id ?? null,
    files, run_validation:runErrors};
}
export function inspectBundle(bundle) {
  ok(bundle && bundle.schema === 'dairn.evidence-bundle.v1', 'invalid bundle schema');
  const errors = validateCheckRun(bundle.run); ok(!errors.length, errors.join('; '));
  ok(typeof bundle.files?.run_json?.sha256 === 'string' && /^[0-9a-f]{64}$/.test(bundle.files.run_json.sha256), 'bundle run digest missing');
  return {schema:bundle.schema, run_id:bundle.run.run_id, status:bundle.run.status,
    subject:bundle.run.subject, bundle_sha256:bundle.bundle_sha256 || null};
}
