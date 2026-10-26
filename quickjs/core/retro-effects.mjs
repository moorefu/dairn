/* 可比试验的描述性效果，资料缺失时保持 UNKNOWN；不自动宣称因果或修改规则。 */
import {sha256} from './sha256.mjs';
import {validateCheckRun} from './evidence.mjs';
import {canonical} from './governance-plan.mjs';
function ok(v,m){if(!v)throw Error(m);}
const digest=value=>/^[0-9a-f]{64}$/.test(value||'');
const text=value=>typeof value==='string'&&value.trim().length>0;
const passed=check=>check.status==='passed'&&check.exit_code===0&&!check.timed_out;
function executionIdentity(run,selected,metric){
  const e=run.execution||{};
  for(const key of ['policy_sha256','toolchain_sha256','runtime_sha256','check_plan_sha256'])ok(digest(e[key]),'试验缺少 '+key+' 可比身份');
  ok(e.input_coverage==='declared-complete'&&digest(e.snapshot_before_sha256)&&e.snapshot_before_sha256===e.snapshot_after_sha256,'试验输入覆盖不完整或运行时发生改变');
  ok(Array.isArray(e.requirements)&&e.requirements.length>0&&e.requirements.every(r=>r&&typeof r.required==='boolean'),'试验缺少完整必需保障集合');
  const required=e.requirements.filter(r=>r.required),ids=new Set();
  ok(required.length>0&&Array.isArray(e.executors),'试验缺少必需保障或执行配置');
  const executors=[];
  for(const requirement of required){
    ok(text(requirement.id)&&!ids.has(requirement.id)&&text(requirement.check_id)&&(requirement.module_id===null||text(requirement.module_id)),'试验必需保障身份无效或重复');ids.add(requirement.id);
    const configs=e.executors.filter(x=>x&&x.requirement_id===requirement.id&&x.check_id===requirement.check_id&&x.module_id===requirement.module_id);
    const results=run.checks.filter(x=>x.requirement_id===requirement.id&&x.id===requirement.check_id&&x.module===requirement.module_id);
    ok(configs.length===1&&results.length===1,'试验必需保障缺少唯一执行配置或结果');
    const config=configs[0],result=results[0];
    ok(Array.isArray(config.argv)&&config.argv.length>0&&config.argv.every(text)&&text(config.cwd)&&(config.timeout===null||(Number.isFinite(config.timeout)&&config.timeout>0))&&digest(config.implementation_digest),'试验执行配置身份不完整');
    ok(canonical(result.argv)===canonical(config.argv)&&result.cwd===config.cwd,'试验实际 argv/cwd 与执行配置不一致');
    if(metric==='duration_ms'||result!==selected)ok(passed(result),'耗时比较或非目标必需保障没有成功闭合');
    else ok(passed(result)||(result.status==='failed'&&Number.isInteger(result.exit_code)&&result.exit_code!==0&&!result.timed_out),'失败率样本没有确定的成功或失败结果');
    executors.push(config);
  }
  ok(required.some(r=>r.id===selected.requirement_id&&r.check_id===selected.id&&r.module_id===selected.module),'试验目标不属于必需保障集合');
  ok(metric==='duration_ms'?run.status==='passed':['passed','failed'].includes(run.status),'试验 Run 失效或未成功完成');
  // Subject 与输入快照允许在改善前后变化；各 Run 必须稳定，执行契约不得变化。
  const guarantees=required.map(({subject_binding,...rest})=>rest).sort((a,b)=>a.id.localeCompare(b.id));
  return {repository:run.subject.repository,policy:e.policy_sha256,toolchain:e.toolchain_sha256,runtime:e.runtime_sha256,required:guarantees,executors:executors.sort((a,b)=>a.requirement_id.localeCompare(b.requirement_id))};
}
function raw(h,root,rel){ok(typeof rel==='string'&&!rel.startsWith('/')&&!rel.includes('\\')&&!rel.split('/').some(p=>!p||p==='.'||p==='..'),'不安全的试验引用');let p=root;for(const part of rel.split('/')){p=p.replace(/\/$/,'')+'/'+part;ok(!h.isSymlink(p),'试验引用经过链接');}if(h.readBytes)h.readBytes(p,1024*1024);return h.read(p);}
function read(h,root,ref){ok(ref&&/^[0-9a-f]{64}$/.test(ref.sha256||''),'需要试验引用摘要');const content=raw(h,root,ref.path);ok(sha256(content)===ref.sha256,'试验引用摘要改变');return JSON.parse(content);}
function cohort(h,root,ref){
  const doc=read(h,root,ref);ok(doc.schema==='dairn.retro-cohort.v1','cohort schema 无效');
  ok(['duration_ms','failure_rate'].includes(doc.metric),'未知效果指标');
  ok(doc.fixture&&/^[0-9a-f]{64}$/.test(doc.fixture.sha256||'')&&sha256(raw(h,root,doc.fixture.path))===doc.fixture.sha256,'回放 fixture 身份缺失或改变');
  ok(Array.isArray(doc.trials)&&doc.trials.length>0&&doc.trials.length<=1000,'试验样本缺失或超过上限');
  const values=[],identities=new Set(),subjects=new Set(),runs=new Set();
  for(const trial of doc.trials){
    const run=read(h,root,trial);ok(validateCheckRun(run).length===0,'试验 Run 无效');
    ok(!runs.has(run.run_id),'同一 Run 不能重复计入试验样本');runs.add(run.run_id);
    const checks=run.checks.filter(c=>c.id===trial.check_id&&c.module===trial.module);ok(checks.length===1,'试验检查匹配不唯一');
    const c=checks[0];ok(Number.isFinite(c.duration_sec)&&c.duration_sec>=0,'缺少真实耗时');
    ok(c.log&&c.log_sha256&&sha256(raw(h,root,c.log))===c.log_sha256,'试验日志缺失或改变');
    identities.add(canonical({fixture:doc.fixture.sha256,metric:doc.metric,...executionIdentity(run,c,doc.metric),check_id:trial.check_id,module:trial.module}));
    subjects.add(run.subject.source_commit);
    values.push(doc.metric==='duration_ms'?c.duration_sec*1000:(c.status==='passed'?0:1));
  }
  ok(identities.size===1,'cohort 内输入、策略或工具环境不可比');
  return {metric:doc.metric,identity:[...identities][0],subjects:[...subjects],values,samples:values.length,mean:values.reduce((a,b)=>a+b,0)/values.length};
}
export function compareRetroCohorts(h,root,baseline,experiment){
  try{
    const before=cohort(h,root,baseline),after=cohort(h,root,experiment);
    ok(before.identity===after.identity,'baseline 与 experiment 的 fixture、环境或必需保障不一致');
    return {schema:'dairn.retro-effect.v1',status:'comparable-description',assurance:'local-unattested',metric:before.metric,
      baseline:{samples:before.samples,mean:before.mean,subjects:before.subjects},experiment:{samples:after.samples,mean:after.mean,subjects:after.subjects},
      delta:after.mean-before.mean,observed_improvement:after.mean<before.mean,
      limitations:'本地样本和描述性均值不证明因果、统计显著性或平台授权；需人类复评收益与副作用。'};
  }catch(e){return {schema:'dairn.retro-effect.v1',status:'insufficient-evidence',assurance:'local-unattested',reason:String(e.message||e)};}
}
