/* Controlled Analyzer Runner. Executes one configured analyzer via argv (no shell),
 * writes a dairn.analyzer-request.v1 request file, validates the bounded
 * dairn.surface-result.v1 response and keeps an advisory local cache.
 * Cache is advisory and never substitutes a CI quality gate. Legacy stub
 * protocols (dairn-stub-v1 / surface-analysis) are rejected, never parsed.
 */
import {sha256} from './sha256.mjs';
import {configuredAnalyzers} from './analyzers.mjs';
import {normalizeReport,REPORT_FORMATS} from './report-adapters.mjs';
const at=(a,b)=>a.replace(/\/$/,'')+'/'+b;
const valid=p=>typeof p==='string'&&p.length>0&&!p.startsWith('/')&&!p.includes('\\')&&!p.split('/').some(x=>!x||x==='.'||x==='..');
const assert=(v,m)=>{if(!v)throw Error('Analyzer: '+m);};
function safe(h,root,p){assert(valid(p),'invalid relative path '+p);let d=root;for(const x of p.split('/')){d=at(d,x);assert(!h.isSymlink(d),'symlinked path '+p);}return d;}

const validChange=x=>x&&valid(x.path)&&typeof x.symbol==='string'&&/^[\w.#:$()<>,\[\] *-]{1,220}$/.test(x.symbol)&&['added','removed','changed'].includes(x.change)&&typeof x.before==='string'&&typeof x.after==='string';

export function runAnalyzer(h,root,id,{base=null,head=null,refresh=false}={}){
  const s=configuredAnalyzers(h,root).analyzers.find(x=>x.id===id);assert(s,'unconfigured '+id);
  const git=h.run(['git','rev-parse','--verify','HEAD^{commit}'],root,15);
  assert(git.code===0&&!git.timedOut,'Git HEAD unavailable');const actualHead=git.output.trim();
  let baseSha=null;if(base){const r=h.run(['git','rev-parse','--verify',base+'^{commit}'],root,15);assert(r.code===0&&!r.timedOut,'cannot resolve base');baseSha=r.output.trim();}
  if(head)assert(head===actualHead,'HEAD changed');
  const req={schema:'dairn.analyzer-request.v1',analyzer_id:id,domain:s.domain,
    subject:{source_commit:actualHead,base_commit:baseSha},
    root,
    scope:{modules:[],paths:[]},
    limits:{max_changes:500}};
  const configFile=safe(h,root,'.dairn/analyzers.json');
  const actualConfigHash=sha256(h.read(configFile));
  if(h.env('GITHUB_ACTIONS')==='true'||h.env('GITLAB_CI')==='true'){
    const expected=h.env('DAIRN_EXPECTED_ANALYZERS_SHA256');
    assert(expected&&/^[a-f0-9]{64}$/.test(expected)&&expected===actualConfigHash,
      'CI analyzer requires externally pinned DAIRN_EXPECTED_ANALYZERS_SHA256');
  }
  // Include readable file-valued argv entries in the cache key, so changed local analyzers never hit stale cache.
  const sourceDigests=s.execution.argv.filter(a=>a.startsWith('/')&&h.exists(a)&&!h.isDirectory(a)&&!h.isSymlink(a))
    .map(a=>{const raw=h.read(a);assert(raw.length<=1048576,'analyzer source too large for cache fingerprint');return [a,sha256(raw)];});
  const manifest=sha256(JSON.stringify([s,actualConfigHash,sourceDigests,h.env('DAIRN_ANALYZER_TOOLCHAIN_FINGERPRINT')||'unversioned-toolchain']));
  // Never use a cache key based only on HEAD: uncommitted workspace changes must invalidate cached analysis.
  const changed=h.run(['git','status','--porcelain','--untracked-files=all'],root,15);
  assert(changed.code===0&&!changed.timedOut,'cannot inspect workspace state');
  const dirty=changed.output.trim();const cacheable=!dirty;
  const key=sha256(JSON.stringify([req,manifest]));
  const dir=safe(h,root,'.dairn/cache/analyzers');h.mkdirs(dir);
  const cached=at(dir,key+'.json');
  const validResponse=doc=>doc.schema==='dairn.surface-result.v1'&&doc.analyzer_id===id&&doc.domain==='surface'&&
    doc.subject?.source_commit===actualHead&&doc.subject?.base_commit===baseSha;
  if(cacheable&&!refresh&&h.exists(cached)&&!h.isSymlink(cached)){
    try{const rec=JSON.parse(h.read(cached));if(rec.cache_key===key&&validResponse(rec.response)&&Array.isArray(rec.response.changes)&&rec.response.changes.every(c=>validChange(c)))return {source:'local-cache',...rec.response};}catch(_){}
  }
  const suffix=Date.now()+'-'+Math.random().toString(16).slice(2);
  const request=at(dir,'req-'+suffix+'.json'),output=at(dir,'out-'+suffix+'.json');
  assert(!h.exists(request)&&!h.exists(output),'temporary collision');
  try{
    h.writeExclusive(request,JSON.stringify(req)+'\n');
    const result=h.run([...s.execution.argv,request,output],((s.execution.cwd||'.')==='.'?root:safe(h,root,s.execution.cwd)),s.execution.timeout_seconds||120);
    assert(!result.timedOut&&result.code===0,'analyzer failed: '+(result.output||'').slice(0,200));
    assert(h.exists(output)&&!h.isSymlink(output),'analyzer did not create a safe response');
    const raw=h.read(output);assert(raw.length<=1048576,'response too large');
    const doc=JSON.parse(raw);
    assert(validResponse(doc),'response identity mismatch');
    assert(Array.isArray(doc.changes)&&doc.changes.length<=500&&doc.changes.every(validChange),'invalid analyzer results');
    for(const change of doc.changes)safe(h,root,change.path);
    if(cacheable){const tmp=at(dir,'cache-'+suffix+'.json');try{h.writeExclusive(tmp,JSON.stringify({cache_key:key,response:doc})+'\n');h.rename(tmp,cached);}finally{if(h.exists(tmp))h.remove(tmp);}}
    return {source:'analyzer-run',...doc};
  }finally{if(h.exists(request))h.remove(request);if(h.exists(output))h.remove(output);}
}

/* peekAnalyzerResult：只读探测同一请求/清单下的有效缓存，不执行工具、不写任何文件。
 * 选择器用它在计划阶段决定 reuse；缓存仍只是 advisory 本地结果。 */
export function peekAnalyzerResult(h,root,id,{base=null}={}){
  try{
    const s=configuredAnalyzers(h,root).analyzers.find(x=>x.id===id);
    if(!s)return {available:false,reason:'ANALYZER_NOT_CONFIGURED'};
    if((s.mode||'execute')!=='execute')return {available:false,reason:'IMPORT_MODE'};
    const git=h.run(['git','rev-parse','--verify','HEAD^{commit}'],root,15);
    if(git.timedOut||git.code!==0)return {available:false,reason:'GIT_HEAD_UNAVAILABLE'};
    const actualHead=git.output.trim();
    let baseSha=null;if(base){const r=h.run(['git','rev-parse','--verify',base+'^{commit}'],root,15);if(r.timedOut||r.code!==0)return {available:false,reason:'BASE_UNAVAILABLE'};baseSha=r.output.trim();}
    const req={schema:'dairn.analyzer-request.v1',analyzer_id:id,domain:s.domain,
      subject:{source_commit:actualHead,base_commit:baseSha},root,scope:{modules:[],paths:[]},limits:{max_changes:500}};
    const actualConfigHash=sha256(h.read(safe(h,root,'.dairn/analyzers.json')));
    const sourceDigests=s.execution.argv.filter(a=>a.startsWith('/')&&h.exists(a)&&!h.isDirectory(a)&&!h.isSymlink(a))
      .map(a=>[a,sha256(h.read(a))]);
    const manifest=sha256(JSON.stringify([s,actualConfigHash,sourceDigests,h.env('DAIRN_ANALYZER_TOOLCHAIN_FINGERPRINT')||'unversioned-toolchain']));
    const changed=h.run(['git','status','--porcelain','--untracked-files=all'],root,15);
    if(changed.timedOut||changed.code!==0)return {available:false,reason:'WORKSPACE_STATE_UNAVAILABLE'};
    if(changed.output.trim())return {available:false,reason:'DIRTY_WORKSPACE'};
    const key=sha256(JSON.stringify([req,manifest]));
    const cached=at(safe(h,root,'.dairn/cache/analyzers'),key+'.json');
    if(!h.exists(cached)||h.isSymlink(cached))return {available:false,reason:'NOT_CACHED'};
    const rec=JSON.parse(h.read(cached));
    const validResponse=doc=>doc.schema==='dairn.surface-result.v1'&&doc.analyzer_id===id&&doc.domain==='surface'&&
      doc.subject?.source_commit===actualHead&&doc.subject?.base_commit===baseSha;
    if(rec.cache_key===key&&validResponse(rec.response)&&Array.isArray(rec.response.changes)&&rec.response.changes.every(c=>validChange(c)))
      return {available:true,subject:{source_commit:actualHead,base_commit:baseSha},changes:rec.response.changes,source:'local-cache'};
    return {available:false,reason:'CACHE_INVALID'};
  }catch(error){return {available:false,reason:'CACHE_INSPECTION_FAILED',detail:String(error&&error.message||error).slice(0,200)};}
}

/* importAnalysisReport：只读导入一份本地报告并归一化为 Observation。
 * 绝不执行任何工具、不联网；来源未经验证 → unverified-import，
 * 不得因 JSON 自述 ci-verified 而提升信任。 */
export function importAnalysisReport(h,root,id,{artifact=null}={}){
  const registry=configuredAnalyzers(h,root);
  const def=registry.analyzers.find(x=>x.id===id);
  assert(def,'unconfigured '+id);
  assert((def.mode||'execute')==='import','analyzer '+id+' is not mode=import');
  const rel=artifact||def.report.path;
  assert(valid(rel),'unsafe artifact path');
  const path=artifact?assertArtifact(h,root,rel):safe(h,root,rel);
  assert(h.exists(path)&&!h.isDirectory(path)&&!h.isSymlink(path),'report artifact missing or unsafe: '+rel);
  const raw=h.read(path);
  const digest=sha256(raw);
  const observation=normalizeReport(def.report.adapter||REPORT_FORMATS[def.report.format],raw,
    {analyzer_id:id,domain:def.domain,source_path:rel,sha256:digest,kind:'unverified-import'});
  const started=h.now();
  return {schema:'dairn.analysis-run.v1',
    run_id:'analysis-import-'+started+'-'+Math.random().toString(16).slice(2,8),
    analyzer_id:id,domain:def.domain||null,
    status:'completed',imported_artifact:{path:rel,sha256:digest,bytes:raw.length},
    observation,source:'local-import',assurance:'unverified-import',
    note:'unverified import is never ci-verified and never a gate verdict'};
}
function assertArtifact(h,root,rel){return safe(h,root,rel);}

/* executeAnalyzer：执行一个 analyzer 并生成 dairn.analysis-run.v1 机器观察记录。
 * 执行失败（工具错误/超时/响应无效）不抛出，而是产生对应 status 的 run 记录；
 * 配置/Git 类错误（非法配置、无法解析 base）仍抛出。Analysis Run 不是 Check Run，
 * completed 只表示执行与解析成功，绝不表示 Fitness PASS 或 Gate 放行。 */
export function executeAnalyzer(h,root,id,{base=null}={}){
  const registry=configuredAnalyzers(h,root);
  const def=registry.analyzers.find(x=>x.id===id);
  if(!def)throw Error('Analyzer: unconfigured '+id);
  const definitionSha=sha256(JSON.stringify(def));
  const started=h.now();
  const newRun=(status,extra={})=>({
    schema:'dairn.analysis-run.v1',
    run_id:'analysis-'+started+'-'+Math.random().toString(16).slice(2,8),
    analyzer_id:id,domain:def.domain||'surface',
    definition_sha256:definitionSha,
    status,
    source:'local-execution',assurance:'local-observed',
    note:'advisory machine observation; not a check run and never a gate verdict',
    ...extra});
  try{
    const result=runAnalyzer(h,root,id,{base});
    // surface 执行结果经 builtin adapter 归一化为 Observation，供 Quality Fitness 消费。
    const observation=normalizeReport('builtin:dairn-json',JSON.stringify({schema:'dairn.surface-result.v1',
      analyzer_id:id,domain:result.domain,subject:result.subject,changes:result.changes||[]}),
      {analyzer_id:id,domain:result.domain,kind:'local-execution'});
    observation.provenance={kind:result.source==='local-cache'?'local-cache':'local-execution',assurance:'local-observed'};
    return newRun('completed',{
      subject:result.subject,
      from_cache:result.source==='local-cache',
      changes_count:Array.isArray(result.changes)?result.changes.length:0,
      observation,
      duration_ms:Math.max(0,h.now()-started)});
  }catch(e){
    const msg=String(e&&e.message||e);
    const status=/timed? ?out|timeout/i.test(msg)?'timeout'
      :/unconfigured|invalid|identity mismatch|too large|unsafe|symlink|response/i.test(msg)?'report-error'
      :/Git HEAD|cannot resolve base|workspace/i.test(msg)?'invalidated':'tool-error';
    return newRun(status,{error:msg.slice(0,300),duration_ms:Math.max(0,h.now()-started)});
  }
}
