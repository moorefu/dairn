/* 统一 v1 的可观察行为与失败边界；在临时目录验证，不操作项目固定 Runtime。 */
import * as os from 'os';
import * as std from 'std';
import {host} from '../host/qjs.mjs';
import {beginObservation,readObservations,observationReport,observeCommand} from '../core/observe.mjs';
import {promotionPlan,applyPromotion,recoverRuntime} from '../core/runtime-promotion.mjs';
import {planGovernance} from '../core/governance-plan.mjs';
import {sha256,sha256Bytes} from '../core/sha256.mjs';
import {compareRetroCohorts} from '../core/retro-effects.mjs';
import {createCheckRun} from '../core/evidence.mjs';
import {validateRetro} from '../core/retro.mjs';
import {recommendWorkflow} from '../core/workflow.mjs';
import {recommendAdaptations,collectRunHistory} from '../core/governance-feedback.mjs';
const dir=(std.getenv('TMPDIR')||host.cwd())+'/dairn-v1-'+os.getpid()+'-'+Date.now();host.mkdirs(dir+'/.dairn');host.write(dir+'/.dairn/lock.json','{}');
let failures=0,total=0;
const assert=(v,m)=>{if(!v)throw Error(m);};
function test(name,f){total++;try{f();print('PASS '+name);}catch(e){failures++;print('FAIL '+name+': '+e);}}
test('实现意图不被架构、文档或 PR 关键词降为无实现阶段',()=>{
  for(const title of ['在当前分支实现架构提案','精简验证脚本，按文档进行下一轮 PR 迭代','Implement the architecture proposal','优化项目导航文档生成器']){
    assert(recommendWorkflow(title).stages.some(s=>s.id==='implement'),'实现阶段缺失：'+title);
  }
  assert(!recommendWorkflow('仅评审实现方案').stages.some(s=>s.id==='implement'),'纯评审被当作实现');
  assert(!recommendWorkflow('仅设计缓存架构').stages.some(s=>s.id==='implement'),'纯设计被当作实现');
  assert(recommendWorkflow('Review PR',{intent:'change'}).stages.some(s=>s.id==='implement'),'显式任务类型未生效');
});
test('OB01 成功和失败保留退出码，事件不包含参数或私人路径',()=>{
  const secret='TOKEN-private-path-/Users/private';
  assert(beginObservation(host,dir,['check',secret])(37)===37,'退出码被改变');
  beginObservation(host,dir,['doctor'])(0);
  const data=readObservations(host,dir),raw=JSON.stringify(data);
  assert(data.events.length===4,'缺开始/结束事件');assert(!raw.includes(secret)&&!raw.includes(dir),'泄露参数或目录');
  const report=observationReport(data);assert(report.commands.failed===1&&report.launcher_attempt_count==='UNKNOWN','尝试覆盖被补零');
});
test('OB05 写入失败不得改变业务退出，损坏记录保留覆盖缺口',()=>{
  const broken={...host,writeExclusive(){throw Error('disk full');}};
  assert(beginObservation(broken,dir,['check'])(42)===42,'采集改变结果');
  const day=host.now().slice(0,10);host.write(dir+'/.dairn/observe/events/'+day+'/damaged.jsonl','{bad}\n');
  assert(readObservations(host,dir).coverage.damaged_records===1,'损坏被静默忽略');
});
test('OB03 可关闭采集且未接线的首次成功率为 UNKNOWN',()=>{
  const h={...host,log(){}};observeCommand(h,dir,{pos:['config'],mode:'disabled',apply:true});
  const before=readObservations(host,dir).events.length;beginObservation(host,dir,['check'])(0);
  assert(readObservations(host,dir).events.length===before,'关闭后仍采集');
  assert(observationReport(readObservations(host,dir)).first_attempt_success_rate==='UNKNOWN','错误成功率');
});
const retro=()=>({schema:'dairn.retro.v1',retro_id:'retro-test',task_id:'task-test',scope:{repository:'org/repo',base_commit:'a'.repeat(40),head_commit:'b'.repeat(40),window:{start:'2026-10-25T00:00:00Z',end:'2026-10-25T01:00:00Z'},coverage:{cli:'partial',harness:'unknown',ci:'unavailable'}},status:'no-action',findings:[]});
test('RV03 no-action 合法，旧 schema 草案拒绝',()=>{
  assert(!validateRetro(host,dir,retro()).errors.length,'无建议失败');
  assert(validateRetro(host,dir,{schema:1,task_id:'task-test',observed:['x'],resolution:{kind:'check'}}).errors.length,'旧草案误读为新协议');
});
function finding(kind){return {id:'finding-'+kind,status:'proposed',category:kind,severity:'medium',observed:'实际重复执行',sources:[{kind:'document',reference:'docs/problem.md'}],confidence:'observed-symptom',hypothesis:'已有检查未接线',resolution:{kind,action:'修复现有路径'},verification_plan:{method:'matched-replay',fixture:'fixture-1',success_metric:'duration',target:'不增加成本',guardrails:['保留全部必需保障']}};}
test('RV01/02 七类 findings 共存，虚构事件不能通过',()=>{
  host.mkdirs(dir+'/docs');host.write(dir+'/docs/problem.md','实际证据');
  const doc=retro();doc.status='proposed';doc.findings=['check','review-standard','navigation','tooling','harness-integration','information-access','prune'].map(finding);
  assert(!validateRetro(host,dir,doc).errors.length,'七类不兼容');
  doc.findings[0].sources=[{kind:'observation-event',event_id:'missing',reference:'.dairn/observe/events/missing.jsonl'}];
  assert(validateRetro(host,dir,doc).errors.length,'虚构来源被接受');
});
test('RV05 单一布尔通过不能产生 verified',()=>{
  const doc=retro();doc.status='verified';const f=finding('check');f.status='verified';f.decision={status:'accepted',actor:'human',reference:'https://example.com/review'};f.implementation={commit:'b'.repeat(40),reference:'https://example.com/change'};f.verification={passed:true};doc.findings=[f];
  assert(validateRetro(host,dir,doc).errors.length,'布尔值提升为验证');
});
test('RV05 非 Check 回放必须有成功命令与可核对的真实输出',()=>{
  const root=dir+'/replay';host.mkdirs(root);host.write(root+'/problem.md','真实问题来源');
  const result=host.run(['git','--version'],root,15);assert(result.code===0,'回放命令未成功执行');
  host.write(root+'/output.log',result.output);
  const trial={argv:['git','--version'],exit_code:result.code,output_path:'output.log',output_sha256:sha256(result.output)};
  const doc=retro(),f=finding('tooling');doc.status=f.status='verified';doc.findings=[f];
  f.sources=[{kind:'document',reference:'problem.md'}];f.decision={status:'accepted',actor:'human',reference:'review'};f.implementation={commit:'b'.repeat(40),reference:'change'};
  const validate=record=>{host.write(root+'/replay.json',JSON.stringify({schema:'dairn.retro-replay.v1',status:'passed',trials:[record]}));f.verification={replay:{path:'replay.json',sha256:sha256(host.read(root+'/replay.json'))}};return validateRetro(host,root,doc);};
  assert(!validate(trial).errors.length,'真实成功回放被拒绝');
  for(const invalid of [{...trial,argv:[]},{...trial,exit_code:19},{...trial,output_sha256:'not-a-digest'},{...trial,output_sha256:'0'.repeat(64)},{...trial,output_path:'missing.log'}])assert(validate(invalid).errors.length,'非法或不可核对的回放产生 verified');
  host.write(root+'/output.log','已被改写');assert(validate(trial).errors.length,'输出被改写仍产生 verified');
});
test('RV08 实施验证失败可带原因修订或退役，无需伪造绿色证明',()=>{
  const implemented=retro(),f=finding('tooling');implemented.status=f.status='implemented';implemented.findings=[f];
  f.decision={status:'accepted',actor:'human',reference:'review'};f.implementation={commit:'b'.repeat(40),reference:'change'};
  assert(!validateRetro(host,dir,implemented).errors.length,'实施记录不合法');
  const revised=JSON.parse(JSON.stringify(implemented));revised.status=revised.findings[0].status='revised';revised.findings[0].follow_up={status:'revised',reason:'回放仍失败，需要重新实施'};
  assert(!validateRetro(host,dir,revised,{previous:implemented}).errors.length,'失败实施必须伪造成功回放才能修订');
  const retired=JSON.parse(JSON.stringify(revised));retired.status=retired.findings[0].status='retired';retired.findings[0].follow_up={status:'retired',reason:'改进无效，保留来源并停止该方案'};
  assert(!validateRetro(host,dir,retired,{previous:revised}).errors.length,'失败修订必须伪造成功回放才能退役');
  const noReason=JSON.parse(JSON.stringify(revised));delete noReason.findings[0].follow_up.reason;assert(validateRetro(host,dir,noReason,{previous:implemented}).errors.length,'无原因的修订被接受');
  const noDecision=JSON.parse(JSON.stringify(revised));delete noDecision.findings[0].decision;assert(validateRetro(host,dir,noDecision,{previous:implemented}).errors.length,'修订丢失人类决定');
  const verified=JSON.parse(JSON.stringify(implemented));verified.status=verified.findings[0].status='verified';assert(validateRetro(host,dir,verified,{previous:implemented}).errors.length,'没有成功验证仍进入 verified');
});
test('RV07/OB08 同提交的高失败率没有等价身份不能叫 flaky',()=>{
  const runs=Array.from({length:12},(_,i)=>({subject_commit:'a'.repeat(40),checks:[{module:'app',id:'unit',status:i%2?'passed':'failed',duration_sec:1}]}));
  const report=recommendAdaptations({runs});assert(report.recommendations.some(r=>r.kind==='FREQUENT_FAILURE'),'失败频数丢失');assert(!report.recommendations.some(r=>['SUSPECTED_FLAKY','REPEATED_RUNS'].includes(r.kind)),'不完整身份误判等价');
});
test('历史损坏不得被声称完整覆盖',()=>{
  host.mkdirs(dir+'/.dairn/governance/evidence/runs/'+'a'.repeat(40)+'/bad');host.write(dir+'/.dairn/governance/evidence/runs/'+'a'.repeat(40)+'/bad/run.json','{bad');
  const runs=collectRunHistory(host,dir);assert(runs.coverage.unreadable===1,'损坏历史丢失');
});
test('PC04 全局契约无执行器会显式阻断，有执行器则进入同一计划',()=>{
  const policy={schema_version:1,modules:[{name:'app',path:'.',checks:{lint:{argv:['python','-V']}}}],required_checks:{L0:['lint'],L1:['lint'],L2:['lint']}};
  const contract={id:'contract-1',baseline:{contracts:['compat']},paths:['.']};
  const change={paths:['api.py'],modules:policy.modules,risk:'L0'};
  const first=planGovernance({trustedPolicy:policy,change,refactorContracts:[contract]});
  assert(first.plan.gaps.some(g=>g.kind==='REQUIRED_EXECUTOR_MISSING'),'全局契约被跳过');
  policy.repository_checks={compat:{argv:['python','compat.py'],cwd:'.'}};
  const second=planGovernance({trustedPolicy:policy,change,refactorContracts:[contract]});
  assert(second.plan.executors.some(e=>e.module_id===null&&e.requirement_id==='contract-1.compat'),'全局执行器未绑定');
  assert(second.plan_sha256!==first.plan_sha256,'执行器不影响计划身份');
});
test('PC08 执行目录与超时改变必须改变计划摘要',()=>{
  const policy={schema_version:1,modules:[{name:'app',path:'.',checks:{lint:{argv:['python','-V'],cwd:'.',timeout:1}}}],required_checks:{L0:['lint'],L1:['lint'],L2:['lint']}};
  const change={paths:['api.py'],modules:policy.modules,risk:'L0'};
  const one=planGovernance({trustedPolicy:policy,change});policy.modules[0].checks.lint.timeout=2;
  const two=planGovernance({trustedPolicy:policy,change});assert(one.plan_sha256!==two.plan_sha256,'超时未绑定');
});
test('RT07/08 来源变化拒绝激活，激活故障恢复原文件',()=>{
  const project=dir+'/promotion',source=dir+'/installed';host.mkdirs(project+'/.dairn/runtime');host.mkdirs(source);
  host.write(project+'/.dairn/lock.json',JSON.stringify({version:'old',runtime_sha256:'a'.repeat(64),managed:{}}));
  host.write(project+'/.dairn/runtime/dairn-embedded.com','old');host.write(project+'/.dairn/runtime/runtime-integrity.json','{}');
  host.write(source+'/dairn-embedded.com','new');const digest=sha256Bytes(host.readBytes(source+'/dairn-embedded.com'));
  host.write(source+'/runtime-integrity.json',JSON.stringify({engine_version:'new',sha256:digest}));
  const h={...host,env:name=>name==='DAIRN_RUNTIME_DIR'?source:host.env(name)};
  const plan=promotionPlan(h,project,{version:'new',identity:'b'.repeat(64),managedPlan:{actions:[],full:{},managed:{}}});
  let rejected=false;host.write(source+'/dairn-embedded.com','tampered');
  try{applyPromotion(h,project,plan,{reviewedHash:plan.plan_sha256,activate(){throw Error('不应进入激活');},verify:()=>true});}catch(_){rejected=true;}
  assert(rejected&&host.read(project+'/.dairn/runtime/dairn-embedded.com')==='old','来源篡改仍激活');
  host.write(source+'/dairn-embedded.com','new');rejected=false;
  try{applyPromotion(h,project,plan,{reviewedHash:plan.plan_sha256,activate(){host.write(project+'/.dairn/runtime/dairn-embedded.com','partial');throw Error('注入故障');},verify:()=>true});}catch(_){rejected=true;}
  assert(rejected&&host.read(project+'/.dairn/runtime/dairn-embedded.com')==='old','半事务未恢复');
});
test('RT09 准备中断只能由已退出的所有者恢复，不读取半份备份',()=>{
  const root=dir+'/interrupted',transaction='test-prepare',path=root+'/.dairn/runtime-transactions/'+transaction;
  host.mkdirs(path);host.write(root+'/.dairn/runtime-promotion.lock',JSON.stringify({transaction,owner_pid:123,operation:'promote'}));
  host.write(path+'/journal.json',JSON.stringify({schema:'dairn.runtime-transaction.v1',id:transaction,status:'preparing',owner_pid:123,plan:{plan_sha256:'a'.repeat(64),inputs:[{path:'.dairn/lock.json',sha256:'b'.repeat(64)}]}}));
  for(const state of [true,null]){
    let rejected=false;try{recoverRuntime({...host,processAlive:()=>state},root,{transaction,apply:true});}catch(_){rejected=true;}
    assert(rejected&&host.exists(root+'/.dairn/runtime-promotion.lock'),'活跃或状态未知的所有者被恢复');
  }
  assert(recoverRuntime({...host,processAlive:()=>false},root,{transaction,apply:true}).status==='rolled-back','准备中断无法恢复');
  assert(!host.exists(root+'/.dairn/runtime-promotion.lock'),'恢复后互斥锁未释放');
});
test('OB03 首次启动成功率只使用声明完整且闭合的 Session 分母',()=>{
  const root=dir+'/session';host.mkdirs(root+'/.dairn');host.write(root+'/.dairn/lock.json','{}');
  let clock=0;const h={...host,log(){},now:()=>new Date(Date.now()+clock++*1000).toISOString()};
  for(const [kind,invocation,status] of [['harness.session-start','s','unknown'],['launcher.attempt.started','first','started'],['launcher.attempt.failed','first','failed'],['launcher.attempt.started','retry','started'],['launcher.attempt.succeeded','retry','passed'],['harness.turn-end','s','unknown']]){
    const payload={kind,invocation_id:invocation,session_id:'private',status,coverage:kind==='harness.turn-end'?'complete':'partial'};
    observeCommand({...h,readStdin:()=>JSON.stringify(payload)},root,{pos:['ingest'],provider:'dsh',stdin:true});
  }
  const report=observationReport(readObservations(h,root));assert(report.first_attempt_success_rate===0&&report.first_attempt_denominator.complete_sessions===1,'重试成功被计作首次成功或分母未闭合');
});
test('OB03 缺少启动事件的终结尝试不能被完整 Session 分母忽略',()=>{
  const root=dir+'/orphan-attempt';host.mkdirs(root+'/.dairn');host.write(root+'/.dairn/lock.json','{}');
  let clock=0;const h={...host,log(){},now:()=>new Date(Date.now()+clock++*1000).toISOString()};
  for(const [kind,invocation,status] of [['harness.session-start','s','unknown'],['launcher.attempt.failed','lost-start','failed'],['launcher.attempt.started','retry','started'],['launcher.attempt.succeeded','retry','passed'],['harness.turn-end','s','unknown']]){
    const payload={kind,invocation_id:invocation,session_id:'private',status,coverage:kind==='harness.turn-end'?'complete':'partial'};
    observeCommand({...h,readStdin:()=>JSON.stringify(payload)},root,{pos:['ingest'],provider:'dsh',stdin:true});
  }
  const report=observationReport(readObservations(h,root));
  assert(report.launcher_attempt_count===2,'孤立失败尝试未保留');
  assert(report.first_attempt_success_rate==='UNKNOWN'&&report.first_attempt_denominator.complete_sessions===0,'缺失首次启动的重试成功被算为 100%');
});
test('OB09 同任务跨 Harness 只在完整条件相同时描述可比样本',()=>{
  const root=dir+'/providers';host.mkdirs(root+'/.dairn');host.write(root+'/.dairn/lock.json','{}');
  const bindings={subject_commit:'a'.repeat(40),worktree_snapshot_sha256:'b'.repeat(64),policy_sha256:'c'.repeat(64),plan_sha256:'d'.repeat(64),toolchain_sha256:'e'.repeat(64),runtime_sha256:'f'.repeat(64)};
  const emit=(provider,task,extra)=>{const payload={kind:'launcher.attempt.succeeded',invocation_id:task+'-'+provider,operation:'check',status:'passed',exit_code:0,task_id:task,...bindings,...extra};observeCommand({...host,log(){},readStdin:()=>JSON.stringify(payload)},root,{pos:['ingest'],provider,stdin:true});};
  for(const provider of ['codex','dsh'])emit(provider,'same-task',{});
  emit('codex','missing-input',{});emit('dsh','missing-input',{worktree_snapshot_sha256:null});
  emit('codex','different-input',{});emit('dsh','different-input',{policy_sha256:'0'.repeat(64)});
  const report=observationReport(readObservations(host,root)),task=id=>report.task_comparisons?.find(t=>t.task_id===id);
  assert(task('same-task')?.status==='comparable-description','相同任务的完整样本未关联');
  assert(task('same-task').providers.length===2&&task('same-task').providers.every(p=>p.coverage.bound_samples===1),'缺少各宿主样本覆盖');
  assert(task('missing-input')?.status==='UNKNOWN','缺少输入绑定仍比较宿主');
  assert(task('different-input')?.status==='incomparable','不同策略条件仍比较宿主');
  const finish=beginObservation(host,root,['check','--task','cli-task']);finish(0,[],Object.fromEntries(Object.entries(bindings).filter(([key])=>key!=='runtime_sha256')));
  assert(readObservations(host,root).events.some(e=>e.kind==='command.completed'&&e.correlation.task_id==='cli-task'),'CLI --task 未关联任务');
});
test('OB05 采集恢复时补记缺口，安全状态可跨调用重试且不改变业务退出',()=>{
  const root=dir+'/recover-gap';host.mkdirs(root+'/.dairn');host.write(root+'/.dairn/lock.json','{}');
  let first=true;const transient={...host,writeExclusive(path,raw){if(path.includes('/events/')&&first){first=false;throw Error('temporary disk failure');}return host.writeExclusive(path,raw);}};
  assert(beginObservation(transient,root,['check'])(42)===42,'缺口补记改变业务退出码');
  let data=readObservations(host,root);assert(data.events.some(e=>e.kind==='observation.collection-gap')&&data.coverage.collection_gaps===1,'恢复后缺口未落盘');
  const deferred=dir+'/deferred-gap';host.mkdirs(deferred+'/.dairn');host.write(deferred+'/.dairn/lock.json','{}');
  const unavailable={...host,writeExclusive(path,raw){if(path.includes('/events/'))throw Error('events temporarily unavailable');return host.writeExclusive(path,raw);}};
  assert(beginObservation(unavailable,deferred,['doctor'])(17)===17,'延后缺口改变业务退出码');
  assert(host.exists(deferred+'/.dairn/observe/deferred-gap.json'),'缺口未保留安全有界状态');
  beginObservation(host,deferred,['doctor'])(0);data=readObservations(host,deferred);
  assert(data.events.some(e=>e.kind==='observation.collection-gap')&&!host.exists(deferred+'/.dairn/observe/deferred-gap.json'),'下次调用未重试延后缺口');
});
test('RV06/08 回放引用支持描述性对比，环境身份不一致时拒绝效果结论',()=>{
  const root=dir+'/effect';host.mkdirs(root);host.write(root+'/fixture.py','固定回放输入');
  const fixture={path:'fixture.py',sha256:sha256(host.read(root+'/fixture.py'))};
  const make=(label,seconds,{metric='duration_ms',status='passed'}={})=>{
    host.write(root+'/'+label+'.log','实际格式的回放日志');
    const requirement={id:'app.unit',module_id:'app',check_id:'unit',required:true};
    const executor={requirement_id:'app.unit',module_id:'app',check_id:'unit',argv:['python','fixture.py'],cwd:'.',timeout:30,implementation_digest:'1'.repeat(64)};
    const run=createCheckRun({subject:{schema:'dairn.subject.v1',repository:'org/repo',kind:'git-commit',source_commit:label==='before'?'a'.repeat(40):'b'.repeat(40),tree_sha:'c'.repeat(40),base_commit:null,comparison:'base-to-source'},execution:{policy_sha256:'d'.repeat(64),toolchain_sha256:'e'.repeat(64),runtime_sha256:'f'.repeat(64),check_plan_sha256:'2'.repeat(64),snapshot_before_sha256:'3'.repeat(64),snapshot_after_sha256:'3'.repeat(64),input_coverage:'declared-complete',requirements:[requirement],executors:[executor]},required_checks:['unit'],checks:[{id:'unit',module:'app',requirement_id:'app.unit',status,exit_code:status==='passed'?0:7,argv:['python','fixture.py'],cwd:'.',duration_sec:seconds,log:label+'.log',log_sha256:sha256(host.read(root+'/'+label+'.log'))}]});
    host.write(root+'/'+label+'-run.json',JSON.stringify(run));
    const trial={path:label+'-run.json',sha256:sha256(host.read(root+'/'+label+'-run.json')),module:'app',check_id:'unit'};
    host.write(root+'/'+label+'.json',JSON.stringify({schema:'dairn.retro-cohort.v1',fixture,metric,trials:[trial]}));
    return {path:label+'.json',sha256:sha256(host.read(root+'/'+label+'.json'))};
  };
  const before=make('before',1),after=make('after',0.5),result=compareRetroCohorts(host,root,before,after);
  assert(result.status==='comparable-description'&&result.observed_improvement&&result.delta===-500,'回放均值对比错误');
  const original=host.read(root+'/after.json'),duplicated=JSON.parse(original);
  duplicated.trials.push({...duplicated.trials[0]});host.write(root+'/after.json',JSON.stringify(duplicated));
  const repeated={path:'after.json',sha256:sha256(host.read(root+'/after.json'))};
  assert(compareRetroCohorts(host,root,before,repeated).status==='insufficient-evidence','同一 Run 被重复计作独立样本');
  host.write(root+'/after.json',original);
  const savedRun=host.read(root+'/after-run.json');
  const mutated=change=>{const run=JSON.parse(savedRun);change(run);host.write(root+'/after-run.json',JSON.stringify(run));const cohort=JSON.parse(original);cohort.trials[0].sha256=sha256(host.read(root+'/after-run.json'));host.write(root+'/after.json',JSON.stringify(cohort));return compareRetroCohorts(host,root,before,{path:'after.json',sha256:sha256(host.read(root+'/after.json'))});};
  for(const change of [r=>{r.execution.toolchain_sha256='0'.repeat(64);},r=>{r.checks[0].argv=['python','-c','pass'];r.execution.executors[0].argv=r.checks[0].argv;},r=>{r.checks[0].cwd='other';r.execution.executors[0].cwd='other';},r=>{r.execution.executors[0].timeout=1;},r=>{r.execution.runtime_sha256='0'.repeat(64);},r=>{r.execution.requirements[0].scope={kind:'repository'};},r=>{delete r.execution.executors;},r=>{delete r.execution.runtime_sha256;},r=>{r.execution.snapshot_after_sha256='0'.repeat(64);},r=>{r.status='failed';r.checks[0].status='failed';r.checks[0].exit_code=7;r.checks[0].duration_sec=0.001;}])assert(mutated(change).status==='insufficient-evidence','执行身份不完整、保障改变或失败提前退出仍宣称耗时改善');
  const failureBefore=make('failure-before',1,{metric:'failure_rate',status:'failed'}),failureAfter=make('failure-after',0.5,{metric:'failure_rate'});
  const failureEffect=compareRetroCohorts(host,root,failureBefore,failureAfter);
  assert(failureEffect.status==='comparable-description'&&failureEffect.baseline.mean===1&&failureEffect.experiment.mean===0,'失败率不能比较真实失败与成功样本');
});
print(JSON.stringify({tests:total,failed:failures}));std.exit(failures?1:0);
