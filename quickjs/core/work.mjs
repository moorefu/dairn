/* Dairn task ledger. Advisory workflow tracking, not agent execution or CI attestation.
 * Project-owned task files, stage-specific evidence hash checks and fail-closed writes.
 */
import {sha256} from './sha256.mjs';
import {recommendWorkflow} from './workflow.mjs';
import {validateTaskObject} from './tasks.mjs';
import {validateCheckRun} from './evidence.mjs';
import {launcherInfo,LAUNCHER_POSIX,LAUNCHER_WINDOWS} from './launcher.mjs';
import {captureWorktree,sameWorktree,taskExclusions} from './worktree.mjs';
const at=(a,b)=>a.replace(/\/$/,'')+'/'+b;
const ok=(c,m)=>{if(!c)throw Error(m);};
const idRe=/^[a-z][a-z0-9-]{1,63}$/;
const SKIPPABLE=['orient','grill','diagnose','specify','slice','reflect'];
const evidenceKinds=new Set(['note','test','review','spec','document','machine-evidence','grill','retro','tasks']);
const MAX_SESSION_ANCHORS=200;
const ACTOR_MAX=200;
const revisionOf=t=>Number.isInteger(t.revision)&&t.revision>=0?t.revision:0;
const nonEmpty=v=>typeof v==='string'&&v.trim().length>0;
const gitHead=(h,root)=>{const r=h.run(['git','rev-parse','--verify','HEAD^{commit}'],root,15);ok(!r.timedOut&&r.code===0,'Cannot resolve current Git HEAD');return r.output.trim();};
const checkPath=id=>'.dairn/work/'+id+'.json';
const lockPath=id=>'.dairn/work/.'+id+'.lock';
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
/* Every mutation runs under a per-task lock; commitTask then re-reads the ledger and
 * applies a compare-and-swap on revision so a stale writer can never clobber newer state. */
function withTaskLock(h,root,id,fn){
  const path=safe(h,root,lockPath(id));
  h.mkdirs(path.slice(0,path.lastIndexOf('/')));
  const acquire=()=>h.writeExclusive(path,h.now()+'\n');
  try{acquire();}catch(_){
    // 崩溃遗留的锁会永久阻塞任务：超过 10 分钟视为陈旧锁并回收一次。
    let stale=false;
    try{const stamp=Date.parse(String(h.read(path)).trim());stale=Number.isFinite(stamp)&&Date.now()-stamp>600000;}catch(__){/* unreadable lock counts as active */}
    if(!stale)throw Error('Another dairn work command is modifying task '+id+'; retry');
    try{h.remove(path);acquire();}catch(__){throw Error('Another dairn work command is modifying task '+id+'; retry');}
  }
  let value;
  try{value=fn();}finally{
    try{if(h.exists(path))h.remove(path);}catch(_){/* A stale lock is reported by the retry message; never mask the primary outcome. */}
  }
  return value;
}
function readTask(h,root,id){
  ok(idRe.test(id||''),'Specify a safe task ID: --id <task-id>');
  const rel=checkPath(id),file=safe(h,root,rel);
  ok(exists(h,file),'Unknown task: '+id);
  const obj=JSON.parse(h.read(file));
  ok(obj.schema===1&&obj.id===id&&Array.isArray(obj.stages),'Invalid task state: '+id);
  ok(obj.revision===undefined||(Number.isInteger(obj.revision)&&obj.revision>=0),'Invalid task state: '+id);
  return obj;
}
function commitTask(h,root,id,t,expectedRevision){
  const current=readTask(h,root,id);
  ok(revisionOf(current)===expectedRevision,'Task changed concurrently; retry');
  t.revision=expectedRevision+1;
  t.updated_at=h.now();
  writeAtomic(h,root,checkPath(id),t);
  return t;
}
function reportStage(t){return t.stages.find(s=>s.status==='active')||null;}
/* Checks are Task-independent (RUN-02): a task reference only gates the link
 * operation itself, never the eligibility or outcome of the Check run. */
export function checkTaskPresence(h,root,id){
  const t=readTask(h,root,id);
  ok(t.stages.some(s=>s.id==='implement'),'Task has no implement stage to reference runs: '+id);
  return {task:t,head:gitHead(h,root)};
}
function machineProblems(h,root,t,requirePassed=false){
  const errors=[];
  // Worktree capture and policy hashing are comparison-wide, not per-run: compute
  // them lazily once so a task with several historical runs stays linear.
  const exclusions=taskExclusions(t);
  let currentWorktree=null,currentPolicy=null,currentSnapshotExclusions=null;
  const snapshotExclusions=()=>{if(currentSnapshotExclusions===null){try{const policyTxt=h.read(root.replace(/\/$/,'')+'/.dairn/governance/project.json');const policy=JSON.parse(policyTxt);currentSnapshotExclusions=Array.isArray(policy.snapshot_exclusions)?policy.snapshot_exclusions:[];}catch(_){currentSnapshotExclusions=[];}}return currentSnapshotExclusions;};
  const worktree=()=>currentWorktree??(currentWorktree=captureWorktree(h,root,120,exclusions,{snapshot_exclusions:snapshotExclusions()}));
  const policyHash=()=>{if(currentPolicy===null)currentPolicy=sha256(h.read(root.replace(/\/$/,'')+'/.dairn/governance/project.json'));return currentPolicy;};
  for(const stage of t.stages)for(const link of stage.machine_runs||[]){
    try{
      ok(stage.id==='implement','Machine runs may only be linked to implement');
      const file=safe(h,root,link.path);
      ok(exists(h,file),'Missing machine run: '+link.path);
      const raw=h.read(file);ok(sha256(raw)===link.sha256,'Machine evidence digest mismatch: '+link.path);
      const evidence=JSON.parse(raw);
      if(evidence.schema==='dairn.check-run.v1'){
        // v1 protocol runs are standalone evidence: validate structure and the
        // recorded binding only. Current-state applicability is judged below.
        ok(!validateCheckRun(evidence).length,'Invalid check-run evidence: '+link.path);
        ok(evidence.run_id===link.run_id&&evidence.subject.source_commit===link.commit,'Run id/commit mismatch');
        ok(evidence.subject.base_commit===link.base_commit,'Run base mismatch');
        ok(evidence.execution.policy_sha256===link.policy_sha256,'Run policy mismatch');
        ok(evidence.status===link.status,'Machine status mismatch');
      }else{
        ok(evidence.schema_version===2&&evidence.run_id===link.run_id&&evidence.task_id===t.id,'Machine run id/task mismatch');
        ok(evidence.head===link.commit&&evidence.policy_sha256===link.policy_sha256,'Machine run commit/policy mismatch');
        ok(evidence.worktree&&evidence.worktree.schema===1&&typeof evidence.worktree.identity_sha256==='string','Machine run missing worktree identity');
        ok(evidence.trust==='local-unattested'&&link.trust==='local-unattested','Unexpected trust declaration');
        ok(['passed','failed'].includes(evidence.status),'Invalid run status');
        ok(evidence.status===link.status,'Machine status mismatch');
        const expected=evidence.required_checks||[],modules=evidence.modules||[];
        ok(expected.length>0&&modules.length>0,'Machine run missing required checks/modules');
        for(const module of modules)for(const gate of expected)ok(evidence.checks.some(c=>c.module===module&&c.gate===gate),'Machine run missing required gate '+module+':'+gate);
        ok(evidence.checks.length===modules.length*expected.length,'Unexpected machine gate count');
        if(evidence.status==='passed')ok(evidence.checks.every(c=>c.status==='passed'&&c.returncode===0),'Run marked passed with failed checks');
      }
      ok(link.trust==='local-unattested','Unexpected trust declaration');
      // Historical runs stay valid evidence for the state they were captured in
      // (architecture §7): currency against today's policy/worktree is only
      // judged for the run selected to progress the task, never retroactively.
    }catch(e){errors.push(stage.id+': '+e.message);}
  }
  if(requirePassed){
    const stage=t.stages.find(s=>s.id==='implement');
    if(stage&&stage.status!=='pending'){
      const head=gitHead(h,root);
      const passing=(stage.machine_runs||[]).filter(x=>x.status==='passed'&&x.commit===head);
      if(!passing.length)errors.push('No passing machine run for current HEAD');
      else{
        // Only the run that would satisfy progression is held to the current
        // policy/worktree; older passing runs merely remain inspectable history.
        const runIds=new Set(passing.map(x=>x.run_id));
        for(const link of stage.machine_runs||[]){
          if(!runIds.has(link.run_id))continue;
          try{
            const evidence=JSON.parse(h.read(safe(h,root,link.path)));
            const runPolicy=evidence.policy_sha256??evidence.execution?.policy_sha256;
            ok(runPolicy===policyHash(),'Policy changed since machine run: '+link.path);
            // v2 runs carry a full worktree snapshot; v1 runs carry the
            // snapshot digest captured before the checks executed.
            const before=evidence.worktree?evidence.worktree.snapshot_sha256:evidence.execution?.snapshot_before_sha256;
            ok(before===worktree().snapshot_sha256,'Worktree changed since machine run: '+link.path);
          }catch(e){errors.push('implement: '+e.message);}
        }
      }
    }
  }
  return errors;
}
/* Linking is a read-only reference from the advisory ledger to an existing
 * run; it never mints trust and never gates the run itself (RUN-02/RUN-03). */
function runLinkFrom(evidence,rel,raw){
  const digest=sha256(raw);
  if(evidence.schema==='dairn.check-run.v1')
    return {run_id:evidence.run_id,path:rel,sha256:digest,commit:evidence.subject.source_commit,
      base_commit:evidence.subject.base_commit,policy_sha256:evidence.execution.policy_sha256,
      status:evidence.status,trust:'local-unattested',recorded_at:null};
  return {run_id:evidence.run_id,path:rel,sha256:digest,commit:evidence.head,
    base_commit:evidence.base,policy_sha256:evidence.policy_sha256,
    status:evidence.status,trust:'local-unattested',recorded_at:null};
}
export function linkCheckRun(h,root,id,rel,expectedRun){
  const t=readTask(h,root,id);
  const implement=t.stages.find(s=>s.id==='implement');
  ok(implement,'Task has no implement stage: '+id);
  const file=safe(h,root,rel),raw=h.read(file);
  const evidence=JSON.parse(raw);
  if(expectedRun)ok(raw===JSON.stringify(expectedRun,null,2)+'\n','Run content changed on disk before linking');
  ok(typeof evidence.run_id==='string'&&evidence.run_id.length>0,'Run evidence has no run_id');
  const link=runLinkFrom(evidence,rel,raw);
  implement.machine_runs??=[];
  ok(!implement.machine_runs.some(x=>x.run_id===link.run_id),'Duplicate run ID');
  link.recorded_at=h.now();
  implement.machine_runs.push(link);
  const expected=revisionOf(t);
  withTaskLock(h,root,id,()=>commitTask(h,root,id,t,expected));
  return link;
}
/* Locate a standalone run evidence file by run id under the governance evidence tree. */
export function locateRunEvidence(h,root,runId,explicitPath){
  ok(/^run-[A-Za-z0-9][A-Za-z0-9._-]{1,127}$/.test(runId||''),'Invalid run id: '+(runId||''));
  ok(!runId.includes('..'),'Invalid run id');
  const candidates=explicitPath?[explicitPath]:[
    ...globEvidence(h,root,'.dairn/governance/evidence/runs/*/'+runId+'/run.json'),
    '.dairn/governance/evidence/'+runId+'-checks.json'];
  for(const rel of candidates){
    const file=safe(h,root,rel);
    if(!exists(h,file))continue;
    const evidence=JSON.parse(h.read(file));
    if(evidence.run_id===runId)return {path:rel,evidence};
  }
  throw Error('Run evidence not found for '+runId);
}
function globEvidence(h,root,pattern){
  // patterns used here contain exactly one '*' directory segment
  const star=pattern.indexOf('*');
  if(star<0)return [pattern];
  const prefix=pattern.slice(0,star),suffix=pattern.slice(star+1);
  const dir=safe(h,root,prefix.endsWith('/')?prefix.slice(0,-1):prefix);
  if(!h.exists(dir)||!h.isDirectory(dir))return [];
  return h.list(dir).sort().map(name=>prefix+name+suffix);
}
function stageContract(h,root,t,active){
  if(!active)return null;
  const invocation=launcherView(h,root).invocation;
  const requirements=active.id==='implement'?[{id:'machine-check',kind:'machine-run',condition:'all policy-required checks passed for the current commit'},{id:'implementation-notes',kind:'artifact',optional:true}]:
    active.id==='review'?[{id:'standards-and-spec',kind:'artifact',format:'two-axis-review',spec_fidelity:'pass|fail|not-applicable',head:'current-commit'}]:
    active.id==='synchronize'?[{id:'documentation-impact-decision',kind:'artifact',format:'synchronization-review',head:'current-commit',reviewed_docs:'list',status:'updated|no-change'}]:
    active.id==='diagnose'?[{id:'reproducer',kind:'artifact',format:'reproducible-red-signal',verification:'agent-assisted'}]:
    active.id==='grill'?[{id:'grill-questions',kind:'artifact',format:'grill-questions',questions:'no-open-frontier',confirmation:'human-sourced-advisory'}]:
    active.id==='specify'?[{id:'spec',kind:'artifact',format:'spec',acceptance:'non-empty-when-json'}]:
    active.id==='slice'?[{id:'slice-artifact',kind:'artifact',format:'tasks-or-note'}]:
    active.id==='reflect'?[{id:'retro-resolution',kind:'artifact',format:'retro-resolution',resolution:'check|standard'}]:
    [{id:'stage-artifact',kind:'artifact',verification:'sha256-integrity-only'}];
  return {schema:1,task_id:t.id,stage:active.id,executor:active.id==='review'?'hybrid':'agent',skill:active.skill,goal:active.goal,
    invocation,
    inputs:[{kind:'project-facts',path:'.dairn/facts/project-facts.json'},{kind:'governance-spec',path:'docs/GOVERNANCE_SPEC.md'}],requirements,
    completion:{machine_checks:active.id==='implement'?[invocation.posix+' check --task '+t.id+' --base <trusted-base>']:[],human_approval:'external-if-required'},
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
  // Session anchors are process evidence for a historical commit; only existence and
  // digest are re-checked here. Anchors never require the current HEAD.
  for(const a of t.session_anchors||[]){
    try{
      ok(isObj(a)&&nonEmpty(a.path),'Invalid session anchor entry');
      const path=safe(h,root,a.path);
      if(!exists(h,path))errors.push('session-anchor: missing anchor '+a.path);
      else if(sha256(h.read(path))!==a.sha256)errors.push('session-anchor: changed anchor '+a.path);
    }catch(e){errors.push('session-anchor: '+e.message);}
  }
  return errors;
}
function idFor(o){return o.id||o.pos[1];}
function result(h,value){h.log(JSON.stringify(value,null,2));return 0;}
/* Review/evidence identity is self-asserted only: Dairn never authenticates an actor. */
function actorFromCli(h,o){
  for(const candidate of [o.actor,h.env('DAIRN_ACTOR')]){
    if(candidate===undefined||candidate===null)continue;
    ok(typeof candidate==='string','Actor must be a string');
    const actor=candidate.trim();
    if(!actor)continue;
    ok(actor.length<=ACTOR_MAX,'Actor must be 200 characters or fewer');
    return actor;
  }
  return null;
}
/* Invocation contract: agents must call the project launcher instead of guessing PATH. */
function launcherView(h,root){
  let info=null;
  try{info=launcherInfo(h,root)||null;}catch(_){info=null;}
  const posix=info&&nonEmpty(info.invocation)?info.invocation.trim():'./'+LAUNCHER_POSIX;
  const windows=info&&nonEmpty(info.windows_invocation)?info.windows_invocation.trim():String(LAUNCHER_WINDOWS).replace(/\//g,'\\');
  return {info,invocation:{posix,windows,note:"Use this project launcher; 'dairn' in docs is shorthand",doctor:posix+' doctor'}};
}
function launcherSummary(info){
  if(!info)return null;
  return {resolved:info.resolved??null,windows:info.windows??null,mode:info.mode??null,
    invocation:info.invocation??null,windows_invocation:info.windows_invocation??null,runtime:info.runtime??null};
}
function lastReviewEvidence(h,root,t){
  let last=null;
  for(const stage of t.stages)for(const evidence of stage.evidence||[])if(evidence.kind==='review')last=evidence;
  if(!last)return null;
  let verdict=null;
  try{verdict=JSON.parse(h.read(safe(h,root,last.path)));}catch(_){return null;}
  if(!isObj(verdict))return null;
  const fileActor=nonEmpty(verdict.actor)?verdict.actor.trim():null;
  const recordedActor=nonEmpty(last.actor)?last.actor.trim():null;
  return {path:last.path,standards:verdict.standards??null,spec_fidelity:verdict.spec_fidelity??null,
    head:verdict.head??null,actor:fileActor||recordedActor,assurance:'self-asserted'};
}
function readPolicy(h,root){
  const file=safe(h,root,'.dairn/governance/project.json');
  ok(exists(h,file),'Missing .dairn/governance/project.json for retro validation');
  try{return JSON.parse(h.read(file));}catch(e){throw Error('Invalid .dairn/governance/project.json: '+e.message);}
}
function configuredChecks(policy){
  const names=new Set();
  for(const m of policy?.modules||[])for(const key of Object.keys(m?.checks||{}))names.add(key);
  for(const list of Object.values(policy?.required_checks||{}))if(Array.isArray(list))for(const name of list)names.add(name);
  return names;
}
function grillOpenQuestions(h,root,stage){
  const open=[];
  for(const evidence of stage.evidence||[]){
    if(evidence.kind!=='grill')continue;
    const data=JSON.parse(h.read(safe(h,root,evidence.path)));
    for(const question of data.questions||[])if(question&&question.status==='open')open.push(String(question.id||'?'));
  }
  return open;
}
function safeEvidence(h,root,t,stage,path,kind,fallbackActor=null){
  ok(evidenceKinds.has(kind),'--kind note|test|review|spec|document|machine-evidence|grill|retro|tasks');
  const file=safe(h,root,path);ok(exists(h,file),'Evidence file missing: '+path);
  ok(!path.startsWith('.dairn/work/'),'Task ledger cannot cite itself as evidence');
  const data=h.read(file);ok(data.length<=1048576,'Evidence file exceeds 1 MiB');ok(data.trim().length>0,'Evidence file must not be empty');
  let actor=fallbackActor??null;
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
    ok(review.head===gitHead(h,root),'Review must reference current Git HEAD');
    if(review.actor!==undefined){
      ok(typeof review.actor==='string','Review actor must be a string');
      ok(review.actor.trim().length>0,'Review actor must be a non-empty string');
      ok(review.actor.trim().length<=ACTOR_MAX,'Review actor must be 200 characters or fewer');
      actor=review.actor.trim();
    }
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
  if(stage==='grill'){
    ok(kind==='grill','Grill requires --kind grill');
    let grill;try{grill=JSON.parse(data);}catch(_){throw Error('Grill evidence must be JSON');}
    ok(isObj(grill)&&grill.schema===1,'Grill evidence must be schema 1 JSON');
    ok(grill.task_id===t.id,'Grill evidence must reference task '+t.id);
    ok(Array.isArray(grill.questions)&&grill.questions.length>0,'Grill evidence requires a nonempty questions array');
    const ids=new Set();
    for(const question of grill.questions){
      ok(isObj(question),'Grill question must be an object');
      ok(nonEmpty(question.id),'Grill question requires id');
      ok(!ids.has(question.id),'Duplicate grill question id: '+question.id);
      ids.add(question.id);
      ok(nonEmpty(question.prompt),'Grill question requires prompt: '+question.id);
      ok(nonEmpty(question.recommendation),'Grill question requires recommendation: '+question.id);
      ok(question.status==='resolved'||question.status==='open','Grill question status must be resolved|open: '+question.id);
      if(question.status==='resolved')ok(nonEmpty(question.decision),'Resolved grill question requires decision: '+question.id);
      if(question.rationale!==undefined)ok(typeof question.rationale==='string','Grill rationale must be a string: '+question.id);
    }
    if(grill.confirmed_by!==undefined)ok(nonEmpty(grill.confirmed_by),'Grill confirmed_by must be a nonempty string');
    if(grill.confirmed_at!==undefined)ok(nonEmpty(grill.confirmed_at),'Grill confirmed_at must be a nonempty string');
  }
  if(stage==='specify'){
    ok(kind==='spec','Specify requires --kind spec');
    const grill=t.stages.find(s=>s.id==='grill');
    ok(!grill||['recorded','skipped'].includes(grill.status),'Specify requires recorded (or explicitly skipped) Grill evidence; advance the grill stage first');
    if(/\.json$/i.test(path)){
      let spec;try{spec=JSON.parse(data);}catch(_){throw Error('JSON spec evidence must be valid JSON: '+path);}
      ok(isObj(spec)&&Array.isArray(spec.acceptance)&&spec.acceptance.length>0,'JSON spec evidence requires a nonempty acceptance array');
    }else{
      let spec=null;try{spec=JSON.parse(data);}catch(_){spec=null;}
      if(isObj(spec))ok(Array.isArray(spec.acceptance)&&spec.acceptance.length>0,'JSON spec evidence requires a nonempty acceptance array');
    }
  }
  if(stage==='slice'){
    ok(kind==='tasks'||kind==='note','Slice requires --kind tasks|note');
    if(kind==='tasks'){
      let plan;try{plan=JSON.parse(data);}catch(_){throw Error('Slice tasks evidence must be JSON');}
      let problems;try{problems=validateTaskObject(plan);}catch(e){problems=['validator failed: '+(e?.message||e)];}
      ok(Array.isArray(problems),'Slice tasks validator returned an invalid result');
      ok(problems.length===0,'Invalid slice tasks evidence: '+problems.join('; '));
    }
  }
  if(stage==='reflect'){
    ok(kind==='retro','Reflect requires --kind retro');
    let retro;try{retro=JSON.parse(data);}catch(_){throw Error('Reflect evidence must be JSON');}
    ok(isObj(retro)&&retro.schema===1,'Retro evidence must be schema 1 JSON');
    ok(retro.task_id===t.id,'Retro evidence must reference task '+t.id);
    ok(Array.isArray(retro.observed)&&retro.observed.length>0&&retro.observed.every(nonEmpty),'Retro evidence requires a nonempty observed array of strings');
    const resolution=retro.resolution;
    ok(isObj(resolution)&&!Array.isArray(resolution),'Retro evidence requires exactly one resolution object');
    ok(resolution.kind==='check'||resolution.kind==='standard','Retro resolution kind must be check|standard');
    if(resolution.kind==='check'){
      const names=configuredChecks(readPolicy(h,root));
      ok(nonEmpty(resolution.check)&&names.has(resolution.check),'Retro check must name a configured project check: '+(resolution.check||'(missing)'));
      ok(nonEmpty(resolution.red_evidence),'Retro check resolution requires red_evidence');
      ok(exists(h,safe(h,root,resolution.red_evidence)),'Retro red_evidence file does not exist: '+resolution.red_evidence);
      ok(resolution.verified_red===true,'Retro check resolution requires verified_red: true');
    }else{
      ok(typeof resolution.document==='string'&&(resolution.document==='AGENTS.md'||resolution.document.startsWith('docs/')),'Retro standard document must be AGENTS.md or docs/*');
      ok(exists(h,safe(h,root,resolution.document)),'Retro standard document does not exist: '+resolution.document);
      ok(nonEmpty(resolution.section),'Retro standard resolution requires a nonempty section');
    }
  }
  return {path,kind,sha256:sha256(data),observed_at:h.now(),source:'user-supplied; not independently attested',
    actor,assurance:'self-asserted; actor is not authenticated'};
}
export function appendSessionAnchor(h,root,id,anchor){
  const t=readTask(h,root,id);
  ok(isObj(anchor),'Session anchor must be an object');
  ok(nonEmpty(anchor.path),'Session anchor requires path');
  const file=safe(h,root,anchor.path);
  ok(exists(h,file),'Session anchor file missing: '+anchor.path);
  ok(typeof anchor.sha256==='string'&&/^[0-9a-f]{64}$/.test(anchor.sha256),'Session anchor requires a lowercase sha256 digest');
  ok(sha256(h.read(file))===anchor.sha256,'Session anchor digest mismatch: '+anchor.path);
  ok(typeof anchor.head==='string'&&/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(anchor.head),'Session anchor head must be a 40/64-char hex commit');
  for(const field of ['provider','session_id','event'])ok(nonEmpty(anchor[field]),'Session anchor requires '+field);
  ok(anchor.created_at===undefined||nonEmpty(anchor.created_at),'Session anchor created_at must be a nonempty string');
  ok(!(t.session_anchors||[]).some(a=>a.path===anchor.path),'Session anchor already recorded: '+anchor.path);
  const entry={path:anchor.path,sha256:anchor.sha256,provider:anchor.provider,session_id:anchor.session_id,head:anchor.head,event:anchor.event,created_at:anchor.created_at||h.now()};
  t.session_anchors=[...(t.session_anchors||[]),entry];
  ok(t.session_anchors.length<=MAX_SESSION_ANCHORS,'Session anchor limit reached ('+MAX_SESSION_ANCHORS+')');
  const expected=revisionOf(t);
  withTaskLock(h,root,id,()=>commitTask(h,root,id,t,expected));
  return {...entry,revision:t.revision};
}
export function activeTaskIds(h,root){
  const dir=safe(h,root,'.dairn/work');
  if(!h.exists(dir)||!h.isDirectory(dir))return [];
  return h.list(dir).filter(name=>name.endsWith('.json')&&name.length>5&&idRe.test(name.slice(0,-5))).sort()
    .map(name=>name.slice(0,-5)).filter(id=>readTask(h,root,id).status==='active');
}
export function activeTaskProblems(h,root){
  const problems=[];
  for(const id of activeTaskIds(h,root)){
    let t;try{t=readTask(h,root,id);}catch(e){problems.push(id+': '+e.message);continue;}
    for(const error of proofCheck(h,root,t))problems.push(id+': '+error);
    const implement=t.stages.find(s=>s.id==='implement');
    if(implement&&(implement.status==='active'||implement.status==='recorded')){
      try{for(const error of machineProblems(h,root,t,true))problems.push(id+': '+error);}
      catch(e){problems.push(id+': '+(e?.message||e));}
    }
  }
  return problems;
}
export function runWork(h,root,o){
  const op=o.pos[0]||'status';
  const dir=safe(h,root,'.dairn/work');
  if(op==='start'){
    const title=o.pos.slice(1).join(' ').trim();ok(title&&title.length<=300,'Usage: dairn work start <task title> [--id task-id]');
    const id=o.id||sluggify(title);ok(idRe.test(id||''),'Provide --id safe-ascii-task-id for this title');
    const target=safe(h,root,checkPath(id));
    const r=recommendWorkflow(title);
    const selected=r.stages.map((s,i)=>({id:s.id,skill:s.skill,goal:s.goal,status:i===0?'active':'pending',evidence:[],machine_runs:[]}));
    const task={schema:1,id,title,classification:r.classification,revision:1,created_at:h.now(),updated_at:h.now(),status:'active',current_stage:selected[0].id,stages:selected,
      assurance:'advisory-records; not CI attestation or human approval'};
    withTaskLock(h,root,id,()=>{
      ok(!h.exists(target),'Task already exists: '+id);
      writeAtomic(h,root,checkPath(id),task);
    });
    return result(h,{event:'started',id,title,revision:task.revision,next:selected[0],path:checkPath(id)});
  }
  if(op==='list'){
    const ids=h.exists(dir)?h.list(dir).filter(n=>idRe.test(n.slice(0,-5))&&n.endsWith('.json')).sort().map(n=>n.slice(0,-5)):[];
    return result(h,ids.map(id=>{const t=readTask(h,root,id);return {id,title:t.title,status:t.status,current_stage:t.current_stage,revision:revisionOf(t)};}));
  }
  const id=idFor(o), t=readTask(h,root,id),active=reportStage(t);
  const lifecycleReason=()=>typeof o.reason==='string'?o.reason.trim():typeof o.pos[2]==='string'?o.pos[2].trim():'';
  if(op==='cancel'){
    const reason=lifecycleReason();
    ok(reason,'Usage: dairn work cancel '+id+' --reason "..."');
    ok(t.status==='active'&&active,'Only active tasks can be cancelled: '+id);
    const expected=revisionOf(t),stage=active;
    withTaskLock(h,root,id,()=>{
      stage.status='cancelled';
      t.status='cancelled';
      t.cancelled_at=h.now();
      t.cancelled_reason=reason;
      commitTask(h,root,id,t,expected);
    });
    return result(h,{event:'cancelled',task:id,status:t.status,stage:stage.id,reason,revision:t.revision});
  }
  if(op==='reopen'){
    const reason=lifecycleReason();
    ok(reason,'Usage: dairn work reopen '+id+' --reason "..."');
    ok(t.status==='cancelled'||t.status==='recorded-complete','Only cancelled or recorded-complete tasks can be reopened: '+id);
    const expected=revisionOf(t);
    let reopened=null;
    withTaskLock(h,root,id,()=>{
      if(t.status==='cancelled'){
        reopened=t.stages.find(s=>s.status==='cancelled');
        ok(reopened,'Cancelled task has no cancelled stage to reopen: '+id);
      }else{
        reopened=t.stages.at(-1);
        ok(reopened&&(reopened.status==='recorded'||reopened.status==='skipped'),'Recorded-complete task has no recorded/skipped final stage: '+id);
      }
      reopened.status='active';
      t.status='active';
      t.current_stage=reopened.id;
      t.reopened_at=h.now();
      t.reopened_reason=reason;
      commitTask(h,root,id,t,expected);
    });
    return result(h,{event:'reopened',task:id,status:t.status,stage:reopened.id,reason,revision:t.revision});
  }
  if(op==='skip'){
    const reason=lifecycleReason();
    ok(reason,'Usage: dairn work skip '+id+' --reason "..."');
    ok(t.status==='active'&&active,'Only active tasks can skip a stage');
    ok(SKIPPABLE.includes(active.id),'Only planning stages can be skipped: '+SKIPPABLE.join(', '));
    const skipErrors=proofCheck(h,root,t);
    ok(!skipErrors.length,'Evidence changed or missing: '+skipErrors.join('; '));
    const expected=revisionOf(t),index=t.stages.findIndex(s=>s===active);
    const skipped={stage:active.id,reason,at:h.now()};
    withTaskLock(h,root,id,()=>{
      active.status='skipped';
      t.skips=[...(t.skips||[]),skipped];
      if(index+1<t.stages.length){t.stages[index+1].status='active';t.current_stage=t.stages[index+1].id;}
      else {t.status='recorded-complete';t.current_stage=null;}
      commitTask(h,root,id,t,expected);
    });
    return result(h,{event:'skipped',task:id,stage:skipped.stage,reason,status:t.status,next:reportStage(t),revision:t.revision});
  }
  const errors=[...proofCheck(h,root,t),...machineProblems(h,root,t,false)];
  if(op==='link-check'){
    const runId=o.run;ok(runId,'Usage: dairn work link-check <id> --run <run-id> [--evidence <run.json>]');
    const located=locateRunEvidence(h,root,runId,o.evidence);
    ok(!errors.length,'Task evidence integrity check failed');
    // linkCheckRun re-reads the run file, pins its bytes and commits under the
    // per-task lock with a revision CAS; a concurrent writer fails loudly.
    const rawEvidence=JSON.parse(h.read(safe(h,root,located.path)));
    const link=linkCheckRun(h,root,id,located.path,rawEvidence);
    return result(h,{event:'linked',task:id,run_id:link.run_id,path:link.path,status:link.status,
      assurance:'advisory reference to an existing run; linking grants no trust',revision:readTask(h,root,id).revision});
  }
  if(op==='status'||op==='next'||op==='verify'){
    const current=active?{...active,goal:active.goal}:null;
    const launcher=launcherView(h,root);
    const requireReviewActor=!!o.require_review_actor||h.env('DAIRN_REQUIRE_REVIEW_ACTOR')==='true';
    const check={task:id,revision:revisionOf(t),status:t.status,current_stage:t.current_stage,
      next:op==='next'?stageContract(h,root,t,active):current,
      invocation:launcher.invocation,
      stages:t.stages.map(s=>({stage:s.id,status:s.status,skill:s.skill,evidence_count:s.evidence.length,machine_runs:(s.machine_runs||[]).length})),
      evidence_errors:errors,session_anchors:(t.session_anchors||[]).length,
      assurance:'Task evidence integrity only; run dairn validate and dairn check for machine gates'};
    if(op==='verify'&&o.require_machine_gates)errors.push(...machineProblems(h,root,t,true));
    if(op==='verify'&&o.require_session_anchor&&!(t.session_anchors||[]).length)errors.push('No session anchor recorded for this task');
    if(op==='verify'){
      const review=lastReviewEvidence(h,root,t);
      check.review=review;
      check.launcher=launcherSummary(launcher.info);
      check.review_actor_required=requireReviewActor;
      if(requireReviewActor){
        if(!review)errors.push('No review evidence recorded; cannot satisfy --require-review-actor');
        else if(!review.actor)errors.push('Review evidence has no actor; set review.actor, --actor or DAIRN_ACTOR');
      }
    }
    check.evidence_errors=errors;check.machine_gates_required=!!o.require_machine_gates;
    check.session_anchor_required=!!o.require_session_anchor;
    check.linked_runs=(t.stages.find(s=>s.id==='implement')?.machine_runs||[]).map(x=>({run_id:x.run_id,status:x.status}));
    h.log(JSON.stringify(check,null,2));return op==='verify'&&errors.length?2:0;
  }
  ok(t.status==='active'&&active,'Task is not active');
  if(op==='record'){
    const path=o.pos[2];ok(path,'Usage: dairn work record <id> <repo-relative-evidence-path> --kind <type>');
    const evidence=safeEvidence(h,root,t,active.id,path,o.kind||'note',actorFromCli(h,o));
    // The grill document is a living frontier: re-recording replaces the previous draft
    // so a resolved interview can supersede an earlier open-questions snapshot.
    if(active.id==='grill'&&evidence.kind==='grill')active.evidence=(active.evidence||[]).filter(e=>e.kind!=='grill');
    ok(active.evidence.length<50,'Too many evidence artifacts for stage');
    ok(!active.evidence.some(e=>e.path===path),'Evidence path already recorded for active stage');
    active.evidence.push(evidence);
    const expected=revisionOf(t);
    withTaskLock(h,root,id,()=>commitTask(h,root,id,t,expected));
    return result(h,{event:'recorded',task:id,stage:active.id,evidence});
  }
  if(op==='advance'||op==='finish'){
    ok(!errors.length,'Evidence changed or missing: '+errors.join('; '));
    ok(active.evidence.length>0||(active.id==='implement'&&(active.machine_runs||[]).length>0),'Current stage requires evidence: '+active.id);
    if(active.id==='implement')ok(!machineProblems(h,root,t,true).length,'Implementation requires a passing check --task run for the current HEAD');
    // Machine-run evidence is linked by the Dairn executor, never synthesized by a free-form artifact record.
    if(active.id==='review'){ok(active.evidence.some(e=>e.kind==='review'),'Review needs structured review evidence');
      const lastReview=active.evidence.filter(e=>e.kind==='review').at(-1);
      let verdict=null;
      try{verdict=JSON.parse(h.read(safe(h,root,lastReview.path)));}catch(_){verdict=null;}
      ok(isObj(verdict)&&verdict.standards==='pass'&&verdict.spec_fidelity!=='fail','Review standards or spec fidelity failed; fix and record a passing review before advancing');
      if(t.stages.some(s=>s.id==='implement'))ok(!machineProblems(h,root,t,true).length,'Review requires passing machine run for current HEAD');}
    if(active.id==='synchronize'){ok(active.evidence.some(e=>e.kind==='document'),'Synchronize needs structured document impact decision');
      if(t.stages.some(x=>x.id==='review'))ok(t.stages.find(x=>x.id==='review')?.status==='recorded','Synchronize requires completed Review');}
    if(active.id==='grill'){
      const open=grillOpenQuestions(h,root,active);
      ok(!open.length,'Grill has open questions: '+open.join(', '));
    }
    if(active.id==='specify'){
      ok(active.evidence.some(e=>e.kind==='spec'),'Specify needs structured spec evidence');
      const grill=t.stages.find(s=>s.id==='grill');
      ok(!grill||['recorded','skipped'].includes(grill.status),'Specify requires completed (or explicitly skipped) Grill evidence');
    }
    if(active.id==='slice')ok(active.evidence.some(e=>e.kind==='tasks'||e.kind==='note'),'Slice needs tasks or note evidence');
    if(active.id==='reflect')ok(active.evidence.some(e=>e.kind==='retro'),'Reflect needs structured retro evidence');
    const index=t.stages.findIndex(s=>s===active);
    if(op==='finish')ok(index===t.stages.length-1,'Task stages remain; use work advance');
    if(op==='advance')ok(index+1<t.stages.length,'Last stage requires work finish');
    const expected=revisionOf(t);
    active.status='recorded';
    if(index+1<t.stages.length){t.stages[index+1].status='active';t.current_stage=t.stages[index+1].id;}
    else{t.status='recorded-complete';t.current_stage=null;}
    withTaskLock(h,root,id,()=>commitTask(h,root,id,t,expected));
    return result(h,{task:id,status:t.status,completed_stage:active.id,next:reportStage(t),assurance:'local records only; CI attestation is produced by the protected evidence chain, never by the task ledger'});
  }
  throw Error('Usage: dairn work start|list|status|next|record|advance|skip|verify|finish|cancel|reopen|link-check');
}
