/* Deterministic advisory workflow router. Never claims human approval or auto-invokes an agent. */
const stages=[
 {id:'orient',skill:'dairn-spec-discovery',goal:'Locate existing project facts, decisions, glossary and authoritative contracts',output:'evidence-backed scope'},
 {id:'grill',skill:'dairn-grill',goal:'Resolve design-tree unknowns with a human interview before specifying',output:'grill questions with no open frontier'},
 {id:'diagnose',skill:'dairn-bugfix',goal:'Find one red-capable and fast failure signal before hypotheses',output:'reproduction command and red result'},
 {id:'specify',skill:'dairn-change-plan',goal:'Specify user-observable result, out-of-scope and test seams',output:'reviewable spec or plan'},
 {id:'slice',skill:'dairn-tracer-tasks',goal:'Break the change into independently verifiable vertical slices',output:'blocking DAG and vertical slice plan'},
 {id:'implement',skill:'dairn-tdd',goal:'Red-green in one tested public seam per slice',output:'real test results'},
 {id:'review',skill:'dairn-code-review',goal:'Separate Standards and Spec Fidelity verdicts, no fake spec pass',output:'two-axis review with sources'},
 {id:'synchronize',skill:'dairn-project-guidance',goal:'Compare observed facts to project documents; propose scoped edits',output:'drift report and human-reviewed documentation diff'},
 {id:'reflect',skill:'dairn-retro',goal:'Record observed process failures and improve automated checks first',output:'concrete environment improvement proposal'}
];
export function recommendWorkflow(text){
 const q=String(text||'').toLowerCase();
 const isBug=/(bug|fail|failure|broken|error|debug|diagnos|故障|报错|修复|异常|排障|问题复现)/.test(q);
 const isDoc=/(docs?|readme|agents\.md|documentation|drift|文档|漂移|项目事实|规范同步)/.test(q);
 const isReview=/(review|audit|pr\b|评审|审查|审核)/.test(q);
 const isIncident=/(incident|postmortem|事故|应急|复盘)/.test(q);
 const isDesign=/(architecture|design|spec|规划|架构|设计|方案)/.test(q);
 let selected=['orient'];
 if(isBug)selected.push('diagnose','implement','review','synchronize');
 else if(isIncident)selected.push('diagnose','review','reflect');
 else if(isDoc)selected.push('synchronize');
 else if(isReview)selected.push('review','synchronize');
 else if(isDesign)selected.push('grill','specify','slice','review','synchronize');
 else selected.push('grill','specify','slice','implement','review','synchronize');
 return {query:text,classification:isBug?'bug':isIncident?'incident':isDoc?'documentation':isReview?'review':isDesign?'design':'change',
   stages:stages.filter(x=>selected.includes(x.id)),
   invariants:['Start from observed repository facts and authoritative specs',
     'Grill resolves design unknowns before Specify; no open questions may remain',
     'Never report an unrun test as passed',
     'For bugs reproduce red before applying a fix',
     'Spec Fidelity is not-applicable without an authoritative spec',
     'No Skill substitutes for protected CI or required human approval'],
   commands:['dairn guide drift','dairn validate','dairn check --base <trusted-base>'],
   note:'This is advisory stage selection, not automated Skill invocation or approvals.'};
}
export function workflowStageList(){return stages;}
