/* Explicit, reviewed contract relationships; never infer a Spec binding from a matching name.
 * Registry is project-owned, optional and NOT proof of semantic compliance.
 */
const relOk=p=>typeof p==='string'&&p.length>0&&!p.startsWith('/')&&!p.includes('\\')&&!p.split('/').some(s=>!s||s==='.'||s==='..');
const at=(r,p)=>r.replace(/\/$/,'')+'/'+p;
const pathSafe=(h,root,rel)=>{
  if(!relOk(rel))return false;
  let next=root;for(const part of rel.split('/')){next=at(next,part);if(h.isSymlink(next))return false;}
  return true;
};
const must=(yes,message)=>{if(!yes)throw Error('Relations: '+message);};
const idPattern=/^[a-z][a-z0-9.-]+$/;
export function readRelations(h,root,facts,{base=null}={}){
  let raw=null,source='working-tree';
  if(base){
    const r=h.run(['git','rev-parse','--verify',base+'^{commit}'],root,15);
    must(!r.timedOut&&r.code===0,'unresolved trusted base '+base);
    const sha=r.output.trim(),old=h.run(['git','show',sha+':.dairn/relations.json'],root,15);
    must(!old.timedOut,'timeout reading base relations');
    if(old.code===0){raw=old.output;source='git:'+sha;
      const oldFacts=h.run(['git','show',sha+':.dairn/facts/project-facts.json'],root,15);
      if(oldFacts.code===0&&!oldFacts.timedOut)facts=JSON.parse(oldFacts.output);
    }
    else source='git:'+sha+':no-registry';
  }else{
    const path=at(root,'.dairn/relations.json');
    must(pathSafe(h,root,'.dairn/relations.json'),'symlinked relation registry is prohibited');
    if(h.exists(path))raw=h.read(path);
  }
  if(raw===null)return {source,bindings:[],nodes:[],edges:[]};
  let doc;
  try{doc=JSON.parse(raw);}catch(e){throw Error('Relations JSON is invalid: '+e.message);}
  must(doc.schema===1&&Array.isArray(doc.bindings),'expected schema:1 and bindings array');
  must(doc.bindings.length<=250,'too many bindings');
  const specSet=new Set((facts.specs||[]).map(s=>s.id).filter(Boolean));
  const symbols=new Map();
  for(const file of facts.code_surfaces||[])for(const entry of file.symbols||[]){
    const name=entry.split(':')[0];symbols.set(file.path+'#'+name,{name,path:file.path,language:file.language});
  }
  const nodes=new Map(),edges=[],bindings=[],used=new Set();
  const node=(id,type,path)=>{if(!nodes.has(id))nodes.set(id,{id,type,...(path?{source:path}:{})});};
  for(const b of doc.bindings){
    must(b&&typeof b==='object'&&!Array.isArray(b),'invalid binding');
    must(idPattern.test(b.spec_id||'')&&specSet.has(b.spec_id),'unrecognized authoritative spec_id: '+b.spec_id);
    must(b.symbol&&pathSafe(h,root,b.symbol.path)&&/^[A-Za-z_]\w*$/.test(b.symbol.name||''),'symbol requires safe path and identifier');
    const symbol=symbols.get(b.symbol.path+'#'+b.symbol.name);
    must(!!symbol,'unobserved public symbol: '+b.symbol.path+'#'+b.symbol.name);
    const key=b.spec_id+'|'+b.symbol.path+'#'+b.symbol.name;
    must(!used.has(key),'duplicate spec/symbol binding: '+key);used.add(key);
    const tests=b.tests||[],docs=b.docs||[];
    must(Array.isArray(tests)&&Array.isArray(docs)&&tests.length<=30&&docs.length<=30,'invalid tests/docs array');
    for(const p of [...tests,...docs]){
      must(pathSafe(h,root,p)&&h.exists(at(root,p))&&!h.isDirectory(at(root,p)),'missing/unsafe relation target '+p);
    }
    const sid='spec:'+b.spec_id,symid='symbol:'+symbol.language+':'+symbol.path+'#'+symbol.name;
    node(sid,'spec',(facts.specs||[]).find(s=>s.id===b.spec_id)?.path);
    node(symid,'symbol',symbol.path);
    edges.push({from:sid,to:symid,type:'specifies',confidence:'explicit-reviewed-registry',source});
    for(const path of tests){const tid='test:'+path;node(tid,'test',path);edges.push({from:tid,to:symid,type:'verifies',confidence:'explicit-reviewed-registry',source});}
    for(const path of docs){const did='doc:'+path;node(did,'document',path);edges.push({from:did,to:sid,type:'documents',confidence:'explicit-reviewed-registry',source});}
    bindings.push({spec_id:b.spec_id,symbol,tests,docs});
  }
  return {source,bindings,nodes:[...nodes.values()].sort((a,b)=>a.id.localeCompare(b.id)),edges};
}
export function addRelationsToImpact(h,root,report,facts,{base=null}={}){
  if(base){
    const test=h.run(['git','diff','--name-only',base,'HEAD','--','.dairn/relations.json'],root,15);
    must(!test.timedOut&&test.code===0,'cannot compare relation registry to trusted base');
    if(test.output.trim()){
      report.impacts.push({path:'.dairn/relations.json',category:'relation-registry',level:'review-required',change:'changed',confidence:'not-trusted-until-reviewed'});
      report.status=report.status==='contract-impact'?'contract-impact':'review-required';
      report.counts.changes=report.impacts.length;
      if(!report.affected_docs.some(x=>x.path==='AGENTS.md'))report.affected_docs.push({path:'AGENTS.md',reasons:['Relation registry changed; review authoritative contract navigation']});
    }
  }
  const reg=readRelations(h,root,facts,{base});
  for(const impact of report.impacts||[]){
    const matched=reg.bindings.filter(b=>b.symbol.path===impact.path||(impact.category==='spec'&&b.spec_id===impact.spec_id));
    if(matched.length){
      impact.explicit_relations=matched.map(b=>({spec_id:b.spec_id,symbol:b.symbol.path+'#'+b.symbol.name,tests:b.tests,docs:b.docs}));
      impact.analysis_method='explicit-registry-plus-static-diff';
      const targets=new Set([...(impact.affected_docs||[]),...matched.flatMap(b=>b.docs)]);
      impact.affected_docs=[...targets].sort();
    }
  }
  const changed= new Map((report.impacts||[]).flatMap(i=>(i.explicit_relations||[]).flatMap(x=>[[x.spec_id,x]])));
  const extra=[...new Set([...changed.values()].flatMap(x=>x.docs))].sort();
  for(const path of extra)if(!report.affected_docs.some(x=>x.path===path))report.affected_docs.push({path,reasons:['Explicit Spec/symbol relation affected by change']});
  report.affected_docs.sort((a,b)=>a.path.localeCompare(b.path));
  report.counts.affected_documents=report.affected_docs.length;
  report.relationships={source:reg.source,nodes:reg.nodes,edges:reg.edges,explicit_bindings:reg.bindings.length,assurance:'bindings were structurally verified; semantic correctness requires independent review'};
  return report;
}
