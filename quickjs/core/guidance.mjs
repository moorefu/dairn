import {factsReport,acceptFacts,impactReport} from './facts.mjs';
/* Project documentation planning/audit: deterministic facts, never invented prose. */
const join=(root,part)=>root.replace(/\/$/,'')+'/'+part;
const present=(h,root,p)=>h.exists(join(root,p))&&!h.isDirectory(join(root,p));
const load=(h,root,p)=>present(h,root,p)?h.read(join(root,p)):null;
function facts(h,root,config){
  return config.modules.map(m=>({
    module:m.name,path:m.path,profiles:m.profiles,
    manifest_candidates:['go.mod','Cargo.toml','pyproject.toml','package.json','pom.xml','build.gradle','build.gradle.kts','nginx.conf']
      .filter(f=>present(h,root,(m.path==='.'?'':m.path+'/')+f))
      .map(f=>(m.path==='.'?'':m.path+'/')+f),
    commands:Object.fromEntries(Object.entries(m.checks||{}).map(([k,x])=>[k,{argv:x.argv,cwd:x.cwd,verified:false}]))
  }));
}
function internalLinks(source){
  const links=[],re=/\[[^\]]*\]\(([^)]+)\)/g;
  let match;while((match=re.exec(source))!==null){const url=match[1].split('#')[0].trim();
    if(url&&!/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(url))links.push(url);
  }return links;
}
function audit(h,root,config){
  const required=['AGENTS.md','README.md','docs/GOVERNANCE_SPEC.md','docs/PROJECT_GUIDE.md'];
  const missing=required.filter(p=>!present(h,root,p)),warnings=[],errors=[];
  for(const p of missing) warnings.push('Missing project documentation: '+p);
  const agents=load(h,root,'AGENTS.md');
  if(agents&&!agents.includes('Dairn:BEGIN managed navigation'))errors.push('AGENTS.md missing Dairn navigation block');
  const readme=load(h,root,'README.md');
  if(readme&&!readme.includes('docs/PROJECT_GUIDE.md'))warnings.push('README.md should link docs/PROJECT_GUIDE.md (preserved team content not auto-edited)');
  const spec=load(h,root,'docs/GOVERNANCE_SPEC.md');
  if(spec&&!spec.includes('.dairn/governance/project.json'))warnings.push('Governance entry missing policy pointer');
  for(const p of ['README.md','docs/PROJECT_GUIDE.md']){
    const content=load(h,root,p);if(!content)continue;
    const prefix=p.includes('/')?'docs/':'';
    for(const link of internalLinks(content)){
      if(link.includes('..')||link.startsWith('~'))continue; // don't validate external project-relative locations or unsafe paths
      if(!present(h,root,prefix+link))warnings.push(p+': broken local Markdown link to '+link);
    }
  }
  return {missing,warnings,errors};
}
export function guidance(h,root,mode,{strict=false,verify,apply=false,base=null,analyzer=null,templates}={}){
  if(!['plan','audit','scaffold','facts','drift','impact'].includes(mode))throw Error('Usage: dairn guide plan | audit [--strict] | scaffold [--apply] | facts [--apply] | drift [--strict]');
  verify?.();
  const config=JSON.parse(h.read(join(root,'.dairn/lock.json'))).config;
  if(mode==='impact'){
    const report=impactReport(h,root,config,{base,analyzer});
    h.log(JSON.stringify({mode,project:config.name,...report},null,2));
    return strict&&['unbaselined','review-required','contract-impact'].includes(report.status)?2:0;
  }
  if(mode==='facts'||mode==='drift'){
    const report=factsReport(h,root,config,{base});
    if(mode==='facts'&&apply&&base)throw Error('Cannot accept a facts baseline while --base is specified');
    if(mode==='facts'&&apply){acceptFacts(h,root,report.current);h.log(JSON.stringify({mode:'facts',status:'baseline-accepted',path:report.snapshot_path,changes_before_accept:report.changes.length},null,2));return 0;}
    const {current,...publicReport}=report;
    h.log(JSON.stringify({...publicReport,mode,project:config.name,actions:report.affected_docs.map(x=>({path:x.path,action:'review',reasons:x.reasons})),note:'This detects changes, not whether documentation is semantically correct; never auto-updates snapshot.'},null,2));
    return strict&&report.status!=='clean'?2:0;
  }
  if(mode==='scaffold'){
    const wanted={'README.md':templates.readme(config),'docs/PROJECT_GUIDE.md':templates.guide(config)};
    const actions=[];
    // Preflight ALL paths before writing any file; no symlink traversal, no overwrite.
    for(const path of Object.keys(wanted)){
      let current=root;
      for(const component of path.split('/')){
        current=join(current,component);
        if(h.isSymlink(current))throw Error('Refuse symlinked documentation path: '+current);
      }
      const full=join(root,path);
      if(h.exists(full)&&h.isDirectory(full))throw Error('Documentation path is a directory: '+full);
      actions.push({path,status:h.exists(full)?'preserved':'create'});
    }
    if(apply){
      const written=[];
      try {
        for(const {path,status} of actions)if(status==='create'){
          const full=join(root,path),parent=full.slice(0,full.lastIndexOf('/'));
          h.mkdirs(parent);
          const tmp=full+'.dairn-guide-tmp-'+Date.now();
          try{h.write(tmp,wanted[path]);h.rename(tmp,full);}finally{if(h.exists(tmp))h.remove(tmp);}
          written.push(full);
        }
      }catch(e){for(const p of written.reverse())try{h.remove(p);}catch(_){}throw e;}
    }
    h.log(JSON.stringify({mode:'scaffold',applied:apply,actions,owned_by:'project; not added to runtime lock'},null,2));
    return 0;
  }
  const report=audit(h,root,config);
  const factDrift=factsReport(h,root,config);
  if(factDrift.status==='drift') report.warnings.push('Project facts drift ('+factDrift.changes.length+' changes): run dairn guide drift');
  else if(factDrift.status==='unbaselined') report.warnings.push('Project facts have no reviewed baseline: run dairn guide facts --apply');
  const out={project:config.name,mode,root,documentation:{
    'AGENTS.md':'Agent-specific navigation and procedures; preserve team-authored instructions',
    'README.md':'Human-facing product overview, verified getting started, module entry points',
    'docs/PROJECT_GUIDE.md':'Project-specific architecture, development, testing, security, open questions',
    'docs/GOVERNANCE_SPEC.md':'Dairn governance navigation; runtime-managed',
    'docs/specs/':'Only verified project contracts, split by topic when necessary',
    '.agents/notes/':'Significant engineering decisions, with required lifecycle semantics'
  },facts:facts(h,root,config),...report};
  if(mode==='plan'){
    out.recommended_skill='dairn-project-guidance';
    out.fact_changes=factDrift.changes;out.affected_docs=factDrift.affected_docs;
    out.workflow=['Inspect actual code, build manifests, and existing user documentation','Separate observed facts from unverified assumptions','Propose README/AGENTS/docs changes as a reviewable diff','Preserve team content and never overwrite runtime-managed policy','Run dairn guide audit; dairn validate; and relevant actual tests'];
    out.scaffolding='Project README and guide are project-owned; neither is included in runtime-managed file hashes';
  }
  h.log(JSON.stringify(out,null,2));
  return report.errors.length||strict&&report.warnings.length?2:0;
}
