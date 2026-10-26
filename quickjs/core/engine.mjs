import {executeCheck} from './stack-check.mjs';
import {toolchainIdentity} from './toolchain.mjs';
/* 基于 QuickJS 的治理编排。 */
import { classify, moduleSelection, manifestValidate, policyValidate, invariant, relative, requiresManifest } from './policy.mjs';
import {sha256} from './sha256.mjs';
import {validateAll,archiveValidate} from './validators.mjs';
import {docsValidate} from './docs-validator.mjs';
import {lifecycleValidate} from './lifecycle-validator.mjs';
import {verifyRuntimeLock,runtimeVersion,doctor as projectDoctor} from './project.mjs';
import {checkTaskPresence,linkCheckRun,activeTaskIds,activeTaskProblems} from './work.mjs';
import {runTurnEnd} from './hooks.mjs';
import {prChangeMeta,isCiPullRequest} from './ci-context.mjs';
import {captureFacts} from './facts.mjs';
import {readRelations} from './relations.mjs';
import {configuredAnalyzers} from './analyzers.mjs';
import {captureWorktree,taskExclusions} from './worktree.mjs';
import {createCheckRun,writeRunEvidence} from './evidence.mjs';
import {planGovernance} from './governance-plan.mjs';
import {readRefactorContracts,projectContextOf,validateRefactorContract} from './project-context.mjs';
const slash = x => x.replace(/\\/g, '/');
const join = (a,b) => b === '.' ? a : a.replace(/\/$/,'') + '/' + b;
const within = (root, path) => path === root || path.startsWith(root.replace(/\/$/,'') + '/');
const COMMANDS = ['doctor','validate','validate-core','scope','check','help','hook'];
const HOOKS = ['pre-push','turn-end'];
const VALUE_FLAGS = new Map([['--root','root'],['--base','base'],['--head','head'],['--timeout','timeout'],['--task','task'],
  ['--payload','payload'],['--provider','provider'],['--session','session'],['--event','event']]);
function parseArgs(args) {
  // `--help`/`-h` 在任何位置都直接早退，不让缺少 --base 之类的检查把它变成错误。
  if (args.includes('--help') || args.includes('-h')) {
    return {cmd:'help',root:null,base:null,head:'HEAD',timeout:120,all:false,json:false,task:null,
      pos:[],hook:null,strict:false,stdin:false,no_check:false,allow_unattributed:false,
      payload:null,provider:null,session:null,event:null};
  }
  let cmd = null, root = null, base = null, head = 'HEAD', timeout = 120, all = false, json = false, task=null;
  let strict = false, stdin = false, no_check = false, allow_unattributed = false;
  let payload = null, provider = null, session = null, event = null;
  const pos = [];
  for(let i=0; i<args.length; i++) {
    const a=args[i];
    if (VALUE_FLAGS.has(a)) {
      invariant(i+1<args.length, a+' needs value');
      const v=args[++i];
      const key=VALUE_FLAGS.get(a);
      if (key==='timeout') timeout=Number(v);
      else if (key==='root') root=v;
      else if (key==='base') base=v;
      else if (key==='head') head=v;
      else if (key==='task') task=v;
      else if (key==='payload') payload=v;
      else if (key==='provider') provider=v;
      else if (key==='session') session=v;
      else event=v;
    } else if (a==='--all') all=true;
    else if (a==='--json') json=true;
    else if (a==='--strict') strict=true;
    else if (a==='--stdin') stdin=true;
    else if (a==='--no-check') no_check=true;
    else if (a==='--allow-unattributed') allow_unattributed=true;
    else if (a.startsWith('-')) throw new Error('Unknown option / command: '+a);
    else if (!cmd && COMMANDS.includes(a)) cmd=a;
    else pos.push(a);
  }
  invariant(Number.isFinite(timeout)&&timeout>=1&&timeout<=3600, 'timeout must be 1..3600 seconds');
  if (!cmd) cmd = 'help';
  let hook = null;
  if (cmd==='hook') {
    invariant(pos.length>0, 'Usage: dairn hook pre-push|turn-end');
    invariant(HOOKS.includes(pos[0]), 'Unknown hook: '+pos[0]+' (expected pre-push|turn-end)');
    invariant(pos.length===1, 'Unexpected hook arguments: '+pos.slice(1).join(' '));
    hook = pos[0];
  } else if (pos.length) throw new Error('Unknown option / command: '+pos[0]);
  if ((cmd==='scope' || cmd==='check') && !base && !all) throw new Error(cmd+' requires --base (or check --all)');
  if (all && cmd!=='check') throw new Error('--all only supported by check');
  if (task && cmd!=='hook' && (cmd!=='check'||all||!base||head!=='HEAD')) throw new Error('--task requires check --base REF with checked-out HEAD; --all/--head not supported');
  return {cmd,root,base,head,timeout,all,json,task,pos,hook,strict,stdin,no_check,allow_unattributed,payload,provider,session,event};
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
  const full={...result.detail,docs:[],lifecycle:[],relations:[],analyzers:[]};
  try{configuredAnalyzers(h,root);}catch(e){full.analyzers=[e.message];}
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
  } else if (isCiPullRequest(h)) {
    // 缺少变更清单时回退到平台 PR/MR 元数据；元数据不可用时保持 fail closed。
    const pr = prChangeMeta(h, floor);
    if (pr) meta={...pr};
    else if(requiresManifest(paths)) throw new Error('QuickJS preview requires manifest for CI PR/MR changes; provide .dairn/governance/changes/<id>.json or platform PR metadata');
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
/* --- 审计日志：每个 gate 的原始输出落盘，截断上限按 UTF-8 字节计算。 --- */
const LOG_LIMIT = 65536;
const LOG_TRUNCATION_MARKER = '\n[... truncated at 65536 bytes]';
function sanitizeName(value) {
  const name = String(value == null ? '' : value).replace(/[^A-Za-z0-9_.-]/g, '_');
  return name || '_';
}
function truncateUtf8(text, limit) {
  // JS 字符串按 UTF-16 计长，这里按 UTF-8 字节截断，避免多字节字符被截半个。
  let bytes = 0, end = 0;
  for (const char of text) {
    const code = char.codePointAt(0);
    const size = code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    if (bytes + size > limit) return {text: text.slice(0, end), truncated: true};
    bytes += size;
    end += char.length;
  }
  return {text, truncated: false};
}
function gateLogKey(opts) {
  const prefix = opts.task ? 'task-' + sanitizeName(opts.task) : opts.hook ? 'pre-push' : 'check';
  // 同一 HEAD 重复 check 也必须得到新目录：时间戳 + 短随机摘要，绝不覆盖旧日志。
  return prefix + '-' + Date.now() + '-' + sha256(prefix + '|' + Date.now() + '|' + Math.random()).slice(0, 6);
}
function writeGateLog(h, logsDir, logsRel, seen, name, text) {
  let base = sanitizeName(name);
  if (seen.has(base)) {
    let index = 2;
    while (seen.has(base + '-' + index)) index++;
    base = base + '-' + index;
  }
  seen.add(base);
  const file = base + '.log';
  const cut = truncateUtf8(String(text == null ? '' : text), LOG_LIMIT);
  const content = cut.truncated ? cut.text + LOG_TRUNCATION_MARKER : cut.text;
  h.write(join(logsDir, file), content);
  return {log: logsRel + '/' + file, log_sha256: sha256(content), log_truncated: cut.truncated};
}
/* doctor 由 project.mjs 唯一实现（launcher 感知）；此处不再保留第二份不可达实现。 */
function repositoryOf(h,root,timeout){
  const fromEnv=h.env('DAIRN_CI_REPOSITORY');
  if(fromEnv)return fromEnv;
  const probe=h.run(['git','config','--get','remote.origin.url'],root,Math.min(timeout,30));
  if(!probe.timedOut&&probe.code===0&&probe.output){
    const value=probe.output.trim().replace(/\.git$/,'');
    const match=/^(?:https?:\/\/|ssh:\/\/|git@)(?:[^/:]+[/:])?(.+)$/.exec(value);
    return match?match[1]:value;
  }
  return 'local/repository';
}
function checks(h,root,opts,st,raw,validation,stats) {
  const risk=opts.all ? 'L2' : st.risk;
  const mods=opts.all ? st.policy.modules : st.modules;
  const required=st.policy.required_checks[risk];
  const evidenceDir=join(root,'.dairn/governance/evidence');
  const logRunKey=gateLogKey(opts);
  const logsRel='.dairn/governance/evidence/logs/'+logRunKey;
  // 工作树身份只在会成为门禁证据的运行里捕获（任务检查、hook、baseline）。
  // 纯预览证据不参与任何门禁，避免在大型未追踪目录上做无意义的全量摘要。
  // 捕获失败（例如 tracked symlink 输入）fail closed：记录为整体失败但仍写
  // 证据文件，让门禁 reason 可审计，而不是让整个 check 无证据崩溃。
  let worktree=null,worktreeError=null;
  const captureExclusions=opts.taskPreflight?taskExclusions(opts.taskPreflight.task):[];
  // 生成物边界来自受信项目策略；同一 Run 的 before/after 必须使用同一闭包。
  const captureOptions={snapshot_exclusions:Array.isArray(st.policy?.snapshot_exclusions)?st.policy.snapshot_exclusions:[]};
  if(opts.task||opts.hook||opts.all||opts.base){
    try{worktree=captureWorktree(h,root,opts.timeout,captureExclusions,captureOptions);}
    catch(e){worktreeError=String(e&&e.message||e);}
  }
  let contracts=[];
  if(opts.base){
    const baseCommit=command(h,['git','rev-parse','--verify',opts.base+'^{commit}'],root,opts.timeout).trim();
    const names=command(h,['git','ls-tree','-r','--name-only',baseCommit,'--','.dairn/governance/refactors'],root,opts.timeout).split(/\r?\n/).filter(p=>p.endsWith('.json'));
    contracts=names.map(name=>{relative(name);return validateRefactorContract(JSON.parse(command(h,['git','show',baseCommit+':'+name],root,opts.timeout)),name);});
  }else contracts=readRefactorContracts(h,root);
  const planEnvelope=planGovernance({trustedPolicy:st.policy,projectContext:projectContextOf(st.policy),change:{paths:st.paths||[],modules:mods,risk,risk_floor:risk,all:!!opts.all,runtime_sha256:opts.runtimeHash||null,policy_sha256:sha256(raw),authority_source:opts.base?'git-base-unverified':'local-project',subject:worktree?.source_commit?{schema:'dairn.subject.v1',repository:repositoryOf(h,root,opts.timeout),kind:'git-commit',source_commit:worktree.source_commit,tree_sha:worktree.tree_sha,base_commit:opts.all?null:st.base,comparison:'base-to-source'}:null},refactorContracts:contracts});
  let tools;try{tools=toolchainIdentity(h,root,planEnvelope.plan.executors,opts.runtimeHash||null);}catch(_){tools={sha256:null,status:'unknown'};}
  const records=[];
  let failed=!!worktreeError;
  if(worktreeError)h.error('ERROR: worktree snapshot failed: '+worktreeError);
  if (!opts.all && !st.paths.length) {
    if(opts.task)throw Error('Task-linked check requires changed paths and actual selected checks');
    if(stats){stats.checks=0;stats.failed=false;}
    h.log('No diff; static core validated, no stack checks');return 0;}
  invariant(mods.length>0 || st.paths.every(p=>p.startsWith('docs/') || p.endsWith('.md') || p.startsWith('.agents/notes/') || p.startsWith('.dairn/governance/operations/') || p.startsWith('.dairn/governance/changes/') || p.startsWith('.dairn/work/') || p.startsWith('.dairn/facts/') || p.startsWith('.dairn/governance/evidence/') || p.startsWith('.dairn/cache/')), 'No module matched changed source');
  const logsAbs=join(join(evidenceDir,'logs'),logRunKey);
  h.mkdirs(logsAbs);
  const seenLogs=new Set();
  for(const requirement of planEnvelope.plan.requirements){
    const executor=planEnvelope.plan.executors.find(e=>e.requirement_id===requirement.id);
    const m=mods.find(x=>x.name===requirement.module_id)||{name:null,path:'.'};
    const gate=requirement.check_id,cfg=executor?{argv:executor.argv,cwd:executor.cwd,timeout:executor.timeout}:null;
    const record={requirement_id:requirement.id,scope:requirement.scope,module:m.name,gate,status:'missing',returncode:null};
    const logName=(m.name||'repository')+'-'+requirement.id;
    if(!cfg) {
      failed=true;
      Object.assign(record,writeGateLog(h,logsAbs,logsRel,seenLogs,logName,'Check configuration missing for '+m.name+':'+gate+'\n'));
      records.push(record);continue;
    }
    record.argv=cfg.argv;
    let gateOutput='';
    try {
      const cwd=checkCwd(h,root,m,cfg); record.cwd=cwd.slice(root.length).replace(/^\//,'')||'.';
      h.log('[run] '+m.name+':'+gate+' '+cfg.argv.join(' '));
      const executorTimeout=Math.min(cfg.timeout||opts.timeout,opts.timeout);
      const result=executeCheck(h,cfg.argv,cwd,executorTimeout);
      record.returncode=result.code;record.duration_sec=result.duration_sec;record.timed_out=!!result.timedOut;
      record.output_sha256=sha256(result.output||'');record.output_truncated=false;
      record.status=result.timedOut||result.error?'error':result.code===0?'passed':'failed';
      gateOutput=result.output||'';
      if(record.status!=='passed') {record.reason=(result.timedOut?'timeout: ':'failed: ')+(result.output||'').slice(0,1024);if(!gateOutput)gateOutput=record.reason;}
    }catch(e){
      record.status='error';record.reason=e.message;record.output_sha256=sha256(e.message||'');record.output_truncated=/output exceeded/.test(e.message||'');
      gateOutput=e&&e.message?e.message:String(e);
    }
    Object.assign(record,writeGateLog(h,logsAbs,logsRel,seenLogs,logName,gateOutput));
    if(record.status!=='passed') failed=true;
    records.push(record);
  }
  /* The v1 protocol run is the ONLY machine-written evidence artifact (the
   * legacy JSON report dual-write is gone, PR-03). Non-Git baselines have no
   * commit identity and therefore no attestable subject — they get an
   * execution audit record that is explicitly NOT dairn.check-run.v1 (it can
   * never be attested, bundled or gated); audit logs still land under
   * evidence/logs/ with content digests bound in each check record. */
  const toProtocolChecks = rs => rs.map(c=>({id:c.gate,module:c.module,status:c.timed_out?'timeout':c.status,
    requirement_id:c.requirement_id,scope:c.scope,exit_code:c.returncode,argv:c.argv??null,cwd:c.cwd??null,duration_sec:c.duration_sec??null,
    timed_out:!!c.timed_out,reason:c.reason??null,log:c.log??null,log_sha256:c.output_sha256??null,
    log_truncated:c.output_truncated??null}));
  const headProbe=h.run(['git','rev-parse','HEAD^{tree}'],root,opts.timeout);
  let v1Ref=null,v1Run=null;
  if(!headProbe.timedOut&&headProbe.code===0&&/^([0-9a-f]{40,64})\s*$/i.test(headProbe.output||'')){
    const treeSha=headProbe.output.trim();
    const headCommit=command(h,['git','rev-parse','--verify','HEAD^{commit}'],root,opts.timeout).trim();
    // Evidence must describe the commit the caller scoped: a HEAD that moved
    // mid-check can never be attested (fail closed instead of writing a lie).
    if(!opts.all && headCommit!==st.head) throw Error('Git HEAD changed during check; evidence cannot be written');
    let snapAfter=null,snapAfterFailed=false;
    if(worktree&&!worktreeError){
      try{snapAfter=captureWorktree(h,root,opts.timeout,captureExclusions,captureOptions);}
      catch(e){snapAfterFailed=true;}
    }
    if(opts.task){
      const started=opts.taskPreflight;
      invariant(headCommit===started.head&&headCommit===st.head,'Git HEAD changed during check; evidence cannot be attached');
    }
    // Input coverage is honesty, not a formality: ignored inputs the caller
    // never declared leave the evidence unable to prove what it ran over
    // (T41); such a run is invalidated rather than silently passed.
    const coverageIncomplete=!!worktree&&!worktreeError&&worktree.input_coverage==='incomplete';
    // The engine cannot prove its own runner trustworthiness: environment is a
    // declared observation only and assurance stays local-observed (T40);
    // ci-level trust is established by the signed chain, never self-reported.
    const environment=(h.env('GITHUB_ACTIONS')==='true'||h.env('GITLAB_CI')==='true')?'ci-declared':'local';
    const created=createCheckRun({subject:{schema:'dairn.subject.v1',repository:repositoryOf(h,root,opts.timeout),kind:'git-commit',
        source_commit:headCommit,tree_sha:treeSha,
        base_commit:opts.all?null:st.base,comparison:'base-to-source'},
      execution:{environment,runtime_sha256:opts.runtimeHash??null,policy_sha256:sha256(raw),
        toolchain_sha256:tools.sha256,toolchain_observation:tools,check_plan_sha256:planEnvelope.plan_sha256,requirements:planEnvelope.plan.requirements,executors:planEnvelope.plan.executors,logs_dir:logsRel,
        mode:opts.all?'baseline-all':opts.hook?'pre-push-gate':'risk-gate-preview',
        risk,governance_validators:Object.keys(validation.detail).sort(),
        changed_paths:opts.all?[]:[...st.paths],
        snapshot_before_sha256:worktree?worktree.snapshot_sha256:null,
        snapshot_after_sha256:snapAfter?snapAfter.snapshot_sha256:null,
        input_coverage:worktree?worktree.input_coverage:null},
      required_checks:[...required],
      checks:toProtocolChecks(records),
      status:(snapAfterFailed||(snapAfter&&worktree&&snapAfter.snapshot_sha256!==worktree.snapshot_sha256)||coverageIncomplete)?'invalidated':(failed?'failed':'passed'),
      declared_assurance:'local-observed',related_tasks:opts.task?[opts.task]:[],now:h.now()});
    failed=failed||created.status!=='passed';
    v1Run=created;v1Ref=writeRunEvidence(h,root,v1Run);
    if(typeof h.observationContext==='function')h.observationContext({run_id:created.run_id,subject_commit:created.subject.source_commit,worktree_snapshot_sha256:created.execution.snapshot_before_sha256,policy_sha256:created.execution.policy_sha256,plan_sha256:created.execution.check_plan_sha256,toolchain_sha256:created.execution.toolchain_sha256});
    if(coverageIncomplete)h.error('ERROR: snapshot input coverage incomplete ('+worktree.uncovered_inputs.length+' uncovered ignored inputs); run evidence invalidated');
  } else {
    h.mkdirs(evidenceDir);
    const audit={schema:'dairn.execution-record.v1',
      mode:opts.all?'baseline-all':opts.hook?'pre-push-gate':'risk-gate-preview',
      risk,required_checks:[...required],checks:toProtocolChecks(records),
      status:failed?'failed':'passed',logs_dir:logsRel,created_at:h.now()};
    h.write(join(evidenceDir,'execution-'+logRunKey+'.json'),JSON.stringify(audit,null,2)+'\n');
    h.log('v1 run evidence skipped: no Git commit identity for an attestable subject; execution audit recorded');
  }
  if(stats){stats.checks=records.length;stats.failed=failed;}
  if(opts.task){invariant(v1Ref&&v1Run,'Task-linked check requires v1 run evidence');const linked=linkCheckRun(h,root,opts.task,v1Ref.path,v1Run);h.log('Linked task run: '+linked.run_id+' ['+linked.status+']');}
  h.log('Evidence: '+(v1Ref?v1Ref.path:'none')+'\nResult: '+(failed?'FAILED':'PASSED')+' [technical-checks-only; NOT full governance approval]');
  return failed?1:0;
}
function firstLine(value) { return String(value||'').trim().split(/\r?\n/)[0].trim(); }
function prePushBase(h,root,opts) {
  const override=opts.base||h.env('DAIRN_TRUSTED_BASE_REF');
  if (typeof override==='string' && override.trim()) return override.trim();
  const merge=h.run(['git','merge-base','HEAD','origin/main'],root,opts.timeout);
  if(!merge.timedOut && merge.code===0 && firstLine(merge.output)) return firstLine(merge.output);
  const parent=h.run(['git','rev-parse','HEAD^'],root,opts.timeout);
  if(!parent.timedOut && parent.code===0 && firstLine(parent.output)) return firstLine(parent.output);
  throw new Error('pre-push requires --base or origin/main or a parent commit');
}
function prePush(h,root,st,opts) {
  const base=prePushBase(h,root,opts);
  const validation=governanceValidators(h,root,base);
  if(validation.errors.length){for(const error of validation.errors)h.error('ERROR: '+error);return 1;}
  const stats={checks:0,failed:false};
  if(!opts.no_check){
    const scope={...readScope(h,root,st.policy,{...opts,cmd:'check',base,all:false,task:null}),policy:st.policy};
    const code=checks(h,root,{...opts,cmd:'check',base,all:false,task:null,hook:true},scope,st.policy_raw,validation,stats);
    if(code) return code;
  }
  let problems=[];
  try {problems=activeTaskProblems(h,root)||[];}
  catch(e){problems=[e&&e.message?e.message:String(e)];}
  if(problems.length){for(const problem of problems)h.error('ERROR: '+problem);return 1;}
  let active=[];
  try {active=activeTaskIds(h,root)||[];}catch(_){active=[];}
  h.log('pre-push PASS: '+stats.checks+' checks, '+active.length+' active tasks');
  return 0;
}
export function main(h,args) {
  try {
    const opts=parseArgs(args);
    if(opts.cmd==='help') {h.log('Dairn '+runtimeVersion(h)+' — AI-Native Software Engineering Toolkit\n  dairn init|adopt [--root PATH] [--stack go|python|rust|vue|java|spring-boot|openresty] [--ci none|github|gitlab|both] [--sample] [--plan]\n  dairn detect|doctor|validate [--root PATH]\n  dairn scope|check --base SHA [--root PATH]\n  dairn check --all (baseline L2 checks)\n  dairn handoff [--json] [--base origin/main] [--task ID] [--note TEXT] [--max-chars 12000] [--out .dairn/tmp/handoff.md]   (read-only agent handoff; no .dairn required)\n  dairn observe status|report|trace|compare|suggest [--json]   (本地观测，不授予 Gate 权限)\n  dairn runtime inspect|promote --source installed --plan [--json]\n  dairn runtime promote --source installed --apply --plan-sha256 <hash>\n  dairn runtime rollback --to <identity> --plan\n  dairn governance execute --base <ref> [--assurance] [--requirements app.unit] [--context <local.json>] [--plan-sha256 <hash>]   (离线执行与机器保障，审批委托 SCM)\n  dairn governance plan|explain --base <ref> [--json]   (deterministic minimum-sufficient assurance plan; advisory, never a gate verdict)\n  dairn governance assess [--json]   (capability discovery: declared vs detected; never self-certifies CI)\n  dairn governance recommend [--window 90d] [--json]   (evidence-backed tuning suggestions; never auto-applied)\n  dairn refactor plan|compare|verify|status --id <id>   (optional cross-PR refactor contracts and debt baselines)\n  dairn evidence verify --bundle <path>|--run <run-id> [--json]   (independent evidence verification)\n  dairn evidence inspect --run <run-id> [--json]\n  dairn gate evaluate --base <ref> --check <run.json> [--context <c.json>] | --runs <manifest.json> --jobs <expected.json> --needs <needs.json> [--attestation <st.json> --signature <sig> --key <pub>] [--modules m1,m2] [--risk L0|L1|L2] [--stage pre-merge|post-merge|release] [--json]\n  dairn attest prepare --bundle <path> --context <c.json> [--out <statement.json>]\n  dairn attest verify --statement <s.json> --signature <s.sig> --key <absolute-trusted-pubkey> [--context <c.json>]\n  dairn hook pre-push|turn-end [--task ID] [--no-check] [--provider P --session S] [--allow-unattributed]\n  dairn hooks install [--apply] [--git] [--force] [--launcher PATH]\n  dairn tasks check|ready [--strict]\n  dairn notes seal [--apply]\n  dairn docs check [--json]\n  dairn upgrade --plan|--apply [--root PATH]\n  dairn work start|list|status|next|record|advance|skip|verify|finish|cancel|reopen [--require-machine-gates|--require-session-anchor|--require-review-actor]\n  dairn work revise <task-id> --stage <stage>|--kind <kind> --reason <reason>   (归档旧证据并重新执行后续阶段)\n  dairn work link-check <task-id> --run <run-id> (advisory reference to an existing run)\n  dairn guide impact --base SHA [--analyzer PROJECT-ANALYZER-ID]\n  dairn analyzers [list|templates|doctor|init --template LANGUAGE --id NAME [--apply]] [--root PATH]   (legacy "stubs" command is rejected: breaking rename, no alias)\n  dairn analyze run <analyzer-id> | --suite <suite-id> [--base <ref>] [--refresh] [--json] [--out PATH]   (advisory analysis runs; never a gate verdict)\n  dairn analyze import <analyzer-id> [--artifact PATH] [--json] [--out PATH]   (read-only report import; unverified-import, never ci-verified)\n  dairn quality fitness [--json]   (compare quality goals with local observations; PASS never approves)\n  dairn capability plan [--base <ref>] [--json]   (advisory agent/skill participation; never starts models)\n  dairn skills catalog|list|add NAME [--apply]\n  dairn docs find QUERY|show|context SPEC-ID|check [--json]');return 0;}
    const root=h.realpath(opts.root??h.cwd());
    const runtimeLock=verifyRuntimeLock(h,root,false);opts.runtimeHash=runtimeLock?.runtime_sha256||null;
    const st=staticChecks(h,root);
    if(opts.base&&opts.cmd==='check'&&!opts.all){
      const baseCommit=command(h,['git','rev-parse','--verify',opts.base+'^{commit}'],root,opts.timeout).trim();
      const trustedRaw=command(h,['git','show',baseCommit+':.dairn/governance/project.json'],root,opts.timeout);
      const trusted=JSON.parse(trustedRaw);invariant(policyValidate(trusted).length===0,'Base policy invalid');
      st.policy=trusted;st.policy_raw=trustedRaw;
    }
    const actualPolicyHash=sha256(st.policy_raw);
    const expected=h.env('DAIRN_EXPECTED_POLICY_SHA256');
    if (expected) invariant(/^[0-9a-f]{64}$/.test(expected) && expected===actualPolicyHash,'Policy hash differs from externally trusted policy');
    if (opts.cmd==='check' && (h.env('GITHUB_ACTIONS')==='true'||h.env('GITLAB_CI')==='true'))
      invariant(!!expected,'CI check requires protected DAIRN_EXPECTED_POLICY_SHA256');
    if(st.errors.length) {for(const s of st.errors)h.error('ERROR: '+s);return 1;}
    if(opts.cmd==='hook') {
      // Hook 也要求已初始化项目：runtime lock 必须存在且与当前运行时一致。
      verifyRuntimeLock(h,root,true);
      if(opts.hook==='turn-end') return runTurnEnd(h,root,opts);
      return prePush(h,root,st,opts);
    }
    if(opts.cmd==='doctor') return projectDoctor(h,root);
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
    if(opts.task){ opts.taskPreflight=checkTaskPresence(h,root,opts.task); opts.runtimeHash=verifyRuntimeLock(h,root,true).runtime_sha256;}
    const scope=opts.all ? {policy:st.policy} : {...readScope(h,root,st.policy,opts),policy:st.policy};
    if(opts.cmd==='scope') {
      h.log(JSON.stringify({paths:scope.paths,modules:scope.modules.map(m=>m.name),risk:scope.risk,governance_mode:scope.governance_mode,
        classification_reasons:scope.triggers,record_source:scope.record_source,review_pending:scope.review_pending,
        required_checks:scope.required},null,2));return 0;
    }
    return checks(h,root,opts,scope,st.policy_raw,preflight);
  } catch(e) {
    // GATE 命令的 Runtime Lock 漂移：稳定单行错误码 + exit 4，不打 JS 堆栈；
    // 其余错误保持原有语义（含堆栈、exit 2）。
    if(e&&e.exitCode===4){h.error(String(e.message||e));return 4;}
    h.error('ERROR: '+String(e)+(e?.stack?'\n'+e.stack:''));return 2;
  }
}
