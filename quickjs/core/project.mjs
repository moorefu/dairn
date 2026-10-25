import {recommendWorkflow,workflowStageList} from './workflow.mjs';
import {runWork,locateRunEvidence} from './work.mjs';
import {installHooks} from './hooks.mjs';
import {lintAssets} from './assets-lint.mjs';
import {tasksReport,tasksReady} from './tasks.mjs';
import {sealArchive} from './notes.mjs';
import {verifyBundle,verifyRunBytes} from './evidence.mjs';
import {evaluate as gateEvaluate} from './gate.mjs';
import {prepareAttestation,verifyAttestation} from './attestation.mjs';
import {platformVerdict as approvalPlatformVerdict} from './approval.mjs';
import {captureHandoff} from './handoff.mjs';
import {renderHandoff} from './handoff-render.mjs';
import {planForChange} from './governance-plan.mjs';
import {assessCapabilities, discoverRepository} from './capabilities.mjs';
import {locateContract, locateRun, compareDebt, verifyExitConditions, writeContract} from './refactor.mjs';
import {validateRefactorContract} from './project-context.mjs';
import {collectRunHistory, recommendAdaptations} from './governance-feedback.mjs';
import {LAUNCHER_POSIX,LAUNCHER_WINDOWS,LAUNCHER_CONFIG,RUNTIME_DIR,LEGACY_LAUNCHER_POSIX,LEGACY_LAUNCHER_WINDOWS,defaultLauncherConfig,readLauncherConfig,launcherInfo,payloadLauncherConfig,inspectRuntimePayload,vendorRuntime,verifyLauncher,runtimeSource,runtimeFreshness} from './launcher.mjs';
import {templateReader,navigation,ciTemplate,projectReadme,projectGuide,governanceSpec,claudeMd,rootGitattributes,dairnGitattributes,launcherScripts} from './scaffold.mjs';
import {configuredAnalyzers,analyzerInit,analyzerDoctor,analyzerTemplates,resolveAnalysisSuite} from './analyzers.mjs';
import {executeAnalyzer,importAnalysisReport} from './analyzer-runner.mjs';
import {loadQualityGoals} from './quality-goals.mjs';
import {evaluateFitness} from './quality-fitness.mjs';
import {discoverCapabilities,buildParticipationPlan} from './capability-registry.mjs';
import {configuredAnalyzers as _cfgAnalyzers} from './analyzers.mjs';
import {captureFacts,acceptFacts,factSnapshotPath} from './facts.mjs';
import {buildAnalyzerPlan,renderPlan} from './analyzer-plan.mjs';
import {buildContextPack,renderContextPack,MAX_LIMIT} from './context.mjs';
/* Dairn QuickJS 项目生命周期与分发层；写入前规划全部项目变更。 */
/* 旧版本生成的受管 Makefile；本版本不再生成，upgrade 时随旧启动器一起退役。 */
const LEGACY_MAKEFILE='.dairn/Makefile';
import {sha256} from './sha256.mjs';
import {guidance} from './guidance.mjs';
import {minimumChecks, policyValidate, invariant, relative} from './policy.mjs';
const ASSETS='/zip/quickjs/assets/';
const BEGIN='<!-- Dairn:BEGIN managed navigation -->';
const END='<!-- Dairn:END managed navigation -->';
const SKILLS=['dairn-agent-workflow','dairn-workflow-router','dairn-governance','dairn-spec-discovery','dairn-code-review','dairn-bugfix','dairn-project-guidance','dairn-grill','dairn-change-plan','dairn-tracer-tasks','dairn-tdd','dairn-retro'];
const STACKS=['go','rust','python','java','spring-boot','vue','openresty'];
const NOTE_KINDS=['feature','bug-fix','simplification','architecture','process','testing','security'];
const EXCLUDE=new Set(['.git','.dairn','.agents','node_modules','.venv','venv','vendor','target','dist','build','__pycache__','docs','tests']);
const j=(a,b)=>b==='.'?a:a.replace(/\/$/,'')+'/'+b;
const fmt=obj=>JSON.stringify(obj,null,2)+'\n';
const txt=s=>String(s??'');
const isobj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const file=(h,p)=>h.exists(p)&&!h.isDirectory(p);
const read=(h,p)=>h.read(p);
const checkedRoot=(h,path,create)=>{
  if(!h.exists(path)) {if(!create)throw Error('Project directory does not exist: '+path); h.mkdirs(path);}
  invariant(h.isDirectory(path),'Not a directory: '+path);
  return h.realpath(path);
};
const assetIndex=h=>JSON.parse(read(h,ASSETS+'manifest.json'));
export const runtimeVersion=h=>assetIndex(h).version;
export function runtimeIdentity(h){
  const raw=read(h,ASSETS+'manifest.json');
  const m=JSON.parse(raw);
  for(const x of m.engine_sources||[]) invariant(sha256(read(h,'/zip/'+x.path))===x.sha256,'Embedded engine code checksum mismatch: '+x.path);
  for(const x of m.assets||[]) invariant(sha256(read(h,ASSETS+x.type+'/'+x.path))===x.sha256,'Embedded asset checksum mismatch: '+x.path);
  return sha256(raw);
}
const VALUE_OPTIONS=['--root','--path','--name','--stack','--module','--modules','--ci','--base','--timeout','--id','--kind','--analyzer','--suite','--artifact','--template','--session','--provider','--payload','--event','--reason','--launcher','--vendor-runtime','--actor','--run','--evidence','--bundle','--subject','--policy','--context','--check','--approval','--attestation','--statement','--signature','--key','--out','--stage','--risk','--snapshot','--origin','--task','--note','--max-chars','--window','--file','--capability','--for','--limit','--section','--lines'];
const FLAG_OPTIONS={'--plan':'plan','--dry-run':'plan','--discover':'discover','--apply':'apply','--diff':'diff','--sample':'sample','--all':'all','--json':'json','--strict':'strict','--refresh':'refresh','--change':'change','--require-machine-gates':'require_machine_gates','--require-session-anchor':'require_session_anchor','--require-review-actor':'require_review_actor','--stdin':'stdin','--no-check':'no_check','--force':'force','--git':'git','--allow-unattributed':'allow_unattributed'};
// Suite 与 Fitness 共用模式分派，导入错误保留来源并提供 UNKNOWN 所需的缺失观测。
function runAnalysisTarget(h,root,def,base){
  if((def.mode||'execute')!=='import')return executeAnalyzer(h,root,def.id,{base});
  try{return importAnalysisReport(h,root,def.id);}
  catch(e){return {schema:'dairn.analysis-run.v1',
    run_id:'analysis-import-'+h.now()+'-'+Math.random().toString(16).slice(2,8),
    analyzer_id:def.id,domain:def.domain,status:'report-error',
    source:'local-import',assurance:'unverified-import',error:String(e&&e.message||e).slice(0,300),
    note:'unverified import is never ci-verified and never a gate verdict'};}
}
function argsParse(args){
  const out={cmd:args[0]||'help',pos:[],root:'.',stack:'auto',ci:'none',timeout:120};
  for(let i=1;i<args.length;i++){
    const a=args[i];
    if(VALUE_OPTIONS.includes(a)){
      invariant(i+1<args.length,'Missing value for '+a);out[a==='--path'?'root':a.slice(2).replace(/-/g,'_')]=args[++i];
    } else if(Object.prototype.hasOwnProperty.call(FLAG_OPTIONS,a)) out[FLAG_OPTIONS[a]]=true;
    else if(a.startsWith('-')) throw Error('Unknown option: '+a);else out.pos.push(a);
  }
  return out;
}
function stackFor(h,dir){
  if(file(h,j(dir,'go.mod')))return 'go';
  if(file(h,j(dir,'Cargo.toml')))return 'rust';
  if(file(h,j(dir,'package.json'))){try {const pkg=JSON.parse(read(h,j(dir,'package.json')));if('vue' in {...pkg.dependencies,...pkg.devDependencies})return 'vue';}catch(_){}}
  for(const f of ['pom.xml','build.gradle','build.gradle.kts'])if(file(h,j(dir,f))){const t=read(h,j(dir,f)).toLowerCase();return /spring-boot|org\.springframework\.boot/.test(t)?'spring-boot':'java';}
  for(const f of ['pyproject.toml','setup.py','requirements.txt'])if(file(h,j(dir,f)))return 'python';
  if(file(h,j(dir,'nginx.conf'))||file(h,j(dir,'conf/nginx.conf')))return 'openresty';
  return null;
}
export function detect(h,root){
  const found=[];
  function walk(dir,rel,depth){
    const stack=stackFor(h,dir);if(stack)found.push({path:rel,stack});
    if(depth>=2)return;
    for(const n of h.list(dir).sort())if(!EXCLUDE.has(n)&&!n.startsWith('.')&&h.isDirectory(j(dir,n))&&!h.isSymlink(j(dir,n)))
      walk(j(dir,n),rel==='.'?n:rel+'/'+n,depth+1);
  }
  walk(root,'.',0);
  return found;
}
function commands(h,stack,dir){
  const step=argv=>({argv,cwd:dir});
  if(stack==='go')return {lint:step(['dairn','stack-check','go','lint']),unit:step(['go','test','./...']),integration:step(['go','test','./...']),build:step(['go','build','./...'])};
  if(stack==='rust')return {lint:step(['dairn','stack-check','rust','lint']),unit:step(['cargo','test','--lib','--bins']),integration:step(['cargo','test','--tests']),build:step(['cargo','build','--locked'])};
  if(stack==='python')return {lint:step(['dairn','stack-check','python','lint']),unit:step(['python','-m','pytest','-m','not integration']),integration:step(['python','-m','pytest','-m','integration']),build:step(['python','-m','build','--no-isolation'])};
  if(stack==='vue'){
    let p={};try{p=JSON.parse(read(h,j(j(dir,'.'),'package.json')));}catch(_){}
    const mgr=file(h,j(dir,'pnpm-lock.yaml'))?'pnpm':file(h,j(dir,'yarn.lock'))?'yarn':'npm';
    const mapping={lint:['lint','typecheck'],unit:['test:unit','test'],integration:['test:e2e','test:integration'],build:['build']};
    return Object.fromEntries(Object.entries(mapping).map(([k,v])=>[k,step([mgr,'run',v.find(x=>Object.hasOwn(p.scripts||{},x))||'dairn-missing-'+k]) ]));
  }
  if(stack==='java'||stack==='spring-boot'){
    const gradle=file(h,j(dir,'build.gradle'))||file(h,j(dir,'build.gradle.kts'));
    const bin=gradle?(file(h,j(dir,'gradlew'))?'./gradlew':'gradle'):(file(h,j(dir,'mvnw'))?'./mvnw':'mvn');
    return gradle?{lint:step([bin,'checkstyleMain']),unit:step([bin,'test']),integration:step([bin,'integrationTest']),build:step([bin,'build'])}:
      {lint:step([bin,'-B','-ntp','checkstyle:check']),unit:step([bin,'-B','-ntp','test']),integration:step([bin,'-B','-ntp','verify']),build:step([bin,'-B','-ntp','-DskipTests','package'])};
  }
  if(stack==='openresty')return {lint:step(['luacheck','.']),unit:step(['busted','spec']),integration:step(['prove','-r','t']),build:step(['openresty','-t','-p','.','-c','conf/nginx.conf'])};
  throw Error('Unsupported stack '+stack);
}
function moduleConfig(h,root,o){
  invariant(STACKS.includes(o.stack)||o.stack==='auto','Unsupported stack '+o.stack);
  let found=o.stack==='auto'?detect(h,root):[{path:o.module||'.',stack:o.stack}];
  if(o.module&&o.stack==='auto')found=found.filter(x=>x.path===o.module);
  invariant(found.length>0,'No language detected; supply --stack go|rust|python|java|spring-boot|vue|openresty');
  const used=new Set();
  return found.map(f=>{
    relative(f.path,true);
    let name=f.path==='.'?'app':f.path.split('/').pop().toLowerCase().replace(/[^a-z0-9-]/g,'-').replace(/^-+|-+$/g,'')||'app';
    if(!/^[a-z]/.test(name))name='app-'+name;let key=name,i=2;while(used.has(key))key=name+'-'+(i++);used.add(key);
    return {name:key,path:f.path,profiles:f.stack==='spring-boot'?['java','spring-boot']:[f.stack],checks:commands(h,f.stack,f.path)};
  });
}
function makeDesired(h,root,config,prior){
  const m=assetIndex(h), entries={};
  const tpl=templateReader(h);
  // 受管规则：一个文件一旦进入 lock.managed，就必须在后续所有版本的 desired 集合里继续存在，
  // 否则计划会把它当成“本版本已移除的受管资产”而 fail closed。项目自有文件（如 root
  // .gitattributes、CLAUDE.md）只在缺失时创建；已受管时继续按受管内容刷新。
  const wasManaged=rel=>!!(prior&&prior.managed&&prior.managed[rel]);
  const skills=new Set([...SKILLS,...config.modules.flatMap(x=>x.profiles.map(s=>'dairn-stack-'+s)),...(config.extra_skills||[])]);
  for(const x of m.assets)if(x.type==='skills'&&skills.has(x.path.split('/')[0]))entries['.agents/skills/'+x.path]=read(h,ASSETS+'skills/'+x.path);
  if(!prior){
    const policy={schema_version:1,project:config.name,modules:config.modules,
      required_checks:{L0:[...minimumChecks.L0],L1:[...minimumChecks.L1],L2:[...minimumChecks.L2]}};
    invariant(policyValidate(policy).length===0,'Generated project policy is invalid');
    entries['.dairn/governance/project.json']=fmt(policy);
    entries['.agents/notes/archived/sha256.json']='{}\n';
    if(!file(h,j(root,'.gitignore')))entries['.gitignore']='# Dairn transient analyzer and runtime cache\n.dairn/cache/\n.dairn/tmp/\n';
    entries['.dairn/analyzers.json']=fmt({schema:'dairn.analyzers.v1',analyzers:[]});
    if(!file(h,j(root,'CLAUDE.md'))||wasManaged('CLAUDE.md'))entries['CLAUDE.md']=claudeMd(tpl);
    if(config.sample){
      invariant(config.modules.length===1&&JSON.stringify(config.modules[0].profiles)==='["go"]','--sample requires a Go-only project');
      const prefix=config.modules[0].path==='.'?'':config.modules[0].path+'/';
      entries[prefix+'go.mod']='module example.com/'+config.name.toLowerCase().replace(/[^a-z0-9-]/g,'-')+'\n\ngo 1.20\n';
      entries[prefix+'hello.go']='package hello\n\nfunc Greeting() string {\n\treturn "hello"\n}\n';
      entries[prefix+'hello_test.go']='package hello\n\nimport "testing"\n\nfunc TestGreeting(t *testing.T) {\n\tif Greeting() != "hello" {\n\t\tt.Fatal("unexpected greeting")\n\t}\n}\n';
    }
  }
  // Project content is generated only on first adoption; it is NEVER added to runtime-managed hashes.
  if(!prior){
    if(!file(h,j(root,'README.md')))entries['README.md']=projectReadme(tpl,config);
    if(!file(h,j(root,'docs/PROJECT_GUIDE.md')))entries['docs/PROJECT_GUIDE.md']=projectGuide(tpl,config);
  }
  // .dairn/cache 与 .dairn/tmp 是临时目录（.gitignore 整目录忽略），
  // 不生成受管 marker：否则 fresh clone 缺少这些文件会让 verifyRuntimeLock 失败。
  entries['docs/GOVERNANCE_SPEC.md']=governanceSpec(tpl);
  // 项目内 launcher 是受管入口；launcher.json 是项目自有配置（见 planFor 排除列表）。
  const launchers=launcherScripts(tpl);
  entries[LAUNCHER_POSIX]=launchers.posix;
  entries[LAUNCHER_WINDOWS]=launchers.windows;
  entries['.dairn/.gitattributes']=dairnGitattributes(tpl);
  // 根 .gitattributes 是项目自有文件：只在缺失时创建，用于保证受管启动器的换行稳定。
  // 一旦在旧版本里被创建并纳入受管集合，就继续按受管内容维护（见 wasManaged）。
  if(!file(h,j(root,'.gitattributes'))||wasManaged('.gitattributes'))entries['.gitattributes']=rootGitattributes(tpl);
  if(!prior||!file(h,j(root,LAUNCHER_CONFIG)))entries[LAUNCHER_CONFIG]=fmt(defaultLauncherConfig(runtimeVersion(h)));
  if(['github','both'].includes(config.ci))entries['.github/workflows/dairn.yml']=ciTemplate(tpl,'github');
  if(['gitlab','both'].includes(config.ci))entries['.gitlab-ci.yml']=ciTemplate(tpl,'gitlab');
  return entries;
}
function managedBlock(content){
  const a=content.indexOf(BEGIN), b=content.indexOf(END);
  if(a===-1 && b===-1)return null;
  invariant(a>=0&&b>a&&content.indexOf(BEGIN,a+1)<0&&content.indexOf(END,b+1)<0,'Malformed/duplicate AGENTS managed block');
  return {a,b:b+END.length,raw:content.slice(a,b+END.length)};
}
function planFor(h,root,entries,lock){
  const before=lock?.managed||{}, next={}, actions=[];
  const full={...entries};let prior=file(h,j(root,'AGENTS.md'))?read(h,j(root,'AGENTS.md')):null;
  const block=prior===null?null:managedBlock(prior);
  const nav=navigation(templateReader(h));
  let generated='# Agent instructions\n\n'+nav+'\n';
  if(prior!==null){generated=block?prior.slice(0,block.a)+nav+prior.slice(block.b):prior+(prior.endsWith('\n')?'':'\n')+'\n'+nav+'\n';}
  full['AGENTS.md']=generated;
  for(const [rel,content] of Object.entries(full).sort(([a],[b])=>a.localeCompare(b))){
    const path=j(root,rel);relative(rel);
    let unsafe=false;let cur=root;
    for(const component of rel.split('/')){cur=j(cur,component);if(h.isSymlink(cur)){unsafe=true;break;}}
    const old=file(h,path)?read(h,path):null;
    let status;
    if(rel==='AGENTS.md'){
      status=unsafe?'conflict':(block && (!before[rel]||sha256(block.raw)!==before[rel]))?'conflict':old===content?'unchanged':old===null?'create':'update';
      next[rel]=sha256(nav);
    }else{
      status=unsafe?'conflict':old===null?'create':old===content?'unchanged':!before[rel]||sha256(old)!==before[rel]?'conflict':'update';
      if(!['.dairn/governance/project.json','.dairn/analyzers.json','.gitignore','CLAUDE.md','.agents/notes/archived/sha256.json','README.md','docs/PROJECT_GUIDE.md',LAUNCHER_CONFIG].includes(rel) &&
        // Sample source code and build manifests become project-owned immediately.
        !(rel==='go.mod'||rel==='hello.go'||rel==='hello_test.go'||/^[^/]+\/(?:go\.mod|hello(?:_test)?\.go)$/.test(rel))) next[rel]=sha256(content);
    }
    actions.push({path:rel,status});
  }
  // This release starts with the dairn-* namespace. There is no compatibility
  // translation, implicit deletion, or lock migration for retired asset names.
  // A future same-namespace upgrade must explicitly account for removed assets.
  // 旧版本把项目启动器放在 .dairn/bin/、并生成 .dairn/Makefile；本版本退役这些受管文件，
  // 把启动器迁到项目根 dairn/dairn.cmd。除这类显式迁移外，受管资源集合只增不减，避免静默删除他人文件。
  const LEGACY_MANAGED=new Set([LEGACY_LAUNCHER_POSIX,LEGACY_LAUNCHER_WINDOWS,LEGACY_MAKEFILE]);
  const retired=Object.keys(before).filter(rel=>!(rel in full));
  const unexpected=retired.filter(rel=>!LEGACY_MANAGED.has(rel));
  invariant(unexpected.length===0,'Managed assets no longer in this Dairn release: '+unexpected.join(', ')+'. Manual review required.');
  for(const rel of retired)actions.push({path:rel,status:'remove'});
  const kept={...next};
  return {actions,full,managed:kept};
}
/* 组装要写入 .dairn/launcher.json 的 config；vendor 模式先做只读校验。 */
function launcherConfigFor(h,root,o){
  if(!o.vendor_runtime)return null;
  const version=runtimeVersion(h);
  const vendored=vendorRuntime(h,root,o.vendor_runtime,{version});
  return {...defaultLauncherConfig(version),mode:'vendored',runtime:vendored.runtime};
}
/* plan/摘要输出用；--plan 下缺失运行时时降级为 pending，不做写入。 */
function launcherSummary(h,root,o,vendorConfig=null){
  if(vendorConfig)return {mode:'vendored',runtime:vendorConfig.runtime};
  if(o.vendor_runtime){
    if(!h.exists(j(root,RUNTIME_DIR))){
      return {mode:'vendored',pending:true,source:o.vendor_runtime,note:'place the official dairn-embedded.com and runtime-integrity.json in .dairn/runtime first'};
    }
    const vendored=vendorRuntime(h,root,o.vendor_runtime,{version:runtimeVersion(h)});
    return {mode:'vendored',runtime:vendored.runtime};
  }
  const configPath=j(root,LAUNCHER_CONFIG);
  if(file(h,configPath)){
    const config=readLauncherConfig(h,root);
    const payload=inspectRuntimePayload(h);
    const legacy=config.launcher!==LAUNCHER_POSIX||config.windows_launcher!==LAUNCHER_WINDOWS;
    if(payload&&(config.mode!=='vendored'||!config.runtime||config.runtime.version!==payload.version||config.runtime.sha256!==payload.sha256)){
      return {mode:'vendored',pending:true,payload:payload.dir,legacy,
        note:'apply will copy the bundled runtime into '+RUNTIME_DIR+' and migrate the launcher to ./'+LAUNCHER_POSIX};
    }
    return {mode:config.mode,legacy,runtime:config.runtime};
  }
  const payload=inspectRuntimePayload(h);
  if(payload)return {mode:'vendored',pending:true,payload:payload.dir,
    note:'apply will copy the bundled runtime into '+RUNTIME_DIR};
  return {mode:'external',runtime:null};
}
/* apply 后的项目自有 launcher 配置与执行位；managed launcher 文件由 makeDesired 写入。 */
function ensureLauncher(h,root,o,vendorConfig=null){
  const configPath=j(root,LAUNCHER_CONFIG);
  let config=vendorConfig;
  if(!config&&file(h,configPath)){
    const existing=readLauncherConfig(h,root);
    // launcher.json 是项目自有配置，但受管启动器的位置属于本版本契约：升级时迁移旧路径。
    if(existing.launcher!==LAUNCHER_POSIX||existing.windows_launcher!==LAUNCHER_WINDOWS){
      config={...existing,launcher:LAUNCHER_POSIX,windows_launcher:LAUNCHER_WINDOWS,generated_by:runtimeVersion(h)};
    }
  }
  if(!config&&!file(h,configPath))config=defaultLauncherConfig(runtimeVersion(h));
  if(config){
    invariant(!h.isSymlink(configPath),'Refuse symlinked launcher config: '+LAUNCHER_CONFIG);
    h.mkdirs(configPath.slice(0,configPath.lastIndexOf('/')));
    const tmp=configPath+'.dairn-tmp-'+Date.now();
    try{h.write(tmp,fmt(config));h.rename(tmp,configPath);}finally{if(h.exists(tmp))h.remove(tmp);}
  }
  for(const rel of [LAUNCHER_POSIX,LAUNCHER_WINDOWS]){
    const launcherPath=j(root,rel);
    if(file(h,launcherPath)&&!h.isSymlink(launcherPath)){
      try{h.chmod(launcherPath,0o755);}catch(e){h.log('WARN: cannot make launcher executable: '+(e&&e.message||e));}
    }
  }
  // APE 的 sh 加载器需要执行位；注册 vendored runtime 时尽量补上（Windows 无操作）。
  if(config&&config.mode==='vendored'&&config.runtime&&typeof config.runtime.path==='string'){
    const runtimePath=j(root,config.runtime.path);
    if(file(h,runtimePath)&&!h.isSymlink(runtimePath)){
      try{h.chmod(runtimePath,0o755);}catch(e){h.log('WARN: cannot make vendored runtime executable: '+(e&&e.message||e));}
    }
  }
}
function layoutDirs(root){
  const dirs=[];
  for(const state of ['proposed','implemented','rejected','archived'])for(const kind of NOTE_KINDS)
    dirs.push(j(root,'.agents/notes/'+state+'/'+kind));
  for(const kind of ['feedback','incident','bug','release','action'])dirs.push(j(root,'.dairn/governance/operations/'+kind));
  for(const kind of ['engineering','tasks','changes','evidence'])dirs.push(j(root,'.dairn/governance/'+kind));
  dirs.push(j(root,'.dairn/work'));
  dirs.push(j(root,'.dairn/runtime'));
  dirs.push(j(root,'.dairn/cache'));
  dirs.push(j(root,'.dairn/cache/analyzers'));
  dirs.push(j(root,'.dairn/tmp'));
  return dirs;
}
function preflightLayout(h,root){
  // Forbid symlink traversal, including folders not present in managed-files plans.
  for(const dest of layoutDirs(root)){
    let cur=root;const rel=dest.slice(root.length).replace(/^\//,'');
    for(const part of rel.split('/')){
      cur=j(cur,part);
      invariant(!h.isSymlink(cur),'Refuse symlinked governance layout: '+cur);
      invariant(!h.exists(cur)||h.isDirectory(cur),'Governance layout path is a file: '+cur);
    }
  }
}
function layout(h,root){
  preflightLayout(h,root);
  for(const state of ['proposed','implemented','rejected','archived'])for(const kind of NOTE_KINDS){
    const d=j(root,'.agents/notes/'+state+'/'+kind);h.mkdirs(d);
    if(state!=='archived'&&!file(h,j(d,'.gitkeep')))h.write(j(d,'.gitkeep'),'');
  }
  for(const kind of ['feedback','incident','bug','release','action'])h.mkdirs(j(root,'.dairn/governance/operations/'+kind));
  for(const kind of ['engineering','tasks','changes','evidence'])h.mkdirs(j(root,'.dairn/governance/'+kind));
  h.mkdirs(j(root,'.dairn/work'));
  h.mkdirs(j(root,'.dairn/runtime'));
  h.mkdirs(j(root,'.dairn/cache/analyzers'));
  h.mkdirs(j(root,'.dairn/tmp'));
}
function apply(h,root,planned,nextLock){
  const conflicts=planned.actions.filter(x=>x.status==='conflict');
  invariant(conflicts.length===0,'Conflicts detected; no files written: '+conflicts.map(x=>x.path).join(', '));
  // Preflight is complete before the first write. Preserve existing content for rollback.
  const old=[];
  try {
    for(const a of planned.actions)if(!['unchanged','absent'].includes(a.status)){
      const path=j(root,a.path);old.push({path,old:file(h,path)?read(h,path):null});
      if(a.status==='remove'){if(h.exists(path))h.remove(path);continue;}
      h.mkdirs(path.slice(0,path.lastIndexOf('/')));
      const tmp=path+'.dairn-tmp-'+Date.now();h.write(tmp,planned.full[a.path]);
      try{h.rename(tmp,path);}finally{if(h.exists(tmp))h.remove(tmp);}
    }
    const lockPath=j(root,'.dairn/lock.json');old.push({path:lockPath,old:file(h,lockPath)?read(h,lockPath):null});
    h.mkdirs(j(root,'.dairn'));
    const tmp=lockPath+'.dairn-tmp-'+Date.now();h.write(tmp,fmt(nextLock));
    try{h.rename(tmp,lockPath);}finally{if(h.exists(tmp))h.remove(tmp);}
  }catch(err){for(const snap of old.reverse())try{if(snap.old===null){if(h.exists(snap.path))h.remove(snap.path);}else h.write(snap.path,snap.old);}catch(_){}throw err;}
}
function lockRead(h,root,required){
  const p=j(root,'.dairn/lock.json');if(!file(h,p)){if(required)throw Error('Project not initialized; run dairn init or dairn adopt');return null;}
  const lock=JSON.parse(read(h,p));invariant(lock.schema===2,'Unsupported lock schema');
  const installed=lock.config?.extra_skills||[];
  invariant(Array.isArray(installed)&&installed.every(n=>typeof n==='string'&&/^dairn-[a-z0-9-]+$/.test(n)),
    'Only dairn-* skills are supported in project lock');
  invariant(Object.keys(lock.managed||{}).every(p=>!p.startsWith('.agents/skills/')||/^\.agents\/skills\/dairn-[a-z0-9-]+\//.test(p)),
    'Only dairn-* managed Skills are supported');
  return lock;
}
/* S0 诊断基元：只读描述运行时身份与受管资源漂移，不写入、不授予信任。
 * dairn.runtime-lock.v1 是 doctor / upgrade 与 Agent 自动恢复共同消费的稳定结构。 */
function managedDigest(h,rel,path){
  const original=read(h,path);const block=rel==='AGENTS.md'?managedBlock(original):null;
  // 受管文本在 autocrlf=true 的 Windows checkout 上可能被转成 CRLF；
  // 除有意使用 CRLF 的 .cmd 外，哈希前统一换行，避免“看起来被编辑”。
  const normalize=text=>rel.endsWith('.cmd')?text:String(text).replace(/\r\n/g,'\n');
  return rel==='AGENTS.md'?(block?sha256(normalize(block.raw)):''):sha256(normalize(original));
}
function nextActionsFor(drift){
  const actions=[{command:'dairn doctor --json',description:'read-only Runtime Lock diagnostic; report status, drift codes and expected/actual digests',requires_review:false}];
  if(drift.length){
    actions.push({command:'dairn upgrade --plan --json',description:'review planned managed-resource changes; planning never writes',requires_review:true});
    actions.push({command:'dairn upgrade --apply',description:'apply a reviewed plan; a human must review it before authorization',requires_review:true});
  }
  return actions;
}
export function runtimeLockReport(h,root,lock){
  lock=lock||lockRead(h,root,true);
  const report={schema:'dairn.runtime-lock.v1',status:'ok',root,read_only:true,
    lock:{version:lock.version,runtime_sha256:lock.runtime_sha256},
    runtime:{version:null,runtime_sha256:null},
    launcher:{mode:null,version:null,binary_sha256:null,integrity_sha256:null},
    drift:[],managed:{checked:0,drifted:0},next_actions:[]};
  try{report.runtime.version=runtimeVersion(h);report.runtime.runtime_sha256=runtimeIdentity(h);}
  catch(e){report.drift.push({code:'runtime.integrity',expected:null,actual:null,message:String(e?.message||e)});}
  if(report.runtime.version!==null&&report.runtime.version!==lock.version)
    report.drift.push({code:'runtime.version',expected:lock.version,actual:report.runtime.version});
  if(report.runtime.runtime_sha256!==null&&report.runtime.runtime_sha256!==lock.runtime_sha256)
    report.drift.push({code:'runtime.sha256',expected:lock.runtime_sha256,actual:report.runtime.runtime_sha256});
  try{
    const info=launcherInfo(h,root);report.launcher.mode=info.mode||null;
    const runtime=info.runtime;
    if(runtime){report.launcher.version=runtime.version||null;report.launcher.binary_sha256=runtime.sha256||null;report.launcher.integrity_sha256=runtime.integrity||null;}
  }catch(_){/* launcher 信息只是观察字段；缺失不改变锁一致性判断 */}
  for(const [rel,expected] of Object.entries(lock.managed||{})){
    report.managed.checked++;
    const path=j(root,rel);
    if(!file(h,path)){report.managed.drifted++;report.drift.push({code:'managed.missing',path:rel,expected,actual:null});continue;}
    const actual=managedDigest(h,rel,path);
    if(actual!==expected){report.managed.drifted++;report.drift.push({code:'managed.edited',path:rel,expected,actual});}
  }
  report.status=report.drift.length?'drift':'ok';
  report.next_actions=nextActionsFor(report.drift);
  return report;
}
function lockDriftError(report){
  const codes=report.drift.map(item=>item.code+(item.path?':'+item.path:'')).join(', ');
  const err=new Error('Runtime Lock drift: '+codes);
  err.exitCode=4;err.code='RUNTIME_LOCK_DRIFT';err.diagnostic=report;
  return err;
}
export function verifyRuntimeLock(h,root,required=false){
  const lock=lockRead(h,root,required);if(!lock)return null;
  const report=runtimeLockReport(h,root,lock);
  if(report.status!=='ok')throw lockDriftError(report);
  return lock;
}
function nameValid(value){invariant(/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(value),'Project name must be letters, digits, - or _ and start with letter');return value;}
/* 解压后的发行包根目录不是空目录：允许 init 就地展开治理文件。
 * 只接受发行包自带的启动器、LICENSE/licenses 与 .dairn/runtime 载荷；
 * 出现任何其他内容都说明这是既有项目，应改用 adopt 以免覆盖项目文件。 */
function isReleaseLayout(h,path){
  const allowed=new Set(['dairn','dairn.cmd','LICENSE','licenses','.dairn']);
  let names;try{names=h.list(path);}catch(_){return false;}
  for(const name of names){
    if(!allowed.has(name))return false;
    if(name==='.dairn'){
      let inner;try{inner=h.list(j(path,name));}catch(_){return false;}
      if(!inner.every(x=>x==='runtime'))return false;
      let files;try{files=h.list(j(j(path,name),'runtime'));}catch(_){return false;}
      if(!files.every(x=>x==='dairn-embedded.com'||x==='runtime-integrity.json'))return false;
    }
  }
  return true;
}
function provision(h,o){
  const path=o.root==='.'?h.cwd():o.root;
  if(o.cmd==='init'&&h.exists(path)&&h.isDirectory(path)&&h.list(path).length&&!isReleaseLayout(h,path))throw Error('Nonempty directory: use dairn adopt');
  if(o.cmd==='adopt')invariant(h.exists(path),'Existing project directory required for adopt');
  const root=o.plan&& !h.exists(path)?null:checkedRoot(h,path,!o.plan&&o.cmd==='init');
  // A plan for a missing directory must remain read-only.
  const evaluationRoot=root??path;
  invariant(!h.exists(j(evaluationRoot,'.dairn/lock.json')),'Already managed; use dairn upgrade');
  const pname=nameValid(o.name||evaluationRoot.replace(/\/$/,'').split('/').pop().replace(/^[0-9]+/,'project-').replace(/[^a-zA-Z0-9_-]/g,'-'));
  if(o.sample)invariant(o.stack==='go'&&o.cmd==='init','--sample is supported only by init --stack go');
  // For init, only explicit stack is useful before a new app exists.
  const modules=moduleConfig(h,evaluationRoot,o);
  const config={schema:2,name:pname,modules,ci:o.ci,sample:!!o.sample,extra_skills:[]};
  invariant(['none','github','gitlab','both'].includes(config.ci),'Invalid --ci value');
  const plan=planFor(h,evaluationRoot,makeDesired(h,evaluationRoot,config,null),null);
  preflightLayout(h,evaluationRoot);
  if(o.plan){h.log(fmt({mode:o.cmd,root:evaluationRoot,modules:config.modules.map(x=>({name:x.name,path:x.path,profiles:x.profiles})),
    ...(o.discover?{discovery:{repository:discoverRepository(h,evaluationRoot),
      note:'suggestions only; existing CI/tests are reused, never overwritten — apply requires --apply'}}:{}),
    actions:plan.actions,launcher:launcherSummary(h,evaluationRoot,o)}));return plan.actions.some(x=>x.status==='conflict')?2:0;}
  // Validate an explicitly requested vendored runtime, or copy the bundled runtime payload,
  // BEFORE the first managed write (fail closed; apply rolls back managed files on error).
  const vendorConfig=launcherConfigFor(h,evaluationRoot,o)||payloadLauncherConfig(h,evaluationRoot);
  if(vendorConfig){
    plan.full[LAUNCHER_CONFIG]=fmt(vendorConfig);
    if(!plan.actions.some(x=>x.path===LAUNCHER_CONFIG))plan.actions.push({path:LAUNCHER_CONFIG,status:file(h,j(evaluationRoot,LAUNCHER_CONFIG))?'update':'create'});
  }
  const lock={schema:2,version:runtimeVersion(h),runtime_sha256:runtimeIdentity(h),config,managed:plan.managed};
  apply(h,evaluationRoot,plan,lock);layout(h,evaluationRoot);
  ensureLauncher(h,evaluationRoot,o,vendorConfig);
  // Baseline only fresh initialized projects AFTER generated code and manifests exist.
  // Adopted projects must review and accept observed facts themselves.
  if(o.cmd==='init'&&!h.exists(factSnapshotPath(evaluationRoot)))acceptFacts(h,evaluationRoot,captureFacts(h,evaluationRoot,config));
  h.log('Dairn '+runtimeVersion(h)+' '+o.cmd+' 完成：'+config.modules.length+' 个模块，'+plan.actions.length+' 项资源。');
  h.log('Launcher: '+LAUNCHER_POSIX+' (Windows: '+LAUNCHER_WINDOWS+')'+(vendorConfig?' — vendored runtime registered':' — external runtime resolution'));
  h.log('Next: dairn guide plan; dairn work start <task> --id <id>; dairn hooks install --apply; dairn doctor; dairn check --all');
  if(!vendorConfig)h.log('WARNING: no runtime payload available; copy the official APE + runtime-integrity.json into .dairn/runtime and run dairn upgrade --vendor-runtime .dairn/runtime --apply');
  return 0;
}
function upgrade(h,o){
  const root=checkedRoot(h,o.root==='.'?h.cwd():o.root,false), lock=lockRead(h,root,true);
  const lockReport=runtimeLockReport(h,root,lock);
  const config={...lock.config,sample:false};const plan=planFor(h,root,makeDesired(h,root,config,lock),lock);
  preflightLayout(h,root);
  const installed=runtimeVersion(h);
  let existingLauncher=null;
  try{existingLauncher=readLauncherConfig(h,root);}catch(_){existingLauncher=null;}
  const payload=inspectRuntimePayload(h);
  const payloadFix=!!(payload&&!o.vendor_runtime&&payload.version===installed);
  const legacyLauncher=!!(existingLauncher&&(existingLauncher.launcher!==LAUNCHER_POSIX||existingLauncher.windows_launcher!==LAUNCHER_WINDOWS));
  const staleVendored=!!(existingLauncher&&existingLauncher.mode==='vendored'&&!o.vendor_runtime&&!payloadFix&&
    existingLauncher.runtime&&existingLauncher.runtime.version&&existingLauncher.runtime.version!==installed);
  if(staleVendored){
    const message='Project launcher vendors Dairn '+existingLauncher.runtime.version+' but this CLI is '+installed+
      '; replace .dairn/runtime with the matching release and run dairn upgrade --vendor-runtime .dairn/runtime --apply';
    if(o.apply)throw Error(message);
    h.error('WARNING: '+message);
  }
  const next={schema:2,version:installed,runtime_sha256:runtimeIdentity(h),config,managed:plan.managed};
  // 任意 vendored 运行时变更都必须在写受管文件之前完成校验/复制（fail closed）。
  let vendorConfig=null;
  if(o.apply){
    if(o.vendor_runtime)vendorConfig=launcherConfigFor(h,root,o);
    else if(payloadFix){
      // 版本相同不代表二进制相同（同版本号重建）；用载荷摘要判断是否仍需刷新。
      const current=!!(existingLauncher&&existingLauncher.mode==='vendored'&&existingLauncher.runtime&&
        existingLauncher.runtime.version===installed&&existingLauncher.runtime.sha256===payload.sha256);
      if(!current)vendorConfig=payloadLauncherConfig(h,root);
    }
  }
  if(vendorConfig&&legacyLauncher)vendorConfig={...vendorConfig,launcher:LAUNCHER_POSIX,windows_launcher:LAUNCHER_WINDOWS};
  h.log(fmt({mode:o.apply?'apply':'plan',installed:runtimeVersion(h),recorded:lock.version,actions:plan.actions.filter(x=>o.diff||x.status!=='unchanged'),launcher:launcherSummary(h,root,o,vendorConfig),runtime_lock:lockReport,next_actions:lockReport.next_actions}));
  if(o.diff){for(const a of plan.actions.filter(x=>x.status==='update'))h.log('~ '+a.path+' (managed content changed; diff with git for exact lines)');}
  if(!o.apply)return plan.actions.some(x=>x.status==='conflict')?2:(lockReport.status!=='ok'?4:0);
  apply(h,root,plan,next);layout(h,root);ensureLauncher(h,root,o,vendorConfig);
  h.log('Upgrade applied; project-owned policy and Notes are preserved. Launcher: ./'+LAUNCHER_POSIX+' (Windows: '+LAUNCHER_WINDOWS+')'+
    (vendorConfig?' — vendored runtime registered':(legacyLauncher?' — launcher paths migrated':'')));
  for(const rel of [LEGACY_LAUNCHER_POSIX,LEGACY_LAUNCHER_WINDOWS]){
    const legacyPath=j(root,rel);
    if(h.exists(legacyPath)&&h.isDirectory(legacyPath))try{h.remove(legacyPath);}catch(_){}
  }
  return 0;
}
function addSkill(h,o){
  const root=checkedRoot(h,o.root==='.'?h.cwd():o.root,false),lock=verifyRuntimeLock(h,root,true);
  const name=o.pos[1];invariant(/^[a-z][a-z0-9-]*$/.test(name||''),'skills add <skill-name>');
  const manifest=assetIndex(h);invariant(manifest.assets.some(x=>x.type==='skills'&&x.path===name+'/SKILL.md'),'Unknown Skill: '+name);
  const text=read(h,ASSETS+'skills/'+name+'/SKILL.md');invariant(/^dairn-stage:\s*stable\s*$/m.test(text),'Only stable Skills may be installed by default');
  const config={...lock.config,extra_skills:[...new Set([...(lock.config.extra_skills||[]),name])].sort()};
  const plan=planFor(h,root,makeDesired(h,root,config,lock),lock);
  h.log(fmt({skill:name,actions:plan.actions.filter(x=>x.status!=='unchanged')}));
  if(!o.apply)return plan.actions.some(x=>x.status==='conflict')?2:0;
  apply(h,root,plan,{...lock,config,managed:plan.managed});h.log('Added Skill: '+name);return 0;
}
/* 稳定 ID 现在从 spec frontmatter 解析；manifest.assets[].id 只是构建缓存。 */
function frontmatterId(text){
  for(const line of String(text).split(/\r?\n/).slice(0,30)){
    const match=/^id:\s*(\S+)\s*$/.exec(line);
    if(match)return match[1].replace(/^["']|["']$/g,'');
  }
  return null;
}
function specIndex(h){
  const manifest=assetIndex(h),docs=[];
  for(const asset of manifest.assets){
    if(asset.type!=='specs')continue;
    const text=read(h,ASSETS+'specs/'+asset.path);
    docs.push({id:frontmatterId(text),path:asset.path,text});
  }
  return docs;
}
/* S3 检索精度：frontmatter 字段 + 词法打分，仍只做本地索引，不引入语义/向量依赖。
 * 排序只影响候选顺序与解释；权威性仍由稳定 ID 与 docs show 的完整正文决定。 */
const DOC_RANK={id:100,alias:80,keyword:60,title:40,summary:40,path:40,section:30,body:10};
function parseYamlList(value){
  if(!value)return null;
  try{const parsed=JSON.parse(value);return Array.isArray(parsed)?parsed.map(String):null;}catch(_){/* 非 JSON 内联列表继续手工解析 */}
  const inner=value.replace(/^\[|\]$/g,'');
  if(inner===value&&!value.startsWith('['))return null;
  return inner.split(',').map(item=>item.trim().replace(/^["']|["']$/g,'')).filter(Boolean);
}
function frontmatterFields(text){
  const fields={title:'',summary:'',kind:'',module:'',aliases:[],keywords:[],symbols:[],headings:[]};
  const lines=String(text).split(/\r?\n/);
  for(const line of lines.slice(0,40)){
    const match=/^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if(!match)continue;
    const [,key,raw]=match,value=raw.trim();
    if(key==='title'||key==='summary'||key==='kind'||key==='module'){
      fields[key]=value.replace(/^["']|["']$/g,'');
      continue;
    }
    if(key==='aliases'||key==='keywords'||key==='symbols'){
      const list=parseYamlList(value);
      if(list)fields[key]=list;
    }
  }
  fields.headings=lines.filter(line=>/^#{1,6} /.test(line)).map(line=>line.replace(/^#{1,6} /,'').trim()).filter(Boolean);
  return fields;
}
function docMatches(doc,terms){
  const fields=doc.fields,id=String(doc.id||'').toLowerCase(),path=doc.path.toLowerCase();
  const lowerList=list=>(list||[]).map(item=>String(item).toLowerCase());
  const buckets={id,title:(fields.title||'').toLowerCase(),summary:(fields.summary||'').toLowerCase(),path,
    aliases:lowerList(fields.aliases),keywords:lowerList(fields.keywords),symbols:lowerList(fields.symbols),
    sections:lowerList(fields.headings),body:doc.text.toLowerCase()};
  let score=0;const reasons=[];
  for(const term of terms){
    if(!term)continue;
    if(buckets.id===term){score+=DOC_RANK.id;reasons.push('id');continue;}
    if(buckets.aliases.some(value=>value===term||value.includes(term))){score+=DOC_RANK.alias;reasons.push('aliases');continue;}
    if(buckets.keywords.some(value=>value===term||value.includes(term))||buckets.symbols.some(value=>value===term||value.includes(term))){score+=DOC_RANK.keyword;reasons.push('keywords');continue;}
    if(buckets.title.includes(term)){score+=DOC_RANK.title;reasons.push('title');continue;}
    if(buckets.summary.includes(term)){score+=DOC_RANK.summary;reasons.push('summary');continue;}
    if(buckets.path.includes(term)){score+=DOC_RANK.path;reasons.push('path');continue;}
    if(buckets.sections.some(value=>value.includes(term))){score+=DOC_RANK.section;reasons.push('sections');continue;}
    if(buckets.body.includes(term)){score+=DOC_RANK.body;reasons.push('body');continue;}
    return null; // 多词查询按 AND 语义：每个词都必须命中至少一个字段
  }
  return {score,reasons:[...new Set(reasons)]};
}
function docsShow(h,o,doc){
  invariant(!(o.section!==undefined&&o.lines!==undefined),'--section and --lines are mutually exclusive');
  const lines=doc.text.split(/\r?\n/);let selected=null,section=null;
  if(o.section!==undefined&&o.section!==null){
    const name=String(o.section).replace(/^#+\s*/,'').trim();
    const headings=[];
    lines.forEach((line,index)=>{const match=/^(#{1,6}) (.*)$/.exec(line);if(match)headings.push({index,level:match[1].length,title:match[2].trim()});});
    const hit=headings.find(item=>item.title.toLowerCase()===name.toLowerCase());
    invariant(!!hit,'Unknown section: '+name+(headings.length?' (available: '+headings.map(item=>item.title).join(', ')+')':''));
    let end=lines.length;
    for(const heading of headings)if(heading.index>hit.index&&heading.level<=hit.level){end=heading.index;break;}
    selected={text:lines.slice(hit.index,end).join('\n'),range:[hit.index+1,end]};section=hit.title;
  }else if(o.lines!==undefined&&o.lines!==null){
    const match=/^(\d+)-(\d+)$/.exec(String(o.lines).trim());
    invariant(!!match,'--lines must be <start>-<end> (1-based)');
    const start=Number(match[1]),end=Number(match[2]);
    invariant(start>=1&&start<=end&&end<=lines.length,'--lines out of range 1-'+lines.length);
    selected={text:lines.slice(start-1,end).join('\n'),range:[start,end]};
  }
  if(o.json){
    const payload={schema:'dairn.docs-show.v1',id:doc.id,path:doc.path,line_range:selected?selected.range:[1,lines.length],text:selected?selected.text:doc.text};
    if(section)payload.section=section;
    h.log(fmt(payload));return 0;
  }
  h.log(selected?selected.text:doc.text);
  return 0;
}
function docCmd(h,o){
  const action=o.pos[0]||'find',q=(o.pos[1]||'').toLowerCase();
  if(action==='check'){
    const manifest=assetIndex(h);
    const report=lintAssets(manifest.assets,(type,relPath)=>read(h,ASSETS+type+'/'+relPath));
    if(o.json){h.log(fmt(report));return report.errors.length?2:0;}
    h.log('assets: '+report.stats.specs+' specs, '+report.stats.skills+' skills; references: '+report.stats.references);
    h.log(report.errors.length?'FAIL':'PASS');
    for(const warning of report.warnings)h.log('WARN '+warning.asset+': '+warning.message);
    for(const error of report.errors)h.log('ERROR '+error.asset+': '+error.message);
    return report.errors.length?2:0;
  }
  const docs=specIndex(h).map(doc=>({...doc,fields:frontmatterFields(doc.text)}));
  if(action==='find'){
    invariant(q,'docs find <query>');
    invariant(o.section===undefined&&o.lines===undefined,'--section/--lines are only valid for docs show');
    const terms=o.pos.slice(1).map(term=>term.toLowerCase()).filter(Boolean);
    const scored=[];
    for(const doc of docs){
      if(!doc.id)continue;
      const match=docMatches(doc,terms);
      if(match)scored.push({id:doc.id,path:doc.path,score:match.score,rank_reason:match.reasons});
    }
    scored.sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
    const hits=scored.slice(0,30);
    if(o.json){
      h.log(fmt({schema:'dairn.docs-find.v1',query:o.pos.slice(1).join(' '),terms,hits,
        truncated:scored.length>hits.length,next:hits.length?'dairn docs show '+hits[0].id:null}));
      return hits.length?0:1;
    }
    for(const hit of hits)h.log(hit.id+'\t'+hit.path);
    if(hits.length)h.error('Next: dairn docs show '+hits[0].id);
    return hits.length?0:1;
  }
  if(action==='show'||action==='context'){
    invariant(q,'docs show <id>');
    const doc=docs.find(x=>x.id&&x.id.toLowerCase()===q);
    invariant(!!doc,'Unknown spec id: '+q);
    if(action==='show')return docsShow(h,o,doc);
    invariant(o.section===undefined&&o.lines===undefined,'--section/--lines are only valid for docs show');
    const limit=8000;
    const truncated=doc.text.length>limit;
    let body=doc.text;
    if(truncated){
      let cut=doc.text.slice(0,limit);
      const newline=cut.lastIndexOf('\n');
      if(newline>0)cut=cut.slice(0,newline);
      body=cut+'\n\n[truncated at 8000 characters; use dairn docs show '+doc.id+' for the full authoritative text]';
    }
    h.log(body);
    return 0;
  }
  throw Error('Usage: dairn docs find <topic> | docs show <spec-id> | docs context <spec-id> | docs check [--json]');
}
function doctor(h,root){
  const lock=lockRead(h,root,true);const lockReport=runtimeLockReport(h,root,lock);
  const cfg=JSON.parse(read(h,j(root,'.dairn/governance/project.json')));
  const problems=policyValidate(cfg),modules=cfg.modules.map(m=>({name:m.name,path:m.path,checks:Object.keys(m.checks)}));
  const launcherCheck=verifyLauncher(h,root);
  for(const problem of launcherCheck.problems)problems.push(problem);
  let launcher=launcherCheck.info;
  if(!launcher){try{launcher=launcherInfo(h,root);}catch(_){launcher=null;}}
  if(!launcher)launcher={resolved:LAUNCHER_POSIX,windows:LAUNCHER_WINDOWS,mode:'external',invocation:'./'+LAUNCHER_POSIX,windows_invocation:LAUNCHER_WINDOWS,runtime:null};
  if(launcher.mode==='vendored'&&launcher.runtime&&launcher.runtime.version&&launcher.runtime.version!==lock.version){
    problems.push('vendored launcher runtime is '+launcher.runtime.version+' but project lock is '+lock.version+'; run dairn upgrade --vendor-runtime .dairn/runtime --apply');
  }
  const candidates=[['git','--version']];
  for(const m of cfg.modules)for(const stack of m.profiles){
    if(stack==='python'){
      const configured=Object.values(m.checks).map(check=>check.argv?.[0]).filter(tool=>
        typeof tool==='string'&&/^python(?:3(?:\.\d+)?)?(?:\.exe)?$/i.test(tool.replace(/\\/g,'/').split('/').pop()));
      for(const tool of configured.length?configured:['python'])candidates.push([tool,'--version']);
      continue;
    }
    const tool=({go:['go','version'],rust:['cargo','--version'],python:['python','--version'],vue:['node','--version'],
      java:['java','-version'],'spring-boot':['java','-version'],openresty:['openresty','-v']})[stack];
    if(tool)candidates.push(tool);
  }
  const tools={};for(const argv of candidates){if(argv[0] in tools)continue;
    try{
      const result=h.run(argv,root,10);
      tools[argv[0]]=result.timedOut?'timeout':result.code===0?'available':'missing-or-error';
      if(tools[argv[0]]!=='available')problems.push('tool '+argv[0]+': '+tools[argv[0]]+
        ' (exit '+result.code+')'+(result.output?' — '+String(result.output).trim().slice(0,512):''));
    }
    catch(e){tools[argv[0]]='unavailable: '+e.message;problems.push('tool '+argv[0]+': '+tools[argv[0]]);}
  }
  const drift=lockReport.status!=='ok';
  const status=drift?'drift':problems.length?'unready':'ready';
  // 运行时来源与源码陈旧度：只报告，不改变门禁语义；运行时身份仍以 runtime_sha256 为准。
  const runtime_source=runtimeSource(h);
  let freshness={status:'unknown',checked:0,stale_sources:[],stale_count:0,note:'runtime manifest unavailable'};
  try{freshness=runtimeFreshness(h,root,assetIndex(h).engine_sources);}catch(_){}
  h.log(fmt({product:'Dairn',engine:'Cosmopolitan QuickJS',version:lockReport.runtime.version||lock.version,status,root,runtime_sha256:lock.runtime_sha256,
    runtime_lock:lockReport,runtime:{version:lock.version,source:runtime_source,freshness},launcher,invocation:launcher.invocation+' doctor',modules,tools,problems}));
  for(const problem of problems)h.error('ERROR: '+problem);
  if(drift)h.error('Runtime Lock drift: '+lockReport.drift.map(item=>item.code+(item.path?':'+item.path:'')).join(', '));
  return drift?4:(problems.length?1:0);
}

/* --- 独立证据/门禁命令：只读验证，不授予信任，不触网。 --- */
function safeRelInside(h,root,rel){
  invariant(typeof rel==='string'&&rel.length>0&&!rel.startsWith('/')&&!rel.includes('\\')&&!/^[A-Za-z]:/.test(rel)&&!rel.split('/').some(x=>x==='..'||x===''||x==='.'),'Unsafe project-relative path: '+rel);
  let cur=root;for(const part of rel.split('/')){cur=j(cur,part);invariant(!h.isSymlink(cur),'Refuse symlinked input: '+rel);}
  return cur;
}
function readJsonRel(h,root,rel,label){
  invariant(typeof rel==='string'&&rel.length>0,label+' path required');
  // 受信 CI 上下文可以来自项目外的受控位置（例如 signer 的 mktemp 输入）；
  // 仅读取 JSON，不授予任何执行能力，验签失败仍然 fail closed。
  const isAbsolute=rel.startsWith('/')||/^[A-Za-z]:[\\/]/.test(rel);
  const path=isAbsolute?rel:safeRelInside(h,root,rel);
  invariant(file(h,path),label+' not found: '+rel);
  return JSON.parse(read(h,path));
}
function evidenceCmd(h,o,root){
  const op=o.pos[0]||'verify';
  if(op==='verify'){
    invariant(o.bundle||o.run,'Usage: dairn evidence verify --bundle <path> | --run <run-id> [--evidence <run.json>]');
    if(o.bundle){
      const report=verifyBundle(h,root,o.bundle);
      if(o.json)h.log(fmt(report));
      else{h.log('bundle: '+report.status+' (run '+String(report.run_id)+', '+report.files.length+' files)');
        for(const f of report.files)h.log((f.ok?'OK   ':'FAIL ')+f.name+' '+f.path+(f.reason?' — '+f.reason:''));
        for(const e of report.run_validation)h.error('ERROR '+e);}
      return report.status==='verified'?0:1;
    }
    const located=locateRunEvidence(h,root,o.run,o.evidence);
    const checked=verifyRunBytes(h,root,located.path);
    h.log(fmt({schema:'dairn.check-run.v1',status:'verified',run_id:checked.run.run_id,
      run_status:checked.run.status,declared_assurance:checked.run.declared_assurance,
      path:located.path,run_sha256:checked.sha256,
      subject:checked.run.subject,required_checks:checked.run.required_checks}));
    return 0;
  }
  if(op==='inspect'){
    invariant(o.run,'Usage: dairn evidence inspect --run <run-id> [--evidence <run.json>] [--json]');
    const located=locateRunEvidence(h,root,o.run,o.evidence);
    const checked=verifyRunBytes(h,root,located.path);
    const run=checked.run;
    h.log(fmt({schema:'dairn.check-run.v1',run_id:run.run_id,status:run.status,
      declared_assurance:run.declared_assurance,related_tasks:run.related_tasks,
      subject:run.subject,path:located.path,run_sha256:checked.sha256,
      required_checks:run.required_checks,
      checks:(run.checks||[]).map(c=>({id:c.id,status:c.status,exit_code:c.exit_code??c.returncode??null}))}));
    return 0;
  }
  if(op==='bundle'){
    invariant(o.run&&o.out,'Usage: dairn evidence bundle --run <run-id> [--evidence <run.json>] [--origin <origin.json>] --out <bundle.json>');
    const located=locateRunEvidence(h,root,o.run,o.evidence);
    const checked=verifyRunBytes(h,root,located.path);
    const files={run_json:{path:located.path,sha256:checked.sha256}};
    if(o.origin){
      const originPath=safeRelInside(h,root,o.origin);
      invariant(file(h,originPath),'origin not found: '+o.origin);
      files.origin_json={path:o.origin,sha256:sha256(read(h,originPath))};
    }
    const bundle={schema:'dairn.evidence-bundle.v1',run:checked.run,files};
    bundle.bundle_sha256=sha256(JSON.stringify(bundle));
    const outPath=safeRelInside(h,root,o.out);
    invariant(!file(h,outPath),'refuse to overwrite bundle: '+o.out);
    h.write(outPath,fmt(bundle));
    h.log(fmt({status:'bundled',path:o.out,run_id:checked.run.run_id,files:Object.keys(files)}));
    return 0;
  }
  throw Error('Usage: dairn evidence verify|inspect|bundle --bundle <path>|--run <run-id>');
}
function gateCmd(h,o,root){
  const op=o.pos[0]||'evaluate';
  invariant(op==='evaluate','Usage: dairn gate evaluate --subject <s.json> --policy <p.json> [...]');
  invariant(o.subject&&o.policy,'gate evaluate requires --subject and --policy');
  // P0: the gate consumes the RESULT of real Ed25519 verification, never a
  // bare statement JSON (consolidated plan §2.2). A statement without its
  // signature and CI-controlled public key cannot gate anything.
  if(o.attestation)invariant(o.signature&&o.key,
    'gate evaluate --attestation requires --signature <sig> and --key <absolute trusted pubkey> (real Ed25519 verification)');
  const subject=readJsonRel(h,root,o.subject,'subject');
  const policy=readJsonRel(h,root,o.policy,'policy');
  const check=o.check?readJsonRel(h,root,o.check,'check run') : null;
  const approval=o.approval?readJsonRel(h,root,o.approval,'approval verdict') : null;
  const context=o.context?readJsonRel(h,root,o.context,'context') : {};
  let verifiedAttestation=null;
  if(o.attestation){
    const statement=readJsonRel(h,root,o.attestation,'attestation statement');
    let verified;
    try { verified=verifyAttestation(h,root,o.attestation,o.signature,o.key,context); }
    catch(e){
      const failed={schema:'dairn.gate-verdict.v1',status:'FAIL',
        reasons:['attestation verification failed: '+String(e&&e.message||e)]};
      if(o.json)h.log(fmt(failed));
      else h.error('ERROR gate: FAIL — '+failed.reasons[0]);
      return 1;
    }
    verifiedAttestation={...verified,schema:'dairn.verified-attestation.v1',statement};
  }
  const modules=o.modules?String(o.modules).split(',').map(x=>x.trim()).filter(Boolean):null;
  const verdict=gateEvaluate({subject,policy,check,approval,context,verifiedAttestation,modules,
    risk:o.risk||null,requiredStage:o.stage||'pre-merge',trustedPolicy:policy});
  if(o.json)h.log(fmt(verdict));
  else h.log('gate: '+verdict.status+(verdict.reasons.length?' — '+verdict.reasons.join('; '):''));
  return verdict.status==='PASS'?0:verdict.status==='INDETERMINATE'?3:1;
}
/* 平台审批快照裁决：消费 ci/providers 抓取的规范化快照，不触网、不信 PR 自带 JSON。 */
function approvalCmd(h,o,root){
  const op=o.pos[0]||'evaluate';
  invariant(op==='evaluate','Usage: dairn approval evaluate --snapshot <snap.json> [--policy <p.json>] [--json]');
  invariant(o.subject===undefined,'approval uses the snapshot subject; --subject is not accepted');
  invariant(o.snapshot,'approval evaluate requires --snapshot <platform snapshot json>');
  const snapshot=readJsonRel(h,root,o.snapshot,'approval snapshot');
  const policy=o.policy?readJsonRel(h,root,o.policy,'policy'):{};
  const verdict=approvalPlatformVerdict(snapshot,policy.approvals||policy);
  if(o.json)h.log(fmt(verdict));
  else h.log('approval: '+verdict.status+' provider='+verdict.provider+
    ' eligible=['+verdict.eligible_reviewer_ids.join(',')+']'+
    (verdict.reasons.length?' — '+verdict.reasons.join('; '):''));
  return verdict.status==='PASS'?0:verdict.status==='INDETERMINATE'?3:1;
}
function attestCmd(h,o,root){  const op=o.pos[0];
  if(op==='prepare'){
    invariant(o.bundle&&o.context,'attest prepare requires --bundle and --context (trusted CI context JSON)');
    const context=readJsonRel(h,root,o.context,'context');
    const result=prepareAttestation(h,root,o.bundle,context,o.out||undefined);
    h.log(fmt(result));h.error('NOTE: statement is unsigned; signing happens on the isolated protected CI signer');
    return 0;
  }
  if(op==='verify'){
    invariant(o.statement&&o.signature&&o.key,'attest verify requires --statement --signature --key <absolute trusted pubkey>');
    const context=o.context?readJsonRel(h,root,o.context,'context'):{};
    const result=verifyAttestation(h,root,o.statement,o.signature,o.key,context);
    h.log(fmt(result));return 0;
  }
  throw Error('Usage: dairn attest prepare --bundle <p> --context <c.json> [--out <s.json>] | attest verify --statement <s> --signature <sig> --key <pub>');
}

/* 零仪式交接（§23）：只读派生视图，无需 .dairn/lock.json、无需 Work、默认零写盘。 */
function handoffCmd(h,o,root){
  const view=captureHandoff(h,root,{base:o.base||null,task:o.task||null,note:o.note||null,timeout:30});
  const maxChars=Math.max(500,Number(o.max_chars)||12000);
  // JSON 输出显式标记信任边界：handoff 是派生视图，不是 Evidence，不改变门禁结论。
  const report=o.json?{...view,advisory:true,evidence:false}:view;
  if(o.json)h.log(fmt(report));
  else{
    const rendered=renderHandoff(view,{maxChars});
    h.log(rendered.text.replace(/\n$/,''));
    if(rendered.truncated)h.error('NOTE: handoff output truncated to fit '+maxChars+' characters; core facts, sources and unknowns were kept');
  }
  if(o.out){
    const rel=String(o.out);
    const outPath=safeRelInside(h,root,rel);
    invariant(!file(h,outPath),'refuse to overwrite existing file: '+rel);
    invariant(!rel.startsWith('.dairn/governance/evidence/'),'refuse to write handoff into the evidence tree: '+rel);
    h.mkdirs(outPath.slice(0,outPath.lastIndexOf('/')));
    const content=o.json?fmt(report):renderHandoff(view,{maxChars}).text;
    h.writeExclusive(outPath,content);
    h.log('handoff written: '+rel+' (explicitly requested; advisory view, not evidence)');
  }
  return 0;
}

/* 治理计划（§5/§7）：确定性解释计划。Plan 描述待执行工作，不宣告门禁通过。 */
function governanceCmd(h,o,root){
  const op=o.pos[0]||'plan';
  if(op==='plan'||op==='explain'){
    invariant(o.base,'governance '+op+' requires --base <trusted-ref>');
    const {plan,plan_sha256}=planForChange(h,root,{base:o.base});
    if(op==='plan'){
      if(o.json)h.log(fmt({plan,plan_sha256}));
      else{
        h.log('governance plan: risk='+plan.classification.effective_risk+' mode='+(plan.classification.governance_mode||'?')+
          ' status='+plan.status);
        h.log('  subject: '+(plan.subject?plan.subject.source_commit.slice(0,12)+' (base '+(plan.subject.base_commit?plan.subject.base_commit.slice(0,12):'none')+')':'n/a'));
        for(const r of plan.requirements)h.log('  require '+r.id+' ['+r.origin+']');
        for(const e of plan.executors)h.log('  executor '+e.module_id+':'+e.check_id+' phase='+e.phase);
        h.log('  local-fast: '+(plan.execution.local_fast.join(', ')||'none')+'; ci-required: '+plan.execution.ci_required.length);
        h.log('  approvals: '+(plan.approvals.length?'scm-native natural person':'none'));
        h.log('  advisory: '+(plan.advisory_workflow.join(' > ')||'none')+'; work required: '+plan.work_required);
        for(const g of plan.gaps)h.error('GAP '+g.kind+' '+g.module_id+':'+g.check_id+' — '+g.reason);
        h.log('  plan_sha256: '+plan_sha256);
      }
      return plan.gaps.length?1:0;
    }
    /* explain：给接手者的解释链——为什么是这些要求、谁授权、缺什么。 */
    const lines=[];
    lines.push('Governance plan explanation (advisory; gates are evaluated independently)');
    lines.push('Change: '+plan.classification.effective_risk+' (floor '+plan.classification.risk_floor+')'+
      (plan.classification.governance_mode?' in '+plan.classification.governance_mode:''));
    for(const reason of plan.classification.reasons)
      lines.push('  because: '+reason.rule+' ['+reason.source+']');
    lines.push('Requirements come from the trusted policy for '+plan.classification.effective_risk+
      ' plus approved refactor contracts; module context can only add, never lower.');
    for(const r of plan.requirements)lines.push('  - '+r.id+' required by '+r.origin);
    for(const g of plan.gaps)lines.push('  - MISSING capability '+g.module_id+':'+g.check_id+' — CI must fail until an executor exists');
    lines.push('Local fast feedback ('+(plan.execution.local_fast.join(', ')||'none')+') is speed advice; CI required set is complete: '+plan.execution.ci_required.length+' items.');
    lines.push('Approvals: '+(plan.approvals.length?'SCM-native, natural person — granted by the platform, never by this plan':'not required at this risk level'));
    lines.push('No work ledger is required for any of this (work_required=false).');
    for(const line of lines)h.log(line);
    if(o.json)h.log(fmt({plan,plan_sha256}));
    return plan.gaps.length?1:0;
  }
  if(op==='assess'){
    /* 能力评估（§12）：declared/detected 分级，绝不自报 ci-verified。 */
    const policyJson=JSON.parse(read(h,j(root,'.dairn/governance/project.json')));
    const report=assessCapabilities(h,root,policyJson,{risk:o.risk||'L1'});
    report.discovery_timestamp=h.now();
    if(o.json)h.log(fmt(report));
    else{
      h.log('capability assessment (risk '+report.risk+'): declared='+report.summary.declared+
        ' detected='+report.summary.detected+' missing-tools='+report.summary.missing_tools+
        ' unconfigured='+report.summary.unconfigured);
      for(const m of report.modules)for(const c of m.checks)
        h.log('  '+m.name+':'+c.check_id+' '+c.status+(c.required?' [required]':''));
      for(const note of report.notes)h.log('  note: '+note);
      for(const g of report.gaps)h.error('GAP '+g.kind+' '+g.module+':'+g.check_id+' — '+g.reason);
    }
    return report.gaps.length?1:0;
  }
  if(op==='recommend'){
    /* 治理反馈（§15）：只给有证据的建议，绝不自动应用；样本不足如实说明。 */
    const days=Math.min(Math.max(Number(o.window)||90,1),365);
    const nowMs=Date.parse(h.now());
    invariant(Number.isFinite(nowMs),'cannot determine current time');
    const windowStart=new Date(nowMs-days*86400000).toISOString();
    const runs=collectRunHistory(h,root,{windowStart});
    const report=recommendAdaptations({runs,windowStart,windowEnd:h.now(),minSamples:10});
    if(o.json)h.log(fmt(report));
    else{
      h.log('governance feedback: '+report.status+' — '+runs.length+' runs in the last '+days+'d');
      for(const r of report.recommendations){
        h.log('  propose '+r.proposal+' ['+r.kind+'] observed '+JSON.stringify(r.observed));
        h.log('    action: '+r.proposed_action+' (preserves: '+r.requirements_preserved.join(', ')+'; requires approval)');
      }
      h.log('  note: '+report.note);
    }
    return 0;
  }
  throw Error('Usage: dairn governance plan|explain --base <ref> | governance assess [--risk L0|L1|L2] | governance recommend [--window 90d] [--json]');
}

/* 重构还债（§13）：可选跨 PR 契约、债务基线与阶段关闭；只追加保证，绝不降级。 */
function refactorCmd(h,o,root){
  const op=o.pos[0];
  if(op==='plan'){
    invariant(o.id&&o.file,'refactor plan requires --id <id> --file <contract.json> [--apply]');
    const contractPath=safeRelInside(h,root,o.file);
    const contract=validateRefactorContract(JSON.parse(read(h,contractPath)),o.file);
    invariant(contract.id===o.id,'--id must match the contract id: '+contract.id);
    const result=writeContract(h,root,contract,{apply:!!o.apply});
    h.log(fmt(result));
    return 0;
  }
  invariant(o.id,'refactor '+op+' requires --id <contract-id>');
  const {contract,rel}=locateContract(h,root,o.id);
  if(op==='status'){
    const runs=h.exists(j(root,'.dairn/governance/evidence/runs'))
      ? (h.list(j(root,'.dairn/governance/evidence/runs'))||[]).filter(x=>/^[0-9a-f]{40,64}$/i.test(x)).length : 0;
    h.log(fmt({schema:'dairn.refactor-status.v1',id:contract.id,intent:contract.intent,
      path:rel,baseline:contract.baseline,paths:contract.paths||null,
      known_failures:(contract.debt||{}).known_failures.length,
      exit_conditions:(contract.migration||{}).exit_conditions,
      local_run_commits:runs}));
    return 0;
  }
  const {run,rel:runRel}=locateRun(h,root,{runId:o.run||null});
  if(op==='compare'){
    const report=compareDebt(contract,run);
    report.run_path=runRel;
    if(o.json)h.log(fmt(report));
    else{
      h.log('refactor compare '+contract.id+': '+report.status+' (run '+report.run_id+')');
      for(const f of report.known_failures)h.log('  known debt: '+f.module+':'+f.check_id+' ('+f.status+')');
      for(const f of report.new_failures)h.error('NEW failure beyond baseline: '+f.module+':'+f.check_id+' ('+f.status+')');
      for(const f of report.signature_drift)h.error('SIGNATURE DRIFT: '+f.module+':'+f.check_id+' — the known failure changed shape');
      for(const f of report.retired_failures)h.log('  retired debt: '+(f.module?f.module+':':'')+f.check_id);
    }
    return report.status==='within-baseline'?0:1;
  }
  if(op==='verify'){
    const comparison=compareDebt(contract,run);
    const verdict=verifyExitConditions(contract,run,comparison);
    verdict.compare=comparison;
    if(o.json)h.log(fmt(verdict));
    else{
      h.log('refactor verify '+contract.id+': '+verdict.status);
      for(const c of verdict.checked)h.log('  checked '+c.condition+': '+c.status);
      for(const u of verdict.unverified)h.log('  unverified '+(u.condition||'(none)')+' — '+u.reason);
    }
    return verdict.status==='pass'?0:verdict.status==='fail'?1:3;
  }
  throw Error('Usage: dairn refactor plan --id <id> --file <contract.json> [--apply] | refactor compare|verify|status --id <id> [--run <run-id>] [--json]');
}

export function isProjectCommand(args){return ['init','adopt','detect','upgrade','docs','skills','guide','workflow','work','analyzers','analyze','context','quality','capability','stubs','doctor','version','--version','tasks','hooks','notes','evidence','gate','attest','approval','handoff','governance','refactor'].includes(args[0]);}
export function dispatch(h,args){
  try{
    if(args[0]==='stubs'){h.error('Dairn ERROR: unsupported legacy command "stubs"; it was replaced by "dairn analyzers" (breaking rename, no alias)');return 2;}
    const o=argsParse(args),root=o.root==='.'?h.cwd():o.root;
    if(o.cmd==='version'||o.cmd==='--version'){h.log('Dairn '+runtimeVersion(h)+' — Cosmopolitan QuickJS');return 0;}
    if(o.cmd==='init'||o.cmd==='adopt')return provision(h,o);
    if(o.cmd==='detect'){const r=checkedRoot(h,root,false);h.log(fmt(detect(h,r)));return 0;}
    if(o.cmd==='upgrade')return upgrade(h,o);
    if(o.cmd==='doctor')return doctor(h,checkedRoot(h,root,false));
    if(o.cmd==='docs')return docCmd(h,o);
    if(o.cmd==='tasks'){
      const tasksRoot=checkedRoot(h,root,false), op=o.pos[0]||'check';
      invariant(['check','ready'].includes(op),'Usage: dairn tasks check [--strict] [--json] | dairn tasks ready [--json]');
      if(op==='ready'){
        const report=tasksReady(h,tasksRoot);
        if(o.json){h.log(fmt(report));}
        else {
          h.log('tasks: ready '+report.ready.length+', blocked '+report.blocked.length+(report.errors.length?', errors '+report.errors.length:''));
          for(const item of report.ready)h.log('READY '+item);
          for(const item of report.blocked)h.log('BLOCKED '+item.id+' waiting_on '+item.waiting_on.join(','));
        }
        for(const error of report.errors)h.error('ERROR: '+error);
        return report.errors.length?2:0;
      }
      const report=tasksReport(h,tasksRoot,{strict:!!o.strict});
      if(o.json)h.log(fmt(report));
      else {
        h.log('tasks: '+report.tasks+'; ready: '+report.ready.length+'; errors: '+report.errors.length+'; warnings: '+report.warnings.length);
        for(const error of report.errors)h.log('ERROR '+error);
        for(const warning of report.warnings)h.log('WARN '+warning);
        h.log(report.errors.length?'FAIL':'PASS');
      }
      return report.errors.length?2:0;
    }
    if(o.cmd==='hooks'){
      const hooksRoot=checkedRoot(h,root,false);verifyRuntimeLock(h,hooksRoot,true);
      invariant((o.pos[0]||'install')==='install','Usage: dairn hooks install [--apply] [--git] [--force] [--launcher PATH]');
      h.log(fmt(installHooks(h,hooksRoot,{apply:!!o.apply,git:!!o.git,force:!!o.force,launcher:o.launcher})));
      return 0;
    }
    if(o.cmd==='notes'){
      const notesRoot=checkedRoot(h,root,false);verifyRuntimeLock(h,notesRoot,true);
      invariant(o.pos[0]==='seal','Usage: dairn notes seal [--apply]');
      h.log(fmt(sealArchive(h,notesRoot,{apply:!!o.apply})));
      return 0;
    }
    if(o.cmd==='workflow'){
      if(o.pos[0]==='stages'){h.log(fmt(workflowStageList()));return 0;}
      invariant(o.pos[0]==='recommend'&&o.pos.length>1,'Usage: dairn workflow stages | workflow recommend <task description>');
      h.log(fmt(recommendWorkflow(o.pos.slice(1).join(' '))));return 0;
    }
    if(o.cmd==='work'){const r=checkedRoot(h,root,false);verifyRuntimeLock(h,r,true);return runWork(h,r,o);}
    if(o.cmd==='evidence'){const r=checkedRoot(h,root,false);return evidenceCmd(h,o,r);}
    if(o.cmd==='gate'){const r=checkedRoot(h,root,false);return gateCmd(h,o,r);}
    if(o.cmd==='attest'){const r=checkedRoot(h,root,false);return attestCmd(h,o,r);}
    if(o.cmd==='approval'){const r=checkedRoot(h,root,false);return approvalCmd(h,o,r);}
    if(o.cmd==='handoff'){const r=checkedRoot(h,root,false);return handoffCmd(h,o,r);}
    if(o.cmd==='governance'){const r=checkedRoot(h,root,false);return governanceCmd(h,o,r);}
    if(o.cmd==='refactor'){const r=checkedRoot(h,root,false);return refactorCmd(h,o,r);}
    if(o.cmd==='analyzers'){
      const rr=checkedRoot(h,root,false);verifyRuntimeLock(h,rr,true);
      const op=o.pos[0]||'list';
      if(op==='templates'){h.log(fmt(analyzerTemplates()));return 0;}
      if(op==='init'){h.log(fmt(analyzerInit(h,rr,{template:o.template||'go',id:o.id||'surface',apply:!!o.apply})));return 0;}
      if(op==='doctor'){const report=analyzerDoctor(h,rr);h.log(fmt(report));return report.ready?0:2;}
      invariant(op==='list','Usage: analyzers [list|templates|doctor|init --template LANGUAGE --id NAME [--apply]]');
      h.log(fmt({schema:1,configured:configuredAnalyzers(h,rr).analyzers.map(s=>((s.mode||'execute')==='import')?{id:s.id,domain:s.domain,mode:'import',report:{path:s.report.path,format:s.report.format}}:{id:s.id,domain:s.domain,mode:'execute',argv:s.execution.argv,cwd:s.execution.cwd||'.'}),suites:configuredAnalyzers(h,rr).suites.map(x=>({id:x.id,analyzers:x.analyzers}))}));return 0;
    }
    if(o.cmd==='quality'){
      const rr=checkedRoot(h,root,false);verifyRuntimeLock(h,rr,true);
      invariant((o.pos[0]||'fitness')==='fitness','Usage: dairn quality fitness [--json]');
      const goalsDoc=loadQualityGoals(h,rr,p=>{const f=j(rr,p);return h.exists(f)&&!h.isDirectory(f)&&!h.isSymlink(f)?h.read(f):null;});
      if(!goalsDoc){
        h.log(fmt({schema:'dairn.quality-fitness.v1',status:'NO-GOALS',results:[],
          note:'no .dairn/governance/quality-goals.json configured; nothing is enforced or claimed'}));
        return 0;
      }
      const registry=configuredAnalyzers(h,rr);
      const producers=[...new Set(goalsDoc.objectives.map(g=>g.producer).filter(Boolean))];
      const runs=[];
      for(const id of producers){
        const def=registry.analyzers.find(x=>x.id===id);
        if(!def){runs.push({analyzer_id:id,status:'not-run',error:'producer not configured'});continue;}
        runs.push(runAnalysisTarget(h,rr,def,o.base||null));
      }
      const observations=runs.map(r=>r.observation).filter(x=>x&&x.schema==='dairn.quality-observation.v1');
      const verdict=evaluateFitness(goalsDoc,observations);
      if(o.json)h.log(fmt({...verdict,runs:runs.map(r=>({analyzer_id:r.analyzer_id,status:r.status}))}));
      else{
        h.log('quality fitness: '+verdict.status);
        for(const r of verdict.results)h.log('  '+r.objective_id+' ['+r.enforcement+'] '+r.status+(r.value!==undefined&&r.value!==null?' value='+r.value:'')+(r.reason?' — '+r.reason:''));
        h.log('  note: '+verdict.note);
      }
      return verdict.status==='FAIL'?1:verdict.status==='UNKNOWN'?3:0;
    }
    if(o.cmd==='capability'){
      const rr=checkedRoot(h,root,false);verifyRuntimeLock(h,rr,true);
      invariant((o.pos[0]||'plan')==='plan','Usage: dairn capability plan [--base <ref>] [--json]');
      let subject=null,changePaths=[],gitNote=null;
      try{
        const head=h.run(['git','rev-parse','--verify','HEAD^{commit}'],rr,15);
        if(head.code===0&&!head.timedOut){
          subject=head.output.trim();
          if(o.base){
            const b=h.run(['git','rev-parse','--verify',o.base+'^{commit}'],rr,15);
            if(b.code===0&&!b.timedOut)changePaths=h.run(['git','diff','--name-only',b.output.trim(),head.output.trim()],rr,20).output.split('\n').filter(Boolean).slice(0,200);
          }
        }else{gitNote='git HEAD unavailable: change paths unknown; plan degrades to goals-only';}
      }catch(_){gitNote='git unavailable: change paths unknown; plan degrades to goals-only';}
      const registry=configuredAnalyzers(h,rr);
      const skills=discoverCapabilities(h,rr,(kind,rel)=>{const f=j(rr,'.agents/skills/'+rel);return h.exists(f)&&!h.isDirectory(f)&&!h.isSymlink(f)?h.read(f):null;});
      const goalsDoc=loadQualityGoals(h,rr,p=>{const f=j(rr,p);return h.exists(f)&&!h.isDirectory(f)&&!h.isSymlink(f)?h.read(f):null;});
      const planDoc=buildParticipationPlan({subject,goalsDoc,registry,plan:{change_paths:changePaths},gitNote,skills:skills.skills});
      if(o.json)h.log(fmt(planDoc));
      else{
        h.log('capability plan: '+planDoc.needs.length+' needs, '+planDoc.gaps.length+' gaps');
        for(const n of planDoc.needs)h.log('  NEED '+n.capability+(n.provider?' -> '+n.provider:'')+' — '+n.reason);
        for(const g of planDoc.gaps)h.log('  GAP '+g.capability+' — '+g.gap);
      }
      return planDoc.gaps.length?3:0;
    }
    if(o.cmd==='analyze'){
      const rr=checkedRoot(h,root,false);verifyRuntimeLock(h,rr,true);
      if(o.pos[0]==='plan'){
        const lock=lockRead(h,rr,true);
        const plan=buildAnalyzerPlan(h,rr,{config:lock.config,base:o.base||null,task:o.task||null,capability:o.capability||null,apply:!!o.apply});
        if(o.json)h.log(fmt(plan));else h.log(renderPlan(plan));
        if(o.out){
          const rel=String(o.out);const outPath=safeRelInside(h,rr,rel);
          invariant(!file(h,outPath),'refuse to overwrite existing file: '+rel);
          h.mkdirs(outPath.slice(0,outPath.lastIndexOf('/')));
          h.writeExclusive(outPath,fmt(plan)+'\n');
          if(!o.json)h.log('analyzer plan written: '+rel+' (advisory selection, not a gate verdict)');
        }
        return plan.status==='ready'?0:3;
      }
      invariant(o.pos[0]==='run'||o.pos[0]==='import','Usage: dairn analyze run <analyzer-id> | --suite <suite-id> [--base <ref>] | analyze plan [--base <ref>] [--task TEXT] [--capability CAP] [--apply] [--json] | analyze import <analyzer-id> [--artifact PATH] [--json] [--out PATH]');
      if(o.pos[0]==='import'){
        const id=o.pos[1];
        invariant(id&&/^[a-z][a-z0-9-]{1,48}$/.test(id),'analyze import requires an analyzer id');
        const run=importAnalysisReport(h,rr,id,{artifact:o.artifact||null});
        if(o.json||o.out)h.log(fmt(run));
        else h.log('analyze import '+id+': '+run.status+' ('+(run.observation?.findings?.length||0)+' findings) — '+run.imported_artifact.path+' — run '+run.run_id);
        if(o.out){
          const rel=String(o.out);const outPath=safeRelInside(h,rr,rel);
          invariant(!file(h,outPath),'refuse to overwrite existing file: '+rel);
          h.mkdirs(outPath.slice(0,outPath.lastIndexOf('/')));
          h.writeExclusive(outPath,fmt(run)+'\n');
          if(!o.json)h.log('analysis import written: '+rel+' (unverified observation, not evidence)');
        }
        return 0;
      }
      const registry=configuredAnalyzers(h,rr);
      let targets;
      if(o.suite!==undefined&&o.suite!==null){targets=resolveAnalysisSuite(registry,{suite:o.suite});}
      else{
        const id=o.pos[1];
        invariant(id&&/^[a-z][a-z0-9-]{1,48}$/.test(id),'Usage: dairn analyze run <analyzer-id> | --suite <suite-id>');
        const def=registry.analyzers.find(x=>x.id===id);
        invariant(def,'unconfigured analyzer '+id);
        targets=[def];
      }
      // 串行执行（默认只读，避免未声明写入冲突）；失败记录为对应 status，不中断其他 analyzer。
      const runs=targets.map(def=>runAnalysisTarget(h,rr,def,o.base||null));
      const summary={schema:1,command:'analyze run',analyzer_count:runs.length,
        completed:runs.filter(x=>x.status==='completed').length,
        statuses:runs.map(x=>({analyzer_id:x.analyzer_id,status:x.status}))};
      if(o.json||o.out){h.log(fmt({summary,runs}));}
      else{
        for(const x of runs)h.log('analyze '+x.analyzer_id+': '+x.status+(x.from_cache?' (cache)':'')+' — run '+x.run_id+(x.error?' — '+x.error:''));
        h.log(fmt(summary));
      }
      if(o.out){
        const rel=String(o.out);const outPath=safeRelInside(h,rr,rel);
        invariant(!file(h,outPath),'refuse to overwrite existing file: '+rel);
        invariant(!rel.startsWith('.dairn/governance/'),'refuse to write analysis runs into the governance evidence tree: '+rel);
        h.mkdirs(outPath.slice(0,outPath.lastIndexOf('/')));
        h.writeExclusive(outPath,fmt({summary,runs})+'\n');
        if(!o.json)h.log('analysis runs written: '+rel+' (advisory observation, not evidence)');
      }
      const failed=runs.filter(x=>x.status!=='completed');
      return failed.length?2:0;
    }
    if(o.cmd==='context'){
      const rr=checkedRoot(h,root,false);
      const lock=lockRead(h,rr,true);
      let limit=null;
      if(o.limit!==undefined){
        const parsed=Number(o.limit);
        invariant(Number.isInteger(parsed)&&parsed>=1&&parsed<=MAX_LIMIT,'--limit must be an integer between 1 and '+MAX_LIMIT);
        limit=parsed;
      }
      const pack=buildContextPack(h,rr,{config:lock.config,query:o.pos.join(' '),base:o.base||null,change:!!o.change,focus:o.for||null,limit});
      if(o.json)h.log(fmt(pack));else h.log(renderContextPack(pack));
      if(o.out){
        const rel=String(o.out);const outPath=safeRelInside(h,rr,rel);
        invariant(!file(h,outPath),'refuse to overwrite existing file: '+rel);
        invariant(!rel.startsWith('.dairn/governance/'),'refuse to write context packs into the governance evidence tree: '+rel);
        h.mkdirs(outPath.slice(0,outPath.lastIndexOf('/')));
        h.writeExclusive(outPath,fmt(pack)+'\n');
        if(!o.json)h.log('context pack written: '+rel+' (heuristic assembly, not evidence)');
      }
      return pack.status==='empty'?1:0;
    }
    if(o.cmd==='guide')return guidance(h,checkedRoot(h,root,false),o.pos[0]||'plan',{strict:!!o.strict,apply:!!o.apply,base:o.base||null,analyzer:o.analyzer||null,templates:{readme:c=>projectReadme(templateReader(h),c),guide:c=>projectGuide(templateReader(h),c)},verify:()=>verifyRuntimeLock(h,checkedRoot(h,root,false),true)});
    if(o.cmd==='skills'){
      if(o.pos[0]==='catalog'){
        const m=assetIndex(h);for(const s of m.assets.filter(x=>x.type==='skills'&&x.path.endsWith('/SKILL.md')))h.log(s.path.split('/')[0]);return 0;
      }
      if(o.pos[0]==='add')return addSkill(h,o);
      if(o.pos[0]==='list') {const r=checkedRoot(h,root,false),d=j(r,'.agents/skills');h.log(fmt(h.exists(d)?h.list(d).sort():[]));return 0;}
      throw Error('Usage: dairn skills catalog | skills list | skills add <name> [--apply]');
    }
    return doctor(h,checkedRoot(h,root,false));
  }catch(e){
    if(e&&e.exitCode===4){h.error(String(e.message||e));return 4;}
    h.error('Dairn ERROR: '+(e?.message||e));return 2;
  }
}
export {doctor};
