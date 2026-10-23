/* Refactor governance (consolidated plan §13): optional cross-PR contracts
 * carrying behavior baselines, allowed transitional debt and exit conditions.
 * A contract can only ADD assurance requirements (the planner appends its
 * checks); 'refactor' intent never lowers risk (§13.4). Debt comparison
 * separates known baseline failures from NEW failures — known debt never
 * swallows fresh regressions (T26), and exit conditions that cannot be
 * verified locally are reported as such, never silently passed (T25). */
import {sha256} from './sha256.mjs';

function ok(value, message) { if (!value) throw Error('Refactor: ' + message); }
function join(root, path) { return root.replace(/\/$/, '') + '/' + path; }
function safeRel(path) { return typeof path === 'string' && path.length > 0 && !path.startsWith('/') &&
  !path.includes('\\') && !path.split('/').some(x => !x || x === '.' || x === '..'); }

export function locateContract(h, root, id) {
  ok(/^[a-z0-9][a-z0-9-]*$/.test(String(id || '')), 'unsafe refactor id: ' + id);
  const rel = '.dairn/governance/refactors/' + id + '.json';
  const path = join(root, rel);
  ok(h.exists(path) && !h.isSymlink(path), 'refactor contract not found: ' + rel);
  const contract = JSON.parse(h.read(path));
  ok(contract.schema === 'dairn.refactor.v1' && contract.id === id, 'contract schema/id mismatch: ' + rel);
  return {contract, rel, path};
}

/* The latest locally recorded run for a commit (or a specific run id). */
export function locateRun(h, root, {commit = null, runId = null} = {}) {
  const runsRoot = join(root, '.dairn/governance/evidence/runs');
  ok(h.exists(runsRoot), 'no local run evidence directory');
  const heads = commit ? [commit] : (h.list(runsRoot) || []).filter(x => /^[0-9a-f]{40,64}$/i.test(x)).sort();
  for (const head of [...heads].reverse()) {
    const dir = join(runsRoot, head);
    if (!h.isDirectory(dir)) continue;
    const ids = (h.list(dir) || []).sort();
    for (const id of [...ids].reverse()) {
      if (runId && id !== runId) continue;
      const rel = '.dairn/governance/evidence/runs/' + head + '/' + id + '/run.json';
      const run = JSON.parse(h.read(join(root, rel)));
      ok(run.schema === 'dairn.check-run.v1', 'not a v1 run: ' + rel);
      return {run, rel};
    }
  }
  ok(false, runId ? 'run not found: ' + runId : 'no local run evidence found');
}

/* Compare a run against the contract's debt baseline (§13.4): a failing
 * check whose recorded failure signature matches the baseline stays known
 * debt; anything else is a NEW failure and blocks. */
export function compareDebt(contract, run) {
  ok(contract && run, 'contract and run required');
  const known = new Map();
  for (const failure of (contract.debt || {}).known_failures || []) {
    const key = (failure.module ? failure.module + ':' : '') + failure.check_id;
    known.set(key, failure);
  }
  const knownFailures = [], newFailures = [], changedSignatures = [];
  for (const check of run.checks || []) {
    if (check.status === 'passed') continue;
    const key = (check.module ? check.module + ':' : '') + check.id;
    const baseline = known.get(key);
    const signature = sha256(String(check.reason || check.status || '')).slice(0, 16);
    const item = {check_id: check.id, module: check.module || null, status: check.status, signature};
    if (!baseline) { newFailures.push(item); continue; }
    if (baseline.signature && baseline.signature.slice(0, 16) !== signature) {
      changedSignatures.push({...item, baseline_signature: String(baseline.signature).slice(0, 16)});
      continue;
    }
    knownFailures.push(item);
  }
  /* Baseline entries that no longer fail are retired debt — good news. */
  const stillFailing = new Set([...knownFailures, ...changedSignatures].map(x => (x.module ? x.module + ':' : '') + x.check_id));
  const retiredFailures = [...known.entries()]
    .filter(([key]) => !stillFailing.has(key))
    .map(([key, failure]) => ({check_id: failure.check_id, module: failure.module || null}));
  return {schema: 'dairn.refactor-compare.v1', refactor: contract.id, run_id: run.run_id,
    subject_commit: run.subject?.source_commit || null,
    status: newFailures.length ? 'new-failures' : changedSignatures.length ? 'signature-drift' : 'within-baseline',
    known_failures: knownFailures, new_failures: newFailures, signature_drift: changedSignatures,
    retired_failures: retiredFailures};
}

/* Exit conditions: only what local evidence can actually establish is judged;
 * the rest are listed as unverified so nobody mistakes silence for a pass. */
export function verifyExitConditions(contract, run, comparison) {
  const checked = [], unverified = [];
  const conditions = (contract.migration || {}).exit_conditions || [];
  if (conditions.includes('no-new-failures-beyond-baseline'))
    checked.push({condition: 'no-new-failures-beyond-baseline',
      status: comparison.status === 'within-baseline' ? 'pass' : 'fail',
      detail: comparison.status});
  for (const condition of conditions)
    if (!checked.some(x => x.condition === condition))
      unverified.push({condition, reason: 'cannot be established from local run evidence; requires review or dedicated checks'});
  if (!conditions.length)
    unverified.push({condition: null, reason: 'contract defines no exit conditions; closure cannot be judged'});
  const status = checked.some(x => x.status === 'fail') ? 'fail'
    : unverified.length ? 'needs-review' : 'pass';
  return {schema: 'dairn.refactor-verify.v1', refactor: contract.id, run_id: run.run_id,
    status, checked, unverified};
}

/* Write a new contract (explicit --apply only). */
export function writeContract(h, root, contract, {apply = false} = {}) {
  ok(contract && contract.schema === 'dairn.refactor.v1' && contract.id, 'contract invalid');
  const rel = '.dairn/governance/refactors/' + contract.id + '.json';
  ok(safeRel(rel), 'unsafe contract path');
  const path = join(root, rel);
  ok(!h.exists(path), 'refuse to overwrite existing contract: ' + rel);
  if (!apply) return {applied: false, path: rel,
    contract, note: 'read-only plan; writing requires --apply'};
  h.mkdirs(join(root, '.dairn/governance/refactors'));
  h.writeExclusive(path, JSON.stringify(contract, null, 2) + '\n');
  return {applied: true, path: rel, note: 'contract written; it now adds requirements for matching changes'};
}
