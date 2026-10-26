/* Detached Ed25519 statement protocol. Signing is performed by protected CI. */
import {sha256} from './sha256.mjs';
import {validateSubject} from './subject.mjs';
import {verifyBundle} from './evidence.mjs';

function ok(value, message) { if (!value) throw Error('Attestation: ' + message); }
function safeRel(path) { return typeof path === 'string' && path.length > 0 && !path.startsWith('/') &&
  !path.includes('\\') && !path.split('/').some(x => !x || x === '.' || x === '..'); }
const verifiedResults=new WeakSet();
function freeze(value){if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
export function isVerifiedAttestation(value){return !!value&&verifiedResults.has(value);}
function repoFile(h, root, path) {
  ok(safeRel(path), 'unsafe repository path'); let current = root;
  for (const part of path.split('/')) { current = current.replace(/\/$/, '') + '/' + part; ok(!h.isSymlink(current), 'symlinked path'); }
  return current;
}
function readJson(h, root, path) { const file = repoFile(h, root, path); ok(h.exists(file), 'missing file: ' + path); return {raw:h.read(file), value:JSON.parse(h.read(file))}; }
function contextFields(context) {
  return {provider:context.provider || context.ci_provider || null, repository:context.repository || context.ci_repository || null,
    workflow_ref:context.workflow_ref || context.ci_workflow || null, pipeline_id:context.pipeline_id || context.ci_pipeline_id || null,
    build_job_id:context.build_job_id || context.ci_build_job_id || null, source_commit:context.source_commit || null,
    event:context.event || null,stage:context.stage||'post-merge'};
}
export function statementForRun(run, digests = {}, context = {}, signer = {}) {
  const errors = validateSubject(run?.subject); ok(!errors.length, errors.join('; '));
  ok(run.status === 'passed', 'cannot attest a non-passing run');
  const ci = contextFields(context);
  ok(ci.provider && ci.repository && ci.pipeline_id && ci.build_job_id, 'trusted CI context incomplete');
  return {schema:'dairn.attestation.v1', type:'dairn.ci.evidence.v1',scope:'machine-assurance',human_approval:'delegated-to-scm', subject:{repository:run.subject.repository,
    commit:run.subject.source_commit, tree_sha:run.subject.tree_sha}, run_id:run.run_id,
    digests:{run_json_sha256:digests.run_json_sha256 || digests.run_sha256 || null,
      logs_manifest_sha256:digests.logs_manifest_sha256 || null, origin_json_sha256:digests.origin_json_sha256 || null,
      decision_json_sha256:digests.decision_json_sha256 || null},
    ...(digests.approval_snapshot_sha256?{audit:{scope:'snapshot-bytes-only',approval_snapshot_sha256:digests.approval_snapshot_sha256}}:{}),
    plan_sha256:run.execution?.check_plan_sha256||null,policy_sha256:run.execution?.policy_sha256 || null, runtime_sha256:run.execution?.runtime_sha256 || null,
    ci, signer:{key_id:signer.key_id || context.key_id || null, algorithm:'Ed25519'}};
}
export function statementBytes(statement) { return JSON.stringify(statement) + '\n'; }
export function validateStatement(statement) {
  const errors = [];
  const check = (value, message) => { if (!value) errors.push(message); };
  check(statement?.schema === 'dairn.attestation.v1', 'schema must be dairn.attestation.v1');
  check(statement?.type === 'dairn.ci.evidence.v1', 'type invalid');
  check(statement?.scope==='machine-assurance'&&statement?.human_approval==='delegated-to-scm','statement scope must be machine-assurance with SCM approval delegation');
  check(statement?.digests?.approval_snapshot_sha256===undefined,'approval snapshot belongs in optional audit scope');
  if(statement?.audit)check(statement.audit.scope==='snapshot-bytes-only'&&/^[0-9a-f]{64}$/.test(statement.audit.approval_snapshot_sha256||''),'audit snapshot scope/digest invalid');
  check(typeof statement?.subject?.repository === 'string' && statement.subject.repository.length > 0, 'subject.repository required');
  check(/^[0-9a-f]{40,64}$/i.test(statement?.subject?.commit || ''), 'subject.commit invalid');
  check(/^[0-9a-f]{40,64}$/i.test(statement?.subject?.tree_sha || ''), 'subject.tree_sha invalid');
  check(/^run-[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/.test(statement?.run_id || ''), 'run_id invalid');
  for (const field of ['run_json_sha256','logs_manifest_sha256','origin_json_sha256','decision_json_sha256'])
    if (field !== 'logs_manifest_sha256' || statement?.digests?.[field] != null) check(!statement?.digests?.[field] || /^[0-9a-f]{64}$/i.test(statement.digests[field]), field + ' invalid');
  check(typeof statement?.ci?.provider === 'string' && statement.ci.provider.length > 0, 'ci.provider required');
  check(typeof statement?.ci?.repository === 'string' && statement.ci.repository.length > 0, 'ci.repository required');
  check(typeof statement?.ci?.pipeline_id === 'string' && statement.ci.pipeline_id.length > 0, 'ci.pipeline_id required');
  check(typeof statement?.ci?.build_job_id === 'string' && statement.ci.build_job_id.length > 0, 'ci.build_job_id required');
  return errors;
}
export function verifyAttestationStatement(statement, context = {}) {
  const errors = validateStatement(statement);
  if (errors.length) return {status:'FAIL', reasons:errors};
  const expected = contextFields(context);
  const reasons = [];
  for (const field of ['provider','repository','workflow_ref','pipeline_id','build_job_id','source_commit','stage'])
    if (expected[field] != null && statement.ci[field] !== expected[field]) reasons.push('CI context mismatch: ' + field);
  if (expected.repository && statement.subject.repository !== expected.repository) reasons.push('subject repository mismatch');
  if (expected.source_commit && statement.subject.commit !== expected.source_commit) reasons.push('subject commit mismatch');
  return {status:reasons.length ? 'FAIL' : 'PASS', reasons};
}
function prepareBundleAttestation(h, root, bundlePath, context, outPath) {
  ok(verifyBundle(h,root,bundlePath).status==='verified','bundle file digest verification failed');
  const bundle = readJson(h, root, bundlePath).value;
  ok(bundle?.schema === 'dairn.evidence-bundle.v1', 'invalid bundle');
  const run = bundle.run; const digests = {};
  for (const [key, item] of Object.entries(bundle.files || {})) if (item?.sha256) digests[key + '_sha256'] = item.sha256;
  if (bundle.files?.run_json?.sha256) digests.run_json_sha256 = bundle.files.run_json.sha256;
  const statement = statementForRun(run, digests, context || {});
  const errors = validateStatement(statement); ok(!errors.length, errors.join('; '));
  const raw = statementBytes(statement); const output = outPath || bundlePath.replace(/bundle\.json$/, 'statement.json');
  const file = repoFile(h, root, output); ok(!h.exists(file), 'refuse to overwrite statement'); h.writeExclusive(file, raw);
  return {path:output, statement, statement_sha256:sha256(raw)};
}
function verifyStatementFiles(h, root, statementPath, signaturePath, publicKeyPath, context = {}) {
  ok(publicKeyPath && (publicKeyPath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(publicKeyPath)), 'public key must be absolute');
  ok(!publicKeyPath.startsWith(root + '/'), 'public key must be outside project');
  ok(h.exists(publicKeyPath) && !h.isSymlink(publicKeyPath), 'public key missing/unsafe');
  const statementFile = repoFile(h, root, statementPath), signatureFile = repoFile(h, root, signaturePath);
  ok(h.exists(statementFile) && h.exists(signatureFile), 'signed statement or signature missing');
  const raw = h.read(statementFile); ok(raw.length <= 65536, 'statement too large');
  const statement = JSON.parse(raw); const verdict = verifyAttestationStatement(statement, context);
  ok(verdict.status === 'PASS', verdict.reasons.join('; '));
  const result = h.run(['openssl','pkeyutl','-verify','-pubin','-inkey',publicKeyPath,'-rawin','-in',statementFile,'-sigfile',signatureFile], root, 30);
  ok(!result.timedOut && result.code === 0, 'signature verification failed');
  const verified={schema:'dairn.verified-attestation.v1',status:'PASS',statement_sha256:sha256(raw),key_sha256:sha256(h.read(publicKeyPath)),statement,statement_path:statementPath,signature:signaturePath};
  freeze(verified);verifiedResults.add(verified);return verified;
}

/* Q9: no compatibility layer for pre-v1 task-ledger attestations. The only
 * prepare/verify surface is the detached Ed25519 v1 statement protocol over
 * evidence bundles produced by the protected CI chain. */
export function prepareAttestation(h, root, bundlePath, context = {}, outPath) {
  return prepareBundleAttestation(h, root, bundlePath, context, outPath);
}
export function verifyAttestation(h, root, statementPath, signaturePath, publicKeyPath, context = {}) {
  return verifyStatementFiles(h, root, statementPath, signaturePath, publicKeyPath, context);
}
