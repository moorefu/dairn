/* 本地观测：白名单字段、独占文件、损坏覆盖与未知分母；从不作为 Gate 输入。 */
import {sha256} from './sha256.mjs';
import {compareRetroCohorts} from './retro-effects.mjs';
const join=(r,p)=>r.replace(/\/$/,'')+'/'+p;
const ID=/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const KINDS=new Set(['command.started','command.completed','command.failed','launcher.attempt.started','launcher.attempt.failed','launcher.attempt.succeeded','harness.session-start','harness.turn-end','observation.collection-gap','ci.observed']);
const OPERATIONS=new Set(['init','adopt','upgrade','doctor','validate','check','docs','context','analyze','analyzers','quality','governance','gate','attest','approval','work','hook','handoff','runtime','observe','ci','help','version','tasks','skills','guide','refactor']);
const MAX_FILES=512, MAX_BYTES=65536, MAX_DAYS=30;
function ok(v,m){if(!v)throw Error('Observe: '+m);}
function safe(h,root,rel){let p=root;for(const part of rel.split('/')){ok(part&&part!=='.'&&part!=='..','路径越界');p=join(p,part);ok(!h.isSymlink(p),'拒绝链接路径');}return p;}
function config(h,root){
  const p=safe(h,root,'.dairn/observe/config.json');
  const value=h.exists(p)?JSON.parse(h.read(p)):{};
  ok(!value.mode||['disabled','minimal','local-full'].includes(value.mode),'未知采集模式');
  return {mode:value.mode||'minimal'};
}
function id(prefix){return prefix+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,14);}
function stamp(h){return h.now();}
export function validateObservation(e){
  const errors=[];const check=(v,m)=>{if(!v)errors.push(m);};
  check(e&&Object.keys(e).every(k=>['schema','event_id','occurred_at','kind','source','correlation','runtime','operation','outcome','coverage'].includes(k)),'unknown fields');
  check(e?.schema==='dairn.observation-event.v1','schema');check(ID.test(e?.event_id||''),'event_id');
  check(typeof e?.occurred_at==='string'&&/^\d{4}-\d\d-\d\dT.*Z$/.test(e.occurred_at)&&Number.isFinite(Date.parse(e.occurred_at)),'occurred_at');
  check(KINDS.has(e?.kind),'kind');check(['cli','harness','ci'].includes(e?.source?.type),'source');
  check(e?.source?.assurance===(e?.source?.type==='cli'?'local-cli-observed':e?.source?.type==='harness'?'harness-reported':'external-referenced'),'assurance');
  check(ID.test(e?.correlation?.invocation_id||''),'invocation_id');
  check(e?.correlation?.task_id==null||(typeof e.correlation.task_id==='string'&&ID.test(e.correlation.task_id)),'task_id');
  check(e?.correlation?.session_ref_hash===null||/^[0-9a-f]{64}$/.test(e?.correlation?.session_ref_hash||''),'session_ref_hash');
  check(['native','codex','dsh','claude','github','gitlab'].includes(e?.source?.provider),'provider');
  check((e?.source?.type==='cli'&&e.source.provider==='native')||(e?.source?.type==='harness'&&['codex','dsh','claude'].includes(e.source.provider))||(e?.source?.type==='ci'&&['github','gitlab'].includes(e.source.provider)),'source/provider mismatch');
  check(e?.kind?.startsWith('command.')?e?.source?.type==='cli':e?.kind?.startsWith('ci.')?e?.source?.type==='ci':e?.kind?.startsWith('launcher.')||e?.kind?.startsWith('harness.')?e?.source?.type==='harness':true,'kind/source mismatch');
  check(OPERATIONS.has(e?.operation)||e?.operation==='unknown','operation');
  check(e?.outcome&&['started','passed','failed','blocked','unknown'].includes(e.outcome.status),'status');
  check(e?.outcome?.exit_code===null||Number.isInteger(e?.outcome?.exit_code),'exit_code');
  check(e?.outcome?.duration_ms===null||(Number.isFinite(e?.outcome?.duration_ms)&&e.outcome.duration_ms>=0),'duration_ms');
  const fields={source:['type','provider','assurance'],correlation:['invocation_id','session_ref_hash','task_id','subject_commit','run_id','worktree_snapshot_sha256','policy_sha256','plan_sha256','toolchain_sha256','ci_run_ref'],runtime:['role','version','sha256'],outcome:['status','exit_code','duration_ms','diagnostic_codes'],coverage:['cli_execution','harness_attempt']};
  for(const [key,names] of Object.entries(fields))if(e?.[key]!==null)check(e?.[key]&&Object.keys(e[key]).every(k=>names.includes(k)),'unknown '+key+' fields');
  for(const key of ['worktree_snapshot_sha256','policy_sha256','plan_sha256','toolchain_sha256'])if(e?.correlation?.[key]!=null)check(typeof e.correlation[key]==='string'&&/^[0-9a-f]{64}$/.test(e.correlation[key]),key);
  check(e?.correlation?.subject_commit===null||(typeof e?.correlation?.subject_commit==='string'&&/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(e.correlation.subject_commit)),'subject_commit');
  if(e?.runtime){check(e.runtime.sha256===null||(typeof e.runtime.sha256==='string'&&/^[0-9a-f]{64}$/.test(e.runtime.sha256)),'runtime sha256');check(['governance','candidate','installed-source','unknown'].includes(e.runtime.role),'runtime role');check(e.runtime.version===null||/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(e.runtime.version||''),'runtime version');}
  check(Array.isArray(e?.outcome?.diagnostic_codes)&&e.outcome.diagnostic_codes.every(c=>['RUNTIME_LOCK_DRIFT','DAIRN_NOT_AVAILABLE','RUNTIME_PROMOTION_REQUIRED','POLICY_UNTRUSTED'].includes(c)),'diagnostics');

  return errors;
}
function envelope(h,root,{kind,operation,invocation,code=null,duration=null,provider='native',session=null,status=null,diagnostics=[],context={},attemptCoverage='partial',runtimeSha=null}){
  const source=provider==='native'?'cli':'harness';
  return {schema:'dairn.observation-event.v1',event_id:id('obs'),occurred_at:stamp(h),kind,
    source:{type:source,provider,assurance:source==='cli'?'local-cli-observed':'harness-reported'},
    correlation:{invocation_id:invocation,session_ref_hash:session?sha256(root+'\n'+session):null,task_id:null,subject_commit:null,...context},
    runtime:source==='cli'?runtime(h):runtimeSha?{role:'unknown',version:null,sha256:runtimeSha}:null,operation:OPERATIONS.has(operation)?operation:'unknown',
    outcome:{status:status||(code===null?'started':code===0?'passed':'failed'),exit_code:code,duration_ms:duration,diagnostic_codes:diagnostics.filter(c=>/^[A-Z][A-Z0-9_]{2,63}$/.test(c)).slice(0,8)},
    coverage:{cli_execution:source==='cli'?'complete':'unknown',harness_attempt:source==='harness'?attemptCoverage:'unknown'}};
}
function retryDeferredGap(h,root,mode){
  try{const path=safe(h,root,'.dairn/observe/deferred-gap.json');if(!h.exists(path))return;if(h.readBytes)h.readBytes(path,8192);const event=JSON.parse(h.read(path));ok(!validateObservation(event).length&&event.kind==='observation.collection-gap','无效延后缺口');if(persist(h,root,[event],{mode}))h.remove(path);}catch(_){/* 有界状态留待下次重试；不可写时不承诺恢复。 */}
}
function recordCollectionGap(h,root,mode,operation,invocation,task){
  const event=envelope(h,root,{kind:'observation.collection-gap',operation,invocation,status:'unknown',context:{task_id:task}});event.coverage.cli_execution='partial';
  try{if(persist(h,root,[event],{mode}))return;}catch(_){/* 事件目录可能暂不可写，尝试保留一份有界状态。 */}
  try{const store=safe(h,root,'.dairn/observe');h.mkdirs(store);h.writeExclusive(safe(h,root,'.dairn/observe/deferred-gap.json'),JSON.stringify(event)+'\n');}catch(_){/* 不覆盖已有状态；完全不可写时无法保证恢复。 */}
}
function runtime(h){try{const meta=JSON.parse(h.read('/zip/quickjs/assets/runtime-identity.json'));return {role:['candidate','installed-source'].includes(h.env('DAIRN_RUNTIME_ROLE'))?h.env('DAIRN_RUNTIME_ROLE'):'governance',version:meta.version,sha256:meta.sha256};}catch(_){return {role:'unknown',version:null,sha256:null};}}
function persist(h,root,events,{mode=null,open=false}={}){
  if((mode||config(h,root).mode)==='disabled')return false;
  const store=safe(h,root,'.dairn/observe');h.mkdirs(store);const ignore=safe(h,root,'.dairn/observe/.gitignore');if(!h.exists(ignore))h.writeExclusive(ignore,'*\n');
  const base=safe(h,root,'.dairn/observe/events');h.mkdirs(base);
  for(const day of h.list(base)){if(/^\d{4}-\d\d-\d\d$/.test(day)&&Date.parse(day+'T23:59:59Z')<Date.parse(stamp(h))-MAX_DAYS*86400000){const expired=safe(h,root,'.dairn/observe/events/'+day);if(h.isDirectory(expired)){for(const name of h.list(expired)){ok(/^[A-Za-z0-9._-]+\.(?:jsonl|part)$/.test(name),'旧事件目录有未知文件，拒绝删除');const p=safe(h,root,'.dairn/observe/events/'+day+'/'+name);ok(!h.isDirectory(p),'事件文件不是普通文件');h.remove(p);}h.rmdir(expired);}}}
  const day=stamp(h).slice(0,10),dir=safe(h,root,'.dairn/observe/events/'+day);h.mkdirs(dir);
  if(h.list(dir).length>=MAX_FILES)throw Error('Observe: daily quota');
  const tmp=join(dir,id('events')+'.part'),raw=events.map(e=>{ok(!validateObservation(e).length,'非法事件');return JSON.stringify(e);}).join('\n')+'\n';
  ok(raw.length<=MAX_BYTES,'事件过大');h.writeExclusive(tmp,raw);if(open)return {path:tmp,raw};h.rename(tmp,tmp.replace(/\.part$/,'.jsonl'));return true;
}
/* 每次调用独占 .part，结束后原子完成；异常保留 started 与覆盖缺口。 */
export function beginObservation(h,root,args){
  const supplied=h.env('DAIRN_INVOCATION_ID'),invocation=ID.test(supplied||'')?supplied:id('inv'),start=Date.now();let pending=null,started=null,mode=null,failed=false;
  const taskArg=args.findIndex(arg=>arg==='--task'),task=taskArg>=0&&ID.test(args[taskArg+1]||'')?args[taskArg+1]:null,operation=args[0]==='--version'?'version':args[0];
  try{if(h.exists(join(root,'.dairn/lock.json'))){mode=config(h,root).mode;if(mode!=='disabled'){retryDeferredGap(h,root,mode);started=envelope(h,root,{kind:'command.started',operation,invocation,context:{task_id:task}});pending=persist(h,root,[started],{mode,open:true});}}}catch(_){failed=true;/* 采集异常不得改变命令结果 */}
  const finish=(code,diagnostics=[],context={})=>{
    if(pending)try{
      const rel=pending.path.slice(root.replace(/\/$/,'').length+1),path=safe(h,root,rel);
      ok(h.read(path)===pending.raw,'待完成事件被改写');
      const event={...started,event_id:id('obs'),occurred_at:stamp(h),kind:code===0?'command.completed':'command.failed',correlation:{...started.correlation,...context},
        outcome:{status:code===0?'passed':'failed',exit_code:code,duration_ms:Math.max(0,Date.now()-start),diagnostic_codes:diagnostics.filter(c=>['RUNTIME_LOCK_DRIFT','DAIRN_NOT_AVAILABLE','RUNTIME_PROMOTION_REQUIRED','POLICY_UNTRUSTED'].includes(c)).slice(0,8)}};
      ok(!validateObservation(event).length,'结束事件无效');const raw=pending.raw+JSON.stringify(event)+'\n';ok(raw.length<=MAX_BYTES,'结束事件过大');h.write(path,raw);h.rename(path,path.replace(/\.part$/,'.jsonl'));
    }catch(_){failed=true;/* 保留 .part 和 started，报表暴露覆盖缺口 */}
    if(failed&&mode&&mode!=='disabled')recordCollectionGap(h,root,mode,operation,invocation,task);
    return code;
  };
  finish.pending_path=pending?.path||null;return finish;
}

export function readObservations(h,root,{window='14d',invocation=null,ignoreFile=null}={}){
  ok(/^\d{1,3}d$/.test(window)&&parseInt(window)>0&&parseInt(window)<=MAX_DAYS,'window 必须为 1d..30d');
  const since=Date.parse(stamp(h))-parseInt(window)*86400000,base=safe(h,root,'.dairn/observe/events');
  let totalBytes=0;const events=[],coverage={files:0,unreadable:0,damaged_records:0,partial_files:0,truncated:false,deferred_gaps:0};
  try{if(h.exists(safe(h,root,'.dairn/observe/deferred-gap.json')))coverage.deferred_gaps=1;}catch(_){coverage.unreadable++;}
  if(h.exists(base))for(const day of h.list(base).sort().filter(d=>/^\d{4}-\d\d-\d\d$/.test(d)&&Date.parse(d+'T23:59:59Z')>=since)){
    const dir=safe(h,root,'.dairn/observe/events/'+day);
    if(!h.isDirectory(dir)){coverage.unreadable++;continue;}
    for(const name of h.list(dir).sort()){
      if(join(dir,name)===ignoreFile)continue;
      if(coverage.files>=4096||totalBytes>=8*1024*1024||events.length>=10000){coverage.truncated=true;break;}
      coverage.files++;
      if(name.endsWith('.part'))coverage.partial_files++;
      try{ok(/^[A-Za-z0-9._-]+\.(?:jsonl|part)$/.test(name),'filename');const path=safe(h,root,'.dairn/observe/events/'+day+'/'+name);const size=h.readBytes?h.readBytes(path,MAX_BYTES).length:null;const raw=h.read(path);ok(raw.length<=MAX_BYTES,'oversize');const bytes=size??raw.length;if(totalBytes+bytes>8*1024*1024){coverage.truncated=true;break;}totalBytes+=bytes;
        for(const line of raw.split('\n').filter(Boolean)){if(events.length>=10000){coverage.truncated=true;break;}try{const event=JSON.parse(line);ok(!validateObservation(event).length,'invalid event');if(Date.parse(event.occurred_at)>=since&&(!invocation||event.correlation.invocation_id===invocation))events.push(event);}catch(_){coverage.damaged_records++;}}
      }catch(_){coverage.unreadable++;}
    }
  }
  const seen=new Set();const unique=[];for(const event of events){if(seen.has(event.event_id)){coverage.damaged_records++;continue;}seen.add(event.event_id);unique.push(event);}
  unique.sort((a,b)=>a.occurred_at.localeCompare(b.occurred_at)||a.event_id.localeCompare(b.event_id));
  return {events:unique,coverage:{...coverage,collection_gaps:unique.filter(e=>e.kind==='observation.collection-gap').length}};
}
function taskComparisons(events){
  const tasks=[...new Set(events.map(e=>e.correlation.task_id).filter(Boolean))].sort();
  return tasks.map(task=>{
    const group=events.filter(e=>e.correlation.task_id===task),identities=new Set();let missing=false;
    const providers=[...new Set(group.filter(e=>['cli','harness'].includes(e.source.type)).map(e=>e.source.provider))].sort().map(provider=>{
      const samples=group.filter(e=>e.source.provider===provider&&['command.completed','command.failed','launcher.attempt.failed','launcher.attempt.succeeded'].includes(e.kind));
      const bound=[];for(const event of samples){const c=event.correlation,fields=[c.subject_commit,c.worktree_snapshot_sha256,c.policy_sha256,c.plan_sha256,c.toolchain_sha256,event.runtime?.sha256];
        if(event.operation==='unknown'||fields.some(value=>!value)||samples.filter(e=>e.correlation.invocation_id===c.invocation_id).length!==1)continue;
        const identity=JSON.stringify([event.operation,...fields]);bound.push(identity);identities.add(identity);
      }
      if(!samples.length||bound.length!==samples.length)missing=true;
      return {provider,assurance:provider==='native'?'local-cli-observed':'harness-reported',coverage:{terminal_samples:samples.length,bound_samples:bound.length,unknown_samples:samples.length-bound.length,harness_attempt:provider==='native'?'unknown':'partial'},comparability:bound.length!==samples.length||!samples.length?'UNKNOWN':new Set(bound).size===1?'bound':'incomparable'};
    });
    return {task_id:task,status:providers.length<2||missing?'UNKNOWN':identities.size===1?'comparable-description':'incomparable',providers,limitations:'只描述显式关联且条件相同的可观察样本；不证明全量覆盖、平台来源或模型因果优劣。'};
  });
}
export function observationReport(data){
  const {events,coverage}=data;
  const completed=events.filter(e=>e.kind==='command.completed'||e.kind==='command.failed');
  const attempts=events.filter(e=>e.kind.startsWith('launcher.attempt.'));
  const ci=events.filter(e=>e.kind==='ci.observed');
  const started=events.filter(e=>e.kind==='command.started');
  const incomplete=started.filter(e=>!completed.some(c=>c.correlation.invocation_id===e.correlation.invocation_id)).length;
  const terminal=attempts.filter(e=>e.kind!=='launcher.attempt.started');
  let completeSessions=0,firstSucceeded=0;
  const sessions=new Set(events.filter(e=>e.source.type==='harness'&&e.correlation.session_ref_hash).map(e=>e.correlation.session_ref_hash));
  if(!coverage.unreadable&&!coverage.damaged_records&&!coverage.partial_files&&!coverage.truncated&&!coverage.collection_gaps&&!coverage.deferred_gaps)for(const session of sessions){
    const group=events.filter(e=>e.correlation.session_ref_hash===session),starts=group.filter(e=>e.kind==='harness.session-start'),ends=group.filter(e=>e.kind==='harness.turn-end'&&e.coverage.harness_attempt==='complete');
    if(starts.length!==1||ends.length!==1)continue;
    const sessionAttempts=group.filter(e=>e.kind.startsWith('launcher.attempt.'));
    if(sessionAttempts.some(e=>e.occurred_at<starts[0].occurred_at||e.occurred_at>ends[0].occurred_at))continue;
    const launched=sessionAttempts.filter(e=>e.kind==='launcher.attempt.started').sort((a,b)=>a.occurred_at.localeCompare(b.occurred_at));
    const finished=sessionAttempts.filter(e=>['launcher.attempt.failed','launcher.attempt.succeeded'].includes(e.kind));
    if(!launched.length||(launched.length>1&&launched[0].occurred_at===launched[1].occurred_at))continue;
    if(finished.length!==launched.length||!launched.every(e=>finished.filter(t=>t.correlation.invocation_id===e.correlation.invocation_id&&t.occurred_at>=e.occurred_at).length===1))continue;
    completeSessions++;if(group.some(e=>e.kind==='launcher.attempt.succeeded'&&e.correlation.invocation_id===launched[0].correlation.invocation_id))firstSucceeded++;
  }
  return {schema:'dairn.observation-report.v1',assurance:'local-unattested',coverage:{...coverage,incomplete_invocations:incomplete,harness:attempts.length?'partial':'unknown'},
    ci:{referenced:ci.length,failed:ci.filter(e=>e.outcome.status==='failed').length,assurance:'external-referenced'},commands:{completed:completed.length,failed:completed.filter(e=>e.outcome.exit_code!==0).length},
    launcher_attempt_count:attempts.length?new Set(attempts.map(e=>e.correlation.invocation_id)).size:'UNKNOWN',
    first_attempt_success_rate:completeSessions?firstSucceeded/completeSessions:'UNKNOWN',first_attempt_denominator:{complete_sessions:completeSessions,other_sessions:sessions.size-completeSessions,source:'harness-reported'},
    note:completeSessions?'比率只来自 Harness 声明完整且闭合的 Session；不代表独立认证的全量覆盖':terminal.length?'部分尝试不代表完整 Session 分母；首次成功率保持 UNKNOWN':'未接线的 Harness 尝试不能计为零',
    episodes:completed.filter(e=>e.outcome.exit_code!==0).map(e=>({id:'episode-'+e.event_id,sources:[{kind:'observation-event',event_id:e.event_id}],status:'observed-symptom',operation:e.operation,duration_ms:e.outcome.duration_ms})),
    task_comparisons:taskComparisons(events),repeated_equivalent_checks:'UNKNOWN'};
}
export function observeCommand(h,root,o){
  const op=o.pos[0]||'status';
  if(op==='config'){
    ok(['disabled','minimal','local-full'].includes(o.mode),'mode 必需');
    if(o.apply){const store=safe(h,root,'.dairn/observe');h.mkdirs(store);const ignore=safe(h,root,'.dairn/observe/.gitignore');if(!h.exists(ignore))h.writeExclusive(ignore,'*\n');h.write(safe(h,root,'.dairn/observe/config.json'),JSON.stringify({mode:o.mode})+'\n');}
    h.log(JSON.stringify({mode:o.mode,applied:!!o.apply}));return 0;
  }
  if(op==='reference'){
    ok(o.file,'reference 需要本地 snapshot 文件');const path=safe(h,root,o.file);if(h.readBytes)h.readBytes(path,8192);const snapshot=JSON.parse(h.read(path));
    ok(snapshot.schema==='dairn.ci-observation.v1'&&['github','gitlab'].includes(snapshot.provider),'CI 引用协议无效');
    ok(typeof snapshot.repository==='string'&&/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+){1,4}$/.test(snapshot.repository)&&/^\d{1,24}$/.test(String(snapshot.run_id||'')),'CI 引用标识无效');
    ok(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(snapshot.head_commit||''),'CI Head 必须为完整 SHA');
    ok(['passed','failed','pending','unknown'].includes(snapshot.status),'CI 状态无效');
    const event={schema:'dairn.observation-event.v1',event_id:id('obs'),occurred_at:stamp(h),kind:'ci.observed',source:{type:'ci',provider:snapshot.provider,assurance:'external-referenced'},
      correlation:{invocation_id:'ci-'+snapshot.provider+'-'+snapshot.run_id,session_ref_hash:null,task_id:null,subject_commit:snapshot.head_commit,ci_run_ref:snapshot.provider+':'+sha256(snapshot.repository)+'/'+snapshot.run_id},runtime:null,operation:'ci',
      outcome:{status:snapshot.status==='pending'?'started':snapshot.status,exit_code:null,duration_ms:null,diagnostic_codes:[]},coverage:{cli_execution:'unknown',harness_attempt:'unknown'}};
    persist(h,root,[event]);h.log(JSON.stringify({event_id:event.event_id,assurance:'external-referenced',note:'本地导入不能认证平台或授权 Gate'}));return 0;
  }
  if(op==='ingest'){
    ok(['codex','dsh','claude'].includes(o.provider),'provider 必须为 codex/dsh/claude');
    ok(o.stdin,'ingest 只读取显式 --stdin 的小型白名单载荷');
    const raw=h.readStdin(8192);ok(raw.length<8192,'payload 过大');const payload=JSON.parse(raw);
    ok(KINDS.has(payload.kind)&&!payload.kind.startsWith('command.')&&!payload.kind.startsWith('ci.'),'Harness kind 无效');
    ok(ID.test(payload.invocation_id||''),'invocation_id 必需');
    ok(payload.exit_code==null||Number.isInteger(payload.exit_code),'exit_code 无效');
    ok(payload.task_id==null||(typeof payload.task_id==='string'&&ID.test(payload.task_id)),'task_id 无效');const context={task_id:payload.task_id??null};
    for(const key of ['subject_commit','worktree_snapshot_sha256','policy_sha256','plan_sha256','toolchain_sha256','runtime_sha256']){const value=payload[key];ok(value==null||(typeof value==='string'&&(key==='subject_commit'?/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/:/^[0-9a-f]{64}$/).test(value)),key+' 必须为完整 SHA');if(key!=='runtime_sha256')context[key]=value??null;}
    const e=envelope(h,root,{kind:payload.kind,provider:o.provider,invocation:payload.invocation_id,operation:payload.operation,session:typeof payload.session_id==='string'?payload.session_id.slice(0,256):null,code:payload.exit_code??null,status:payload.status||'unknown',attemptCoverage:['unknown','partial','complete'].includes(payload.coverage)?payload.coverage:'partial',context,runtimeSha:payload.runtime_sha256??null});
    persist(h,root,[e]);h.log(JSON.stringify({event_id:e.event_id,assurance:'harness-reported'}));return 0;
  }
  const data=readObservations(h,root,{window:o.window||'14d',invocation:o.invocation||null,ignoreFile:h.observationFile||null}),report=observationReport(data);
  if(op==='trace'){ok(ID.test(o.invocation||''),'invocation 必需');h.log(JSON.stringify({schema:'dairn.observation-trace.v1',...data}));return 0;}
  if(op==='suggest'){h.log(JSON.stringify({schema:'dairn.observation-suggestions.v1',status:report.episodes.length?'proposal':'insufficient-evidence',episodes:report.episodes,requires_human_invocation:true,applied:false,coverage:report.coverage}));return 0;}
  if(op==='compare'){
    ok(ID.test(o.baseline||'')&&ID.test(o.experiment||''),'baseline/experiment 必需');
    try{const refs=[o.baseline,o.experiment].map(id=>{const path='.dairn/observe/reports/'+id+'.json';const raw=h.read(safe(h,root,path));return {path,sha256:sha256(raw)};});h.log(JSON.stringify(compareRetroCohorts(h,root,refs[0],refs[1])));}catch(_){h.log(JSON.stringify({schema:'dairn.retro-effect.v1',status:'insufficient-evidence',reason:'没有可核对的 cohort 文件；不从时间先后推断因果'}));}return 0;
  }
  ok(['status','report'].includes(op),'未知 observe 子命令');h.log(JSON.stringify({...report,mode:config(h,root).mode}));return 0;
}
