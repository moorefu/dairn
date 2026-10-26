/* 机器保障的可观察契约：固定预期集合、逐项证据和平台职责委托。 */
import * as std from 'std';
import {evaluate} from '../core/gate.mjs';
import {planGovernance} from '../core/governance-plan.mjs';
import {createCheckRun} from '../core/evidence.mjs';
const tests=[];
function test(name,fn){try{fn();tests.push({name,status:'passed'});print('PASS '+name);}catch(e){tests.push({name,status:'failed',reason:String(e)});print('FAIL '+name+': '+e);}}
function assert(value,message){if(!value)throw Error(message);}
const clone=x=>JSON.parse(JSON.stringify(x));
const subject={schema:'dairn.subject.v1',repository:'org/repo',kind:'git-commit',source_commit:'a'.repeat(40),tree_sha:'b'.repeat(40),base_commit:'c'.repeat(40),comparison:'base-to-source'};
const policy={schema_version:1,required_checks:{L0:['lint'],L1:['lint','unit'],L2:['lint','unit']},modules:[{name:'app',path:'.',checks:{lint:{argv:['python','-m','compileall','.']},unit:{argv:['python','-m','unittest']}}}]};
function fixture(){
  const envelope=planGovernance({trustedPolicy:policy,change:{paths:['app.py'],modules:policy.modules,risk:'L1',subject,policy_sha256:'d'.repeat(64),runtime_sha256:'e'.repeat(64)}});
  const run=createCheckRun({subject,required_checks:['lint','unit'],execution:{check_plan_sha256:envelope.plan_sha256,policy_sha256:'d'.repeat(64),runtime_sha256:'e'.repeat(64),requirements:envelope.plan.requirements,executors:envelope.plan.executors,toolchain_sha256:'f'.repeat(64),input_coverage:'declared-complete',snapshot_before_sha256:'1'.repeat(64),snapshot_after_sha256:'1'.repeat(64)},checks:envelope.plan.requirements.map(r=>({id:r.check_id,module:r.module_id,requirement_id:r.id,status:'passed',exit_code:0,argv:envelope.plan.executors.find(e=>e.requirement_id===r.id).argv,cwd:'.',log_sha256:'2'.repeat(64)}))});
  return {trustedPolicy:policy,subject,check:run,plan:envelope,risk:'L1',modules:['app']};
}
test('默认 PASS 仅表示机器保障，审批委托且不判断合并',()=>{
  const result=evaluate(fixture());
  assert(result.status==='PASS',JSON.stringify(result));
  assert(result.scope==='machine-assurance'&&result.human_approval==='delegated-to-scm'&&result.merge_eligibility==='not-evaluated','裁决范围不明确');
  assert(result.assurance==='local-observed'&&result.approved===undefined,'本地输出自授可信度或批准');
});
test('计划不按 L0/L1/L2 复制平台审批人数',()=>{
  const p=fixture().plan.plan;
  assert(p.human_approval==='delegated-to-scm'&&p.approvals===undefined,'计划仍在维护审批镜像');
});
test('缺项、重复、跳过、取消、neutral 和非零结果均拒绝',()=>{
  for(const mutate of [x=>x.check.checks.pop(),x=>x.check.checks.push(clone(x.check.checks[0])),...['skipped','cancelled','neutral','failed','timeout'].map(status=>x=>x.check.checks[0].status=status),x=>x.check.checks[0].exit_code=1]){
    const input=fixture();mutate(input);assert(evaluate(input).status!=='PASS','不完整或未实际成功的结果通过');
  }
});
test('仓库、Base、Head、Tree、Plan、策略、Runtime 和执行器不能错配',()=>{
  for(const mutate of [x=>x.check.subject.repository='other/repo',...['base_commit','source_commit','tree_sha'].map(key=>x=>x.check.subject[key]='9'.repeat(40)),x=>x.check.execution.check_plan_sha256='9'.repeat(64),x=>x.plan.plan.requirements.pop(),x=>x.check.execution.policy_sha256='9'.repeat(64),x=>x.check.execution.runtime_sha256='9'.repeat(64),x=>x.check.checks[0].argv=['fake'],x=>x.check.checks[0].cwd='other']){
    const input=clone(fixture());mutate(input);assert(evaluate(input).status!=='PASS','身份或执行器错配通过');
  }
});
test('输入漂移、覆盖不足和未知工具身份均拒绝',()=>{
  for(const mutate of [x=>x.check.execution.snapshot_after_sha256='9'.repeat(64),x=>x.check.execution.input_coverage='incomplete',x=>x.check.execution.toolchain_sha256=null]){
    const input=fixture();mutate(input);assert(evaluate(input).status!=='PASS','输入或工具身份未知仍通过');
  }
});
test('固定直接依赖作业集合，不接受遗漏或 skipped/neutral/cancelled',()=>{
  const input=fixture();input.expectedJobs=['linux','windows'];input.needs={linux:{result:'success'},windows:{result:'success'}};
  assert(evaluate(input).status==='PASS','有效直接依赖失败');
  for(const state of ['skipped','neutral','cancelled','failure',null]){
    const bad=clone(input);if(state===null)delete bad.needs.windows;else bad.needs.windows.result=state;
    assert(evaluate(bad).status!=='PASS','必需作业未成功仍通过：'+state);
  }
  for(const jobs of [[],['linux','linux'],['linux','windows','missing']]){
    const bad=clone(input);bad.expectedJobs=jobs;
    assert(evaluate(bad).status!=='PASS','空、重复或缺失的固定作业集合通过');
  }
});
test('多个直接 Run 必须共同恰好覆盖完整计划',()=>{
  const input=fixture(),first=clone(input.check),second=clone(input.check);
  for(const [i,run] of [first,second].entries()){
    run.run_id+='-'+i;run.checks=[run.checks[i]];run.required_checks=[run.checks[0].id];
    run.execution.requirements=run.execution.requirements.filter(r=>r.id===run.checks[0].requirement_id);
    run.execution.executors=run.execution.executors.filter(e=>e.requirement_id===run.checks[0].requirement_id);
  }
  delete input.check;input.runs=[first,second];assert(evaluate(input).status==='PASS',JSON.stringify(evaluate(input)));
  input.runs=[first];assert(evaluate(input).status!=='PASS','缺失一个直接 Run 仍通过');
  input.runs=[first,first,second];assert(evaluate(input).status!=='PASS','重复直接 Run 仍通过');
});
print('DAIRN_ASSURANCE_RESULT '+JSON.stringify({passed:tests.filter(t=>t.status==='passed').length,failed:tests.filter(t=>t.status==='failed').length,tests}));
std.exit(tests.some(t=>t.status==='failed')?1:0);
