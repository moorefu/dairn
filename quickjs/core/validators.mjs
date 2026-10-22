/* Dairn validation contracts ported to portable ES Modules for official QuickJS.
 * These are structural checks, NOT proof of human approval or trusted CI execution.
 */
import {tasksValidate} from './tasks.mjs';
const posix = p => p.replace(/\\/g, '/');
const join = (a,b) => a.replace(/\/$/,'')+'/'+b;
const isObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const nonempty = x => typeof x==='string' && !!x.trim();
function readJson(h,p) {return JSON.parse(h.read(p));}
function exists(h,r,p) {return h.exists(join(r,p));}
function collect(h,p, predicate=()=>true) {
  if(!h.exists(p)) return [];
  const out=[];
  function walk(dir) {for(const name of h.list(dir).sort()) {
    const f=join(dir,name);
    if(h.isDirectory(f)) walk(f);
    else if(predicate(f)) out.push(f);
  }} walk(p); return out;
}
function rel(root,file) {return file.slice(root.length).replace(/^\//,'');}
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function validDate(s) { const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s); if(!m)return false;
 const d=new Date(s+'T00:00:00Z'); return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0,10)===s; }
function localLink(h,base,target,root) {
  try { const a=h.realpath(join(base,target)); return (a===root || a.startsWith(root+'/')) && h.exists(a); } catch(_) {return false;}
}
export function skillsValidate(h,root) {
  const errors=[], dir=join(root,'.agents/skills'); if(!h.isDirectory(dir))return ['missing .agents/skills'];
  const found=[];
  for(const name of h.list(dir).sort()) {
    const d=join(dir,name); if(!h.isDirectory(d))continue;
    const skill=join(d,'SKILL.md'); if(!h.exists(skill)){errors.push(name+': missing SKILL.md');continue;}
    const text=h.read(skill), fm=/^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
    if(!fm){errors.push(name+': invalid YAML header');continue;}
    const data={};
    for(const line of fm[1].split(/\r?\n/)) { const i=line.indexOf(':');
      if(i<1 || Object.prototype.hasOwnProperty.call(data,line.slice(0,i))) {errors.push(name+': invalid/duplicate metadata: '+line); continue;}
      data[line.slice(0,i)]=line.slice(i+1).trim().replace(/^['"]|['"]$/g,'');
    }
    if(data.name!==name || name.length>64)errors.push(name+': name mismatch');
    if(!nonempty(data.description) || data.description.length>1024)errors.push(name+': missing/invalid description');
    if(!['stable','experimental','deprecated'].includes(data['dairn-stage']))errors.push(name+': invalid dairn-stage');
    if(data['dairn-stage']==='deprecated'&&!nonempty(data['dairn-replaced-by']))errors.push(name+': deprecated requires replacement');
    const manual=data['disable-model-invocation']==='true';
    if(!['true','false',undefined].includes(data['disable-model-invocation']))errors.push(name+': invalid invocation flag');
    const sidecar=join(d,'agents/openai.yaml');
    if(!h.exists(sidecar))errors.push(name+': missing agents/openai.yaml');
    else {const txt=h.read(sidecar), ps=[...txt.matchAll(/^\s+allow_implicit_invocation:\s*(\S+)/gm)].map(m=>m[1]);
      if(ps.length>1 || (manual&&JSON.stringify(ps)!=='["false"]') || (!manual&&ps.length&&JSON.stringify(ps)!=='["true"]')) errors.push(name+': inconsistent invocation policy');
      if(!txt.includes('interface:') || !txt.includes('display_name:'))errors.push(name+': sidecar missing interface label');
    }
    found.push({name,replacement:data['dairn-replaced-by']});
  }
  const names=new Set(found.map(x=>x.name));
  for(const s of found)if(s.replacement && (!names.has(s.replacement)||s.name===s.replacement))errors.push(s.name+': invalid replacement');
  return errors;
}
export function glossaryValidate(h,root) {
  const errors=[];let files=[];
  if(exists(h,root,'GLOSSARY-MAP.md')) {
    const map=h.read(join(root,'GLOSSARY-MAP.md'));
    const refs=[...map.matchAll(/\]\(([^)#]+\.md)\)/g)].map(m=>m[1]);
    if(!refs.length)errors.push('GLOSSARY-MAP.md must link at least one Glossary');
    const seen=new Set(); for(const path of refs) {
      try {const abs=h.realpath(join(root,path));
        if(!abs.startsWith(root+'/') || !abs.endsWith('/GLOSSARY.md') || seen.has(abs))throw Error('invalid or duplicate');
        seen.add(abs);files.push(abs);
      }catch(e){errors.push('invalid Glossary Map target: '+path);}
    }
  } else if(exists(h,root,'GLOSSARY.md'))files=[join(root,'GLOSSARY.md')];
  for(const file of files) {
    const text=h.read(file);
    if(!text.startsWith('# '))errors.push(rel(root,file)+': missing H1');
    const titles=[...text.matchAll(/^## ([^\n]+)$/gm)];
    if(!titles.length)errors.push(rel(root,file)+': no terms');
    const seen=new Set();
    for(let i=0;i<titles.length;i++) {
      const title=titles[i][1].trim(), desc=text.slice(titles[i].index+titles[i][0].length, i+1<titles.length?titles[i+1].index:text.length).trim();
      if(!title || !desc || desc.startsWith('#'))errors.push(rel(root,file)+': empty definition '+title);
      const key=title.toLowerCase(); if(seen.has(key))errors.push(rel(root,file)+': repeated term '+title);seen.add(key);
    }
  }
  return errors;
}
export function feedbackValidate(h,root) {
  const errors=[];
  for(const type of ['feedback','reviews']) {
    const dir=join(root,'.dairn/governance/engineering/'+type);
    for(const file of collect(h,dir,p=>p.endsWith('.json')))try {
      const d=readJson(h,file);
      if(!isObj(d)|| !/^[A-Za-z0-9_.-]+$/.test(d.id||''))throw Error('invalid id');
      if(type==='feedback') {
        for(const k of ['symptom','command','expected','actual','red_evidence','green_evidence','head'])if(!nonempty(d[k]))throw Error('missing '+k);
        if(d.red_evidence===d.green_evidence)throw Error('red and green references must differ');
      }else {
        for(const k of ['standards','spec']) {
          if(!isObj(d[k])|| !['pass','fail','needs-evidence','not-applicable'].includes(d[k].status))throw Error('invalid '+k+' axis');
          if(!nonempty(d[k].reason))throw Error('missing '+k+' reason');
        }
        if(!nonempty(d.head))throw Error('missing head');
        if(d.spec.status==='pass'&&!d.spec_ref)throw Error('passing spec axis needs spec_ref');
      }
    }catch(e){errors.push(rel(root,file)+': '+e.message);}
  }
  return errors;
}
const NOTE_STATES=['proposed','implemented','rejected'];
const NOTE_CATEGORIES=['feature','bug-fix','simplification','architecture','process','testing','security'];
const NOTE_REQUIRED={proposed:['Problem','Proposal','Alternatives considered','Acceptance criteria','Risks'],implemented:['Problem','Decision','Alternatives considered','Consequences'],rejected:['Problem','Proposal','Alternatives considered']};
function proseLines(text) {const out=[];let mark=null, width=0;
  for(const line of text.split(/\r?\n/)){const m=/^ {0,3}(`{3,}|~{3,})/.exec(line);
    if(m){if(mark===null){mark=m[1][0];width=m[1].length;continue;}if(mark===m[1][0]&&m[1].length>=width){mark=null;continue;}}
    if(mark===null)out.push(line);
  }return out;
}
export function notesValidate(h,root) {
  const errors=[],base=join(root,'.agents/notes');if(!h.isDirectory(base))return ['missing .agents/notes'];
  for(const child of h.list(base))if(h.isDirectory(join(base,child))&&!NOTE_STATES.concat('archived').includes(child))errors.push('unexpected Notes state '+child);
  if(exists(h,root,'.agents/notes/INDEX.md'))errors.push('Notes INDEX.md forbidden');
  for(const state of NOTE_STATES){const dir=join(base,state);
    if(!h.isDirectory(dir)){errors.push('missing Notes lifecycle '+state);continue;}
    for(const child of h.list(dir)) {
      const p=join(dir,child);
      if(h.isDirectory(p)&&!NOTE_CATEGORIES.includes(child))errors.push('invalid Note category: '+state+'/'+child);
    }
    for(const file of collect(h,dir)) {
      const name=rel(base,file),parts=name.split('/');
      if(file.endsWith('/.gitkeep')||file.endsWith('.zh.md')||file.endsWith('.i18n.yaml')|| ['AGENTS.md','CLAUDE.md'].includes(parts[parts.length-1]))continue;
      if(!name.endsWith('.md')||parts.length!==3||!NOTE_CATEGORIES.includes(parts[1])||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(parts[2])){errors.push('invalid Note filename: '+name);continue;}
      if(!validDate(parts[2].slice(0,10)))errors.push('invalid Note date: '+name);
      const text=h.read(file),lines=text.split(/\r?\n/),prose=proseLines(text);
      if(lines.length<5||!/^# Agent Note: \S/.test(lines[0])||lines[1]!==''||lines[3]!=='')errors.push('invalid Note header: '+name);
      const status=lines[2];
      if(state==='rejected'?!/^Status: rejected — \S/.test(status):status!=='Status: '+state)errors.push('invalid Note status: '+name);
      if(prose.filter(s=>s.startsWith('Status:')).length!==1)errors.push('Note must have one status: '+name);
      const headings=prose.map((line,i)=>({line,i})).filter(x=>x.line.startsWith('## '));
      if(!headings.length||headings[0].line!=='## Problem')errors.push('Note must begin with Problem: '+name);
      for(const req of NOTE_REQUIRED[state])if(!headings.some(x=>x.line==='## '+req))errors.push('Note missing '+req+': '+name);
      if(state==='implemented'&&headings.some(x=>/^## (Proposal\b|Plan\b|Migration plan\b|Acceptance criteria\b)/i.test(x.line)))errors.push('implemented Note retains proposal heading: '+name);
      if(new Set(headings.map(x=>x.line)).size!==headings.length)errors.push('duplicate Note heading: '+name);
      for(let i=0;i<headings.length;i++) {
        const from=headings[i].i+1, to=i+1<headings.length?headings[i+1].i:prose.length;
        if(!prose.slice(from,to).some(l=>l.trim()&&!l.trim().startsWith('<!--')))errors.push('empty Note section: '+headings[i].line+' '+name);
      }
      for(const line of prose)for(const m of line.matchAll(/(?<!!)\[[^\]\n]+\]\(([^)]+)\)/g)){
        const target=m[1].split('#')[0].split('?')[0];
        if(!target||target.includes('://')||target.startsWith('mailto:'))continue;
        if(!localLink(h,file.slice(0,file.lastIndexOf('/')),target,root))errors.push('broken Note link '+name+' -> '+target);
      }
    }
  }
  return errors;
}
export const validators={skills:skillsValidate,glossary:glossaryValidate,tasks:tasksValidate,feedback:feedbackValidate,notes:notesValidate};
export function validateAll(h,root,modules=Object.keys(validators)) {
  const detail={},errors=[];
  for(const name of modules){if(!validators[name])throw Error('Unknown validator '+name);
    try {detail[name]=validators[name](h,root);}catch(e){detail[name]=['validator crashed: '+e.message];}
    errors.push(...detail[name].map(e=>name+': '+e));
  }
  return {detail,errors};
}
export function archiveValidate(h,root,base=null) {
  const errors=[],dir=join(root,'.agents/notes/archived'),mp=join(dir,'sha256.json');
  if(!h.exists(mp))return ['missing archived/sha256.json'];
  let manifest;try{manifest=JSON.parse(h.read(mp));if(!isObj(manifest))throw Error('manifest must be map');}
  catch(e){return ['invalid archive manifest: '+e.message];}
  if(base){const raw=h.run(['git','show',base+':.agents/notes/archived/sha256.json'],root,30);
    if(raw.code===0)try{const prev=JSON.parse(raw.output);if(!isObj(prev))throw Error('baseline must be map');
      for(const [name,digest] of Object.entries(prev))if(manifest[name]!==digest)errors.push('sealed manifest entry mutated: '+name);
    }catch(e){errors.push('archive baseline invalid: '+e.message);}
    else {const ref=h.run(['git','cat-file','-e',base+'^{commit}'],root,30);
      if(ref.code!==0)errors.push('unresolvable trusted base '+base);}
  }
  const files=collect(h,dir,p=>p.endsWith('.md')||p.endsWith('.i18n.yaml'));
  const actual=new Map(files.map(f=>[rel(dir,f),sha256(h.read(f))]));
  for(const [name,hash] of Object.entries(manifest)){
    if(typeof name!=='string'||name.startsWith('/')||name.split('/').includes('..')||name.includes('\\')){errors.push('unsafe archive path '+name);continue;}
    if(!/^[0-9a-f]{64}$/.test(hash))errors.push('invalid sealed digest '+name);
    else if(!actual.has(name))errors.push('missing sealed file '+name);
    else if(actual.get(name)!==hash)errors.push('sealed archive mutated '+name);
  }
  for(const [name] of actual) {
    if(!(name in manifest))errors.push('unsealed archive '+name);
    if(!new RegExp('^('+NOTE_CATEGORIES.join('|')+')/\\d{4}-\\d{2}-\\d{2}-[a-z0-9-]+(?:\\.zh\\.md|\\.i18n\\.yaml|\\.md)$').test(name))errors.push('invalid archive filename '+name);
    if(name.endsWith('.md')){
      const lines=h.read(join(dir,name)).split(/\r?\n/),idx=lines.indexOf('Status: implemented');
      const date=idx>=0?lines[idx+1]?.replace(/^Archived: /,''):'';
      if(idx<0||!lines[idx+1]?.startsWith('Archived: ')||!validDate(date)||date<name.split('/').pop().slice(0,10))errors.push('invalid Archived metadata '+name);
    }
  }
  if(base) {
    const diff=h.run(['git','diff','--name-only','-z',base,'HEAD','--','.agents/notes/archived'],root,30);
    if(diff.code!==0 || diff.timedOut)errors.push('cannot resolve archive diff baseline');
    else for(const path of diff.output.split('\0').filter(x=>x && x!=='.agents/notes/archived/sha256.json')) {
      const old=h.run(['git','cat-file','-e',base+':'+path],root,30);
      if(old.code===0){errors.push('previously archived Note changed: '+path);continue;}
      const previous=path.replace('/archived/','/implemented/');
      const origin=h.run(['git','show',base+':'+previous],root,30);
      if(origin.code!==0){errors.push('archive missing implemented origin: '+path);continue;}
      if(path.endsWith('.md')){
        if(!h.exists(join(root,path))){errors.push('archived Note missing: '+path);continue;}
        const current=h.read(join(root,path)).replace(/^Archived: \d{4}-\d{2}-\d{2}\r?\n/m,'');
        if(current!==origin.output)errors.push('archive migration changed decision content: '+path);
      }
    }
  }
  return errors;
}
validators.archive=archiveValidate;
