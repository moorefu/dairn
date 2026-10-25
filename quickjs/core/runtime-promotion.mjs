/* 显式 Runtime 提升事务。计划摘要绑定内容和目标；不代表人类批准。 */
import {sha256,sha256Bytes} from './sha256.mjs';
import {inspectRuntimePayload} from './launcher.mjs';
const join=(r,p)=>r.replace(/\/$/,'')+'/'+p;
const HASH=/^[0-9a-f]{64}$/;
function ok(v,m){if(!v)throw Error('RuntimePromotion: '+m);}
function safe(h,root,rel){let p=root;ok(!rel.startsWith('/')&&!rel.includes('\\')&&!rel.split('/').some(x=>!x||x==='.'||x==='..'),'路径越界');for(const part of rel.split('/')){p=join(p,part);ok(!h.isSymlink(p),'拒绝链接路径');}return p;}
export function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';return JSON.stringify(value);}
function hashFile(h,p){return h.exists(p)?sha256Bytes(h.readBytes(p)):null;}
function payload(h,version){
  const p=inspectRuntimePayload(h);ok(p,'无已安装载荷；必须从显式选择的已验证安装入口执行');
  ok(!h.isSymlink(p.dir)&&!h.isSymlink(p.binary)&&!h.isSymlink(p.integrity),'来源不得为链接');
  ok(hashFile(h,p.binary)===p.sha256,'来源载荷摘要不匹配');ok(p.version===version,'运行中的版本与来源不一致');
  return p;
}
export function promotionPlan(h,root,{version,identity,managedPlan,worktreeSha=null,source='installed'}){
  ok(source==='installed','source 只支持 installed；PATH 名称不构成来源身份');
  const p=payload(h,version),lock=JSON.parse(h.read(safe(h,root,'.dairn/lock.json')));
  const launcherPath=safe(h,root,'.dairn/launcher.json');
  if(h.exists(launcherPath)){const launcher=JSON.parse(h.read(launcherPath));if(launcher.mode==='vendored')ok(launcher.runtime?.sha256===hashFile(h,safe(h,root,'.dairn/runtime/dairn-embedded.com')),'原 Pin 已被改写；需恢复旧载荷后重新计划');}
  const files=[...new Set(['.dairn/runtime/dairn-embedded.com','.dairn/runtime/runtime-integrity.json','.dairn/lock.json','.dairn/launcher.json',...Object.keys(lock.managed||{}),...Object.keys(managedPlan.full||{})])].sort();
  const changes=managedPlan.actions.filter(a=>a.status!=='unchanged').map(a=>({path:a.path,change:a.status,sha256:managedPlan.full[a.path]===undefined?null:sha256(managedPlan.full[a.path])}));
  const conflict=changes.some(a=>a.change==='conflict');
  const plan={schema:'dairn.runtime-promotion-plan.v1',target_project:sha256(h.realpath(root)),
    from:{version:lock.version,runtime_sha256:lock.runtime_sha256,binary_sha256:hashFile(h,safe(h,root,'.dairn/runtime/dairn-embedded.com'))},
    to:{version,runtime_sha256:identity,binary_sha256:p.sha256,source:'installed',source_identity:'sha256:'+p.sha256,source_assurance:'content-verified-origin-reported',reported_entry_sha256:HASH.test(h.env('DAIRN_INSTALLED_ENTRY_SHA256')||'')?h.env('DAIRN_INSTALLED_ENTRY_SHA256'):null,integrity_sha256:hashFile(h,p.integrity)},
    asset_compatibility:conflict?'incompatible':changes.length?'requires-managed-migration':'runtime-only-compatible',
    managed_changes:changes,inputs:files.map(path=>({path,sha256:hashFile(h,safe(h,root,path)),mode:h.exists(safe(h,root,path))&&h.fileMode?h.fileMode(safe(h,root,path)):null})),worktree_snapshot_sha256:worktreeSha,
    rollback:{available:!!hashFile(h,safe(h,root,'.dairn/runtime/dairn-embedded.com')),to_runtime_sha256:lock.runtime_sha256},
    authorization:{required:true,authority:'human-review-and-protected-scm',note:'计划摘要是输入绑定，不是批准证明'}};
  return {...plan,plan_sha256:sha256('dairn.runtime-promotion-plan.v1\n'+canonical(plan))};
}
function snapshot(h,root,dir,inputs){
  h.mkdirs(dir+'/backup');
  for(let i=0;i<inputs.length;i++){const item=inputs[i],p=safe(h,root,item.path);if(item.sha256!==null)h.writeBytes(dir+'/backup/'+i,h.readBytes(p));}
}
function restore(h,root,dir,inputs){
  for(let i=0;i<inputs.length;i++){const item=inputs[i],p=safe(h,root,item.path);if(item.sha256===null){if(h.exists(p)&&!h.isDirectory(p))h.remove(p);}else{const bytes=h.readBytes(dir+'/backup/'+i);ok(sha256Bytes(bytes)===item.sha256,'回滚备份摘要失败');h.mkdirs(p.slice(0,p.lastIndexOf('/')));h.writeBytes(p,bytes);if(item.mode!==null&&item.mode!==undefined)h.chmod(p,item.mode);}}
}
function journal(h,dir,value){const tmp=dir+'/journal.next';h.write(tmp,JSON.stringify(value,null,2)+'\n');h.rename(tmp,dir+'/journal.json');}
function mutexRecord(transaction,owner_pid,operation,plan_sha256){return JSON.stringify({transaction,owner_pid,operation,plan_sha256})+'\n';}
function recoveryClaim(h,dir){
  // 追加独占 claim，绝不删除/覆盖旧 claim 来夺锁；中断后只在旧所有者明确退出时开下一代。
  let generation=0;
  for(;;generation++){
    const path=dir+'/recovery-claim-'+generation+'.json';
    ok(!h.isSymlink(path)&&!h.isSymlink(path+'.done'),'恢复 claim 不得为链接');
    if(!h.exists(path)){
      h.writeExclusive(path,JSON.stringify({owner_pid:h.pid?h.pid():null})+'\n');return path;
    }
    const prior=JSON.parse(h.read(path));
    if(!h.exists(path+'.done'))ok(prior.owner_pid&&h.processAlive&&h.processAlive(prior.owner_pid)===false,'恢复所有者仍活动或状态未知');
  }
}
export function applyPromotion(h,root,plan,{reviewedHash,activate,verify}){
  ok(HASH.test(reviewedHash||'')&&reviewedHash===plan.plan_sha256,'计划摘要改变；重新审阅计划');
  ok(plan.asset_compatibility!=='incompatible','受管资产冲突，拒绝提升');
  const id=Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10),dir=safe(h,root,'.dairn/runtime-transactions/'+id);
  let state={schema:'dairn.runtime-transaction.v1',id,owner_pid:h.pid?h.pid():null,status:'preparing',plan};
  const mutex=safe(h,root,'.dairn/runtime-promotion.lock');h.writeExclusive(mutex,mutexRecord(id,state.owner_pid,'promote',reviewedHash));
  let backed=false;
  try{
    h.mkdirs(dir);journal(h,dir,state);snapshot(h,root,dir,plan.inputs);backed=true;
    state.status='prepared';journal(h,dir,state);
    for(const item of plan.inputs){const target=safe(h,root,item.path);ok(hashFile(h,target)===item.sha256,'目标在计划后改变：'+item.path);if(item.mode!==null&&item.mode!==undefined&&h.fileMode)ok(h.fileMode(target)===item.mode,'目标权限在计划后改变：'+item.path);}
    const p=payload(h,plan.to.version);ok(p.sha256===plan.to.binary_sha256&&hashFile(h,p.integrity)===plan.to.integrity_sha256,'来源在计划后改变');
    state.status='activating';journal(h,dir,state);
    activate();ok(verify(),'提升后自检失败');
    state.status='committed';journal(h,dir,state);
    return {schema:'dairn.runtime-promotion-result.v1',status:'applied',transaction:id,plan_sha256:reviewedHash,rollback_available:true};
  }catch(e){
    try{if(backed)restore(h,root,dir,plan.inputs);state.status='rolled-back';state.reason=String(e.message||e);journal(h,dir,state);}
    catch(recovery){state.status='recovery-required';state.reason=String(recovery.message||recovery);journal(h,dir,state);}
    throw e;
  }finally{
    // recovery-required 保留互斥标记，阻止后续命令覆盖待恢复状态。
    if(state.status!=='recovery-required'&&h.exists(mutex))h.remove(mutex);
  }
}
export function rollbackRuntime(h,root,{to,apply=false,reviewedHash=null}){
  ok(HASH.test(to||''),'to 必须为已批准旧 Runtime 完整身份');
  const base=safe(h,root,'.dairn/runtime-transactions');ok(h.exists(base),'没有可用回滚事务');
  const matches=h.list(base).sort().reverse().map(name=>{ok(/^[a-z0-9-]+$/.test(name),'事务 ID 无效');const dir=join(base,name);return {dir,state:JSON.parse(h.read(safe(h,root,'.dairn/runtime-transactions/'+name+'/journal.json')))};}).filter(x=>x.state.status==='committed'&&x.state.plan.from.runtime_sha256===to);
  ok(matches.length===1,'回滚目标缺失或不唯一；需维护者选择唯一事务');
  const {dir,state}=matches[0],current=state.plan.inputs.map(item=>{const p=safe(h,root,item.path);return {path:item.path,sha256:hashFile(h,p),mode:h.exists(p)&&h.fileMode?h.fileMode(p):null};});
  const data={schema:'dairn.runtime-rollback-plan.v1',target_project:sha256(h.realpath(root)),transaction:state.id,to,inputs:current};
  const hash=sha256(canonical(data));if(!apply)return {...data,plan_sha256:hash};
  ok(hash===reviewedHash,'回滚计划改变');
  const backupName='rollback-current-'+Date.now(),backup=dir+'/'+backupName;let backed=false;
  state.owner_pid=h.pid?h.pid():null;
  const mutex=safe(h,root,'.dairn/runtime-promotion.lock');h.writeExclusive(mutex,mutexRecord(state.id,state.owner_pid,'rollback',hash));
  state.rollback={backup:backupName,inputs:current,plan_sha256:hash};
  state.status='rollback-preparing';
  try{
    // 先记录此次回滚及其所有者，再保存回滚前快照；恢复不能把半份备份当作完整快照。
    journal(h,dir,state);h.mkdirs(backup);snapshot(h,root,backup,current);backed=true;
    state.status='rollback-prepared';journal(h,dir,state);
    restore(h,root,dir,state.plan.inputs);state.status='rolled-back';journal(h,dir,state);
    h.remove(mutex);return {status:'rolled-back',transaction:state.id};
  }catch(e){
    try{
      if(backed)restore(h,root,backup,current);
      state.status='committed';journal(h,dir,state);h.remove(mutex);
    }catch(recovery){
      state.status='rollback-recovery-required';state.reason=String(recovery.message||recovery);journal(h,dir,state);
    }
    throw e;
  }
}
export function recoverRuntime(h,root,{transaction,apply=false}){
  ok(/^[a-z0-9-]+$/.test(transaction||''),'指定事务 ID');
  const dir=safe(h,root,'.dairn/runtime-transactions/'+transaction),mutex=safe(h,root,'.dairn/runtime-promotion.lock');
  const mutexRaw=h.exists(mutex)?h.read(mutex):null,owner=mutexRaw===null?null:JSON.parse(mutexRaw);
  if(owner){
    ok(owner.transaction===transaction&&['promote','rollback','recover'].includes(owner.operation),'互斥锁属于其他事务或归属未知');
    ok(owner.owner_pid&&h.processAlive&&h.processAlive(owner.owner_pid)===false,'互斥锁所有者仍活动或状态未知');
  }
  const statePath=safe(h,root,'.dairn/runtime-transactions/'+transaction+'/journal.json');
  const stateRaw=h.exists(statePath)?h.read(statePath):null;
  let state;
  if(stateRaw!==null)state=JSON.parse(stateRaw);
  else{
    ok(owner?.operation==='promote','事务日志缺失且没有可恢复的准备记录');
    state={schema:'dairn.runtime-transaction.v1',id:transaction,owner_pid:owner.owner_pid,status:'preparing',plan:null};
  }
  ok(state.id===transaction,'事务日志归属不符');
  const rollback=['rollback-preparing','rollback-prepared','rollback-recovery-required'].includes(state.status);
  const terminal=['committed','rolled-back','aborted'].includes(state.status);
  ok(rollback||terminal||['preparing','prepared','activating','recovery-required'].includes(state.status),'事务不需要恢复');
  if(terminal)ok(owner,'终态事务没有本事务遗留锁');
  else{
    ok(state.owner_pid&&h.processAlive&&h.processAlive(state.owner_pid)===false,'事务所有者仍活动或存活状态未知，拒绝恢复');
    if(owner&&owner.operation!=='recover')ok(owner.owner_pid===state.owner_pid,'事务与互斥锁所有者不符');
  }
  if(!apply)return {status:'recovery-required',transaction,plan_sha256:state.plan?.plan_sha256||owner?.plan_sha256||null};
  h.mkdirs(dir);const claim=recoveryClaim(h,dir);
  let lockedRaw=mutexRaw;
  try{
    if(lockedRaw===null){lockedRaw=mutexRecord(transaction,h.pid?h.pid():null,'recover',state.plan?.plan_sha256||null);h.writeExclusive(mutex,lockedRaw);}
    else ok(h.exists(mutex)&&h.read(mutex)===lockedRaw,'互斥锁在恢复前改变');
    ok((h.exists(statePath)?h.read(statePath):null)===stateRaw,'事务日志在恢复前改变');
    // 明确恢复只能恢复操作前快照；已持久化的终态只释放本事务遗留锁。
    if(!terminal&&rollback){
      if(state.status!=='rollback-preparing'){
        const backup=safe(h,root,'.dairn/runtime-transactions/'+transaction+'/'+state.rollback.backup);
        restore(h,root,backup,state.rollback.inputs);
      }
      state.status='committed';
    }else if(!terminal){
      if(state.status!=='preparing')restore(h,root,dir,state.plan.inputs);
      state.status=state.plan?'rolled-back':'aborted';
    }
    journal(h,dir,state);
    ok(h.exists(mutex)&&h.read(mutex)===lockedRaw,'互斥锁在恢复中改变');
    h.remove(mutex);return {status:state.status,transaction};
  }finally{
    h.write(claim+'.done','completed\n');
  }
}
