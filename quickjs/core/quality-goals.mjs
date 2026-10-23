/* Quality Goals v1 (.dairn/governance/quality-goals.json)。
 * 目标定义"要保护什么"；强制性只由受信配置决定，Analyzer 不能自设。
 * 纯函数模块：不读文件、不执行命令。 */
const assert=(v,m)=>{if(!v)throw Error('QualityGoals: '+m);};
export const GOAL_TYPES=new Set(['invariant','regression','trend']);
export const ENFORCEMENTS=new Set(['required','advisory']);
const OPERATORS=new Set(['<=','>=','<','>','==']);

export function validateQualityGoals(doc){
  assert(doc&&doc.schema==='dairn.quality-goals.v1','expected {schema:"dairn.quality-goals.v1", objectives:[]}');
  assert(Array.isArray(doc.objectives)&&doc.objectives.length<=64,'objectives must be an array (<=64)');
  const ids=new Set();
  for(const g of doc.objectives){
    assert(g&&/^[a-z][a-z0-9.-]{1,64}$/.test(g.id||''),'invalid objective id');assert(!ids.has(g.id),'duplicate objective '+g.id);ids.add(g.id);
    assert(GOAL_TYPES.has(g.type),'invalid type (invariant|regression|trend): '+g.type);
    assert(ENFORCEMENTS.has(g.enforcement||'advisory'),'invalid enforcement (required|advisory)');
    assert(typeof g.metric==='string'&&/^[a-z][a-z0-9.*-]{1,80}$/.test(g.metric),'invalid metric');
    if(g.operator!==undefined||g.threshold!==undefined){
      assert(OPERATORS.has(g.operator),'invalid operator');
      assert(typeof g.threshold==='number'&&Number.isFinite(g.threshold),'threshold must be a finite number');
    }
    assert(g.producer===undefined||/^[a-z][a-z0-9-]{1,48}$/.test(g.producer),'invalid producer analyzer id');
    assert(g.attribute===undefined||typeof g.attribute==='string'&&g.attribute.length<=64,'invalid attribute');
  }
  return doc;
}
export function loadQualityGoals(h,root,read){
  // read(path)→text|null 由调用方提供（host 受控读取）；文件不存在视为未配置。
  const raw=read('.dairn/governance/quality-goals.json');
  if(raw===null||raw===undefined)return null;
  return validateQualityGoals(JSON.parse(raw));
}
