/* Dairn task ledger. Advisory workflow tracking, not agent execution or CI attestation.
 * Project-owned task files, stage-specific evidence hash checks and fail-closed writes.
 */
import {sha256} from './sha256.mjs';
import {recommendWorkflow} from './workflow.mjs';
import {statementFor,prepareAttestation,verifyAttestation} from './attestation.mjs';
const at=(a,b)=>a.replace(/\/$/,'')+'/'+b;
const ok=(c,m)=>{if(!c)throw Error(m);};
const idRe=/^[a-z][a-z0-9-]{1,63}$/;
const evidenceKinds=new Set(['note','test','review','spec','document','machine-evidence']);
const gitHead=(h,root)=>{const r=h.run(['git','rev-parse','--verify','HEAD^{commit}'],root,15);ok(!r.timedOut&&r.code===0,'Cannot resolve current Git HEAD');return r.output.trim();};
const checkPath=id=>'.dairn/work/'+id+'.json';
const exists=(h,p)=>h.exists(p)&&!h.isDirectory(p);
const isObj=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
const sluggify=t=>String(t).normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,48);
const safe=(h,root,rel)=>{
  ok(!rel.startsWith('/')&&!rel.includes('\\')&&!rel.split('/').some(x=>x==='..'||x===''||x==='.'),'Unsafe relative path: '+rel);
  let cur=root;for(const p of rel.split('/')){cur=at(cur,p);ok(!h.isSymlink(cur),'Refuse symlink path: '+rel);}
  return cur;
};
function writeAtomic(h,root,rel,data){
  const path=safe(h,root,rel), dir=path.slice(0,path.lastIndexOf('/'));
  h.mkdirs(dir);
  const tmp=path+'.tmp-'+Date.now();
  try{h.write(tmp,JSON.stringify(data,null,2)+'\n');h.rename(tmp,path);}finally{if(h.exists(tmp))h.remove(tmp);}
}
function readTask(h,root,id){
  ok(idRe.test(id||''),'Specify a safe task ID: --id <task-id>');
  const rel='.dairn/work/'+id+'.json',file=safe(h,root,rel);
  ok(exists(h,file),'Unknown task: '+id);
  const obj=JSON.parse(h.read(file));ok(obj.schema===1&&obj.id===id&&Array.isArray(obj.stages),'Invalid task state: '+id);
  return obj;
}
function reportStage(t){return t.stages.find(s=>s.status==='active')||null;}
export function prepareCheckTask(h,root,id){
  const t=readTask(h,root,id),active=reportStage(t);
  ok(t.status==='active'&&active?.id==='implement','Task must be in active implement stage for --task: '+id);
  ok(!proofCheck(h,root,t).length,'Existing task evidence has failed integrity checks');
  return {task:t,head:gitHead(h,root)};
}
function machineProblems(h,root,t,requirePassed=false){
  const errors=[];
  for(const stage of t.stages)for(const link of stage.machine_runs||[]){
    try{
      ok(stage.id==='implement','Machine runs may only be linked to implement');
      const file=safe(h,root,link.path);
      ok(exists(h,file),'Missing machine run: '+link.path);
      const raw=h.read(file);ok(sha256(raw)===link.sha256,'Machine evidence digest mismatch: '+link.path);
      const evidence=JSON.parse(raw);
      ok(evidence.schema_version===2&&evidence.run_id===link.run_id&&evidence.task_id===t.id,'Machine run id/task mismatch');
      ok(evidence.head===link.commit&&evidence.policy_sha256===link.policy_sha256,'Machine run commit/policy mismatch');
      ok(evidence.trust==='local-unattested'&&link.trust==='local-unattested','Unexpected trust declaration');
      ok(['passed','failed'].includes(evidence.status),'Invalid run status');
      ok(evidence.status===link.status,'Machine status mismatch');
      const expected=evidence.required_checks||[],modules=evidence.modules||[];
      ok(expected.length>0&&modules.length>0,'Machine run missing required checks/modules');
      for(const module of modules)for(const gate of expected)ok(evidence.checks.some(c=>c.module===module&&c.gate===gate),'Machine run missing required gate '+module+':'+gate);
      ok(evidence.checks.length===modules.length*expected.length,'Unexpected machine gate count');
      if(evidence.status==='passed')ok(evidence.checks.every(c=>c.status==='passed'&&c.returncode===0),'Run marked passed with failed checks');
      // Historical failed runs remain valid evidence; only a passing run for current HEAD satisfies progression.
    }catch(e){errors.push(stage.id+': '+e.message);}
  }
  if(requirePassed){
    const stage=t.stages.find(s=>s.id==='implement');
    if(stage&&stage.status!=='pending'){
      const head=gitHead(h,root);
      if(!(stage.machine_runs||[]).some(x=>x.status==='passed'&&x.commit===head))errors.push('No passing machine run for current HEAD');
    }
  }
  return errors;
}
export function attachCheckRun(h,root,id,run,rel){
  const t=readTask(h,root,id),active=reportStage(t);
  ok(t.status==='active'&&active?.id==='implement','Task left implement stage while checks ran');
  ok(run.head===gitHead(h,root),'HEAD changed during check; refusing to attach stale run');
  ok(run.schema_version===2&&run.task_id===id,'Invalid task binding in check run');
  ok(run.modules?.length&&run.required_checks?.length,'Cannot attach empty check result');
  const file=safe(h,root,rel),raw=h.read(file),hash=sha256(raw);
  const link={run_id:run.run_id,path:rel,sha256:hash,commit:run.head,base_commit:run.base,policy_sha256:run.policy_sha256,status:run.status,trust:'local-unattested',recorded_at:h.now()};
  active.machine_runs??=[];
  ok(!active.machine_runs.some(x=>x.run_id===run.run_id),'Duplicate run ID');
  active.machine_runs.push(link);t.updated_at=h.now();writeAtomic(h,root,checkPath(id),t);
  return link;
}
function stageContract(t,active){
  if(!active)return null;
  const requirements=active.id==='implement'?[{id:'machine-check',kind:'machine-run',condition:'all policy-required checks passed for the current commit'},{id:'implementation-notes',kind:'artifact',optional:true}]:
    active.id==='review'?[{id:'standards-and-spec',kind:'artifact',format:'two-axis-review',spec_fidelity:'pass|fail|not-applicable',head:'current-commit'}]:
    active.id==='synchronize'?[{id:'documentation-impact-decision',kind:'artifact',format:'synchronization-review',head:'current-commit',reviewed_docs:'list',status:'updated|no-change'}]:
    active.id==='diagnose'?[{id:'reproducer',kind:'artifact',format:'reproducible-red-signal',verification:'agent-assisted'}]:
    [{id:'stage-artifact',kind:'artifact',verification:'sha256-integrity-only'}];
  return {schema:1,task_id:t.id,stage:active.id,executor:active.id==='review'?'hybrid':'agent',skill:active.skill,goal:active.goal,
    inputs:[{kind:'project-facts',path:'.dairn/facts/project-facts.json'},{kind:'governance-spec',path:'docs/GOVERNANCE_SPEC.md'}],requirements,
    completion:{machine_checks:active.id==='implement'?['dairn check --task '+t.id+' --base <trusted-base>']:[],human_approval:'external-if-required'},
    next_action:'agent-perform-stage-and-record-evidence',agent_invocation:'external; Dairn does not call an AI model',assurance:'local-state-only; no CI or human attestation'};
}

function proofCheck(h,root,t){
  const errors=[];
  for(const s of t.stages){
    for(const p of s.evidence||[]){
      try{const path=safe(h,root,p.path);if(!exists(h,path))errors.push(s.id+': missing evidence '+p.path);
        else if(sha256(h.read(path))!==p.sha256)errors.push(s.id+': changed evidence '+p.path);
        else if(s.id==='review'||s.id==='synchronize'){
          const current=gitHead(h,root),saved=JSON.parse(h.read(path));
          if(saved.head!==current)errors.push(s.id+': evidence belongs to stale Git HEAD '+p.path);
        }
      }catch(e){errors.push(s.id+': '+e.message);}
    }
  }
  return errors;
}
function idFor(o){return o.id||o.pos[1];}
function latestPassing(t){const impl=t.stages.find(s=>s.id==='implement');return (impl?.machine_runs||[]).filter(x=>x.status==='passed').at(-1)||null;}
function ciProblems(h,root,t,required){
  const errors=[];const passing=latestPassing(t);const entries=t.ci_attestations||[];
  for(const a of entries){try{const link=t.stages.find(x=>x.id==='implement')?.machine_runs.find(x=>x.run_id===a.run_id);
    ok(link,'CI attestation references missing run');
    const checked=verifyAttestation(h,root,t,link,a.payload,a.signature);
    ok(checked.statement_sha256===a.statement_sha256,'Signed CI payload was modified');
    ok(checked.key_sha256===a.key_sha256,'CI trust anchor changed since attachment');
  }catch(e){errors.push('CI attestation: '+e.message);}}
  if(required){
    if(!passing||passing.commit!==gitHead(h,root))errors.push('No current-HEAD passing run eligible for CI proof');
    else if(!entries.some(x=>x.run_id===passing.run_id))errors.push('No verified CI attestation for current passing run');
  }return errors;
}
function result(h,value){h.log(JSON.stringify(value,null,2));return 0;}
function safeEvidence(h,root,stage,path,kind){
  ok(evidenceKinds.has(kind),'--kind note|test|review|spec|document|machine-evidence');
  const file=safe(h,root,path);ok(exists(h,file),'Evidence file missing: '+path);
  ok(!path.startsWith('.dairn/work/'),'Task ledger cannot cite itself as evidence');
  const data=h.read(file);ok(data.length<=1048576,'Evidence file exceeds 1 MiB');ok(data.trim().length>0,'Evidence file must not be empty');
  if(stage==='implement')ok(kind==='test'||kind==='machine-evidence','Implementation requires test or machine-evidence');
  if(stage==='review'){
    ok(kind==='review','Review requires a review evidence document');
    let review;try{review=JSON.parse(data);}catch(_){throw Error('Review evidence must be JSON');}
    ok(isObj(review)&&['pass','fail'].includes(review.standards),'Review evidence must contain standards: pass|fail');
    ok(['pass','fail','not-applicable'].includes(review.spec_fidelity),'Review evidence must contain spec_fidelity: pass|fail|not-applicable');
    if(review.spec_fidelity==='pass') {
      const spec=review.spec_ref;
      ok(typeof spec==='string'&&spec.startsWith('docs/specs/')&&spec.endsWith('.md'),'Spec Fidelity pass requires a local authoritative docs/specs/*.md spec_ref');
      ok(exists(h,safe(h,root,spec)),'Authoritative Spec does not exist: '+spec);
    }
    ok(review.standards==='pass'&&review.spec_fidelity!=='fail','Failed review cannot advance');
    ok(review.head===gitHead(h,root),'Review must reference current Git HEAD');
  }
  if(stage==='synchronize'){
    ok(kind==='document','Synchronize requires structured document review');
    let sync;try{sync=JSON.parse(data);}catch(_){throw Error('Synchronize evidence must be JSON');}
    ok(isObj(sync)&&['updated','no-change'].includes(sync.status),'Synchronize requires updated|no-change status');
    ok(sync.head===gitHead(h,root),'Synchronize must reference current HEAD');
    ok(Array.isArray(sync.reviewed_docs)&&sync.reviewed_docs.length>0&&sync.reviewed_docs.length<=100,'Synchronize needs reviewed_docs');
    for(const doc of sync.reviewed_docs)ok(typeof doc==='string'&&(doc==='AGENTS.md'||doc==='README.md'||doc.startsWith('docs/'))&&exists(h,safe(h,root,doc)),'Invalid reviewed document: '+doc);
    ok(typeof sync.reason==='string'&&sync.reason.trim().length>=10,'Synchronize needs a review rationale');
  }
  return {path,kind,sha256:sha256(data),observed_at:h.now(),source:'user-supplied; not independently attested'};
}
export function runWork(h,root,o){
  const op=o.pos[0]||'status';
  const dir=safe(h,root,'.dairn/work');
  if(op==='start'){
    const title=o.pos.slice(1).join(' ').trim();ok(title&&title.length<=300,'Usage: dairn work start <task title> [--id task-id]');
    const id=o.id||sluggify(title);ok(idRe.test(id||''),'Provide --id safe-ascii-task-id for this title');
    const target=safe(h,root,'.dairn/work/'+id+'.json');ok(!h.exists(target),'Task already exists: '+id);
    const r=recommendWorkflow(title);
    const selected=r.stages.map((s,i)=>({id:s.id,skill:s.skill,goal:s.goal,status:i===0?'active':'pending',evidence:[],machine_runs:[]}));
    const task={schema:1,id,title,classification:r.classification,created_at:h.now(),updated_at:h.now(),status:'active',current_stage:selected[0].id,stages:selected,
      assurance:'advisory-records; not CI attestation or human approval'};
    writeAtomic(h,root,'.dairn/work/'+id+'.json',task);
    return result(h,{event:'started',id,title,next:selected[0],path:'.dairn/work/'+id+'.json'});
  }
  if(op==='list'){
    const ids=h.exists(dir)?h.list(dir).filter(n=>idRe.test(n.slice(0,-5))&&n.endsWith('.json')).sort().map(n=>n.slice(0,-5)):[];
    return result(h,ids.map(id=>{const t=readTask(h,root,id);return {id,title:t.title,status:t.status,current_stage:t.current_stage};}));
  }
  const id=idFor(o), t=readTask(h,root,id),active=reportStage(t),errors=[...proofCheck(h,root,t),...machineProblems(h,root,t,false)];
  const requireCi=!!o.require_ci_attestation||h.env('DAIRN_REQUIRE_CI_ATTESTATION')==='true';
  if(op==='attest-prepare'){const run=latestPassing(t);ok(run,'No passing run to attest');return result(h,prepareAttestation(h,root,t,run));}
  if(op==='attest-attach'){const payload=o.pos[2],signature=o.pos[3];ok(payload&&signature,'Usage: dairn work attest-attach ID PAYLOAD SIGNATURE');
    const run=latestPassing(t);ok(run,'No passing machine run');
    ok(!errors.length,'Task evidence integrity check failed');
    const att=verifyAttestation(h,root,t,run,payload,signature);
    t.ci_attestations??=[];ok(!t.ci_attestations.some(x=>x.run_id===run.run_id),'CI attestation already linked');
    t.ci_attestations.push({run_id:run.run_id,payload,signature,statement_sha256:att.statement_sha256,key_sha256:att.key_sha256,recorded_at:h.now()});
    t.updated_at=h.now();writeAtomic(h,root,checkPath(id),t);return result(h,att);
  }
  if(requireCi||t.ci_attestations?.length)errors.push(...ciProblems(h,root,t,requireCi));
  if(op==='status'||op==='next'||op==='verify'){
    const current=active?{...active,goal:active.goal}:null;
    const check={task:id,status:t.status,current_stage:t.current_stage,next:op==='next'?stageContract(t,active):current,stages:t.stages.map(s=>({stage:s.id,status:s.status,skill:s.skill,evidence_count:s.evidence.length,machine_runs:(s.machine_runs||[]).length})),evidence_errors:errors,
      assurance:'Task evidence integrity only; run dairn validate and dairn check for machine gates'};
    if(op==='verify'&&o.require_machine_gates)errors.push(...machineProblems(h,root,t,true));
    check.evidence_errors=errors;check.machine_gates_required=!!o.require_machine_gates;check.ci_attestation_required=requireCi;
    check.ci_attestations=(t.ci_attestations||[]).map(x=>({run_id:x.run_id,key_sha256:x.key_sha256}));
    h.log(JSON.stringify(check,null,2));return op==='verify'&&errors.length?2:0;
  }
  ok(t.status==='active'&&active,'Task is not active');
  if(op==='record'){
    const path=o.pos[2];ok(path,'Usage: dairn work record <id> <repo-relative-evidence-path> --kind <type>');
    const evidence=safeEvidence(h,root,active.id,path,o.kind||'note');
    ok(active.evidence.length<50,'Too many evidence artifacts for stage');
    ok(!active.evidence.some(e=>e.path===path),'Evidence path already recorded for active stage');
    active.evidence.push(evidence);t.updated_at=h.now();writeAtomic(h,root,'.dairn/work/'+id+'.json',t);
    return result(h,{event:'recorded',task:id,stage:active.id,evidence});
  }
  if(op==='advance'||op==='finish'){
    ok(!errors.length,'Evidence changed or missing: '+errors.join('; '));
    ok(active.evidence.length>0||(active.id==='implement'&&(active.machine_runs||[]).length>0),'Current stage requires evidence: '+active.id);
    if(active.id==='implement')ok(!machineProblems(h,root,t,true).length,'Implementation requires a passing check --task run for the current HEAD');
    // Machine-run evidence is linked by the Dairn executor, never synthesized by a free-form artifact record.
    if(active.id==='review'){ok(active.evidence.some(e=>e.kind==='review'),'Review needs structured review evidence');
      if(t.stages.some(s=>s.id==='implement'))ok(!machineProblems(h,root,t,true).length,'Review requires passing machine run for current HEAD');}
    if(active.id==='synchronize'){ok(active.evidence.some(e=>e.kind==='document'),'Synchronize needs structured document impact decision');
      if(t.stages.some(x=>x.id==='review'))ok(t.stages.find(x=>x.id==='review')?.status==='recorded','Synchronize requires completed Review');}
    const index=t.stages.findIndex(s=>s===active);
    if(op==='finish')ok(index===t.stages.length-1,'Task stages remain; use work advance');
    if(op==='advance')ok(index+1<t.stages.length,'Last stage requires work finish');
    active.status='recorded';
    if(index+1<t.stages.length){t.stages[index+1].status='active';t.current_stage=t.stages[index+1].id;}
    else{t.status='recorded-complete';t.current_stage=null;}
    t.updated_at=h.now();writeAtomic(h,root,'.dairn/work/'+id+'.json',t);
    return result(h,{task:id,status:t.status,completed_stage:active.id,next:reportStage(t),assurance:requireCi?'verified external signature against supplied trust anchor; human merge approval remains external':'local records only; no implied CI or human approval'});
  }
  throw Error('Usage: dairn work start|list|status|next|record|advance|verify|finish|attest-prepare|attest-attach');
}
