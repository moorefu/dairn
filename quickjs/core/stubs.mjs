/* Language-neutral, project-owned analyzer stub protocol. No embedded language SDK.
 * Stub receives request/output file paths as trailing arguments, executes with argv (no shell).
 * Cache is advisory and never substitutes a CI quality gate.
 */
import {sha256} from './sha256.mjs';
const at=(a,b)=>a.replace(/\/$/,'')+'/'+b;
const valid=p=>typeof p==='string'&&p.length>0&&!p.startsWith('/')&&!p.includes('\\')&&!p.split('/').some(x=>!x||x==='.'||x==='..');
const assert=(v,m)=>{if(!v)throw Error('Stub: '+m);};
function safe(h,root,p){assert(valid(p),'invalid relative path '+p);let d=root;for(const x of p.split('/')){d=at(d,x);assert(!h.isSymlink(d),'symlinked path '+p);}return d;}
export function configuredStubs(h,root){
  const path=safe(h,root,'.dairn/stubs.json');
  if(!h.exists(path))return [];
  const doc=JSON.parse(h.read(path));assert(doc.schema===1&&Array.isArray(doc.stubs)&&doc.stubs.length<=24,'expected {schema:1, stubs:[]}');
  const ids=new Set();
  for(const s of doc.stubs){
    assert(s&&/^[a-z][a-z0-9-]{1,48}$/.test(s.id||''),'invalid stub id');assert(!ids.has(s.id),'duplicate '+s.id);ids.add(s.id);
    assert(s.kind==='surface-analysis','unsupported kind '+s.kind);
    assert(Array.isArray(s.argv)&&s.argv.length>0&&s.argv.length<=32&&s.argv.every(x=>typeof x==='string'&&x&&!/[\0\r\n]/.test(x)),'invalid argv');
    assert(valid(s.cwd||'.')||(s.cwd||'.')==='.','invalid cwd');
    assert(Number.isInteger(s.timeout_seconds||60)&&(s.timeout_seconds||60)>=1&&(s.timeout_seconds||60)<=300,'invalid timeout');
    const cwd=(s.cwd||'.')==='.'?root:safe(h,root,s.cwd);assert(h.isDirectory(cwd),'missing cwd '+s.cwd);
  }
  return doc.stubs;
}
const validChange=x=>x&&valid(x.path)&&typeof x.symbol==='string'&&/^[\w.#:$()<>,\[\] *-]{1,220}$/.test(x.symbol)&&['added','removed','changed'].includes(x.change)&&typeof x.before==='string'&&typeof x.after==='string';
export function runStub(h,root,id,{base=null,head=null,refresh=false}={}){
  const s=configuredStubs(h,root).find(x=>x.id===id);assert(s,'unconfigured '+id);
  const git=h.run(['git','rev-parse','--verify','HEAD^{commit}'],root,15);
  assert(git.code===0&&!git.timedOut,'Git HEAD unavailable');const actualHead=git.output.trim();
  let baseSha=null;if(base){const r=h.run(['git','rev-parse','--verify',base+'^{commit}'],root,15);assert(r.code===0&&!r.timedOut,'cannot resolve base');baseSha=r.output.trim();}
  if(head)assert(head===actualHead,'HEAD changed');
  const req={schema:1,kind:'surface-analysis',stub_id:id,root,base_commit:baseSha,head_commit:actualHead,protocol:'dairn-stub-v1'};
  const configFile=safe(h,root,'.dairn/stubs.json');
  const actualConfigHash=sha256(h.read(configFile));
  if(h.env('GITHUB_ACTIONS')==='true'||h.env('GITLAB_CI')==='true'){
    const expected=h.env('DAIRN_EXPECTED_STUBS_SHA256');
    assert(expected&&/^[a-f0-9]{64}$/.test(expected)&&expected===actualConfigHash,
      'CI analyzer requires externally pinned DAIRN_EXPECTED_STUBS_SHA256');
  }
  // Include readable file-valued argv entries in the cache key, so changed local analyzers never hit stale cache.
  const sourceDigests=s.argv.filter(a=>a.startsWith('/')&&h.exists(a)&&!h.isDirectory(a)&&!h.isSymlink(a))
    .map(a=>{const raw=h.read(a);assert(raw.length<=1048576,'analyzer source too large for cache fingerprint');return [a,sha256(raw)];});
  const manifest=sha256(JSON.stringify([s,actualConfigHash,sourceDigests,h.env('DAIRN_STUB_TOOLCHAIN_FINGERPRINT')||'unversioned-toolchain']));
  // Never use a cache key based only on HEAD: uncommitted workspace changes must invalidate cached analysis.
  const changed=h.run(['git','status','--porcelain','--untracked-files=all'],root,15);
  assert(changed.code===0&&!changed.timedOut,'cannot inspect workspace state');
  const dirty=changed.output.trim();const cacheable=!dirty;
  const key=sha256(JSON.stringify([req,manifest]));
  const dir=safe(h,root,'.dairn/cache/stubs');h.mkdirs(dir);
  const cached=at(dir,key+'.json');
  if(cacheable&&!refresh&&h.exists(cached)&&!h.isSymlink(cached)){
    try{const rec=JSON.parse(h.read(cached));if(rec.cache_key===key&&rec.response?.schema===1&&rec.response.kind==='surface-analysis'&&Array.isArray(rec.response.changes)&&rec.response.changes.every(validChange))return {source:'local-cache',...rec.response};}catch(_){}
  }
  const suffix=Date.now()+'-'+Math.random().toString(16).slice(2);
  const request=at(dir,'req-'+suffix+'.json'),output=at(dir,'out-'+suffix+'.json');
  assert(!h.exists(request)&&!h.exists(output),'temporary collision');
  try{
    h.writeExclusive(request,JSON.stringify(req)+'\n');
    const result=h.run([...s.argv,request,output],((s.cwd||'.')==='.'?root:safe(h,root,s.cwd)),s.timeout_seconds||60);
    assert(!result.timedOut&&result.code===0,'analyzer failed: '+(result.output||'').slice(0,200));
    assert(h.exists(output)&&!h.isSymlink(output),'analyzer did not create a safe response');
    const raw=h.read(output);assert(raw.length<=1048576,'response too large');
    const doc=JSON.parse(raw);
    assert(doc.schema===1&&doc.kind==='surface-analysis'&&doc.stub_id===id&&doc.head_commit===actualHead&&doc.base_commit===baseSha,'response identity mismatch');
    assert(Array.isArray(doc.changes)&&doc.changes.length<=500&&doc.changes.every(validChange),'invalid analyzer results');
    for(const change of doc.changes)safe(h,root,change.path);
    if(cacheable){const tmp=at(dir,'cache-'+suffix+'.json');try{h.writeExclusive(tmp,JSON.stringify({cache_key:key,response:doc})+'\n');h.rename(tmp,cached);}finally{if(h.exists(tmp))h.remove(tmp);}}
    return {source:'project-stub',...doc};
  }finally{if(h.exists(request))h.remove(request);if(h.exists(output))h.remove(output);}
}
export function applyStubImpact(report,results){
  report.stub_analysis={source:results.source,stub_id:results.stub_id,changes:results.changes,assurance:'project-supplied analyzer; advisory not independently verified'};
  for(const c of results.changes){
    const found=report.impacts.find(i=>i.path===c.path);
    if(found){found.analysis_method='project-stub';found.stub_signatures=found.stub_signatures||[];found.stub_signatures.push(c);found.level='review-required';}
    else report.impacts.push({path:c.path,category:'public-surface',level:'review-required',change:c.change,stub_signatures:[c]});
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
const f=(asset,path)=>({asset:'/zip/quickjs/assets/stub-templates/'+asset,path:'tools/dairn/stubs/'+path});
const TEMPLATES={
  go:template('go',[f('go-surface/main.go','go/main.go')],['go','run','tools/dairn/stubs/go/main.go'],['go','version'],'Go 1.20+; Git','Go parser AST (reference implementation)'),
  python:template('python',[f('python-surface/main.py','python/main.py')],['python3','tools/dairn/stubs/python/main.py'],['python3','--version'],'Python 3.9+; Git','Python stdlib ast signatures'),
  javascript:template('javascript',[f('javascript-surface/main.mjs','javascript/main.mjs')],['node','tools/dairn/stubs/javascript/main.mjs'],['node','--version'],'Node.js 18+; Git','JavaScript exports; heuristic syntax scan'),
  typescript:template('typescript',[f('typescript-surface/main.mjs','typescript/main.mjs')],['node','tools/dairn/stubs/typescript/main.mjs'],['node','--version'],'Node.js 18+; Git; TypeScript-aware parsing is project-defined','TypeScript exported declarations; heuristic surface scan'),
  java:template('java',[f('java-surface/Main.java','java/Main.java')],['java','tools/dairn/stubs/java/Main.java'],['java','-version'],'JDK 11+ source launcher; Git','Java public declarations; heuristic surface scan'),
  rust:template('rust',[f('rust-surface/Cargo.toml','rust/Cargo.toml'),f('rust-surface/main.rs','rust/src/main.rs'),f('rust-surface/.gitignore','rust/.gitignore')],['cargo','run','--quiet','--manifest-path','tools/dairn/stubs/rust/Cargo.toml','--'],['cargo','--version'],'Rust + Cargo; serde / serde_json crates (vendor or permit initial fetch); Git','Rust pub declarations via project-owned Cargo adapter'),
  php:template('php',[f('php-surface/main.php','php/main.php')],['php','tools/dairn/stubs/php/main.php'],['php','--version'],'PHP 7.4+; Git','PHP public function/class signatures'),
  lua:template('lua',[f('lua-surface/main.lua','lua/main.lua')],['luajit','tools/dairn/stubs/lua/main.lua'],['luajit','-v'],'LuaJIT with lua-cjson (OpenResty environments); Git','Lua exported functions; heuristic scan'),
  shell:template('shell',[f('shell-surface/main.sh','shell/main.sh')],['sh','tools/dairn/stubs/shell/main.sh'],['sh','-c','command -v jq >/dev/null && command -v git >/dev/null'],'POSIX sh; jq; Git','POSIX shell function signatures'),
  ruby:template('ruby',[f('ruby-surface/main.rb','ruby/main.rb')],['ruby','tools/dairn/stubs/ruby/main.rb'],['ruby','--version'],'Ruby 2.7+; Git','Ruby method/class signatures'),
  csharp:template('csharp',[f('csharp-surface/Surface.csproj','csharp/Surface.csproj'),f('csharp-surface/Program.cs','csharp/Program.cs'),f('csharp-surface/.gitignore','csharp/.gitignore')],['dotnet','run','--project','tools/dairn/stubs/csharp/Surface.csproj','--'],['dotnet','--version'],'.NET SDK 8+; Git','C# public methods and classes; heuristic scan'),
};
export function stubTemplates(){return Object.values(TEMPLATES).map(s=>({name:s.name,files:s.files.map(x=>x.path),argv:s.argv,toolchain:s.probe[0],requires:s.requires,analysis:s.description,project_owned:true}));}
export function stubDoctor(h,root){
 const configured=configuredStubs(h,root),tools=[];
 for(const s of configured){
   const known=Object.values(TEMPLATES).find(t=>JSON.stringify(t.argv)===JSON.stringify(s.argv));
   const cmd=s.argv[0],probe=known?.probe||({go:['go','version'],python3:['python3','--version'],python:['python','--version'],node:['node','--version'],java:['java','-version'],cargo:['cargo','--version'],php:['php','--version'],luajit:['luajit','-v'],ruby:['ruby','--version'],dotnet:['dotnet','--version']}[cmd]);
   if(!probe){tools.push({id:s.id,executor:cmd,status:'not-probed',reason:'custom project command; execute only by explicit guide impact --precision ID'});continue;}
   try{const result=h.run(probe,root,10);tools.push({id:s.id,executor:cmd,status:result.code===0?'available':'missing',detail:result.output.trim().slice(0,160),requires:known?.requires||null});}
   catch(e){tools.push({id:s.id,executor:cmd,status:'missing',detail:String(e.message),requires:known?.requires||null});}
 }
 return {schema:1,configured:configured.map(s=>({id:s.id,kind:s.kind,argv:s.argv,cwd:s.cwd||'.'})),tools,ready:tools.every(x=>x.status!=='missing'),notes:'Probes are advisory and do not install dependencies. Templates are opt-in and execute only via guide impact --precision ID.'};
}
export function stubInit(h,root,{template='go',id='surface',apply=false}={}){
 assert(Object.hasOwn(TEMPLATES,template),'unknown template: '+template);
 assert(/^[a-z][a-z0-9-]{1,48}$/.test(id),'invalid stub id');
 const source=TEMPLATES[template],manifest=safe(h,root,'.dairn/stubs.json');
 const existing=configuredStubs(h,root);assert(!existing.some(s=>s.id===id),'duplicate stub id: '+id);
 const installed=[];
 for(const item of source.files){const target=safe(h,root,item.path);assert(!h.exists(target),'template destination already exists: '+item.path);const raw=h.read(item.asset);assert(raw.length>0,'missing or empty bundled template '+item.asset);installed.push({target,raw,path:item.path});}
 const next={schema:1,stubs:[...existing,{id,kind:'surface-analysis',argv:source.argv,cwd:'.',timeout_seconds:120}]};
 const plan={schema:1,action:'create-project-stub',template,id,applied:!!apply,files:[...source.files.map(x=>x.path),'.dairn/stubs.json'],argv:source.argv,ownership:'project',requires:source.requires,analysis:source.description};
 if(!apply)return plan;
 const tmp=manifest+'.stub-tmp-'+Date.now(),written=[];
 try{
   for(const x of installed){h.mkdirs(x.target.slice(0,x.target.lastIndexOf('/')));h.writeExclusive(x.target,x.raw);written.push(x.target);}
   h.writeExclusive(tmp,JSON.stringify(next,null,2)+'\n');h.rename(tmp,manifest);
 }catch(e){if(h.exists(tmp))h.remove(tmp);for(const x of written)if(h.exists(x))h.remove(x);throw e;}
 return plan;
}
