/* 纯本地机器保障核对；不包含 SCM、HTTP、人工审批或合并判断。 */
import {canonical} from './governance-plan.mjs';
import {sha256} from './sha256.mjs';
import {validateCheckRun} from './evidence.mjs';
const HASH=/^[0-9a-f]{64}$/;
const equal=(a,b)=>canonical(a)===canonical(b);
export function dependencyErrors(expected,needs){
  if(expected===undefined&&needs===undefined)return [];
  if(!Array.isArray(expected)||!expected.length||expected.some(x=>typeof x!=='string'||!x)||new Set(expected).size!==expected.length)return ['EXPECTED_JOBS_INVALID'];
  if(!needs||typeof needs!=='object'||Array.isArray(needs))return ['REQUIRED_JOB_MISSING'];
  const errors=[];
  if(!equal(Object.keys(needs).sort(),[...expected].sort()))errors.push('JOB_SET_MISMATCH');
  for(const id of expected)if(needs[id]?.result!=='success')errors.push('REQUIRED_JOB_NOT_SUCCESS: '+id);
  return errors;
}
export function planCoverage(envelope,runs,subject){
  const errors=[],coverage=[];
  const plan=envelope?.plan;
  if(!plan||plan.schema!=='dairn.governance-plan.v1'||!HASH.test(envelope?.plan_sha256||'')||sha256('dairn.governance-plan.v1\n'+canonical(plan))!==envelope.plan_sha256)return {errors:['PLAN_OR_POLICY_MISMATCH'],coverage};
  if(!equal(plan.subject,subject))errors.push('SUBJECT_MISMATCH');
  if(!Array.isArray(plan.gaps)||plan.gaps.length)errors.push('REQUIRED_EXECUTOR_MISSING');
  const required=Array.isArray(plan.requirements)?plan.requirements.filter(r=>r?.required===true):[];
  const ids=required.map(r=>r.id);
  if(!ids.length||ids.some(id=>typeof id!=='string'||!id))errors.push('REQUIRED_CHECK_MISSING');
  if(new Set(ids).size!==ids.length)errors.push('REQUIREMENT_ID_CONFLICT');
  if(!equal([...(plan.execution?.ci_required||[])].sort(),[...ids].sort()))errors.push('REQUIRED_SET_MISMATCH');
  const executors=Array.isArray(plan.executors)?plan.executors:[];
  for(const req of required){
    const matches=executors.filter(e=>e.requirement_id===req.id);
    if(matches.length!==1||!Array.isArray(matches[0]?.argv)||!matches[0].argv.length)errors.push('REQUIRED_EXECUTOR_MISSING: '+req.id);
    else if(matches[0].module_id!==req.module_id||matches[0].check_id!==req.check_id||!equal(matches[0].scope,req.scope))errors.push('EXECUTOR_SCOPE_MISMATCH: '+req.id);
    if(req.subject_binding!==sha256(canonical(subject)))errors.push('SUBJECT_BINDING_MISMATCH: '+req.id);
  }
  const seenRuns=new Set(),records=[];
  if(!Array.isArray(runs)||!runs.length)errors.push('REQUIRED_CHECK_MISSING');
  for(const run of runs||[]){
    errors.push(...validateCheckRun(run).map(e=>'check: '+e));
    if(seenRuns.has(run?.run_id))errors.push('DUPLICATE_RUN');seenRuns.add(run?.run_id);
    if(!equal(run?.subject,subject))errors.push('SUBJECT_MISMATCH');
    if(run?.status!=='passed')errors.push('REQUIRED_CHECK_FAILED');
    const execution=run?.execution||{};
    if(execution.check_plan_sha256!==envelope.plan_sha256)errors.push('PLAN_OR_POLICY_MISMATCH');
    for(const key of ['policy_sha256','runtime_sha256'])if(!HASH.test(plan.authority?.[key]||'')||execution[key]!==plan.authority[key])errors.push('PLAN_OR_POLICY_MISMATCH: '+key);
    if(execution.input_coverage!=='declared-complete'||!HASH.test(execution.snapshot_before_sha256||'')||execution.snapshot_before_sha256!==execution.snapshot_after_sha256)errors.push('INPUT_SNAPSHOT_MISMATCH');
    if(!HASH.test(execution.toolchain_sha256||''))errors.push('TOOLCHAIN_IDENTITY_MISSING');
    for(const record of run?.checks||[]){
      const req=required.find(r=>r.id===record.requirement_id);
      const executor=executors.find(e=>e.requirement_id===record.requirement_id);
      if(!req||record.module!==req.module_id||record.id!==req.check_id)errors.push('REQUIREMENT_SCOPE_MISMATCH');
      if(!executor||!equal(record.argv,executor.argv)||record.cwd!==executor.cwd)errors.push('EXECUTOR_MISMATCH');
      const declared=(execution.executors||[]).filter(e=>e.requirement_id===record.requirement_id);
      if(declared.length!==1||!equal(declared[0],executor))errors.push('EXECUTOR_IDENTITY_MISMATCH');
      const declaredReq=(execution.requirements||[]).filter(r=>r.id===record.requirement_id);
      if(declaredReq.length!==1||!equal(declaredReq[0],req))errors.push('REQUIREMENT_IDENTITY_MISMATCH');
      if(record.status!=='passed'||record.exit_code!==0||!HASH.test(record.log_sha256||''))errors.push('REQUIRED_CHECK_NOT_SUCCESS');
      records.push(record);
    }
  }
  for(const req of required){
    const matches=records.filter(r=>r.requirement_id===req.id);
    const passed=matches.length===1&&matches[0].status==='passed'&&matches[0].exit_code===0;
    if(!passed)errors.push((matches.length>1?'REQUIREMENT_ID_CONFLICT: ':'REQUIRED_CHECK_MISSING: ')+req.id);
    coverage.push({id:req.id,status:passed?'PASS':'FAIL'});
  }
  return {errors:[...new Set(errors)],coverage};
}
