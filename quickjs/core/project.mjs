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
import {LAUNCHER_POSIX,LAUNCHER_WINDOWS,LAUNCHER_CONFIG,RUNTIME_DIR,launcherScripts,defaultLauncherConfig,readLauncherConfig,launcherInfo,vendorRuntime,verifyLauncher} from './launcher.mjs';
import {configuredAnalyzers,analyzerInit,analyzerDoctor,analyzerTemplates,resolveAnalysisSuite} from './analyzers.mjs';
import {executeAnalyzer,importAnalysisReport} from './analyzer-runner.mjs';
import {loadQualityGoals} from './quality-goals.mjs';
import {evaluateFitness} from './quality-fitness.mjs';
import {discoverCapabilities,buildParticipationPlan} from './capability-registry.mjs';
import {configuredAnalyzers as _cfgAnalyzers} from './analyzers.mjs';
import {captureFacts,acceptFacts,factSnapshotPath} from './facts.mjs';
/* Dairn QuickJS 项目生命周期与分发层；写入前规划全部项目变更。 */
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
const VALUE_OPTIONS=['--root','--path','--name','--stack','--module','--modules','--ci','--base','--timeout','--id','--kind','--analyzer','--suite','--artifact','--template','--session','--provider','--payload','--event','--reason','--launcher','--vendor-runtime','--actor','--run','--evidence','--bundle','--subject','--policy','--context','--check','--approval','--attestation','--statement','--signature','--key','--out','--stage','--risk','--snapshot','--origin','--task','--note','--max-chars','--window','--file'];
const FLAG_OPTIONS={'--plan':'plan','--dry-run':'plan','--discover':'discover','--apply':'apply','--diff':'diff','--sample':'sample','--all':'all','--json':'json','--strict':'strict','--refresh':'refresh','--require-machine-gates':'require_machine_gates','--require-session-anchor':'require_session_anchor','--require-review-actor':'require_review_actor','--stdin':'stdin','--no-check':'no_check','--force':'force','--git':'git','--allow-unattributed':'allow_unattributed'};
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
  if(stack==='go')return {lint:step(['dairn','stack-check','go','lint']),unit:step(['go','test','./...']),integration:step(['go','test','-race','./...']),build:step(['go','build','./...'])};
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
function navigation(){return BEGIN+'\nDairn — AI-Native Software Engineering Toolkit.\n'+
  'Project launcher: `./.dairn/bin/dairn` (Windows: `.dairn\\bin\\dairn.cmd`); `dairn` below is shorthand for this launcher. Never install Dairn during a task; if the launcher is missing, stop and report.\n'+
  'Run `dairn doctor`, `dairn validate`, or `dairn check --base <trusted-ref>` before PR/MR.\n'+
  'Discover shared guidance with `dairn docs find <topic>`; additional Skills via `dairn skills add <name> --apply`.\n'+
  'Project governance policy: `.dairn/governance/project.json`; decisions: `.agents/notes/`.\n'+
  'Project-specific context: `README.md` and `docs/PROJECT_GUIDE.md`; run `dairn guide plan` to enrich with observed facts.\n'+
  'For task continuity use `dairn work start <task> --id <id>` and `dairn work next --id <id>`; inspect impact using `dairn guide impact`.\n'+
  'Task slices: `dairn tasks check` / `dairn tasks ready`; release asset consistency: `dairn docs check`; local hooks: `dairn hooks install --apply`.\n'+
  'For language-specific analysis run `dairn analyzers templates` then `dairn analyzers init --template LANGUAGE --id NAME --apply` and `dairn guide impact --analyzer <analyzer-id>`.\n'+
  'AI Agents call Dairn; Dairn does not invoke a model. Codex and DeepSeek Harness use AGENTS.md; Claude Code follows CLAUDE.md.\n'+END;}
function ciTemplate(provider){
  if(provider==='github')return `name: Dairn governance quality gate
on: [pull_request]
permissions:
  contents: read
jobs:
  dairn:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      # CI administrators provision a trusted Dairn launcher/runtime via DAIRN_CI_BIN.
      - name: Validate and check
        env:
          DAIRN_EXPECTED_POLICY_SHA256: \${{ vars.DAIRN_EXPECTED_POLICY_SHA256 }}
          BASE_SHA: \${{ github.event.pull_request.base.sha }}
          DAIRN_ENFORCE_DOC_DRIFT: \${{ vars.DAIRN_ENFORCE_DOC_DRIFT }}
          DAIRN_CI_BIN: \${{ vars.DAIRN_CI_BIN }}
        run: |
          test -n "$DAIRN_EXPECTED_POLICY_SHA256" && test -n "$BASE_SHA"
          DAIRN_BIN_VALUE="\${DAIRN_CI_BIN:-./.dairn/bin/dairn}"
          sh "$DAIRN_BIN_VALUE" guide drift --base "$BASE_SHA"
          sh "$DAIRN_BIN_VALUE" guide impact --base "$BASE_SHA"
          if [ "\${DAIRN_ENFORCE_DOC_DRIFT:-false}" = "true" ]; then sh "$DAIRN_BIN_VALUE" guide drift --base "$BASE_SHA" --strict; fi
          sh "$DAIRN_BIN_VALUE" validate --base "$BASE_SHA"
          sh "$DAIRN_BIN_VALUE" check --base "$BASE_SHA"
`;
  return `stages: [quality]
variables:
  GIT_DEPTH: "0"
dairn:quality:
  stage: quality
  script:
    - test -n "$DAIRN_EXPECTED_POLICY_SHA256" && test -n "$CI_MERGE_REQUEST_DIFF_BASE_SHA"
    - DAIRN_BIN_VALUE="\${DAIRN_CI_BIN:-./.dairn/bin/dairn}"
    - sh "$DAIRN_BIN_VALUE" guide drift --base "$CI_MERGE_REQUEST_DIFF_BASE_SHA"
    - sh "$DAIRN_BIN_VALUE" guide impact --base "$CI_MERGE_REQUEST_DIFF_BASE_SHA"
    - if [ "\${DAIRN_ENFORCE_DOC_DRIFT:-false}" = "true" ]; then sh "$DAIRN_BIN_VALUE" guide drift --base "$CI_MERGE_REQUEST_DIFF_BASE_SHA" --strict; fi
    - sh "$DAIRN_BIN_VALUE" validate --base "$CI_MERGE_REQUEST_DIFF_BASE_SHA"
    - sh "$DAIRN_BIN_VALUE" check --base "$CI_MERGE_REQUEST_DIFF_BASE_SHA"
  artifacts:
    when: always
    paths: [.dairn/governance/evidence/]
`;
}
function projectReadme(config){
  const profile=config.modules.map(m=>'- `'+m.path+'` — '+m.profiles.join(', ')).join('\n');
  return '# '+config.name+'\n\n'+
    '> TODO: Describe the product purpose, its users, and primary behavior using verified project information.\n\n'+
    '## Modules\n\n'+profile+'\n\n'+
    '## Development\n\n'+
    'Run `dairn doctor` to inspect the configured toolchains and `dairn check --all` for a full technical baseline.\n'+
    'For an existing Git repository, use `dairn check --base <trusted-ref>` for change-scoped checks.\n\n'+
    '## Documentation\n\n'+
    '- [Project guide](docs/PROJECT_GUIDE.md) — architecture, verification and project-specific constraints.\n'+
    '- [Governance entry](docs/GOVERNANCE_SPEC.md) — rules and specification discovery.\n'+
    '- `AGENTS.md` — concise instructions for AI-assisted changes.\n\n'+
    '## Status\n\n'+
    'This README was scaffolded, not inferred from an architecture review. Replace the TODO only after examining the actual code and decisions.\n';
}
function projectGuide(config){
  const lines=config.modules.map(m=>{
    const checks=Object.entries(m.checks||{}).map(([kind,x])=>
      '  - '+kind+': `'+x.argv.join(' ')+'` (cwd: `'+x.cwd+'`)').join('\n');
    return '- **'+m.name+'** (`'+m.path+'`; '+m.profiles.join(', ')+')\n'+checks;
  }).join('\n');
  return '# Project Guide — '+config.name+'\n\n'+
    '> This is a project-owned document: Dairn creates it only when missing and does not lock or overwrite its content.\n'+
    '> TODO fields are unknowns, not verified facts. The `dairn-project-guidance` Skill should research and refine them.\n\n'+
    '## Context and Boundaries\n\n'+
    'TODO: Confirm product goals, users, upstream/downstream systems, and non-goals from code and existing documentation.\n\n'+
    '## Architecture\n\n'+
    'TODO: Record actual components, module responsibilities, data flows and significant constraints; cite the source paths.\n\n'+
    '## Development and Testing\n\n'+
    'The following are **configured commands, not claims of successful execution**:\n\n'+lines+'\n\n'+
    'TODO: Confirm prerequisites, real test commands and environment-specific dependencies by running them.\n\n'+
    '## Security and Operational Boundaries\n\n'+
    'TODO: Document actual secret handling, trust boundaries, observability and recovery assumptions; do not infer protections.\n\n'+
    '## Decisions and Specifications\n\n'+
    'Dairn governance entry: [GOVERNANCE_SPEC.md](GOVERNANCE_SPEC.md).\n\n'+
    'Use `.agents/notes/` for significant decisions. Use `dairn docs find <topic>` for shared Dairn specifications.\n'+
    'Create project-specific `docs/specs/` topic documents only when a real, stable contract needs a source of truth.\n\n'+
    '## Known Unknowns\n\n'+
    '- TODO: Verify unresolved assumptions and missing documentation, then remove this checklist as facts are established.\n';
}
function makeDesired(h,root,config,prior){
  const m=assetIndex(h), entries={};
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
    if(!file(h,j(root,'CLAUDE.md')))entries['CLAUDE.md']='# Claude Code\n\nSee [AGENTS.md](AGENTS.md) for the authoritative, provider-neutral Dairn instructions.\nUse the project launcher `./.dairn/bin/dairn` (Windows: `.dairn\\bin\\dairn.cmd`) instead of a globally installed `dairn`; do not install Dairn, and use the `dairn-agent-workflow` Skill in `.agents/skills/` for deterministic checks.\n';
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
    if(!file(h,j(root,'README.md')))entries['README.md']=projectReadme(config);
    if(!file(h,j(root,'docs/PROJECT_GUIDE.md')))entries['docs/PROJECT_GUIDE.md']=projectGuide(config);
  }
  // .dairn/cache 与 .dairn/tmp 是临时目录（.gitignore 整目录忽略），
  // 不生成受管 marker：否则 fresh clone 缺少这些文件会让 verifyRuntimeLock 失败。
  entries['docs/GOVERNANCE_SPEC.md']='# Dairn\n\nAI-Native Software Engineering Toolkit.\n\n'+
    'Project policy: `.dairn/governance/project.json`; authoritative reference specs: `dairn docs find <topic>`.\n';
  entries['.dairn/Makefile']='.PHONY: doctor validate check\nDAIRN ?= ./.dairn/bin/dairn\ndoctor:\n\t@$(DAIRN) doctor\nvalidate:\n\t@$(DAIRN) validate\ncheck:\n\t@$(DAIRN) check\n';
  // 项目内 launcher 是受管入口；launcher.json 是项目自有配置（见 planFor 排除列表）。
  const launchers=launcherScripts();
  entries[LAUNCHER_POSIX]=launchers.posix;
  entries[LAUNCHER_WINDOWS]=launchers.windows;
  entries['.dairn/.gitattributes']='bin/dairn text eol=lf\nbin/dairn.cmd text eol=crlf\nruntime/*.com binary\nruntime/runtime-integrity.json text eol=lf\n';
  if(!prior||!file(h,j(root,LAUNCHER_CONFIG)))entries[LAUNCHER_CONFIG]=fmt(defaultLauncherConfig(runtimeVersion(h)));
  if(['github','both'].includes(config.ci))entries['.github/workflows/dairn.yml']=ciTemplate('github');
  if(['gitlab','both'].includes(config.ci))entries['.gitlab-ci.yml']=ciTemplate('gitlab');
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
  let generated='# Agent instructions\n\n'+navigation()+'\n';
  if(prior!==null){generated=block?prior.slice(0,block.a)+navigation()+prior.slice(block.b):prior+(prior.endsWith('\n')?'':'\n')+'\n'+navigation()+'\n';}
  full['AGENTS.md']=generated;
  for(const [rel,content] of Object.entries(full).sort(([a],[b])=>a.localeCompare(b))){
    const path=j(root,rel);relative(rel);
    let unsafe=false;let cur=root;
    for(const component of rel.split('/')){cur=j(cur,component);if(h.isSymlink(cur)){unsafe=true;break;}}
    const old=file(h,path)?read(h,path):null;
    let status;
    if(rel==='AGENTS.md'){
      status=unsafe?'conflict':(block && (!before[rel]||sha256(block.raw)!==before[rel]))?'conflict':old===content?'unchanged':old===null?'create':'update';
      next[rel]=sha256(navigation());
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
  const retired=Object.keys(before).filter(rel=>!(rel in full));
  invariant(retired.length===0,'Managed assets no longer in this Dairn release: '+retired.join(', ')+'. Manual review required.');
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
  if(file(h,configPath)){const config=readLauncherConfig(h,root);return {mode:config.mode,runtime:config.runtime};}
  return {mode:'external',runtime:null};
}
/* apply 后的项目自有 launcher 配置与执行位；managed launcher 文件由 makeDesired 写入。 */
function ensureLauncher(h,root,o,vendorConfig=null){
  const configPath=j(root,LAUNCHER_CONFIG);
  let config=vendorConfig;
  if(!config&&!file(h,configPath))config=defaultLauncherConfig(runtimeVersion(h));
  if(config){
    invariant(!h.isSymlink(configPath),'Refuse symlinked launcher config: '+LAUNCHER_CONFIG);
    h.mkdirs(configPath.slice(0,configPath.lastIndexOf('/')));
    const tmp=configPath+'.dairn-tmp-'+Date.now();
    try{h.write(tmp,fmt(config));h.rename(tmp,configPath);}finally{if(h.exists(tmp))h.remove(tmp);}
  }
  const launcherPath=j(root,LAUNCHER_POSIX);
  if(file(h,launcherPath)&&!h.isSymlink(launcherPath)){
    try{h.chmod(launcherPath,0o755);}catch(e){h.log('WARN: cannot make launcher executable: '+(e&&e.message||e));}
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
  dirs.push(j(root,'.dairn/bin'));
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
  h.mkdirs(j(root,'.dairn/bin'));
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
export function verifyRuntimeLock(h,root,required=false){
  const lock=lockRead(h,root,required);if(!lock)return null;
  invariant(lock.version===runtimeVersion(h),'Runtime version differs from project lock; run dairn upgrade --plan');
  invariant(lock.runtime_sha256===runtimeIdentity(h),'Runtime assets differ from project lock; run dairn upgrade --plan');
  for(const [rel,expected] of Object.entries(lock.managed||{})){
    const path=j(root,rel);invariant(file(h,path),'Missing managed file: '+rel);
    const original=read(h,path);const block=rel==='AGENTS.md'?managedBlock(original):null;
    // 受管文本在 autocrlf=true 的 Windows checkout 上可能被转成 CRLF；
    // 除有意使用 CRLF 的 .cmd 外，哈希前统一换行，避免“看起来被编辑”。
    const normalize=text=>rel.endsWith('.cmd')?text:String(text).replace(/\r\n/g,'\n');
    const actual=rel==='AGENTS.md'?(block?sha256(normalize(block.raw)):''):sha256(normalize(original));
    invariant(actual===expected,'Managed resource was edited: '+rel+' (use upgrade plan; restore controlled content)');
  }
  return lock;
}
function nameValid(value){invariant(/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(value),'Project name must be letters, digits, - or _ and start with letter');return value;}
function provision(h,o){
  const path=o.root==='.'?h.cwd():o.root;
  if(o.cmd==='init'&&h.exists(path)&&h.isDirectory(path)&&h.list(path).length)throw Error('Nonempty directory: use dairn adopt');
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
  // Validate an explicitly requested vendored runtime BEFORE the first write (fail closed).
  const vendorConfig=launcherConfigFor(h,evaluationRoot,o);
  const lock={schema:2,version:runtimeVersion(h),runtime_sha256:runtimeIdentity(h),config,managed:plan.managed};
  apply(h,evaluationRoot,plan,lock);layout(h,evaluationRoot);
  ensureLauncher(h,evaluationRoot,o,vendorConfig);
  // Baseline only fresh initialized projects AFTER generated code and manifests exist.
  // Adopted projects must review and accept observed facts themselves.
  if(o.cmd==='init'&&!h.exists(factSnapshotPath(evaluationRoot)))acceptFacts(h,evaluationRoot,captureFacts(h,evaluationRoot,config));
  h.log('Dairn '+runtimeVersion(h)+' '+o.cmd+' 完成：'+config.modules.length+' 个模块，'+plan.actions.length+' 项资源。');
  h.log('Launcher: '+LAUNCHER_POSIX+' (Windows: '+LAUNCHER_WINDOWS+')'+(vendorConfig?' — vendored runtime registered':' — external runtime resolution'));
  h.log('Next: dairn guide plan; dairn work start <task> --id <id>; dairn hooks install --apply; dairn doctor; dairn check --all');
  h.log('Offline runtime: put the official APE + runtime-integrity.json in .dairn/runtime, then run dairn upgrade --vendor-runtime .dairn/runtime --apply (adopt also accepts --vendor-runtime)');return 0;
}
function upgrade(h,o){
  const root=checkedRoot(h,o.root==='.'?h.cwd():o.root,false), lock=lockRead(h,root,true);
  const config={...lock.config,sample:false};const plan=planFor(h,root,makeDesired(h,root,config,lock),lock);
  preflightLayout(h,root);
  const installed=runtimeVersion(h);
  let existingLauncher=null;
  try{existingLauncher=readLauncherConfig(h,root);}catch(_){existingLauncher=null;}
  const staleVendored=!!(existingLauncher&&existingLauncher.mode==='vendored'&&!o.vendor_runtime&&
    existingLauncher.runtime&&existingLauncher.runtime.version&&existingLauncher.runtime.version!==installed);
  if(staleVendored){
    const message='Project launcher vendors Dairn '+existingLauncher.runtime.version+' but this CLI is '+installed+
      '; replace .dairn/runtime with the matching release and run dairn upgrade --vendor-runtime .dairn/runtime --apply';
    if(o.apply)throw Error(message);
    h.error('WARNING: '+message);
  }
  const next={schema:2,version:installed,runtime_sha256:runtimeIdentity(h),config,managed:plan.managed};
  // A requested vendored runtime must validate before any managed file is written.
  const vendorConfig=o.vendor_runtime&&o.apply?launcherConfigFor(h,root,o):null;
  h.log(fmt({mode:o.apply?'apply':'plan',installed:runtimeVersion(h),recorded:lock.version,actions:plan.actions.filter(x=>o.diff||x.status!=='unchanged'),launcher:launcherSummary(h,root,o,vendorConfig)}));
  if(o.diff){for(const a of plan.actions.filter(x=>x.status==='update'))h.log('~ '+a.path+' (managed content changed; diff with git for exact lines)');}
  if(!o.apply)return plan.actions.some(x=>x.status==='conflict')?2:0;
  apply(h,root,plan,next);layout(h,root);ensureLauncher(h,root,o,vendorConfig);
  h.log('Upgrade applied; project-owned policy, Notes and launcher.json are preserved unless --vendor-runtime was given.');return 0;
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
  const docs=specIndex(h);
  if(action==='find'){
    invariant(q,'docs find <query>');
    const hits=docs.filter(x=>x.id&&(x.id.toLowerCase().includes(q)||x.path.toLowerCase().includes(q)||x.text.toLowerCase().includes(q)));
    for(const hit of hits.slice(0,30))h.log(hit.id+'\t'+hit.path);
    return hits.length?0:1;
  }
  if(action==='show'||action==='context'){
    invariant(q,'docs show <id>');
    const doc=docs.find(x=>x.id&&x.id.toLowerCase()===q);
    invariant(!!doc,'Unknown spec id: '+q);
    const truncated=doc.text.length>8000;
    h.log(action==='context'?(truncated?doc.text.slice(0,8000)+'\n\n[truncated at 8000 characters; use dairn docs show '+doc.id+' for the full authoritative text]':doc.text):doc.text);
    return 0;
  }
  throw Error('Usage: dairn docs find <topic> | docs show <spec-id> | docs context <spec-id> | docs check [--json]');
}
function doctor(h,root){
  const lock=verifyRuntimeLock(h,root,true);const cfg=JSON.parse(read(h,j(root,'.dairn/governance/project.json')));
  const problems=policyValidate(cfg),modules=cfg.modules.map(m=>({name:m.name,path:m.path,checks:Object.keys(m.checks)}));
  const launcherCheck=verifyLauncher(h,root);
  for(const problem of launcherCheck.problems)problems.push(problem);
  let launcher=launcherCheck.info;
  if(!launcher){try{launcher=launcherInfo(h,root);}catch(_){launcher=null;}}
  if(!launcher)launcher={resolved:LAUNCHER_POSIX,windows:LAUNCHER_WINDOWS,mode:'external',invocation:'./'+LAUNCHER_POSIX,windows_invocation:LAUNCHER_WINDOWS.replace(/\//g,'\\'),runtime:null};
  if(launcher.mode==='vendored'&&launcher.runtime&&launcher.runtime.version&&launcher.runtime.version!==lock.version){
    problems.push('vendored launcher runtime is '+launcher.runtime.version+' but project lock is '+lock.version+'; run dairn upgrade --vendor-runtime .dairn/runtime --apply');
  }
  const candidates=[['git','--version']];
  for(const m of cfg.modules)for(const stack of m.profiles){
    const tool=({go:['go','version'],rust:['cargo','--version'],python:['python','--version'],vue:['node','--version'],
      java:['java','-version'],'spring-boot':['java','-version'],openresty:['openresty','-v']})[stack];
    if(tool)candidates.push(tool);
  }
  const tools={};for(const argv of candidates){if(argv[0] in tools)continue;
    try{const result=h.run(argv,root,10);tools[argv[0]]=result.code===0?'available':'missing-or-error';}
    catch(e){tools[argv[0]]='unavailable: '+e.message;}
  }
  const status=problems.length?'unready':'ready';
  h.log(fmt({product:'Dairn',engine:'Cosmopolitan QuickJS',version:runtimeVersion(h),status,root,runtime_sha256:lock.runtime_sha256,launcher,invocation:launcher.invocation+' doctor',modules,tools,problems}));
  for(const problem of problems)h.error('ERROR: '+problem);
  return problems.length?1:0;
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
  if(o.json)h.log(fmt(view));
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
    const content=o.json?fmt(view):renderHandoff(view,{maxChars}).text;
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

export function isProjectCommand(args){return ['init','adopt','detect','upgrade','docs','skills','guide','workflow','work','analyzers','analyze','quality','capability','stubs','doctor','version','--version','tasks','hooks','notes','evidence','gate','attest','approval','handoff','governance','refactor'].includes(args[0]);}
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
        runs.push((def.mode||'execute')==='import'?importAnalysisReport(h,rr,id,{artifact:null}):executeAnalyzer(h,rr,id,{base:o.base||null}));
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
      invariant(o.pos[0]==='run'||o.pos[0]==='import','Usage: dairn analyze run <analyzer-id> | --suite <suite-id> [--base <ref>] | analyze import <analyzer-id> [--artifact PATH] [--json] [--out PATH]');
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
          h.log('analysis import written: '+rel+' (unverified observation, not evidence)');
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
      const runs=targets.map(def=>executeAnalyzer(h,rr,def.id,{base:o.base||null}));
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
        h.log('analysis runs written: '+rel+' (advisory observation, not evidence)');
      }
      const failed=runs.filter(x=>x.status!=='completed');
      return failed.length?2:0;
    }
    if(o.cmd==='guide')return guidance(h,checkedRoot(h,root,false),o.pos[0]||'plan',{strict:!!o.strict,apply:!!o.apply,base:o.base||null,analyzer:o.analyzer||null,templates:{readme:projectReadme,guide:projectGuide},verify:()=>verifyRuntimeLock(h,checkedRoot(h,root,false),true)});
    if(o.cmd==='skills'){
      if(o.pos[0]==='catalog'){
        const m=assetIndex(h);for(const s of m.assets.filter(x=>x.type==='skills'&&x.path.endsWith('/SKILL.md')))h.log(s.path.split('/')[0]);return 0;
      }
      if(o.pos[0]==='add')return addSkill(h,o);
      if(o.pos[0]==='list') {const r=checkedRoot(h,root,false),d=j(r,'.agents/skills');h.log(fmt(h.exists(d)?h.list(d).sort():[]));return 0;}
      throw Error('Usage: dairn skills catalog | skills list | skills add <name> [--apply]');
    }
    return doctor(h,checkedRoot(h,root,false));
  }catch(e){h.error('Dairn ERROR: '+(e?.message||e));return 2;}
}
export {doctor};
