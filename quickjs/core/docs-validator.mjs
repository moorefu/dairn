/* SDCL contract: stable document IDs, frontmatter, links, related IDs, query routes. */
import {sha256} from './sha256.mjs';
const required=['id','title','summary','kind','module','keywords','aliases','related'];
const lists=['keywords','aliases','related','symbols'];
const fullid=/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const isStr=x=>typeof x==='string' && !!x.trim();
const join=(a,b)=>a.replace(/\/$/,'')+'/'+b;
function findFiles(h,dir,out) {
  if(!h.isDirectory(dir))return;
  for(const name of h.list(dir).sort()){const p=join(dir,name);
    if(h.isDirectory(p))findFiles(h,p,out);else if(p.endsWith('.md'))out.push(p);
  }
}
function parse(h,root,path) {
  const rel=path.slice(root.length+1),src=h.read(path),lines=src.split('\n');
  if(lines[0]?.trim()!=='---')throw Error(rel+': YAML frontmatter required');
  const data={};let end=-1;
  for(let i=1;i<Math.min(lines.length,60);i++){
    const line=lines[i].trim();if(line==='---'){end=i;break;}
    const m=/^([a-z_]+):\s*(.*)$/.exec(line);if(!m)throw Error(rel+': invalid metadata line '+(i+1));
    const k=m[1],v=m[2];
    if(Object.hasOwn(data,k)||(!required.includes(k)&&k!=='symbols'))throw Error(rel+': duplicate/unknown key '+k);
    if(lists.includes(k)) {let list;try{list=JSON.parse(v);}catch(_){throw Error(rel+': '+k+' needs JSON string array');}
      if(!Array.isArray(list)||list.some(x=>!isStr(x)))throw Error(rel+': invalid '+k);
      data[k]=list;
    } else {if(!v||/^["'\[{]/.test(v))throw Error(rel+': scalar must be unquoted: '+k);data[k]=v;}
  }
  if(end<0)throw Error(rel+': unterminated metadata');
  for(const k of required)if(!(k in data))throw Error(rel+': missing '+k);
  if(!fullid.test(data.id))throw Error(rel+': invalid stable ID '+data.id);
  if(!['spec','reference'].includes(data.kind))throw Error(rel+': invalid kind');
  if(data.kind==='spec'&&rel.split('/')[2]!==data.module)throw Error(rel+': module mismatches specs directory');
  const body=lines.slice(end+1).join('\n');
  if(!body.startsWith('\n# '))throw Error(rel+': body must begin blank line then H1');
  const headings=[],seen=new Set();
  for(const m of body.matchAll(/^## (.+?)\s*$/gm)){
    const title=m[1].trim();const anchor=title.toLowerCase().replace(/[^a-z0-9\u3400-\u9fff -]/g,'').trim().replace(/ /g,'-');
    if(!anchor||seen.has(anchor))throw Error(rel+': invalid or duplicate section anchor '+anchor);
    seen.add(anchor);headings.push({title,anchor});
  }
  return {...data,body,headings,path:rel,sha256:sha256(src)};
}
function terms(text){const result=new Set();
  for(const t of (text||'').toLowerCase().match(/[a-z][a-z0-9_.:/-]*|[\u3400-\u9fff]+|[0-9]+/g)||[]) {
    if(/[\u3400-\u9fff]/.test(t[0])) {
      if(t.length===1)result.add(t);
      else {for(let i=0;i<t.length-1;i++)result.add(t.slice(i,i+2));if(t.length<=6)result.add(t);}
    }else {result.add(t);for(const p of t.split(/[-_]/))if(p)result.add(p);}
  }return result;
}
function score(d,query) {
  const q=query.toLowerCase().trim();if(!q)return 0;
  if(d.id.toLowerCase()===q)return 1000;
  if(d.aliases.some(x=>x.toLowerCase()===q))return 950;
  if((d.symbols||[]).some(x=>x.toLowerCase()===q))return 900;
  const qt=terms(query);if(!qt.size)return 0;
  const sections=[[d.title,18,'title'],[d.aliases.join(' '),16,'alias'],[(d.symbols||[]).join(' '),14,'symbol'],[d.keywords.join(' '),13,'keywords'],[d.summary,8,'summary'],[d.headings.map(h=>h.title).join(' '),7,'heading'],[d.id.replace(/\./g,' '),6,'ID'],[d.body,0.3,'body']];
  let total=0;const matched=new Set();
  for(const [fragment,weight,name] of sections) {
    const set=terms(fragment);let hits=0;for(const t of qt)if(set.has(t)){hits++;matched.add(t);}
    total+=weight*hits/qt.size;
    if(['title','summary','heading','keywords'].includes(name)&&fragment.toLowerCase().includes(q))total+=weight*2;
  }
  return total*(0.3+0.7*matched.size/qt.size);
}
export function docsValidate(h,root) {
  const errors=[],paths=[];findFiles(h,join(root,'docs/specs'),paths);
  const practice=join(root,'docs/best-practices');if(h.isDirectory(practice))for(const x of h.list(practice).sort())if(x.endsWith('.md'))paths.push(join(practice,x));
  const docs=[];for(const p of paths)try{docs.push(parse(h,root,p));}catch(e){errors.push(e.message);}
  const ids=new Map(),aliases=new Map();
  for(const d of docs){
    if(ids.has(d.id))errors.push('duplicate ID '+d.id+' '+ids.get(d.id)+' / '+d.path);ids.set(d.id,d.path);
    for(const a of [d.id,...d.aliases]){const key=a.trim().toLowerCase();if(aliases.has(key)&&aliases.get(key)!==d.id)errors.push('duplicate alias '+a);aliases.set(key,d.id);}
    if(d.related.includes(d.id))errors.push(d.path+': self related ID');
    for(const m of d.body.matchAll(/\]\(([^)]+)\)/g)){
      const target=m[1].split('#')[0];if(!target||/^[a-z][a-z0-9+.-]*:/i.test(target))continue;
      try {const base=join(root,d.path.slice(0,d.path.lastIndexOf('/'))),p=h.realpath(join(base,target));
        if(!p.startsWith(root+'/')||!h.exists(p))throw Error('outside');
      }catch(_){errors.push(d.path+': broken Markdown link '+target);}
    }
  }
  for(const d of docs)for(const ref of d.related)if(!ids.has(ref))errors.push(d.path+': dangling related ID '+ref);
  const route=join(root,'.dairn/governance/docs/query-routes.json');
  if(h.exists(route)&&!errors.length)try {
    const cases=JSON.parse(h.read(route));if(!Array.isArray(cases))throw Error('route file must be array');
    for(const c of cases){if(!c||Object.keys(c).sort().join(',')!=='expected,query'||!isStr(c.expected)||!isStr(c.query))throw Error('invalid route');
      const ranked=docs.map(d=>({d,score:score(d,c.query)})).filter(x=>x.score>0.5).sort((a,b)=>b.score-a.score||a.d.id.localeCompare(b.d.id));
      const winner=ranked[0]?.d.id||null;if(winner!==c.expected)errors.push('query route regression '+c.query+': expected '+c.expected+', got '+winner);
    }
  }catch(e){errors.push('route fixture invalid: '+e.message);}
  return errors;
}
