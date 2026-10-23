#!/usr/bin/env node
// Project-owned TypeScript advisory analyzer. Dependencies: Node.js 18+, git. Not a type checker.
import {readFileSync,writeFileSync,existsSync,lstatSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
const [input,output]=process.argv.slice(2);
if (!input||!output) throw Error('usage: analyzer REQUEST.json RESPONSE.json');
const r=JSON.parse(readFileSync(input,'utf8'));
if(r.schema!=='dairn.analyzer-request.v1'||r.domain!=='surface'||!r.subject?.base_commit||!r.analyzer_id)throw Error('invalid request');
const git=(...args)=>execFileSync('git',['-C',r.root,...args],{encoding:'utf8',maxBuffer:4*1024*1024});
function signatures(text){
 const out={};
 // Deliberately limited: exported declarations only. Re-export graphs and type resolution are outside this starter.
 const re=/^\s*export\s+(?:(?:declare|default|abstract|async)\s+)*(?:function|class|interface|type|const|let|enum|namespace)\s+([A-Za-z_$][\w$]*)[^\n]*/gm;
 for(const m of text.matchAll(re))out['export:'+m[1]]=m[0].trim().replace(/\s+/g,' ').slice(0,240);
 return out;
}
const names=git('diff','--name-only','--diff-filter=ACDMRT',r.subject.base_commit,r.subject.source_commit,'--').trim().split('\n').filter(Boolean);
if(names.length>500)throw Error('too many changed files');
const changes=[];
for(const path of names){
 if(!/\.(?:m?js|cjs|jsx|ts|tsx|mts|cts)$/.test(path)||path.startsWith('/')||path.split('/').includes('..'))continue;
 const old=spawnSync('git',['-C',r.root,'show',r.subject.base_commit+':'+path],{encoding:'utf8',maxBuffer:2*1024*1024});
 const before=old.status===0?signatures(old.stdout):{};
 const full=resolve(r.root,path);
 if(!full.startsWith(resolve(r.root)+ '/')&&full!==resolve(r.root))throw Error('unsafe path');
 if(existsSync(full)&&lstatSync(full).isSymbolicLink())throw Error('symlink refused');
 const after=existsSync(full)?signatures(readFileSync(full,'utf8')):{};
 for(const symbol of [...new Set([...Object.keys(before),...Object.keys(after)])].sort()){
   if(before[symbol]===after[symbol])continue;
   changes.push({path,symbol,change:!(symbol in before)?'added':!(symbol in after)?'removed':'changed',before:before[symbol]||'',after:after[symbol]||''});
 }
}
writeFileSync(output,JSON.stringify({schema:'dairn.surface-result.v1',analyzer_id:r.analyzer_id,domain:'surface',subject:{source_commit:r.subject.source_commit,base_commit:r.subject.base_commit},changes})+'\n');
