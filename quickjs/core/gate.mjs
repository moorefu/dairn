/* Final gate composition. Work state is intentionally absent from this API.
 * PASS/FAIL are deterministic outcomes; INDETERMINATE means required evidence
 * was missing or could not be established (architecture §12) and must exit
 * non-zero in enforcing CI, the same as FAIL. */
import {validateSubject} from './subject.mjs';
import {validateCheckRun} from './evidence.mjs';
import {verifyApproval} from './approval.mjs';
import {verifyAttestationStatement} from './attestation.mjs';
import {resolvePolicy, approvalPolicyFor} from './policy-resolver.mjs';

function verdict(status, reasons) { return {schema:'dairn.gate-verdict.v1', status, reasons:[...new Set(reasons)]}; }
const STAGES = ['pre-merge','post-merge','release'];
export function evaluate(input = {}) {
  const fail = [], pending = [];
  const stage = input.requiredStage || 'pre-merge';
  if (!STAGES.includes(stage)) fail.push('invalid requiredStage: ' + stage);
  const subjectErrors = validateSubject(input.subject);
  if (subjectErrors.length) fail.push(...subjectErrors.map(x => 'subject: ' + x));
  const policy = resolvePolicy(input.trustedPolicy || input.policy || null);
  if (!policy) fail.push('trusted policy missing or invalid');
  const checkErrors = validateCheckRun(input.check);
  if (checkErrors.length) fail.push(...checkErrors.map(x => 'check: ' + x));
  if (input.check && !checkErrors.length && input.check.status !== 'passed') fail.push('required checks did not pass');
  if (input.subject && input.check?.subject &&
    JSON.stringify(input.subject) !== JSON.stringify(input.check.subject)) fail.push('subject mismatch');
  const approvalPolicy = approvalPolicyFor(policy, input.risk || 'L2');
  const approvalRequired = stage === 'pre-merge' ? approvalPolicy.required !== false : !!approvalPolicy.min_count;
  if (approvalRequired) {
    if (!input.approval) pending.push('approval evidence missing (cannot determine SCM approval state)');
    else {
      const approval = verifyApproval(input.approval, approvalPolicy);
      if (approval.status === 'FAIL') fail.push(...approval.reasons.map(x => 'approval: ' + x));
      else if (approval.status === 'INDETERMINATE') pending.push(...approval.reasons.map(x => 'approval: ' + x));
    }
  }
  if (stage === 'post-merge' || stage === 'release') {
    if (!input.attestation) pending.push('attestation evidence missing (cannot determine signed evidence)');
    else {
      const att = verifyAttestationStatement(input.attestation, input.context || {});
      if (att.status !== 'PASS') fail.push(...att.reasons.map(x => 'attestation: ' + x));
      else if (input.subject && input.attestation.subject &&
        (input.attestation.subject.commit !== input.subject.source_commit ||
         input.attestation.subject.tree_sha !== input.subject.tree_sha))
        fail.push('attestation subject does not match the evaluated subject');
    }
  }
  if (fail.length) return verdict('FAIL', fail);
  if (pending.length) return verdict('INDETERMINATE', pending);
  return verdict('PASS', []);
}
