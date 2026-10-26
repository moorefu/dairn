/* 仅组合机器保障；审批与合并资格委托 SCM，不消费 Work 状态或审批裁决。
 * 必需矩阵完整通过才返回 PASS。缺失签名等无法确定的证据返回 INDETERMINATE，
 * 与 FAIL 一样以非零退出。发布阶段只信任真实验签结果，不信任裸声明。 */
import {validateSubject} from './subject.mjs';
import {validateCheckRun} from './evidence.mjs';
import {validateStatement,isVerifiedAttestation} from './attestation.mjs';
import {sha256} from './sha256.mjs';
import {resolvePolicy, requiredChecksFor} from './policy-resolver.mjs';

import {planCoverage,dependencyErrors} from './assurance.mjs';

const VERIFIED_ATTESTATION = 'dairn.verified-attestation.v1';
const RISKS = ['L0', 'L1', 'L2'];

function verdict(status,reasons,coverage=[]) {return {schema:'dairn.gate-verdict.v1',scope:'machine-assurance',status,machine_assurance:status,human_approval:'delegated-to-scm',merge_eligibility:'not-evaluated',assurance:'local-observed',coverage,reasons:[...new Set(reasons)]};}
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
  if(input.subject?.stage&&input.subject.stage!==stage)fail.push('SUBJECT_STAGE_MISMATCH');
  const risk = input.risk || 'L2';
  if (!RISKS.includes(risk)) fail.push('invalid risk: ' + risk);
  const subjectErrors = validateSubject(input.subject);
  if (subjectErrors.length) fail.push(...subjectErrors.map(x => 'subject: ' + x));
  const policy = resolvePolicy(input.trustedPolicy || input.policy || null);
  if (!policy) fail.push('trusted policy missing or invalid');
  const runs=input.runs||[input.check];
  const check=runs.length===1?runs[0]:null;
  let coverage=[];
  if(input.plan){
    try{const result=planCoverage(input.plan,runs,input.subject);fail.push(...result.errors);coverage=result.coverage;}
    catch(_){fail.push('INVALID_MACHINE_EVIDENCE');}
  }else{
    if(runs.length!==1)fail.push('完整计划缺失，不能聚合多个 Run');
    const checkErrors=validateCheckRun(check);
    fail.push(...checkErrors.map(x=>'check: '+x));
    if(check&&!checkErrors.length){
      if(check.status!=='passed')fail.push('required checks did not pass');
      else fail.push(...coverageErrors(input.trustedPolicy||input.policy,risk,check,input.modules).map(x=>'coverage: '+x));
    }
    if(input.subject&&check?.subject&&JSON.stringify(input.subject)!==JSON.stringify(check.subject))fail.push('subject mismatch');
  }
  fail.push(...dependencyErrors(input.expectedJobs,input.needs));
  if(input.attestation)fail.push('bare attestation statements are not accepted; supply the verified result of `dairn attest verify` (verifiedAttestation)');
  if(input.approval||input.approvalRaw)fail.push('APPROVAL_INPUT_NOT_SUPPORTED: 人工审批由 SCM 处理；快照仅供显式审计归档');
  if (stage === 'post-merge' || stage === 'release') {
    if (!input.verifiedAttestation) pending.push('attestation evidence missing (cannot determine signed evidence)');
    else {
      fail.push(...verifiedAttestationErrors(input.verifiedAttestation,input.subject,check));
      if(isVerifiedAttestation(input.verifiedAttestation)){
        const st=input.verifiedAttestation.statement;
        if(st.scope!=='machine-assurance')fail.push('ATTESTATION_SCOPE_MISMATCH');
        if(!input.checkRaw||sha256(input.checkRaw)!==st.digests?.run_json_sha256)fail.push('RUN_DIGEST_MISMATCH');
        if(input.checkRaw&&JSON.stringify(JSON.parse(input.checkRaw))!==JSON.stringify(check))fail.push('RUN_CONTENT_MISMATCH');
        if(st.ci?.stage!==stage)fail.push('ATTESTATION_STAGE_MISMATCH');
        if(st.runtime_sha256!==check?.execution?.runtime_sha256)fail.push('RUNTIME_IDENTITY_MISMATCH');
        if(!st.plan_sha256||st.plan_sha256!==check?.execution?.check_plan_sha256)fail.push('PLAN_OR_POLICY_MISMATCH');
        if(check?.execution?.policy_sha256!==st.policy_sha256||!input.policyRaw||sha256(input.policyRaw)!==st.policy_sha256)fail.push('POLICY_DIGEST_MISMATCH');
      }
    }
  }
  const result=verdict(fail.length?'FAIL':pending.length?'INDETERMINATE':'PASS',fail.length?fail:pending,coverage);
  return {...result,subject:input.subject,plan_sha256:input.plan?.plan_sha256||check?.execution?.check_plan_sha256||null};
}
