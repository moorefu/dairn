/* Quality Fitness Evaluator：把 Quality Goals 与 Quality Observations 比较。
 * 纯函数。三条铁律：
 * 1) 缺数据 → UNKNOWN，绝不猜成 PASS；
 * 2) advisory 目标失败只产生 ADVISORY，不阻断；
 * 3) verdict 只是质量层结论，不是 Gate 放行。 */
const METRIC_READERS={
  'findings.count':obs=>obs.findings?obs.findings.length:null,
  'findings.error-count':obs=>obs.findings?obs.findings.filter(f=>f.severity==='error').length:null,
  'tests.failed':obs=>obs.tests?(obs.tests.failed||0)+(obs.tests.errored||0):null,
  'surface.changes':obs=>{const m=(obs.metrics||[]).find(x=>x.id==='quality.surface.changes');return m?m.value:null;},
};
const COMPARE={
  '<=':(a,b)=>a<=b,'>=':(a,b)=>a>=b,'<':(a,b)=>a<b,'>':(a,b)=>a>b,'==':(a,b)=>a===b,
};

export function evaluateFitness(goalsDoc,observations){
  const byProducer=new Map();
  for(const obs of observations||[]){
    if(!obs||obs.schema!=='dairn.quality-observation.v1')continue;
    byProducer.set(obs.analyzer_id,(byProducer.get(obs.analyzer_id)||0)+1);
  }
  const results=[];
  for(const goal of goalsDoc.objectives){
    const base={objective_id:goal.id,type:goal.type,enforcement:goal.enforcement||'advisory',metric:goal.metric,producer:goal.producer||null};
    const read=METRIC_READERS[goal.metric];
    if(!read){results.push({...base,status:'UNKNOWN',reason:'unsupported metric in this release; no verdict is invented'});continue;}
    const candidates=goal.producer?(observations||[]).filter(o=>o&&o.schema==='dairn.quality-observation.v1'&&o.analyzer_id===goal.producer):(observations||[]).filter(o=>o&&o.schema==='dairn.quality-observation.v1');
    const usable=candidates.filter(o=>o&&read(o)!==null);
    if(!usable.length){results.push({...base,status:'UNKNOWN',reason:goal.producer?('no usable observation from producer '+goal.producer):'no usable observation'});continue;}
    // 多份 observation 时取最保守值（阈值判断失败优先暴露）。
    let verdict='PASS',worst=null;
    for(const obs of usable){
      const value=read(obs);
      const op=COMPARE[goal.operator||'<='];
      const ok=op(value,goal.threshold===undefined?0:goal.threshold);
      if(!ok){verdict='FAIL';worst=value;}
    }
    if(verdict==='PASS')results.push({...base,status:'PASS',value:read(usable[0]),samples:usable.length,comparability:'local-only; no trusted baseline comparison'});
    else results.push({...base,status:'FAIL',value:worst,threshold:goal.threshold===undefined?0:goal.threshold,operator:goal.operator||'<=',samples:usable.length,
      note:'local observation only; NOT a gate verdict — required enforcement still needs trusted CI evidence'});
  }
  const requiredFailed=results.some(r=>r.status==='FAIL'&&r.enforcement==='required');
  const requiredUnknown=results.some(r=>r.status==='UNKNOWN'&&r.enforcement==='required');
  const advisoryFailed=results.some(r=>r.status==='FAIL'&&r.enforcement==='advisory');
  const status=requiredFailed?'FAIL':requiredUnknown?'UNKNOWN':advisoryFailed?'ADVISORY':'PASS';
  return {schema:'dairn.quality-fitness.v1',status,results,
    note:'advisory quality layer: PASS never approves a release; required goals still demand trusted Check/Evidence/CI chains'};
}
