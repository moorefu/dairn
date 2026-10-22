/* 基于 QuickJS 的治理编排。 */
import { classify, moduleSelection, manifestValidate, policyValidate, invariant, relative, requiresManifest } from './policy.mjs';
import {sha256} from './sha256.mjs';
import {validateAll,archiveValidate} from './validators.mjs';
import {docsValidate} from './docs-validator.mjs';
import {lifecycleValidate} from './lifecycle-validator.mjs';
import {verifyRuntimeLock,runtimeVersion} from './project.mjs';
import {prepareCheckTask,attachCheckRun} from './work.mjs';
import {captureFacts} from './facts.mjs';
import {readRelations} from './relations.mjs';
import {configuredStubs} from './stubs.mjs';
const slash = x => x.replace(/\\/g, '/');
const join = (a,b) => b === '.' ? a : a.replace(/\/$/,'') + '/' + b;
const within = (root, path) => path === root || path.startsWith(root.replace(/\/$/,'') + '/');
function parseArgs(args) {
  let cmd = null, root = null, base = null, head = 'HEAD', timeout = 120, all = false, json = false, task=null;
  for(let i=0; i<args.length; i++) {
    const a=args[i];
    if (a === '--root' || a === '--base' || a === '--head' || a === '--timeout' || a === '--task') {
      invariant(i+1<args.length, a+' needs value');
      const v=args[++i]; if (a==='--root') root=v; else if(a==='--base') base=v; else if(a==='--head') head=v; else if(a==='--task') task=v; else timeout=Number(v);
    } else if (a==='--all') all=true;
    else if (a==='--json') json=true;
    else if (!cmd && ['doctor','validate','validate-core','scope','check','help'].includes(a)) cmd=a;
    else throw new Error('Unknown option / command: '+a);
  }
  invariant(Number.isFinite(timeout)&&timeout>=1&&timeout<=3600, 'timeout must be 1..3600 seconds');
  if (!cmd) cmd = 'help';
  if ((cmd==='scope' || cmd==='check') && !base && !all) throw new Error(cmd+' requires --base (or check --all)');
  if (all && cmd!=='check') throw new Error('--all only supported by check');
  if (task && (cmd!=='check'||all||!base||head!=='HEAD')) throw new Error('--task requires check --base REF with checked-out HEAD; --all/--head not supported');
  return {cmd,root,base,head,timeout,all,json,task};
}
function mustRead(h,root,file) {return h.read(join(root,file));}
function jsonFile(h,root,p) {return JSON.parse(mustRead(h,root,p));}
function listDirs(h,p) {return h.exists(p) ? h.list(p) : [];}
function staticChecks(h,root) {
  const problems=[];
  let cfg=null, raw='';
  try {raw=mustRead(h,root,'.dairn/governance/project.json'); cfg=JSON.parse(raw); problems.push(...policyValidate(cfg)); }
  catch(e) {problems.push('Config invalid: '+e.message);}
  for(const f of ['AGENTS.md','docs/GOVERNANCE_SPEC.md']) if(!h.exists(join(root,f))) problems.push('Missing '+f);
  const notes=join(root,'.agents/notes');
  for(const p of ['proposed','implemented','rejected']) if(!h.exists(join(notes,p))) problems.push('Missing Notes lifecycle: '+p);
  const skills=join(root,'.agents/skills');
  if (!h.exists(skills)) problems.push('Missing .agents/skills');
  else for (const s of listDirs(h,skills)) {
    if (!h.isDirectory(join(skills,s))) continue;
    const skill=join(join(skills,s),'SKILL.md');
    if(!h.exists(skill)) {problems.push('Missing '+s+'/SKILL.md');continue;}
    const t=h.read(skill); const fm=t.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n/);
    if(!fm || !new RegExp('^name:\\s*["\']?'+s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'["\']?\\s*$','m').test(fm[1]) || !/^description:\s*.+/m.test(fm[1])) problems.push('Invalid Skill frontmatter: '+s);
  }
  return {policy:cfg,policy_raw:raw,errors:problems};
}
function governanceValidators(h,root,base) {
  const result=validateAll(h,root);
  const full={...result.detail,docs:[],lifecycle:[],relations:[],stubs:[]};
  try{configuredStubs(h,root);}catch(e){full.stubs=[e.message];}
  try{const p=JSON.parse(h.read(join(root,'.dairn/governance/project.json')));readRelations(h,root,captureFacts(h,root,p));}
  catch(e){full.relations=[e.message];}
  try {full.docs=docsValidate(h,root);}catch(e){full.docs=['validator crashed: '+e.message];}
  try {full.lifecycle=lifecycleValidate(h,root,base);}catch(e){full.lifecycle=['validator crashed: '+e.message];}
  if(base) {
    // Append-only checks are dependent on a separately trusted base.
    full.archive=archiveValidate(h,root,base);
  }
  return {detail:full,errors:Object.entries(full).flatMap(([name,errors])=>errors.map(x=>name+': '+x))};
}
function command(h,argv,cwd,timeout) {
  const res=h.run(argv,cwd,timeout);
  if (res.timedOut) throw new Error('Command timeout '+timeout+'s: '+argv[0]);
  if (res.code!==0) throw new Error('Command failed ('+res.code+'): '+argv.join(' ')+'\n'+res.output.slice(0,1024));
  return res.output;
}
function readScope(h,root,policy,opts) {
  const active=command(h,['git','rev-parse','HEAD'],root,opts.timeout).trim();
  const head=command(h,['git','rev-parse',opts.head],root,opts.timeout).trim();
  if (opts.cmd==='check' && active!==head) throw new Error('check HEAD must match checked-out commit');
  const resolvedBase=command(h,['git','rev-parse','--verify',opts.base+'^{commit}'],root,opts.timeout).trim();
  const output=command(h,['git','diff','--name-only','-z','--diff-filter=ACDMRT',resolvedBase,head],root,opts.timeout);
  const paths=output.split('\0').filter(Boolean);
  for(const p of paths) relative(p);
  const floor=classify(paths,p=> h.exists(join(root,p)) ? jsonFile(h,root,p) : null);
  const changes=paths.filter(p=>/^\.dairn\/governance\/changes\/[a-z0-9][a-z0-9-]*\.json$/.test(p));
  invariant(changes.length<2,'Multiple change manifests found');
  let meta={source:'git-local-or-branch',...floor, review_pending:floor.risk==='L2'};
  if(changes.length) {
    const m=jsonFile(h,root,changes[0]);
    if(m.decision_note) invariant(h.exists(join(root,m.decision_note)), 'Missing decision_note');
    meta=manifestValidate(m,floor);
  } else if ((h.env('GITHUB_ACTIONS')==='true' && h.env('GITHUB_EVENT_NAME')==='pull_request') ||
    (h.env('GITLAB_CI')==='true' && h.env('CI_PIPELINE_SOURCE')==='merge_request_event')) {
    // CI provider body metadata is not yet ported; fail closed rather than treating PR as local.
    if(requiresManifest(paths)) throw new Error('QuickJS preview requires manifest for CI PR/MR changes');
  }
  return {paths, modules:moduleSelection(policy,paths), risk:meta.risk, governance_mode:meta.governance_mode,
    triggers:meta.risk_triggers, required:policy.required_checks[meta.risk], base:resolvedBase, head,
    record_source:meta.source, review_pending:meta.review_pending};
}
function checkCwd(h,root,m,cfg) {
  const p=relative(cfg.cwd??m.path,true);
  const absolute=h.realpath(join(root,p));
  invariant(within(root,absolute), 'Check cwd escapes repository: '+p);
  return absolute;
}
function runStackCheck(h,stack,step,cwd,timeout) {
  if(stack==='go' && step==='lint') {
    const repo=h.run(['git','rev-parse','--is-inside-work-tree'],cwd,timeout);
    let goFiles;
    if(repo.code===0) goFiles=command(h,['git','ls-files','--cached','--others','--exclude-standard','-z','--','*.go'],cwd,timeout).split('\0').filter(Boolean);
    else {goFiles=[];const walk=(d,prefix,depth)=>{if(depth>8)return;for(const name of h.list(d)){if(name.startsWith('.')||['vendor','node_modules','target','dist'].includes(name))continue;const abs=join(d,name),rel=prefix+name;if(h.isDirectory(abs))walk(abs,rel+'/',depth+1);else if(name.endsWith('.go'))goFiles.push(rel);}};walk(cwd,'',0);}
    invariant(goFiles.length>0,'No Go files available for gofmt');
    const invalid=command(h,['gofmt','-l',...goFiles],cwd,timeout).trim();
    invariant(!invalid,'gofmt found unformatted files: '+invalid);
    command(h,['go','vet','./...'],cwd,timeout);
    return {code:0,output:'gofmt and go vet passed',duration_sec:0};
  }
  if(stack==='rust'&&step==='lint') {
    command(h,['cargo','fmt','--all','--','--check'],cwd,timeout);
    command(h,['cargo','clippy','--all-targets','--','-D','warnings'],cwd,timeout);
    return {code:0,output:'cargo fmt and clippy passed',duration_sec:0};
  }
  if(stack==='python'&&step==='lint') {
    command(h,['ruff','check','.'],cwd,timeout);
    command(h,['ruff','format','--check','.'],cwd,timeout);
    return {code:0,output:'ruff check and format passed',duration_sec:0};
  }
  throw new Error('Unsupported internal stack-check: '+stack+' '+step+' (fail closed)');
}
function checks(h,root,opts,st,raw,validation) {
  const risk=opts.all ? 'L2' : st.risk;
  const mods=opts.all ? st.policy.modules : st.modules;
  const required=st.policy.required_checks[risk];
  const report={schema_version:opts.task?2:1,engine:'dairn-quickjs',assurance:'technical-checks-only',mode:opts.all?'baseline-all':'risk-gate-preview',
    risk,governance_mode:opts.all?'G2':st.governance_mode,review_pending:opts.all?true:st.review_pending,
    base:opts.all?null:st.base,head:opts.all?null:st.head,utc:h.now(),changed_paths:opts.all?[]:st.paths,
    policy_sha256:sha256(raw),governance_validation:{status:'passed',validators:Object.keys(validation.detail).sort(),error_count:0},checks:[]};
  let failed=false;
  if (!opts.all && !st.paths.length) {
    if(opts.task)throw Error('Task-linked check requires changed paths and actual selected checks');
    h.log('No diff; static core validated, no stack checks');return 0;}
  invariant(mods.length>0 || st.paths.every(p=>p.startsWith('docs/') || p.endsWith('.md') || p.startsWith('.agents/notes/') || p.startsWith('.dairn/governance/operations/') || p.startsWith('.dairn/governance/changes/') || p.startsWith('.dairn/work/') || p.startsWith('.dairn/facts/') || p.startsWith('.dairn/governance/evidence/') || p.startsWith('.dairn/cache/')), 'No module matched changed source');
  for(const m of mods) for(const gate of required) {
    const cfg=m.checks[gate];const record={module:m.name,gate,status:'missing',returncode:null};
    if(!cfg) {failed=true;report.checks.push(record);continue;}
    record.argv=cfg.argv;
    try {
      const cwd=checkCwd(h,root,m,cfg); record.cwd=cwd.slice(root.length).replace(/^\//,'')||'.';
      h.log('[run] '+m.name+':'+gate+' '+cfg.argv.join(' '));
      let result;
      if(cfg.argv[0]==='dairn' && cfg.argv[1]==='stack-check') result=runStackCheck(h,cfg.argv[2],cfg.argv[3],cwd,opts.timeout);
      else result=h.run(cfg.argv,cwd,opts.timeout);
      record.returncode=result.code;record.duration_sec=result.duration_sec;record.timed_out=!!result.timedOut;
      record.output_sha256=sha256(result.output||'');record.output_truncated=false;
      record.status=result.timedOut?'error':result.code===0?'passed':'failed';
      if(record.status!=='passed') record.reason=(result.timedOut?'timeout: ':'failed: ')+(result.output||'').slice(0,1024);
    }catch(e){record.status='error';record.reason=e.message;record.output_sha256=sha256(e.message||'');record.output_truncated=/output exceeded/.test(e.message||'');}
    if(record.status!=='passed') failed=true;
    report.checks.push(record);
  }
  if(opts.task){
    const started=opts.taskPreflight;
    const after=command(h,['git','rev-parse','--verify','HEAD^{commit}'],root,opts.timeout).trim();
    invariant(after===started.head&&after===st.head,'Git HEAD changed during check; evidence cannot be attached');
    report.run_id='run-'+Date.now()+'-'+sha256(opts.task+'|'+st.head+'|'+h.now()+'|'+Math.random()).slice(0,14);
    report.task_id=opts.task;report.base_commit=st.base;report.commit=st.head;report.modules=mods.map(m=>m.name);report.required_checks=[...required];
    report.status=failed?'failed':'passed';report.trust='local-unattested';report.ci=null;report.runtime={version:runtimeVersion(h),runtime_sha256:opts.runtimeHash};
  }
  const dir=join(root,'.dairn/governance/evidence');h.mkdirs(dir);
  const name=opts.task?report.run_id+'-checks.json':(opts.all?'all':st.head.slice(0,12))+'-qjs-checks.json';
  const file=join(dir,name);
  if(h.exists(file))throw Error('Refuse to overwrite existing run evidence: '+file);
  h.write(file,JSON.stringify(report,null,2)+'\n');
  if(opts.task){const linked=attachCheckRun(h,root,opts.task,report,'.dairn/governance/evidence/'+name);h.log('Attached task run: '+linked.run_id+' ['+linked.status+']');}
  h.log('Evidence: '+file+'\nResult: '+(failed?'FAILED':'PASSED')+' [technical-checks-only; NOT full governance approval]');
  return failed?1:0;
}
export function main(h,args) {
  try {
    const opts=parseArgs(args);
    if(opts.cmd==='help') {h.log('Dairn '+runtimeVersion(h)+' — AI-Native Software Engineering Toolkit\n  dairn init|adopt [--root PATH] [--stack go|python|rust|vue|java|spring-boot|openresty] [--ci none|github|gitlab|both] [--sample] [--plan]\n  dairn detect|doctor|validate [--root PATH]\n  dairn scope|check --base SHA [--root PATH]\n  dairn check --all (baseline L2 checks)\n  dairn upgrade --plan|--apply [--root PATH]\n  dairn work start|next|record|advance|verify|finish [--require-ci-attestation]\n  dairn work attest-prepare|attest-attach TASK [PAYLOAD SIG]\n  dairn guide impact --base SHA [--precision PROJECT-STUB-ID]\n  dairn stubs [list|templates|doctor|init --template LANGUAGE --id NAME [--apply]] [--root PATH]\n  dairn skills catalog|list|add NAME [--apply]\n  dairn docs find QUERY|show SPEC-ID');return 0;}
    const root=h.realpath(opts.root??h.cwd());
    verifyRuntimeLock(h,root,false);
    const st=staticChecks(h,root);
    const actualPolicyHash=sha256(st.policy_raw);
    const expected=h.env('DAIRN_EXPECTED_POLICY_SHA256');
    if (expected) invariant(/^[0-9a-f]{64}$/.test(expected) && expected===actualPolicyHash,'Policy hash differs from externally trusted policy');
    if (opts.cmd==='check' && (h.env('GITHUB_ACTIONS')==='true'||h.env('GITLAB_CI')==='true'))
      invariant(!!expected,'CI check requires protected DAIRN_EXPECTED_POLICY_SHA256');
    if(st.errors.length) {for(const s of st.errors)h.error('ERROR: '+s);return 1;}
    if(opts.cmd==='doctor') {h.log(JSON.stringify({engine:'Dairn QuickJS Governance',root,policy_sha256:sha256(st.policy_raw),status:'ready',full_python_parity:false},null,2));return 0;}
    if(opts.cmd==='validate-core') {h.log('PASS: QuickJS core structural checks only');return 0;}
    if(opts.cmd==='validate') {
      const result=governanceValidators(h,root,opts.base);
      for(const [key,errors] of Object.entries(result.detail))h.log(key+': '+(errors.length?'FAIL '+errors.length:'PASS'));
      for(const error of result.errors)h.error('ERROR: '+error);
      return result.errors.length?1:0;
    }
    // A passing technical gate must not bypass structural governance validators.
    let preflight=null;
    if(opts.cmd==='check') {
      const validation=governanceValidators(h,root,opts.base);
      preflight=validation;
      if(validation.errors.length){for(const error of validation.errors)h.error('ERROR: '+error);return 1;}
    }
    if(opts.task){ opts.taskPreflight=prepareCheckTask(h,root,opts.task); opts.runtimeHash=verifyRuntimeLock(h,root,true).runtime_sha256;}
    const scope=opts.all ? {policy:st.policy} : {...readScope(h,root,st.policy,opts),policy:st.policy};
    if(opts.cmd==='scope') {
      h.log(JSON.stringify({paths:scope.paths,modules:scope.modules.map(m=>m.name),risk:scope.risk,governance_mode:scope.governance_mode,
        classification_reasons:scope.triggers,record_source:scope.record_source,review_pending:scope.review_pending,
        required_checks:scope.required},null,2));return 0;
    }
    return checks(h,root,opts,scope,st.policy_raw,preflight);
  } catch(e) {h.error('ERROR: '+String(e)+(e?.stack?'\n'+e.stack:''));return 2;}
}
