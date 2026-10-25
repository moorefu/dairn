/* Final gate composition. Work state is intentionally absent from this API.
 * PASS/FAIL are deterministic outcomes; INDETERMINATE means required evidence
 * was missing or could not be established (architecture §12) and must exit
 * non-zero in enforcing CI, the same as FAIL.
 * P0 hardening (consolidated plan §2.2/§24.2): the gate consumes (a) the full
 * (module_id, check_id) matrix the trusted policy requires for the risk level,
 * (b) a cryptographically verified attestation result — never a bare
 * statement — and (c) approval verdicts bound to this change's identity. */
import {validateSubject} from './subject.mjs';
import {validateCheckRun} from './evidence.mjs';
import {verifyApproval} from './approval.mjs';
import {validateStatement,isVerifiedAttestation} from './attestation.mjs';
import {sha256} from './sha256.mjs';
import {resolvePolicy, approvalPolicyFor, requiredChecksFor} from './policy-resolver.mjs';

const VERIFIED_ATTESTATION = 'dairn.verified-attestation.v1';
const RISKS = ['L0', 'L1', 'L2'];

function verdict(status, reasons) { return {schema:'dairn.gate-verdict.v1', status, reasons:[...new Set(reasons)]}; }
const STAGES = ['pre-merge','post-merge','release'];

/* Every affected module must have a passing record for every policy-required
 * check (T34): a check that only one module ran never covers another module's
 * cell, and records without module identity prove nothing about coverage.
 * Without an explicit module list, the whole policy module set is required —
 * the conservative superset, since gate inputs alone cannot narrow scope. */
function coverageErrors(policy, risk, run, requestedModules) {
  const resolved = resolvePolicy(policy);
  let required = [];
  try { required = requiredChecksFor(resolved || policy, risk); }
  catch (e) { return [String(e.message || e)]; }
  const policyModules = (resolved?.modules || []).map(m => m?.name).filter(x => typeof x === 'string' && x.length > 0);
  const modules = Array.isArray(requestedModules) && requestedModules.length ? [...new Set(requestedModules)]
    : policyModules.length ? policyModules : null;
  const records = Array.isArray(run?.checks) ? run.checks : [];
  const errors = [];
  if (modules === null) {
    // Policy declares no module granularity: check-id coverage is the best the
    // policy can express; single-module projects are unaffected either way.
    for (const id of required)
      if (!records.some(x => x.id === id && x.status === 'passed')) errors.push('required check missing or failed: ' + id);
    return errors;
  }
  const known = new Set(policyModules);
  for (const name of modules)
    if (policyModules.length && !known.has(name)) errors.push('module not declared by the trusted policy: ' + name);
  for (const name of modules) for (const id of required)
    if (!records.some(x => x.module === name && x.id === id && x.status === 'passed'))
      errors.push('module ' + name + ' lacks a passing required check: ' + id);
  return errors;
}

/* A verified attestation is the output of real Ed25519 verification over the
 * statement bytes with a CI-controlled public key (T35). The gate never
 * upgrades a bare statement JSON into trust. */
function verifiedAttestationErrors(v, subject, check) {
  if (!isVerifiedAttestation(v) || v.schema !== VERIFIED_ATTESTATION)
    return ['attestation must be a verified result (schema ' + VERIFIED_ATTESTATION + ') produced by real Ed25519 verification, not a bare statement'];
  const st = v.statement;
  if (!st || typeof st !== 'object') return ['verified attestation must embed the statement it verified'];
  const errors = validateStatement(st).map(x => 'attestation: ' + x);
  if (typeof v.statement_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(v.statement_sha256))
    errors.push('verified attestation must carry the verified statement digest');
  if (subject && st.subject && (st.subject.commit !== subject.source_commit ||
      st.subject.tree_sha !== subject.tree_sha || st.subject.repository !== subject.repository))
    errors.push('attestation subject does not match the evaluated subject');
  if (check?.run_id && st.run_id && st.run_id !== check.run_id)
    errors.push('attestation covers run ' + st.run_id + ', not the evaluated run ' + check.run_id);
  return errors;
}

export function evaluate(input = {}) {
  const fail = [], pending = [];
  const stage = input.requiredStage || 'pre-merge';
  if (!STAGES.includes(stage)) fail.push('invalid requiredStage: ' + stage);
  const risk = input.risk || 'L2';
  if (!RISKS.includes(risk)) fail.push('invalid risk: ' + risk);
  const subjectErrors = validateSubject(input.subject);
  if (subjectErrors.length) fail.push(...subjectErrors.map(x => 'subject: ' + x));
  const policy = resolvePolicy(input.trustedPolicy || input.policy || null);
  if (!policy) fail.push('trusted policy missing or invalid');
  const checkErrors = validateCheckRun(input.check);
  if (checkErrors.length) fail.push(...checkErrors.map(x => 'check: ' + x));
  if(stage==='pre-merge')pending.push('SCM_ORIGIN_UNVERIFIED: 本地 JSON 不能认证受信 Check/Review 来源；需由受保护 PCC Verifier 实时查询 SCM');
  if (input.check && !checkErrors.length) {
    if (input.check.status !== 'passed') fail.push('required checks did not pass');
    else fail.push(...coverageErrors(input.trustedPolicy || input.policy, risk, input.check, input.modules).map(x => 'coverage: ' + x));
  }
  if (input.subject && input.check?.subject &&
    JSON.stringify(input.subject) !== JSON.stringify(input.check.subject)) fail.push('subject mismatch');
  // Bare statements are the pre-hardening input shape; reject loudly instead of
  // silently re-interpreting them so no caller keeps an insecure invocation.
  if (input.attestation) fail.push('bare attestation statements are not accepted; supply the verified result of `dairn attest verify` (verifiedAttestation)');
  const approvalPolicy = approvalPolicyFor(policy, risk);
  const approvalRequired = stage === 'pre-merge' ? approvalPolicy.required !== false : !!approvalPolicy.min_count;
  if (approvalRequired) {
    if (!input.approval) pending.push('approval evidence missing (cannot determine SCM approval state)');
    else {
      // Change-identity binding (T36): a verdict copied from another
      // repository, PR or head must never authorize this change.
      const binding = [];
      if (input.approval.subject?.repository !== input.subject?.repository) binding.push('repository');
      if (input.approval.subject?.reviewed_head_sha !== input.subject?.source_commit) binding.push('reviewed_head_sha');
      if (input.subject?.change?.number != null && input.approval.subject?.number != null &&
        input.approval.subject.number !== input.subject.change.number) binding.push('number');
      if (binding.length) fail.push('approval verdict is bound to a different change: ' + binding.join('+') + ' mismatch');
      else {
        const approval = verifyApproval(input.approval, approvalPolicy);
        if (approval.status === 'FAIL') fail.push(...approval.reasons.map(x => 'approval: ' + x));
        else if (approval.status === 'INDETERMINATE') pending.push(...approval.reasons.map(x => 'approval: ' + x));
      }
    }
  }
  if (stage === 'post-merge' || stage === 'release') {
    if (!input.verifiedAttestation) pending.push('attestation evidence missing (cannot determine signed evidence)');
    else {
      fail.push(...verifiedAttestationErrors(input.verifiedAttestation,input.subject,input.check));
      if(isVerifiedAttestation(input.verifiedAttestation)){
        const st=input.verifiedAttestation.statement;
        if(!input.checkRaw||sha256(input.checkRaw)!==st.digests?.run_json_sha256)fail.push('RUN_DIGEST_MISMATCH');
        if(input.checkRaw&&JSON.stringify(JSON.parse(input.checkRaw))!==JSON.stringify(input.check))fail.push('RUN_CONTENT_MISMATCH');
        if(st.ci?.stage!==stage)fail.push('ATTESTATION_STAGE_MISMATCH');
        if(st.runtime_sha256!==input.check?.execution?.runtime_sha256)fail.push('RUNTIME_IDENTITY_MISMATCH');
        if(!st.plan_sha256||st.plan_sha256!==input.check?.execution?.check_plan_sha256)fail.push('PLAN_OR_POLICY_MISMATCH');
        if(approvalRequired&&(!input.approvalRaw||sha256(input.approvalRaw)!==st.digests?.approval_snapshot_sha256))fail.push('APPROVAL_DIGEST_MISMATCH');
        if(input.check?.execution?.policy_sha256!==st.policy_sha256||!input.policyRaw||sha256(input.policyRaw)!==st.policy_sha256)fail.push('POLICY_DIGEST_MISMATCH');
      }
    }
  }
  if (fail.length) return verdict('FAIL', fail);
  if (pending.length) return verdict('INDETERMINATE', pending);
  return verdict('PASS', []);
}
