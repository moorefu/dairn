import {addRelationsToImpact} from './relations.mjs';
import {runStub,applyStubImpact} from './stubs.mjs';
/* Deterministic, bounded, redaction-conscious project facts and doc drift.
 * Only observed paths, declared dependencies and configured commands; no generated prose.
 * Snapshot is project-owned and NEVER refreshed during drift detection.
 */
import {sha256} from './sha256.mjs';
const at=(root,part)=>root.replace(/\/$/,'')+'/'+part;
const exists=(h,p)=>h.exists(p)&&!h.isDirectory(p)&&!h.isSymlink(p);
const ignored=new Set(['.git','.dairn','.agents','node_modules','vendor','target','dist','build','.venv','venv','__pycache__','coverage','.next']);
const manifests=['go.mod','go.sum','Cargo.toml','Cargo.lock','pyproject.toml','requirements.txt','poetry.lock','uv.lock','Pipfile.lock','package.json','package-lock.json','pnpm-lock.yaml','yarn.lock','pom.xml','build.gradle','build.gradle.kts','gradle.lockfile','settings.gradle','settings.gradle.kts','nginx.conf'];
const buildfiles=['Makefile','GNUmakefile','Taskfile.yml','justfile','Dockerfile','.github/workflows/dairn.yml','.gitlab-ci.yml'];
const entryNames=['main.go','main.rs','main.py','__main__.py','app.py','manage.py','main.lua','init.lua','index.js','index.ts','main.ts','main.js','main.vue','App.vue'];
const kindOf=n=>{if(n==='go.mod'||n==='go.sum')return 'go';if(n.startsWith('Cargo.'))return 'rust';if(['pyproject.toml','requirements.txt','poetry.lock','uv.lock','Pipfile.lock'].includes(n))return 'python';if(['package.json','package-lock.json','pnpm-lock.yaml','yarn.lock'].includes(n))return 'node';if(['pom.xml','build.gradle','build.gradle.kts','gradle.lockfile','settings.gradle','settings.gradle.kts'].includes(n))return 'jvm';return 'openresty';};
const arrEq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function safeWalk(h,root,sub,depth,files,folders){
  if(depth>4||files.length>3500)return;
  const loc=at(root,sub==='.'?'':sub);
  if(!h.isDirectory(loc)||h.isSymlink(loc))return;
  for(const name of h.list(loc).sort()){
    if(ignored.has(name)||(name.startsWith('.')&&!(sub==='.'&&name==='.github')))continue;
    const rel=sub==='.'?name:sub+'/'+name,full=at(root,rel);
    if(h.isSymlink(full))continue;
    if(h.isDirectory(full)){
      if(depth<=1)folders.push(rel);
      if(depth<4) safeWalk(h,root,rel,depth+1,files,folders);
    }else if(h.exists(full))files.push(rel);
  }
}
function depNames(file,raw){
  let out=[];
  if(file==='package.json')try{const data=JSON.parse(raw);out=Object.keys({...data.dependencies,...data.devDependencies,...data.peerDependencies});}catch(_){}
  else if(file==='go.mod'){
    out=[...raw.matchAll(/^\s*([a-zA-Z0-9_.-]+\.[\w.\/-]+)\s+v\d/gm)].map(x=>x[1]);
  }else if(file==='requirements.txt')out=raw.split('\n').map(x=>/^\s*([\w.-]+)(?:[!<=>~;\[]|\s|$)/.exec(x)?.[1]).filter(Boolean);
  else if(file==='Cargo.toml'){
    let dep=false;for(const line of raw.split('\n')){const section=/^\s*\[([^\]]+)\]/.exec(line);if(section){dep=/(?:^|\.)dependencies$/.test(section[1])||section[1]==='dev-dependencies'||section[1]==='build-dependencies';continue;}const key=dep?/^\s*([A-Za-z0-9_-]+)\s*=/.exec(line):null;if(key)out.push(key[1]);}
  }else if(file==='pyproject.toml'){
    out=[...raw.matchAll(/^\s*([\w.-]+)\s*=\s*\{[^\n]*version\s*=/gm)].map(x=>x[1]);
    const match=/\bdependencies\s*=\s*\[([\s\S]*?)\]/m.exec(raw);if(match)out.push(...[...match[1].matchAll(/["']([\w.-]+)(?:[><=!~;\[]|\s|["'])/g)].map(x=>x[1]));
  }
  return [...new Set(out)].sort().slice(0,250);
}
function discoverSpecs(h,root){
  const out=[];function walk(dir,rel,depth){if(depth>6||!h.isDirectory(dir)||h.isSymlink(dir))return;
    for(const name of h.list(dir).sort()){
      const path=at(dir,name),r=rel?rel+'/'+name:name;
      if(h.isSymlink(path))continue;
      if(h.isDirectory(path)){walk(path,r,depth+1);continue;}
      if(!name.endsWith('.md'))continue;
      const raw=h.read(path);const stable=/^id:\s*([a-z][a-z0-9.-]+)\s*$/m.exec(raw.slice(0,1500))?.[1]||null;
      out.push({path:'docs/specs/'+r,id:stable,sha256:sha256(raw)});
    }
  }walk(at(root,'docs/specs'),'',0);return out;
}
export function captureFacts(h,root,config){
  const files=[],folders=[];safeWalk(h,root,'.',0,files,folders);
  const manifestsFound=files.filter(x=>manifests.includes(x.split('/').pop())).sort().map(path=>{
    const text=h.read(at(root,path)),base=path.split('/').pop();
    return {path,stack:kindOf(base),sha256:sha256(text),declared_name:declaredModuleName(base,text),dependencies:depNames(base,text)};
  });
  const builds=files.filter(x=>buildfiles.includes(x.split('/').pop())||/^\.github\/workflows\//.test(x))
    .sort().map(path=>({path,sha256:sha256(h.read(at(root,path)))}));
  const entries=files.filter(x=>entryNames.includes(x.split('/').pop())||/^(cmd|src\/main|apps)\/[^/]+\/main\.(go|rs|py|ts|js)$/.test(x))
    .sort().slice(0,500);
  const modules=config.modules.map(m=>({name:m.name,path:m.path,profiles:[...m.profiles].sort(),commands:Object.fromEntries(
    Object.entries(m.checks||{}).sort(([a],[b])=>a.localeCompare(b)).map(([k,c])=>[k,{argv:c.argv,cwd:c.cwd}]))}));
  const observed_modules=manifestsFound.filter(x=>['go.mod','Cargo.toml','pyproject.toml','package.json','pom.xml','build.gradle','build.gradle.kts','nginx.conf'].includes(x.path.split('/').pop()))
    .map(x=>({path:x.path.split('/').slice(0,-1).join('/')||'.',stack:x.stack,source:x.path})).sort((a,b)=>a.source.localeCompare(b.source));
  const code_surfaces=files.filter(x=>codeExt.has(x.split('.').pop())&&!/\.(?:test|spec)\./.test(x)&&!/(?:^|\/)(?:test|tests|spec)\//.test(x))
    .sort().slice(0,500).map(p=>codeSurface(h,root,p,config));
  return {schema:1,project:config.name,modules,observed_modules,manifests:manifestsFound,build:builds,entrypoints:entries,specs:discoverSpecs(h,root),code_surfaces};
}
// Bounded heuristic scanners: imports, exported declarations and source fingerprints.
// No AST or semantic completeness is claimed; unknown syntax remains an open question.
const codeExt=new Set(['go','rs','py','java','ts','tsx','js','jsx']);
function codeSurface(h,root,path,config){
  const ext=path.split('.').pop(),raw=h.read(at(root,path));
  if(raw.length>131072)return {path,language:ext,sha256:sha256(raw),opaque:true,imports:[],symbols:[],surface_sha256:null};
  const imports=[],decl=[];
  for(const line of raw.split('\n')){
    const t=line.trim();let m;
    if(ext==='go'){
      if((m=/^import\s+(?:[\w.]+\s+)?["`]([^"`]+)["`]/.exec(t))||(m=/^(?:[\w.]+\s+)?["`]([^"`]+)["`]\s*(?:\/\/.*)?$/.exec(t)))imports.push(m[1]);
      if((m=/^(?:func\s+(?:\([^)]*\)\s*)?|type\s+)([A-Z]\w*)\b/.exec(t)))decl.push(m[1]+':'+sha256(t));
    }else if(ext==='py'){
      if((m=/^(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/.exec(t)))imports.push(m[1]||m[2]);
      if((m=/^(?:async\s+)?def\s+([a-zA-Z][\w]*)\s*\(|^class\s+([a-zA-Z][\w]*)\s*[:(]/.exec(line))&&!(m[1]||m[2]).startsWith('_'))decl.push((m[1]||m[2])+':'+sha256(t));
    }else if(ext==='rs'){
      if((m=/^use\s+([^;]+)/.exec(t)))imports.push(m[1].trim());
      if((m=/^pub(?:\([^)]*\))?\s+(?:(?:async|unsafe)\s+)?(?:fn|struct|enum|trait|type|mod|const)\s+(\w+)/.exec(t)))decl.push(m[1]+':'+sha256(t));
    }else if(ext==='java'){
      if((m=/^import\s+(?:static\s+)?([\w.]+)\s*;/.exec(t)))imports.push(m[1]);
      if(/^public\s+|^protected\s+/.test(t)&&(/[({;]$/.test(t))){
        const name=/(?:class|interface|enum|record)\s+(\w+)|([A-Za-z_$][\w$]*)\s*\(/.exec(t);
        if(name)decl.push((name[1]||name[2])+':'+sha256(t));
      }
    }else{
      if((m=/^import\s+.*?\s+from\s+["']([^"']+)/.exec(t))||(m=/^import\s*["']([^"']+)/.exec(t)))imports.push(m[1]);
      if((m=/^export\s+(?:default\s+)?(?:(?:async|declare)\s+)?(?:function|class|interface|type|const|let|enum)\s+(\w+)/.exec(t)))decl.push(m[1]+':'+sha256(t));
    }
    if(imports.length>100||decl.length>200)break;
  }
  const mod=[...config.modules].sort((a,b)=>b.path.length-a.path.length).find(m=>m.path==='.'||path.startsWith(m.path+'/'))?.name||'unmapped';
  return {path,language:ext,module:mod,sha256:sha256(raw),imports:[...new Set(imports)].sort(),symbols:[...new Set(decl)].sort(),surface_sha256:sha256([...new Set(decl)].sort().join('\n'))};
}

function declaredModuleName(filename,raw){
  let m;
  if(filename==='go.mod')return /^module\s+(\S+)/m.exec(raw)?.[1]||null;
  if(filename==='package.json')try{return JSON.parse(raw).name||null;}catch(_){return null;}
  if(filename==='Cargo.toml')return /\[package\]([\s\S]*?)(?:\n\[|$)/m.exec(raw)?.[1].match(/^\s*name\s*=\s*["']([^"']+)/m)?.[1]||null;
  if(filename==='pyproject.toml')return /\[project\]([\s\S]*?)(?:\n\[|$)/m.exec(raw)?.[1].match(/^\s*name\s*=\s*["']([^"']+)/m)?.[1]||null;
  return null;
}
// Imports are hints; only resolve an edge when it matches an observed module's declared identity.
export function moduleGraph(facts){
  const modules=facts.modules||[], identities=[];
  for(const m of facts.manifests||[])if(m.declared_name){
    const owner=[...modules].sort((a,b)=>b.path.length-a.path.length).find(x=>x.path==='.'||m.path.startsWith(x.path+'/'));
    if(owner)identities.push({name:m.declared_name,module:owner.name,path:owner.path});
  }
  const edges=new Map();
  for(const file of facts.code_surfaces||[]){
    for(const name of file.imports||[]){
      const matches=identities.filter(x=>name===x.name||name.startsWith(x.name+'/')).sort((a,b)=>b.name.length-a.name.length);
      const target=matches[0];if(!target||target.module===file.module)continue;
      const key=file.module+'\u0000'+target.module;
      if(!edges.has(key))edges.set(key,{from:file.module,to:target.module,via:[],confidence:'declared-import-prefix'});
      const edge=edges.get(key);if(edge.via.length<25&&!edge.via.includes(file.path))edge.via.push(file.path);
    }
  }
  return {nodes:modules.map(x=>({name:x.name,path:x.path,profiles:x.profiles})),edges:[...edges.values()].sort((a,b)=>(a.from+a.to).localeCompare(b.from+b.to))};
}

const map=(list,key)=>new Map((list||[]).map(x=>[x[key],x]));
const diff=(older,newer,key,fn)=>{
  const previous=map(older,key),current=map(newer,key),events=[];
  for(const id of new Set([...previous.keys(),...current.keys()])){
    const a=previous.get(id),b=current.get(id);
    if(!a)events.push({key:id,change:'added',...fn(null,b)});
    else if(!b)events.push({key:id,change:'removed',...fn(a,null)});
    else if(!arrEq(a,b))events.push({key:id,change:'changed',...fn(a,b)});
  }return events.sort((a,b)=>a.key.localeCompare(b.key));
};
export function compareFacts(old,current){
  const changes=[],suggestions=new Map();
  const propose=(doc,reason)=>{if(!suggestions.has(doc))suggestions.set(doc,[]);suggestions.get(doc).push(reason);};
  const modules=diff(old.modules,current.modules,'name',(a,b)=>({category:'module',before:a,after:b}));
  modules.push(...diff(old.observed_modules,current.observed_modules,'source',(a,b)=>({category:'observed-module',before:a,after:b})));
  for(const c of modules){changes.push(c);propose('README.md','Module layout or stack changed: '+c.key);propose('docs/PROJECT_GUIDE.md','Review architecture and module map: '+c.key);propose('AGENTS.md','Review module-specific agent navigation: '+c.key);}
  for(const c of diff(old.manifests,current.manifests,'path',(a,b)=>({category:'dependencies',before:a?{sha256:a.sha256,dependencies:a.dependencies}:null,after:b?{sha256:b.sha256,dependencies:b.dependencies}:null}))){
    changes.push(c);propose('docs/PROJECT_GUIDE.md','Dependency manifest changed: '+c.key);propose('README.md','Review installation prerequisites: '+c.key);
  }
  for(const c of diff(old.build,current.build,'path',(a,b)=>({category:'build',before:a?.sha256||null,after:b?.sha256||null}))){changes.push(c);propose('docs/PROJECT_GUIDE.md','Review build and CI commands: '+c.key);propose('AGENTS.md','Review agent verification entry points: '+c.key);}
  if(!arrEq(old.entrypoints,current.entrypoints)){
    changes.push({category:'entrypoints',change:'changed',before:old.entrypoints,after:current.entrypoints});
    propose('README.md','Review actual application startup path');propose('docs/PROJECT_GUIDE.md','Review startup path and architecture');
  }
  for(const c of diff(old.specs,current.specs,'path',(a,b)=>({category:'spec',before:a?.sha256||null,after:b?.sha256||null,id:b?.id||a?.id||null}))){
    changes.push(c);propose('docs/PROJECT_GUIDE.md','Review changed authoritative Spec: '+c.key);
    propose('AGENTS.md','Review Spec discovery/navigation pointer: '+(c.id||c.key));
  }
  for(const c of diff(old.code_surfaces||[],current.code_surfaces||[],'path',(a,b)=>({
    category: !a||!b ? 'source-layout' : a.surface_sha256!==b.surface_sha256?'public-surface':JSON.stringify(a.imports)!==JSON.stringify(b.imports)?'imports':'code-internal',
    module:b?.module||a?.module||'unmapped',symbols_before:a?.symbols||[],symbols_after:b?.symbols||[],imports_before:a?.imports||[],imports_after:b?.imports||[],
    surface_incomplete:!!(a?.opaque||b?.opaque),before_sha256:a?.sha256||null,after_sha256:b?.sha256||null
  }))){
    changes.push(c);
    if(c.category==='public-surface'||c.category==='source-layout'){
      propose('docs/PROJECT_GUIDE.md','Review potential public interfaces and architecture in '+c.key);
      propose('AGENTS.md','Review source/module navigation for '+c.key);
    }else if(c.category==='imports')propose('docs/PROJECT_GUIDE.md','Review source dependency links: '+c.key);
  }
  return {status:changes.length?'drift':'clean',changes,affected_docs:[...suggestions].sort(([a],[b])=>a.localeCompare(b)).map(([path,reasons])=>({path,reasons:[...new Set(reasons)]}))};
}
export function factSnapshotPath(root){return at(root,'.dairn/facts/project-facts.json');}
export function factsReport(h,root,config,{base=null}={}){
  const current=captureFacts(h,root,config),path=factSnapshotPath(root);
  let prior=null,source='local-snapshot';
  if(base){
    const revision=h.run(['git','rev-parse','--verify',base+'^{commit}'],root,10);
    if(revision.code!==0||revision.timedOut)throw Error('Cannot resolve trusted Git base: '+base);
    const sha=revision.output.trim();
    const data=h.run(['git','show',sha+':.dairn/facts/project-facts.json'],root,10);
    if(data.code===0&&!data.timedOut)prior=data.output;
    else if(data.timedOut)throw Error('Timed out reading trusted facts baseline');
    source='git:'+sha;
  }else if(exists(h,path))prior=h.read(path);
  if(prior===null)return {status:'unbaselined',changes:[],affected_docs:[],snapshot_path:'.dairn/facts/project-facts.json',baseline_source:source,current};
  const old=JSON.parse(prior);if(old.schema!==1)throw Error('Unsupported project facts schema');
  return {...compareFacts(old,current),snapshot_path:'.dairn/facts/project-facts.json',baseline_source:source,current};
}
export function acceptFacts(h,root,current){
  const file=factSnapshotPath(root);let part=root;
  for(const component of ['.dairn','facts','project-facts.json']){part=at(part,component);if(h.isSymlink(part))throw Error('Refuse symlinked fact snapshot path: '+part);}
  h.mkdirs(at(root,'.dairn/facts'));const tmp=file+'.dairn-tmp-'+Date.now();
  try{h.write(tmp,JSON.stringify(current,null,2)+'\n');h.rename(tmp,file);}finally{if(h.exists(tmp))h.remove(tmp);}
}

// Structured impact report. Levels are suggestions, never proof of a changed contract.
export function impactReport(h,root,config,opts={}){
  const r=factsReport(h,root,config,opts);
  if(r.status==='unbaselined')return {status:'unbaselined',baseline_source:r.baseline_source,changes:[],affected_docs:[],edges:[],confidence:'heuristic'};
  const grades={'spec':3,'public-surface':2,'source-layout':2,'module':2,'observed-module':2,'dependencies':2,'build':2,'entrypoints':2,'imports':2,'code-internal':1};
  const impacts=r.changes.map(c=>({path:c.key||null,category:c.category,module:c.module||null,level:grades[c.category]===3?'contract-impact':grades[c.category]===2?'review-required':'informational',
    change:c.change,symbols_before:c.symbols_before||[],symbols_after:c.symbols_after||[],imports_before:c.imports_before||[],imports_after:c.imports_after||[],
    confidence:c.surface_incomplete?'incomplete-static-scan':'heuristic',spec_id:c.id||null}));
  const severity=Math.max(0,...impacts.map(x=>grades[x.category]||0));
  const edges=[];for(const c of impacts){
    const targets=r.affected_docs.filter(d=>d.reasons.some(x=>c.path&&x.includes(c.path))).map(x=>x.path);
    for(const doc of targets)edges.push({source:c.path,target:doc,relationship:'review-suggested',confidence:'heuristic'});
  }
  const graph=moduleGraph(r.current);

  const changedModules=new Set(impacts.filter(x=>x.module&&x.level!=='informational').map(x=>x.module));
  const downstream=new Set();const frontier=[...changedModules];
  // Bounded reverse-reachability: importers can be affected by changes in imported modules.
  for(let depth=0;frontier.length&&depth<Math.min(4,graph.nodes.length);depth++){
    const next=[];
    for(const edge of graph.edges)if(frontier.includes(edge.to)&&!changedModules.has(edge.from)&&!downstream.has(edge.from)){
      downstream.add(edge.from);next.push(edge.from);
    }
    frontier.splice(0,frontier.length,...next);
  }
  const report={status:severity===3?'contract-impact':severity===2?'review-required':severity===1?'informational':'clean',baseline_source:r.baseline_source,
    counts:{changes:impacts.length,affected_documents:r.affected_docs.length},impacts,edges,graph,downstream_modules:[...downstream].sort(),affected_docs:r.affected_docs,
    note:'Static heuristic: identifies potential impacts, not semantic proof or an approval. Review source and spec; retain evidence.'};
  addRelationsToImpact(h,root,report,r.current,{base:opts.base||null});
  if(opts.precision){
    const stub=runStub(h,root,opts.precision,{base:opts.base||null});
    applyStubImpact(report,stub);
  }
  return report;
}
