/* Dairn Analyzer Registry v1 (.dairn/analyzers.json, schema dairn.analyzers.v1).
 * Language-neutral, project-owned analyzer protocol. No embedded language SDK.
 * The analyzer receives request/output file paths as trailing argv entries and is
 * executed without a shell. Legacy stub naming/protocol is rejected, not migrated.
 */
import {sha256} from './sha256.mjs';
import {REPORT_FORMATS} from './report-adapters.mjs';
const at=(a,b)=>a.replace(/\/$/,'')+'/'+b;
const valid=p=>typeof p==='string'&&p.length>0&&!p.startsWith('/')&&!p.includes('\\')&&!p.split('/').some(x=>!x||x==='.'||x==='..');
const assert=(v,m)=>{if(!v)throw Error('Analyzer: '+m);};
function safe(h,root,p){assert(valid(p),'invalid relative path '+p);let d=root;for(const x of p.split('/')){d=at(d,x);assert(!h.isSymlink(d),'symlinked path '+p);}return d;}
const CONFIG_PATH='.dairn/analyzers.json';
const LEGACY_CONFIG_PATH='.dairn/stubs.json';
const ANALYZER_DOMAINS=new Set(['surface','static','architecture','complexity','test','coverage','security','performance','contract','reliability','custom']);
const LEGACY_ERROR='UNSUPPORTED_LEGACY_ANALYZER_CONFIG: '+LEGACY_CONFIG_PATH+' belongs to the removed stub protocol and is neither read nor migrated. Rewrite it as '+CONFIG_PATH+' with {"schema":"dairn.analyzers.v1","analyzers":[]} (breaking rename, no compatibility alias) and delete the legacy file.';

export function configuredAnalyzers(h,root){
  assert(!h.exists(at(root,LEGACY_CONFIG_PATH)),LEGACY_ERROR);
  const path=safe(h,root,CONFIG_PATH);
  if(!h.exists(path))return {analyzers:[],suites:[]};
  const doc=JSON.parse(h.read(path));
  assert(doc.schema==='dairn.analyzers.v1'&&Array.isArray(doc.analyzers)&&doc.analyzers.length<=24,'expected {schema:"dairn.analyzers.v1", analyzers:[]}');
  const ids=new Set();
  for(const s of doc.analyzers){
    assert(s&&/^[a-z][a-z0-9-]{1,48}$/.test(s.id||''),'invalid analyzer id');assert(!ids.has(s.id),'duplicate '+s.id);ids.add(s.id);
    assert(typeof s.domain==='string'&&ANALYZER_DOMAINS.has(s.domain),'unsupported domain '+JSON.stringify(s.domain)+' (allowed: '+[...ANALYZER_DOMAINS].join('|')+')');
    const mode=s.mode||'execute';
    assert(mode==='execute'||mode==='import','unsupported mode '+JSON.stringify(mode));
    if(mode==='execute'){
      assert(s.domain==='surface','execute mode is surface-only in this release (got "'+s.domain+'")');
    }
    if(mode==='import'){
      const r=s.report||{};
      assert(valid(r.path),'import analyzer requires safe report.path');
      assert(typeof r.format==='string'&&REPORT_FORMATS[r.format],'unsupported report.format (sarif-2.1.0|junit-xml|dairn-json)');
      assert(r.adapter===undefined||r.adapter===REPORT_FORMATS[r.format],'report.adapter must match report.format');
      assert(s.execution===undefined,'import analyzer must not declare execution');
      continue;
    }
    assert(s.report===undefined,'report field is only valid for mode=import analyzers');
    assert(s.capabilities===undefined||(Array.isArray(s.capabilities)&&s.capabilities.length<=16&&s.capabilities.every(x=>typeof x==='string'&&/^[a-z][a-z0-9.-]{1,64}$/.test(x))),'invalid capabilities');
    const e=s.execution||{};
    assert(Array.isArray(e.argv)&&e.argv.length>0&&e.argv.length<=32&&e.argv.every(x=>typeof x==='string'&&x&&!/[\0\r\n]/.test(x)),'invalid argv');
    assert(valid(e.cwd||'.')||(e.cwd||'.')==='.','invalid cwd');
    assert(Number.isInteger(e.timeout_seconds||120)&&(e.timeout_seconds||120)>=1&&(e.timeout_seconds||120)<=300,'invalid timeout');
    const cwd=(e.cwd||'.')==='.'?root:safe(h,root,e.cwd);assert(h.isDirectory(cwd),'missing cwd '+e.cwd);
  }
  // Suites 是纯执行编组：只引用已登记 analyzer，不定义任何可提升信任的字段。
  const suites=Array.isArray(doc.suites)?doc.suites:[];
  assert(suites.length<=16,'too many suites');
  const suiteIds=new Set();
  for(const suite of suites){
    assert(suite&&/^[a-z][a-z0-9-]{1,48}$/.test(suite.id||''),'invalid suite id');
    assert(!suiteIds.has(suite.id),'duplicate suite '+suite.id);suiteIds.add(suite.id);
    assert(!ids.has(suite.id),'suite id must not shadow analyzer id: '+suite.id);
    assert(Array.isArray(suite.analyzers)&&suite.analyzers.length>0&&suite.analyzers.length<=24,'suite analyzers must be a non-empty array');
    const seen=new Set();
    for(const id of suite.analyzers){
      assert(typeof id==='string'&&ids.has(id),'suite references unknown analyzer: '+id);
      assert(!seen.has(id),'duplicate analyzer in suite '+suite.id+': '+id);seen.add(id);
    }
  }
  return {analyzers:doc.analyzers,suites};
}
/* 解析 Suite 为去重、按注册顺序固定的执行清单；不存在时抛错。 */
export function resolveAnalysisSuite({analyzers,suites},{suite}){
  const def=suites.find(x=>x.id===suite);
  assert(def,'unconfigured suite '+suite);
  const byId=new Map(analyzers.map(x=>[x.id,x]));
  return def.analyzers.map(id=>byId.get(id));
}
const validChange=x=>x&&valid(x.path)&&typeof x.symbol==='string'&&/^[\w.#:$()<>,\[\] *-]{1,220}$/.test(x.symbol)&&['added','removed','changed'].includes(x.change)&&typeof x.before==='string'&&typeof x.after==='string';
export const isValidSurfaceChange=validChange;
/* builtin:surface adapter: a dairn.surface-result.v1 response becomes advisory
 * public-surface facts inside the impact report. Never a gate verdict. */
export function applyAnalyzerImpact(report,results){
  report.analyzer_analysis={source:results.source,analyzer_id:results.analyzer_id,domain:results.domain,changes:results.changes,assurance:'project-supplied analyzer; advisory not independently verified'};
  for(const c of results.changes){
    const found=report.impacts.find(i=>i.path===c.path);
    if(found){found.analysis_method='project-analyzer';found.analyzer_signatures=found.analyzer_signatures||[];found.analyzer_signatures.push(c);found.level='review-required';}
    else report.impacts.push({path:c.path,category:'public-surface',level:'review-required',change:c.change,analyzer_signatures:[c]});
    for(const p of ['docs/PROJECT_GUIDE.md','AGENTS.md']){
      let d=report.affected_docs.find(x=>x.path===p);if(!d){d={path:p,reasons:[]};report.affected_docs.push(d);}
      d.reasons.push('Project analyzer surface change: '+c.path+'#'+c.symbol);
    }
  }
  if(results.changes.length&&['clean','informational'].includes(report.status))report.status='review-required';
  report.counts.changes=report.impacts.length;report.counts.affected_documents=report.affected_docs.length;
  return report;
}

/* Developer-facing, project-owned template tooling. Templates are bundled for
 * convenience, but generated source stays under the project's own ownership.
 */
// Bundled examples are opt-in, project-owned analyzers. No language SDK is linked into Dairn Core.
// Multi-file templates allow compiled languages to carry a build manifest or project file.
const template=(name,files,argv,probe,requires,description)=>({name,files,argv,probe,requires,description});
const f=(asset,path)=>({asset:'/zip/quickjs/assets/analyzer-templates/'+asset,path:'tools/dairn/analyzers/'+path});
const TEMPLATES={
  go:template('go',[f('go-surface/main.go','go/main.go')],['go','run','tools/dairn/analyzers/go/main.go'],['go','version'],'Go 1.20+; Git','Go parser AST (reference implementation)'),
  python:template('python',[f('python-surface/main.py','python/main.py')],['python3','tools/dairn/analyzers/python/main.py'],['python3','--version'],'Python 3.9+; Git','Python stdlib ast signatures'),
  javascript:template('javascript',[f('javascript-surface/main.mjs','javascript/main.mjs')],['node','tools/dairn/analyzers/javascript/main.mjs'],['node','--version'],'Node.js 18+; Git','JavaScript exports; heuristic syntax scan'),
  typescript:template('typescript',[f('typescript-surface/main.mjs','typescript/main.mjs')],['node','tools/dairn/analyzers/typescript/main.mjs'],['node','--version'],'Node.js 18+; Git; TypeScript-aware parsing is project-defined','TypeScript exported declarations; heuristic surface scan'),
  java:template('java',[f('java-surface/Main.java','java/Main.java')],['java','tools/dairn/analyzers/java/Main.java'],['java','-version'],'JDK 11+ source launcher; Git','Java public declarations; heuristic surface scan'),
  rust:template('rust',[f('rust-surface/Cargo.toml','rust/Cargo.toml'),f('rust-surface/main.rs','rust/src/main.rs'),f('rust-surface/.gitignore','rust/.gitignore')],['cargo','run','--quiet','--manifest-path','tools/dairn/analyzers/rust/Cargo.toml','--'],['cargo','--version'],'Rust + Cargo; serde / serde_json crates (vendor or permit initial fetch); Git','Rust pub declarations via project-owned Cargo adapter'),
  php:template('php',[f('php-surface/main.php','php/main.php')],['php','tools/dairn/analyzers/php/main.php'],['php','--version'],'PHP 7.4+; Git','PHP public function/class signatures'),
  lua:template('lua',[f('lua-surface/main.lua','lua/main.lua')],['luajit','tools/dairn/analyzers/lua/main.lua'],['luajit','-v'],'LuaJIT with lua-cjson (OpenResty environments); Git','Lua exported functions; heuristic scan'),
  shell:template('shell',[f('shell-surface/main.sh','shell/main.sh')],['sh','tools/dairn/analyzers/shell/main.sh'],['sh','-c','command -v jq >/dev/null && command -v git >/dev/null'],'POSIX sh; jq; Git','POSIX shell function signatures'),
  ruby:template('ruby',[f('ruby-surface/main.rb','ruby/main.rb')],['ruby','tools/dairn/analyzers/ruby/main.rb'],['ruby','--version'],'Ruby 2.7+; Git','Ruby method/class signatures'),
  csharp:template('csharp',[f('csharp-surface/Surface.csproj','csharp/Surface.csproj'),f('csharp-surface/Program.cs','csharp/Program.cs'),f('csharp-surface/.gitignore','csharp/.gitignore')],['dotnet','run','--project','tools/dairn/analyzers/csharp/Surface.csproj','--'],['dotnet','--version'],'.NET SDK 8+; Git','C# public methods and classes; heuristic scan'),
};
export function analyzerTemplates(){return Object.values(TEMPLATES).map(s=>({name:s.name,files:s.files.map(x=>x.path),argv:s.argv,toolchain:s.probe[0],requires:s.requires,analysis:s.description,project_owned:true}));}
export function analyzerDoctor(h,root){
 const configured=configuredAnalyzers(h,root).analyzers,tools=[];
 for(const s of configured){
   if((s.mode||'execute')==='import'){
     tools.push({id:s.id,executor:null,status:'not-probed',reason:'import analyzer; report is read on demand, never executed'});
     continue;
   }
   const known=Object.values(TEMPLATES).find(t=>JSON.stringify(t.argv)===JSON.stringify(s.execution.argv));
   const cmd=s.execution.argv[0],probe=known?.probe||({go:['go','version'],python3:['python3','--version'],python:['python','--version'],node:['node','--version'],java:['java','-version'],cargo:['cargo','--version'],php:['php','--version'],luajit:['luajit','-v'],ruby:['ruby','--version'],dotnet:['dotnet','--version']}[cmd]);
   if(!probe){tools.push({id:s.id,executor:cmd,status:'not-probed',reason:'custom project command; execute only by explicit guide impact --analyzer ID'});continue;}
   try{const result=h.run(probe,root,10);tools.push({id:s.id,executor:cmd,status:result.code===0?'available':'missing',detail:result.output.trim().slice(0,160),requires:known?.requires||null});}
   catch(e){tools.push({id:s.id,executor:cmd,status:'missing',detail:String(e.message),requires:known?.requires||null});}
 }
 return {schema:1,configured:configured.map(s=>({id:s.id,domain:s.domain,mode:s.mode||'execute',argv:s.execution.argv,cwd:s.execution.cwd||'.'})),tools,ready:tools.every(x=>x.status!=='missing'),notes:'Probes are advisory and do not install dependencies. Templates are opt-in and execute only via guide impact --analyzer ID.'};
}
export function analyzerInit(h,root,{template='go',id='surface',apply=false}={}){
 assert(Object.hasOwn(TEMPLATES,template),'unknown template: '+template);
 assert(/^[a-z][a-z0-9-]{1,48}$/.test(id),'invalid analyzer id');
 const source=TEMPLATES[template],manifest=safe(h,root,CONFIG_PATH);
 const existing=configuredAnalyzers(h,root).analyzers;assert(!existing.some(s=>s.id===id),'duplicate analyzer id: '+id);
 const installed=[];
 for(const item of source.files){const target=safe(h,root,item.path);assert(!h.exists(target),'template destination already exists: '+item.path);const raw=h.read(item.asset);assert(raw.length>0,'missing or empty bundled template '+item.asset);installed.push({target,raw,path:item.path});}
 const next={schema:'dairn.analyzers.v1',analyzers:[...existing,{id,domain:'surface',mode:'execute',capabilities:['quality.surface-diff'],execution:{argv:source.argv,cwd:'.',timeout_seconds:120}}]};
 const plan={schema:1,action:'create-project-analyzer',template,id,applied:!!apply,files:[...source.files.map(x=>x.path),CONFIG_PATH],argv:source.argv,ownership:'project',requires:source.requires,analysis:source.description};
 if(!apply)return plan;
 const tmp=manifest+'.analyzer-tmp-'+Date.now(),written=[];
 try{
   for(const x of installed){h.mkdirs(x.target.slice(0,x.target.lastIndexOf('/')));h.writeExclusive(x.target,x.raw);written.push(x.target);}
   h.writeExclusive(tmp,JSON.stringify(next,null,2)+'\n');h.rename(tmp,manifest);
 }catch(e){if(h.exists(tmp))h.remove(tmp);for(const x of written)if(h.exists(x))h.remove(x);throw e;}
 return plan;
}
