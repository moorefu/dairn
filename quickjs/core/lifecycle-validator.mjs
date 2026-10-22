/* Repository event ledger verification. Does not confer approval or identity trust. */
const definitions={
 feedback:{prefix:'FB',states:['new','triaged','linked','closed'], terminal:['closed']},
 incident:{prefix:'INC',states:['detected','mitigating','monitoring','resolved','reviewed','closed'],terminal:['closed']},
 bug:{prefix:'BUG',states:['new','triaged','fixing','verifying','fixed','closed','rejected'],terminal:['closed','rejected']},
 release:{prefix:'REL',states:['planned','approved','deployed','observing','accepted','rolled_back'],terminal:['accepted','rolled_back']},
 action:{prefix:'ACT',states:['open','in_progress','done','waived'],terminal:['done','waived']}
};
const transitions={
 feedback:{new:['triaged'],triaged:['linked','closed'],linked:['closed','triaged'],closed:['triaged']},
 incident:{detected:['mitigating','resolved'],mitigating:['monitoring','resolved'],monitoring:['resolved','mitigating'],resolved:['reviewed','mitigating'],reviewed:['closed','mitigating'],closed:['mitigating']},
 bug:{new:['triaged','rejected'],triaged:['fixing','rejected'],fixing:['verifying','triaged'],verifying:['fixed','fixing'],fixed:['closed','fixing'],closed:['triaged'],rejected:['triaged']},
 release:{planned:['approved'],approved:['deployed'],deployed:['observing','rolled_back'],observing:['accepted','rolled_back'],accepted:['rolled_back'],rolled_back:[]},
 action:{open:['in_progress','waived'],in_progress:['done','waived'],done:['in_progress'],waived:['open']}
};
const evidenceKinds=['metric','alert','log','trace','ticket','pr','test','ci','deployment','dashboard','runbook','other'];
const isObj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const txt=x=>typeof x==='string'&&!!x.trim();
const join=(a,b)=>a.replace(/\/$/,'')+'/'+b;
function parseId(id) {const m=/^(FB|INC|BUG|REL|ACT)-(\d{8})-(\d{3,})$/.exec(id||'');if(!m)throw Error('invalid record id');
  const date=m[2].slice(0,4)+'-'+m[2].slice(4,6)+'-'+m[2].slice(6);
  const d=new Date(date+'T00:00:00Z');if(Number.isNaN(+d)||d.toISOString().slice(0,10)!==date)throw Error('invalid ID date');
  return Object.keys(definitions).find(k=>definitions[k].prefix===m[1]);
}
function recordPath(root,id) {return join(root,'.dairn/governance/operations/'+parseId(id)+'/'+id+'.json');}
function time(t) {if(!txt(t)|| !/(?:Z|[+-]\d\d:\d\d)$/.test(t))throw Error('timestamp requires timezone');
  const v=Date.parse(t);if(Number.isNaN(v))throw Error('invalid timestamp');return v;
}
function postmortem(h,root,id) {
  const errors=[],p=join(root,'docs/postmortems/'+id+'.md');if(!h.exists(p))return ['major incident missing Postmortem '+id];
  const body=h.read(p);if(!body.startsWith('# Postmortem: '+id+'\n'))errors.push('Postmortem title mismatched '+id);
  for(const heading of ['Summary','Impact','Timeline','Contributing factors','Detection and response','Corrective actions','Verification'])
    if(!body.split('\n').some(l=>l.trim()==='## '+heading))errors.push('Postmortem missing '+heading+' '+id);
  if(/\bTODO\b|待填写|<[^>]+>/i.test(body))errors.push('Postmortem contains placeholders '+id);
  return errors;
}
function checkRecord(h,root,obj,file) {
  const errors=[];const fail=msg=>errors.push(file.slice(root.length+1)+': '+msg);
  if(!isObj(obj))return [file+': expected object'];
  let kind;try{kind=parseId(obj.id);if(kind!==obj.type)fail('type and ID mismatch');if(file!==recordPath(root,obj.id))fail('record path mismatched ID');}
  catch(e){return [file+': '+e.message];}
  const def=definitions[kind];if(obj.schema_version!==1)fail('invalid schema_version');
  for(const k of ['title','owner'])if(!txt(obj[k]))fail('missing '+k);
  if(!def.states.includes(obj.status))fail('invalid status');
  if(kind==='incident'&&!['SEV1','SEV2','SEV3','SEV4'].includes(obj.severity))fail('incident requires severity');
  if(kind==='bug'&&!['production','preproduction','development'].includes(obj.origin))fail('bug requires origin');
  if(kind==='feedback'&&!['metric','alert','user','support','operator','test','other'].includes(obj.source))fail('feedback requires source');
  const links=isObj(obj.links)?obj.links:{};
  if(!isObj(obj.links))fail('links must be object');
  for(const [key,values] of Object.entries(links)) {
    if(![...Object.keys(definitions),'note'].includes(key)||!Array.isArray(values)){fail('invalid links.'+key);continue;}
    if(new Set(values.map(String)).size!==values.length)fail('duplicate links.'+key);
    for(const val of values){if(typeof val!=='string'){fail('invalid linked ID');continue;}
      if(key==='note') {
        if(!val.startsWith('.agents/notes/')||val.split('/').includes('..')||!h.exists(join(root,val)))fail('missing or unsafe Note link '+val);
      }else try {if(parseId(val)!==key||!h.exists(recordPath(root,val)))fail('missing or invalid record link '+val);}
      catch(_){fail('invalid linked record '+val);}
    }
  }
  const evidence=Array.isArray(obj.evidence)?obj.evidence:[];if(!Array.isArray(obj.evidence))fail('evidence must be array');
  for(const e of evidence){if(!isObj(e)||!evidenceKinds.includes(e.kind)||!txt(e.ref)||e.ref.trim().length<5)fail('invalid evidence entry');
    else try {time(e.at);}catch(_){fail('invalid evidence timestamp');}}
  const refs=evidence.filter(isObj).map(e=>e.ref);if(new Set(refs).size!==refs.length)fail('duplicate evidence reference');
  const history=obj.history;if(!Array.isArray(history)||!history.length){fail('missing history');return errors;}
  let previous=null,last=-Infinity;
  for(let i=0;i<history.length;i++){
    const e=history[i];if(!isObj(e)){fail('history event not object');continue;}
    try {const timestamp=time(e.at);if(timestamp<last)fail('history time reversed');last=timestamp;}catch(_){fail('invalid history timestamp');}
    if(!txt(e.actor)||!txt(e.reason))fail('history actor/reason required');
    if(i===0){if(e.from!==null||e.to!==def.states[0])fail('first event must initialize initial state');}
    else {if(e.from!==previous)fail('history.from discontinuity');
      if(e.to!==previous && !(transitions[kind][previous]||[]).includes(e.to))fail('invalid transition '+previous+' -> '+e.to);}
    const ev=e.evidence_refs===undefined?[]:e.evidence_refs;
    if(!Array.isArray(ev)||ev.some(x=>!refs.includes(x)))fail('history references unknown evidence');
    if(i>0&&e.to!==previous&&def.terminal.includes(e.to)&&Array.isArray(ev)&&!ev.length)fail('terminal transition requires evidence refs');
    previous=e.to;
  }
  if(obj.status!==previous)fail('status must match final event');
  try {if(time(obj.opened_at)!==time(history[0].at))fail('opened_at mismatch');
    if(time(obj.updated_at)!==time(history[history.length-1].at))fail('updated_at mismatch');}
  catch(_){fail('invalid lifecycle timestamps');}
  const details=isObj(obj.details)?obj.details:{};if(!isObj(obj.details))fail('details must be object');
  if(def.terminal.includes(obj.status)){
    if(!evidence.length)fail('terminal record must have evidence');
    if(kind==='feedback'){
      if(!['duplicate','not-actionable','resolved','linked'].includes(details.disposition))fail('feedback closing disposition required');
      if(details.disposition==='linked'&&!['incident','bug','action'].some(k=>Array.isArray(links[k])&&links[k].length))fail('linked feedback must have downstream record');
    }else if(kind==='incident'){
      if(['impact','mitigation','resolution'].some(k=>!txt(details[k])))fail('incident closure detail missing');
      if(['SEV1','SEV2'].includes(obj.severity)){errors.push(...postmortem(h,root,obj.id));if(!Array.isArray(links.action)||!links.action.length)fail('major incident requires Action');}
    }else if(kind==='bug'&&obj.status==='closed'){
      if(['reproduction','fix_ref','verification_ref'].some(k=>!txt(details[k])))fail('bug closure detail missing');
      if(obj.origin==='production'){
        if(!Array.isArray(links.release)||!links.release.length)fail('production bug missing release');
        else if(!links.release.some(id=>{try{return JSON.parse(h.read(recordPath(root,id))).status==='accepted';}catch(_){return false;}}))fail('production bug requires accepted release');
        if(!details.post_release_observation)fail('production bug requires post-release observation');
        if(!evidence.some(e=>['metric','dashboard','trace','log'].includes(e?.kind)))fail('production bug requires runtime signal evidence');
      }
    }else if(kind==='release'){
      if(['artifact_digest','gate_ref','deployment_ref','observation'].some(k=>!txt(details[k])))fail('release closure detail missing');
      const kinds=new Set(evidence.map(e=>e?.kind));if(!kinds.has('ci')||!kinds.has('deployment'))fail('release requires CI and deployment evidence');
      if(!['metric','dashboard','trace','log','alert'].some(k=>kinds.has(k)))fail('release requires observed signal');
    }else if(kind==='action'&&!txt(details.outcome_ref))fail('action requires outcome_ref');
  }
  return errors;
}
export function lifecycleValidate(h,root,base=null) {
  const errors=[],operation='.dairn/governance/operations',seen=new Set();
  for(const kind of Object.keys(definitions)) {
    const dir=join(root,operation+'/'+kind);
    if(!h.isDirectory(dir)){errors.push('missing operation directory '+kind);continue;}
    for(const name of h.list(dir).sort()) {
      if(name==='.gitkeep')continue;
      const file=join(dir,name);if(h.isDirectory(file)||!name.endsWith('.json')){errors.push('unexpected operations file '+kind+'/'+name);continue;}
      try{const rec=JSON.parse(h.read(file));if(seen.has(rec.id))errors.push('duplicate operation ID '+rec.id);seen.add(rec.id);
        errors.push(...checkRecord(h,root,rec,file));}
      catch(e){errors.push('invalid '+kind+'/'+name+': '+e.message);}
    }
  }
  if(base) {
    // Compare against an externally supplied baseline. The supplied ref is not an approval authority.
    const listing=h.run(['git','ls-tree','-r','--name-only',base,'--',operation],root,30);
    if(listing.code!==0||listing.timedOut)errors.push('cannot load baseline operations: '+(listing.output||''));
    else for(const path of listing.output.split(/\r?\n/).filter(x=>x.endsWith('.json')))try {
      const raw=h.run(['git','show',base+':'+path],root,30);
      if(raw.code!==0)throw Error('cannot read previous '+path);
      const old=JSON.parse(raw.output),file=join(root,path);
      if(!h.exists(file)){errors.push(path+': deleting historical record forbidden');continue;}
      const now=JSON.parse(h.read(file)),a=old.history||[],b=now.history||[];
      if(JSON.stringify(b.slice(0,a.length))!==JSON.stringify(a))errors.push(path+': history append-only violation');
      if(old.id!==now.id||old.type!==now.type)errors.push(path+': cannot mutate record ID/type');
      const nums={SEV1:1,SEV2:2,SEV3:3,SEV4:4};
      if(old.type==='incident'&&nums[old.severity]&&nums[now.severity]&&nums[now.severity]>nums[old.severity])errors.push(path+': severity downgrade forbidden');
      if(JSON.stringify(old)!==JSON.stringify(now)&&b.length<=a.length)errors.push(path+': changed facts without history event');
    }catch(e){errors.push(path+': baseline check '+e.message);}
  }
  return errors;
}
