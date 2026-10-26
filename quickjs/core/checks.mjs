import {toolchainIdentity} from './toolchain.mjs';
/* Independent Check Plan -> execution -> Run Evidence implementation. */
import {sha256} from './sha256.mjs';
import {subjectFromGit} from './subject.mjs';
import {captureWorktree, sameWorktree} from './worktree.mjs';
import {createCheckRun, writeRunEvidence} from './evidence.mjs';
import {planGovernance} from './governance-plan.mjs';
import {readRefactorContracts,projectContextOf} from './project-context.mjs';
import {executeCheck} from './stack-check.mjs';

function ok(value, message) { if (!value) throw Error('Check: ' + message); }
function join(root, path) { return root.replace(/\/$/, '') + '/' + path; }
function policyChecks(policy, risk = 'L1') {
  const values = policy?.required_checks?.[risk] || policy?.checks?.[risk] || [];
  ok(Array.isArray(values) && values.length > 0, 'trusted policy has no required checks for ' + risk);
  return [...values];
}
function runOne(h, root, module, id, timeout) {
  const cfg = module?.checks?.[id];
  if (!cfg || !Array.isArray(cfg.argv)) return {id, module:module?.name || null, status:'missing', exit_code:null, argv:null};
  const cwd = join(root, cfg.cwd || module.path || '.');
  let result;
  try{result=executeCheck(h,cfg.argv,cwd,timeout);}
  catch(error){result={code:null,error:true,output:String(error.message||error)};}
  return {id, module:module.name, status:result.timedOut ? 'timeout' : result.error ? 'error' : result.code === 0 ? 'passed' : 'failed',
    exit_code:result.code, argv:cfg.argv, cwd:cfg.cwd || module.path || '.', duration_sec:result.duration_sec,
    log_sha256:sha256(result.output || ''), reason:result.code === 0 ? null : String(result.output || '').slice(0, 1024)};
}
export function checkPlan(policy, modules, risk = 'L1') {
  const required = policyChecks(policy, risk);
  return {schema:'dairn.check-plan.v1', risk, required_checks:required,
    modules:(modules || policy.modules || []).map(x => ({name:x.name, path:x.path, checks:required}))};
}
export function runChecks(h, root, {policy, modules = null, risk = 'L1', base = null, timeout = 120,
  environment = 'local', input_globs = [], write = true, repository = null, change = null,governancePlan=null,subjectOverride=null,runtimeSha=null,requirementIds=null} = {}) {
  ok(policy && typeof policy === 'object', 'policy required');
  const selected = modules || policy.modules || [];
  let subject = subjectFromGit(h, root, {base, repository, change, timeout});
  if(subjectOverride){for(const key of ['repository','source_commit','tree_sha','base_commit'])ok(subjectOverride[key]===subject[key],'SUBJECT_MISMATCH: '+key);subject=subjectOverride;}
  const envelope=governancePlan||planGovernance({trustedPolicy:policy,projectContext:projectContextOf(policy),change:{paths:[],modules:selected,risk,all:true,subject,runtime_sha256:runtimeSha,policy_sha256:sha256(JSON.stringify(policy)),authority_source:'local-unverified'},refactorContracts:readRefactorContracts(h,root)});
  const plan=envelope.plan;
  if(requirementIds!==null)ok(Array.isArray(requirementIds)&&requirementIds.length>0&&new Set(requirementIds).size===requirementIds.length&&requirementIds.every(id=>plan.requirements.some(r=>r.id===id)),'invalid Requirement selection');
  const requirements=requirementIds===null?plan.requirements:plan.requirements.filter(r=>requirementIds.includes(r.id));
  const executors=plan.executors.filter(e=>requirements.some(r=>r.id===e.requirement_id));
  const required=[...new Set(requirements.map(r=>r.check_id))];
  const snapshotExclusions = Array.isArray(policy.snapshot_exclusions) ? policy.snapshot_exclusions : [];
  const captureOptions = {input_globs, snapshot_exclusions: snapshotExclusions};
  const before = captureWorktree(h, root, timeout, [], captureOptions);
  let tools;try{tools=toolchainIdentity(h,root,plan.executors,runtimeSha);}catch(_){tools={sha256:null,status:'unknown'};}
  const checks = [];
  for(const requirement of requirements){
    const executor=plan.executors.find(e=>e.requirement_id===requirement.id);
    if(!executor){checks.push({id:requirement.check_id,module:requirement.module_id,requirement_id:requirement.id,status:'missing',exit_code:null});continue;}
    const module={name:requirement.module_id,path:executor.cwd,checks:{[requirement.check_id]:{argv:executor.argv,cwd:executor.cwd}}};
    checks.push({...runOne(h,root,module,requirement.check_id,Math.min(executor.timeout||timeout,timeout)),requirement_id:requirement.id,scope:requirement.scope});
  }
  const after = captureWorktree(h, root, timeout, [], captureOptions);
  const stable = sameWorktree(before, after) && before.source_commit === after.source_commit;
  // The executor cannot grant itself trust (T40): declared_assurance is always
  // local-observed here, whatever the caller claims about its environment —
  // ci-level trust is established by the signed chain, never by this string.
  // Incomplete declared-input coverage invalidates the evidence instead of
  // quietly passing over inputs the run cannot prove it saw (T41).
  const coverageIncomplete = before.input_coverage === 'incomplete';
  const status = !stable || coverageIncomplete ? 'invalidated'
    : (checks.length > 0 && checks.every(x => x.status === 'passed' && x.exit_code === 0) ? 'passed' : 'failed');
  const execution = {environment, runtime_sha256:runtimeSha, policy_sha256:envelope.plan.authority.policy_sha256||sha256(JSON.stringify(policy)),
    check_plan_sha256:envelope.plan_sha256,requirements,executors,scope:requirementIds===null?'complete-plan':'partial-plan',toolchain_sha256:tools.sha256,toolchain_observation:tools,
    snapshot_before_sha256:before.snapshot_sha256, snapshot_after_sha256:after.snapshot_sha256,
    input_coverage:before.input_coverage,worktree_status:before.status, uncovered_inputs:before.uncovered_inputs};
  const run = createCheckRun({subject, execution, required_checks:required, checks,
    status, declared_assurance:'local-observed', now:h.now()});
  if (write) {
    h.mkdirs(join(root, '.dairn/governance/evidence/runs/' + subject.source_commit + '/' + run.run_id));
    const rel = '.dairn/governance/evidence/runs/' + subject.source_commit + '/' + run.run_id + '/run.json';
    return {...run, evidence_ref:writeRunEvidence(h, root, run, {path:rel})};
  }
  return run;
}
