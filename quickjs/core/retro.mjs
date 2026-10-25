/* Retro v1 仅验证记录与本地引用完整性，从不授予 SCM、Runtime 或 Policy 权限。 */
import {sha256} from './sha256.mjs';
import {compareRetroCohorts} from './retro-effects.mjs';
import {validateCheckRun} from './evidence.mjs';
export const RESOLUTIONS=['check','review-standard','navigation','tooling','harness-integration','information-access','prune'];
const STATES=['proposed','accepted','deferred','rejected','implemented','verified','monitoring','effective','ineffective','retained','revised','retired'];
const TOP=new Set(['schema','retro_id','task_id','scope','status','findings','extensions']);
const FINDING=new Set(['id','status','category','severity','observed','sources','confidence','hypothesis','resolution','verification_plan','decision','implementation','verification','follow_up','extensions']);
const ID=/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const SHA=/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const text=x=>typeof x==='string'&&x.trim().length>0;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
function path(h,root,rel){
  if(!text(rel)||rel.startsWith('/')||rel.includes('\\')||rel.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('不安全的本地引用');
  let p=root;for(const part of rel.split('/')){p=p.replace(/\/$/,'')+'/'+part;if(h.isSymlink(p))throw Error('引用不得经过符号链接');}return p;
}
function local(h,root,reference){const p=path(h,root,reference);if(!h.exists(p)||h.isDirectory(p))throw Error('引用文件不存在');return h.read(p);}
function execution(h,root,ref,expected){
  if(!object(ref)||!text(ref.path)||!/^[0-9a-f]{64}$/.test(ref.sha256||''))throw Error('运行引用需包含 path 与 sha256');
  const raw=local(h,root,ref.path);if(sha256(raw)!==ref.sha256)throw Error('运行引用摘要改变');
  const run=JSON.parse(raw);if(validateCheckRun(run).length||run.status!==expected)throw Error('需要真实格式的 '+expected+' Check Run');
  const checks=run.checks.filter(c=>c.id===ref.check_id&&c.module===ref.module);
  if(checks.length!==1)throw Error('运行引用必须精确匹配检查与模块');
  const check=checks[0];if(!Array.isArray(check.argv)||!check.argv.length||!text(check.log)||!text(check.log_sha256))throw Error('缺少执行 argv 或日志摘要');
  if(expected==='failed'&&(!Number.isInteger(check.exit_code)||check.exit_code===0))throw Error('red 引用必须实际非零退出');
  if(expected==='passed'&&(check.status!=='passed'||check.exit_code!==0))throw Error('green 引用必须实际零退出');
  if(sha256(local(h,root,check.log))!==check.log_sha256)throw Error('日志摘要不匹配');
  return run;
}
const NEXT={proposed:['accepted','deferred','rejected'],accepted:['implemented','deferred','rejected'],implemented:['verified','revised'],verified:['monitoring','ineffective'],monitoring:['effective','ineffective'],effective:['retained','revised','ineffective'],ineffective:['revised','retired'],retained:['monitoring','revised','retired'],revised:['accepted','deferred','retired'],deferred:['proposed','accepted','rejected'],rejected:[],retired:[]};
export function validateRetro(h,root,doc,{taskId=null,previous=null}={}){
  const errors=[],warnings=[];const check=(v,m)=>{if(!v)errors.push(m);};
  if(!object(doc))return {errors:['Retro 必须为对象'],warnings,assurance:'local-unattested'};
  check(doc.schema==='dairn.retro.v1','旧 Retro 草案已退役；请显式迁移为 dairn.retro.v1');
  for(const key of Object.keys(doc))check(TOP.has(key),'未知 Retro 字段：'+key);
  check(ID.test(doc.retro_id||''),'retro_id 无效');
  check(doc.task_id==null||ID.test(doc.task_id),'task_id 无效');if(taskId)check(doc.task_id===taskId,'task_id 不匹配');
  check(object(doc.scope),'scope 必需');
  if(object(doc.scope)){
    check(text(doc.scope.repository),'scope.repository 必需');
    for(const k of ['base_commit','head_commit'])check(SHA.test(doc.scope[k]||''),'scope.'+k+' 必须为完整 SHA');
    const w=doc.scope.window;check(object(w)&&typeof w.start==='string'&&typeof w.end==='string'&&/Z$/.test(w.start)&&/Z$/.test(w.end)&&Number.isFinite(Date.parse(w.start))&&Date.parse(w.start)<=Date.parse(w.end),'scope.window 必须为有序 UTC 时间');
    check(object(doc.scope.coverage)&&['cli','harness','ci'].every(k=>['complete','partial','available','unknown','unavailable'].includes(doc.scope.coverage[k])),'scope.coverage 无效');
  }
  check([...STATES,'no-action','insufficient-evidence'].includes(doc.status),'Retro status 无效');
  check(Array.isArray(doc.findings),'findings 必须为数组');
  if(!Array.isArray(doc.findings))return {errors,warnings,assurance:'local-unattested'};
  check(doc.findings.length<=100,'findings 超过上限');
  if(['no-action','insufficient-evidence'].includes(doc.status))check(doc.findings.length===0,'无行动或证据不足时 findings 必须为空');
  else check(doc.findings.length>0,'有行动时 findings 不得为空');
  const ids=new Set();
  for(const f of doc.findings.slice(0,100)){
    if(!object(f)){errors.push('Finding 必须为对象');continue;}
    for(const key of Object.keys(f))check(FINDING.has(key),'未知 Finding 字段：'+key);
    check(ID.test(f.id||'')&&!ids.has(f.id),'Finding id 无效或重复');ids.add(f.id);
    check(STATES.includes(f.status),'Finding status 无效');
    const old=previous?.findings?.find(item=>item.id===f.id);
    if(old&&old.status!==f.status)check((NEXT[old.status]||[]).includes(f.status),'非法 Finding 状态跃迁：'+old.status+' -> '+f.status);
    check(RESOLUTIONS.includes(f.category),'Finding category 无效');
    check(['low','medium','high','critical'].includes(f.severity),'severity 无效');
    for(const k of ['observed','hypothesis','confidence'])check(text(f[k])&&f[k].length<=4096,k+' 必需且需有界');
    check(object(f.resolution)&&RESOLUTIONS.includes(f.resolution.kind)&&f.resolution.kind===f.category&&text(f.resolution.action),'resolution 必须为七类动作之一');
    check(Array.isArray(f.sources)&&f.sources.length>0&&f.sources.length<=32,'sources 必需且需有界');
    for(const source of (Array.isArray(f.sources)?f.sources:[]).slice(0,32)){
      try{
        check(['observation-event','check-run','scm-reference','document'].includes(source.kind),'source kind 无效');
        if(source.kind==='scm-reference'){
          check(/^https:\/\/[^\s]+$/.test(source.reference||''),'SCM reference 必须为 HTTPS');warnings.push(f.id+': SCM 引用尚未由平台认证，不能作为已批准或已有效的证明');
        }else{
          const ref=String(source.reference||'').replace(/^local:/,'');const raw=local(h,root,ref);
          if(source.sha256)check(sha256(raw)===source.sha256,'source 摘要不匹配');
          if(source.kind==='observation-event'){
            check(ref.startsWith('.dairn/observe/events/'),'Observation 引用必须位于本地事件目录');
            check(raw.split('\n').filter(Boolean).some(line=>{try{const e=JSON.parse(line);return e.schema==='dairn.observation-event.v1'&&e.event_id===source.event_id;}catch(_){return false;}}),'Episode 事件引用不存在');
          }
        }
      }catch(e){errors.push(f.id+': '+e.message);}
    }
    const v=f.verification_plan;
    check(object(v)&&['method','fixture','success_metric','target'].every(k=>text(v[k]))&&Array.isArray(v.guardrails)&&v.guardrails.length>0,'verification_plan 必需且需保留安全约束');
    if(!['proposed','deferred','rejected'].includes(f.status)){
      check(object(f.decision)&&f.decision.status==='accepted'&&text(f.decision.actor)&&text(f.decision.reference),'后续状态必须引用人类 accepted 决定');
      warnings.push(f.id+': 人类决定引用为本地自述，记录不授予写策略、升级或 SCM 权限');
    }
    if(['implemented','verified','monitoring','effective','ineffective','retained','revised','retired'].includes(f.status))
      check(object(f.implementation)&&SHA.test(f.implementation.commit||'')&&text(f.implementation.reference),'实施状态必须有提交与变更引用');
    if(['ineffective','revised','retired'].includes(f.status))
      check(object(f.follow_up)&&f.follow_up.status===f.status&&text(f.follow_up.reason),'失败复评、修订或退役必须保留 follow_up 状态与原因');
    if(['verified','monitoring','effective','retained'].includes(f.status)){
      try{
        check(object(f.verification)&&f.verification.passed===undefined,'verification.passed 布尔值不能证明效果');
        if(f.resolution?.kind==='check'){
          execution(h,root,f.verification?.red,'failed');execution(h,root,f.verification?.green,'passed');
        }else{
          check(object(f.verification)&&object(f.verification.replay)&&text(f.verification.replay.path)&&text(f.verification.replay.sha256),'需要回放结果与摘要');
          const raw=local(h,root,f.verification?.replay?.path);check(sha256(raw)===f.verification.replay.sha256,'回放摘要不匹配');
          const replay=JSON.parse(raw);check(replay.schema==='dairn.retro-replay.v1'&&replay.status==='passed'&&Array.isArray(replay.trials)&&replay.trials.length>0&&replay.trials.length<=1000,'回放记录不完整');
          for(const trial of (Array.isArray(replay.trials)?replay.trials:[]).slice(0,1000)){
            check(object(trial)&&Array.isArray(trial.argv)&&trial.argv.length>0&&trial.argv.every(text)&&trial.exit_code===0,'回放必须包含非空 argv 和实际零退出');
            check(object(trial)&&text(trial.output_path)&&/^[0-9a-f]{64}$/.test(trial.output_sha256||''),'回放需要真实输出路径与 SHA256');
            check(sha256(local(h,root,trial?.output_path))===trial?.output_sha256,'回放输出摘要不匹配');
          }
        }
      }catch(e){errors.push(f.id+': '+e.message);}
    }
    if(['effective','retained'].includes(f.status)){
      const effect=f.follow_up;check(object(effect)&&effect.status==='effective'&&text(effect.limitations)&&Array.isArray(effect.side_effects),'effective 需要限制与副作用');
      const result=compareRetroCohorts(h,root,effect?.baseline,effect?.experiment);
      check(result.status==='comparable-description'&&result.observed_improvement,'effective 需要有实际改善的可比 cohort 引用；不能仅填写样本数或绿色 CI');
      const criteria=effect?.criteria;check(object(criteria)&&['<','<='].includes(criteria.operator)&&typeof criteria.threshold==='number'&&Number.isFinite(criteria.threshold)&&Number.isInteger(criteria.minimum_samples)&&criteria.minimum_samples>=10,'effective 需要数值阈值和至少十个匹配试验的预定标准');
      if(result.status==='comparable-description'&&object(criteria)){check(result.baseline.samples>=criteria.minimum_samples&&result.experiment.samples>=criteria.minimum_samples,'效果样本不足');check(criteria.operator==='<'?result.experiment.mean<criteria.threshold:result.experiment.mean<=criteria.threshold,'效果未满足预定阈值');}
    }
  }
  if(doc.findings.length&&doc.status!=='proposed')check(doc.findings.every(f=>f.status===doc.status),'聚合状态必须与全部 Finding 一致；混合状态使用 proposed');
  return {errors,warnings,assurance:'local-unattested'};
}
