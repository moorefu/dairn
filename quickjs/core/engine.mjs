/* 基于 QuickJS 的治理编排。 */
import { classify, moduleSelection, manifestValidate, policyValidate, invariant, relative, requiresManifest } from './policy.mjs';
import {sha256} from './sha256.mjs';
import {validateAll,archiveValidate} from './validators.mjs';
import {docsValidate} from './docs-validator.mjs';
import {lifecycleValidate} from './lifecycle-validator.mjs';
import {verifyRuntimeLock,runtimeVersion,doctor as projectDoctor} from './project.mjs';
import {prepareCheckTask,attachCheckRun,activeTaskIds,activeTaskProblems} from './work.mjs';
import {runTurnEnd} from './hooks.mjs';
import {prChangeMeta,isCiPullRequest} from './ci-context.mjs';
import {captureFacts} from './facts.mjs';
import {readRelations} from './relations.mjs';
import {configuredStubs} from './stubs.mjs';
import {captureWorktree,taskExclusions} from './worktree.mjs';
const slash = x => x.replace(/\\/g, '/');
const join = (a,b) => b === '.' ? a : a.replace(/\/$/,'') + '/' + b;
const within = (root, path) => path === root || path.startsWith(root.replace(/\/$/,'') + '/');
// Git 输出的相对路径不能含盘符/反斜杠/..；host 会把反斜杠归一化为分隔符。
const safeRelative = p => typeof p === 'string' && p.length > 0 && !p.startsWith('/') &&
  !p.includes('\\') && !/^[A-Za-z]:/.test(p) && !p.split('/').some(x => x === '..' || x === '' || x === '.');
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
function runStackCheck(h,stack,step,cwd,timeout) {
  if(stack==='go' && step==='lint') {
    const repo=h.run(['git','rev-parse','--is-inside-work-tree'],cwd,timeout);
    // `git rev-parse --is-inside-work-tree` 在仓库外也会以 0 退出并打印 false，
    // 必须看输出；只有 Git 明确回答“不是仓库”时才允许文件系统回退。权限、
    // dubious ownership、超时等其它错误必须 fail closed，不能静默退化为扫描。
    invariant(!repo.timedOut,'Go lint Git worktree probe timed out');
    const probe=String(repo.output||'').trim();
    const inRepo=repo.code===0 && /^true$/i.test(probe);
    const notRepo=repo.code!==0 && /not a git repository/i.test(String(repo.output||''));
    invariant(inRepo||notRepo,'Cannot determine Git worktree for Go lint: '+(probe||'git exit '+repo.code));
    let goFiles=[];
    if(inRepo) {
      // Git 工程必须尊重 .gitignore；空列表不能退化成文件系统扫描，否则
      // 会把被忽略的文件或工程外链接目标带入门禁。
      goFiles=command(h,['git','ls-files','-z','--cached','--others','--exclude-standard','--','*.go'],cwd,timeout).split('\0').filter(Boolean);
      invariant(goFiles.length>0,'No Go files available in Git for gofmt');
      invariant(goFiles.length<=20000,'Go lint file list exceeds limit');
      for(const file of goFiles) {
        invariant(safeRelative(file),'Unsafe Go file path from Git: '+JSON.stringify(file));
        invariant(!h.isSymlink(join(cwd,file)),'Go lint refuses symlink path: '+file);
      }
    } else {
      const repoRoot=h.realpath(cwd);
      const maxDepth=8,maxFiles=20000,maxDirs=5000,deadline=Date.now()+timeout*1000;
      let dirs=0;
      const walk=(d,prefix,depth)=>{
        invariant(Date.now()<=deadline,'Go lint file discovery timed out');
        invariant(depth<=maxDepth,'Go lint directory depth exceeded '+maxDepth);
        invariant(!h.isSymlink(d),'Go lint refuses symlink directory: '+prefix);
        const canonical=h.realpath(d);
        invariant(within(repoRoot,canonical),'Go lint path escapes repository: '+prefix);
        invariant(++dirs<=maxDirs,'Go lint directory limit exceeded');
        for(const name of h.list(d)){
          if(name.startsWith('.')||['vendor','node_modules','target','dist'].includes(name))continue;
          const abs=join(d,name),rel=prefix+name;
          invariant(!h.isSymlink(abs),'Go lint refuses symlink path: '+rel);
          const resolved=h.realpath(abs);
          invariant(within(repoRoot,resolved),'Go lint path escapes repository: '+rel);
          if(h.isDirectory(abs)) walk(abs,rel+'/',depth+1);
          else if(name.endsWith('.go')) { invariant(goFiles.length<maxFiles,'Go lint file limit exceeded'); goFiles.push(rel); }
        }
      };
      walk(cwd,'',0);
    }
    invariant(goFiles.length>0,'No Go files available for gofmt');
    // 拆分批次，避免参数列表超过平台命令行长度上限；`--` 防止文件名被当作
    // gofmt 选项（例如被跟踪的 `-e.go`）。
    const invalid=[];
    for(let i=0;i<goFiles.length;i+=500){
      const output=command(h,['gofmt','-l','--',...goFiles.slice(i,i+500)],cwd,timeout).trim();
      if(output)invalid.push(output);
    }
    invariant(!invalid.length,'gofmt found unformatted files: '+invalid.join('\n'));
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
function checks(h,root,opts,st,raw,validation,stats) {
  const risk=opts.all ? 'L2' : st.risk;
  const mods=opts.all ? st.policy.modules : st.modules;
  const required=st.policy.required_checks[risk];
  const evidenceDir=join(root,'.dairn/governance/evidence');
  const logRunKey=gateLogKey(opts);
  const logsRel='.dairn/governance/evidence/logs/'+logRunKey;
  // 工作树身份只在会成为门禁证据的运行里捕获（任务检查、hook、baseline）。
  // 纯预览证据不参与任何门禁，避免在大型未追踪目录上做无意义的全量摘要。
  const worktree=(opts.task||opts.hook||opts.all)?captureWorktree(h,root,opts.timeout,opts.taskPreflight?taskExclusions(opts.taskPreflight.task):[]):null;
  const report={schema_version:opts.task?2:1,engine:'dairn-quickjs',assurance:'technical-checks-only',mode:opts.all?'baseline-all':opts.hook?'pre-push-gate':'risk-gate-preview',
    risk,governance_mode:opts.all?'G2':st.governance_mode,review_pending:opts.all?true:st.review_pending,
    base:opts.all?null:st.base,head:opts.all?null:st.head,utc:h.now(),changed_paths:opts.all?[]:st.paths,
    policy_sha256:sha256(raw),...(worktree?{worktree}:{}),governance_validation:{status:'passed',validators:Object.keys(validation.detail).sort(),error_count:0},checks:[],logs_dir:logsRel};
  if(opts.hook) report.trust='local-unattested';
  let failed=false;
  if (!opts.all && !st.paths.length) {
    if(opts.task)throw Error('Task-linked check requires changed paths and actual selected checks');
    if(stats){stats.checks=0;stats.failed=false;}
    h.log('No diff; static core validated, no stack checks');return 0;}
  invariant(mods.length>0 || st.paths.every(p=>p.startsWith('docs/') || p.endsWith('.md') || p.startsWith('.agents/notes/') || p.startsWith('.dairn/governance/operations/') || p.startsWith('.dairn/governance/changes/') || p.startsWith('.dairn/work/') || p.startsWith('.dairn/facts/') || p.startsWith('.dairn/governance/evidence/') || p.startsWith('.dairn/cache/')), 'No module matched changed source');
  const logsAbs=join(join(evidenceDir,'logs'),logRunKey);
  h.mkdirs(logsAbs);
  const seenLogs=new Set();
  for(const m of mods) for(const gate of required) {
    const cfg=m.checks[gate];const record={module:m.name,gate,status:'missing',returncode:null};
    const logName=m.name+'-'+gate;
    if(!cfg) {
      failed=true;
      Object.assign(record,writeGateLog(h,logsAbs,logsRel,seenLogs,logName,'Check configuration missing for '+m.name+':'+gate+'\n'));
      report.checks.push(record);continue;
    }
    record.argv=cfg.argv;
    let gateOutput='';
    try {
      const cwd=checkCwd(h,root,m,cfg); record.cwd=cwd.slice(root.length).replace(/^\//,'')||'.';
      h.log('[run] '+m.name+':'+gate+' '+cfg.argv.join(' '));
      let result;
      if(cfg.argv[0]==='dairn' && cfg.argv[1]==='stack-check') result=runStackCheck(h,cfg.argv[2],cfg.argv[3],cwd,opts.timeout);
      else result=h.run(cfg.argv,cwd,opts.timeout);
      record.returncode=result.code;record.duration_sec=result.duration_sec;record.timed_out=!!result.timedOut;
      record.output_sha256=sha256(result.output||'');record.output_truncated=false;
      record.status=result.timedOut?'error':result.code===0?'passed':'failed';
      gateOutput=result.output||'';
      if(record.status!=='passed') {record.reason=(result.timedOut?'timeout: ':'failed: ')+(result.output||'').slice(0,1024);if(!gateOutput)gateOutput=record.reason;}
    }catch(e){
      record.status='error';record.reason=e.message;record.output_sha256=sha256(e.message||'');record.output_truncated=/output exceeded/.test(e.message||'');
      gateOutput=e&&e.message?e.message:String(e);
    }
    Object.assign(record,writeGateLog(h,logsAbs,logsRel,seenLogs,logName,gateOutput));
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
  const dir=evidenceDir;h.mkdirs(dir);
  const name=opts.task?report.run_id+'-checks.json':opts.hook?'pre-push-'+Date.now()+'-checks.json':(opts.all?'all':st.head.slice(0,12))+'-qjs-checks.json';
  const file=join(dir,name);
  if(h.exists(file))throw Error('Refuse to overwrite existing run evidence: '+file);
  h.write(file,JSON.stringify(report,null,2)+'\n');
  if(stats){stats.checks=report.checks.length;stats.failed=failed;}
  if(opts.task){const linked=attachCheckRun(h,root,opts.task,report,'.dairn/governance/evidence/'+name);h.log('Attached task run: '+linked.run_id+' ['+linked.status+']');}
  h.log('Evidence: '+file+'\nResult: '+(failed?'FAILED':'PASSED')+' [technical-checks-only; NOT full governance approval]');
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
    if(opts.cmd==='help') {h.log('Dairn '+runtimeVersion(h)+' — AI-Native Software Engineering Toolkit\n  dairn init|adopt [--root PATH] [--stack go|python|rust|vue|java|spring-boot|openresty] [--ci none|github|gitlab|both] [--sample] [--plan]\n  dairn detect|doctor|validate [--root PATH]\n  dairn scope|check --base SHA [--root PATH]\n  dairn check --all (baseline L2 checks)\n  dairn hook pre-push|turn-end [--task ID] [--no-check] [--provider P --session S] [--allow-unattributed]\n  dairn hooks install [--apply] [--git] [--force] [--launcher PATH]\n  dairn tasks check|ready [--strict]\n  dairn notes seal [--apply]\n  dairn docs check [--json]\n  dairn upgrade --plan|--apply [--root PATH]\n  dairn work start|list|status|next|record|advance|skip|verify|finish|cancel|reopen [--require-machine-gates|--require-session-anchor|--require-ci-attestation|--require-review-actor]\n  dairn work attest-prepare|attest-attach TASK [PAYLOAD SIG]\n  dairn guide impact --base SHA [--precision PROJECT-STUB-ID]\n  dairn stubs [list|templates|doctor|init --template LANGUAGE --id NAME [--apply]] [--root PATH]\n  dairn skills catalog|list|add NAME [--apply]\n  dairn docs find QUERY|show|context SPEC-ID|check [--json]');return 0;}
    const root=h.realpath(opts.root??h.cwd());
    verifyRuntimeLock(h,root,false);
    const st=staticChecks(h,root);
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
