/* Report Adapters：把 SARIF 2.1.0 / JUnit XML / Dairn JSON 归一化为
 * dairn.quality-observation.v1。纯函数：不读文件、不联网、不执行命令。
 * 解析器保守失败：DOCTYPE/ENTITY/CDATA、越界 URI、结构缺失、超限元素数
 * 一律 report-error，绝不把"解析失败"当成"零发现"。
 * Observation 是机器归一化事实，不是 Fitness PASS，更不是 Gate 放行。
 */
const MAX_FINDINGS=500;
const validRel=p=>typeof p==='string'&&p.length>0&&p.length<=512&&!p.includes('\\')&&!p.startsWith('/')&&!p.split('/').some(x=>!x||x==='.'||x==='..');
const assert=(v,m)=>{if(!v)throw Error('Adapter: '+m);};

function baseObservation(context){
  return {schema:'dairn.quality-observation.v1',
    analyzer_id:context.analyzer_id,
    domain:context.domain||null,
    imported_from:context.source_path||null,
    imported_sha256:context.sha256||null,
    provenance:{kind:context.kind||'unverified-import',assurance:'unverified-import'},
    findings:[],metrics:[],tests:null,
    note:'adapter-normalized machine observation; unverified import is never ci-verified'};
}

/* ---- SARIF 2.1.0 ---- */
function fromSarif(raw,context){
  let doc;try{doc=JSON.parse(raw);}catch(_){throw Error('Adapter: SARIF is not valid JSON');}
  const schema=String(doc?.$schema||'');
  // 版本以 version 字段为准；$schema 存在时仅要求它自称 sarif（官方 URI 形态多样）。
  assert(doc&&doc.version==='2.1.0'&&(!schema||/sarif/i.test(schema)),'not SARIF 2.1.0');
  assert(Array.isArray(doc.runs),'SARIF runs[] missing');
  const obs=baseObservation(context);
  for(const run of doc.runs){
    assert(run&&typeof run==='object','invalid SARIF run');
    const results=Array.isArray(run.results)?run.results:[];
    assert(results.length<=2000,'too many SARIF results');
    for(const r of results){
      if(!r||typeof r!=='object')continue;
      const loc=r.locations?.[0]?.physicalLocation;
      let path=null,line=null;
      if(loc){
        const uri=loc.artifactLocation?.uri;
        if(typeof uri==='string'&&uri.length>0){
          let clean=uri.replace(/^file:\/\//,'');
          if(clean.startsWith('file:'))throw Error('Adapter: non-http SARIF URI scheme refused');
          clean=decodeURIComponent(clean);
          if(!validRel(clean))throw Error('Adapter: SARIF URI escapes repository root: '+uri.slice(0,120));
          path=clean;line=Number.isInteger(loc.region?.startLine)&&loc.region.startLine>0?loc.region.startLine:null;
        }
      }
      const fingerprint=(r.fingerprints&&typeof r.fingerprints['dairn/v1']==='string'&&r.fingerprints['dairn/v1'])||null;
      obs.findings.push({rule_id:typeof r.ruleId==='string'&&r.ruleId?r.ruleId.slice(0,200):'unknown-rule',
        severity:['error','warning','note','none'].includes(r.level)?r.level:'warning',
        fingerprint:fingerprint&&/^[A-Za-z0-9._:-]{1,200}$/.test(fingerprint)?fingerprint:null,
        fingerprint_basis:fingerprint?'stable':'heuristic',
        location:{path,line},
        message:typeof r.message?.text==='string'?r.message.text.slice(0,400):''});
      if(obs.findings.length>MAX_FINDINGS)throw Error('Adapter: too many findings');
    }
  }
  return obs;
}

/* ---- JUnit XML（受限、保守的解析器）----
 * 只接受扁平的 <testsuites>/<testsuite>/<testcase>(/<failure|error|skipped>) 结构；
 * DOCTYPE/ENTITY/CDATA/处理指令/嵌套 <properties> 一律拒绝；不做任何外部解析。 */
function fromJunit(raw,context){
  // 允许且仅允许标准 XML 声明 <?xml ...?>；其余处理指令与外部实体构造一律拒绝。
  const noDecl=raw.replace(/^<\?xml[^?]*\?>/i,'');
  assert(!/<!DOCTYPE|<!ENTITY|<!\[CDATA\[|<\?/i.test(noDecl),'JUnit XML contains refused constructs (DOCTYPE/ENTITY/CDATA/PI)');
  const total={tests:0,failures:0,errors:0,skipped:0};
  const findings=[];
  const suiteAttrRe=/<testsuite\s+([^>]*)>/g;
  let m;
  while((m=suiteAttrRe.exec(raw))!==null){
    const attrs=parseAttrs(m[1]);
    total.tests+=toCount(attrs.tests);total.failures+=toCount(attrs.failures);
    total.errors+=toCount(attrs.errors);total.skipped+=toCount(attrs.skipped);
  }
  const caseRe=/<testcase\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
  let caseCount=0;
  while((m=caseRe.exec(raw))!==null){
    if(++caseCount>5000)throw Error('Adapter: too many JUnit testcases');
    const attrs=parseAttrs(m[1]);const body=m[2]||'';
    const name=(attrs.name||'unknown').slice(0,200);const cls=attrs.classname?attrs.classname.slice(0,200):null;
    if(/<failure[\s>]/i.test(body)){
      total.failures+=0; // 计数以 testsuite 属性为准；这里只登记 finding
      findings.push({rule_id:'junit.failure',severity:'error',fingerprint:null,fingerprint_basis:'heuristic',
        location:{path:context.source_path||null,line:null},message:(cls?cls+' :: ':'')+name});
    }else if(/<error[\s>]/i.test(body)){
      findings.push({rule_id:'junit.error',severity:'error',fingerprint:null,fingerprint_basis:'heuristic',
        location:{path:context.source_path||null,line:null},message:(cls?cls+' :: ':'')+name});
    }
    if(findings.length>MAX_FINDINGS)throw Error('Adapter: too many findings');
  }
  assert(/<\/testsuites>|<\/testsuite>/.test(raw),'JUnit XML has no testsuite root');
  const obs=baseObservation(context);
  obs.tests={total:total.tests,failed:total.failures,errored:total.errors,skipped:total.skipped};
  obs.findings=findings;
  obs.metrics.push({id:'quality.tests.failed',value:total.failures+total.errors,unit:'count',aggregation:'total'});
  return obs;
}
const parseAttrs=s=>{const out={};const re=/([a-zA-Z_][\w.-]*)\s*=\s*"([^"]*)"/g;let m;while((m=re.exec(s))!==null)out[m[1]]=m[2];return out;};
const toCount=v=>{const n=Number(v);return Number.isInteger(n)&&n>=0&&n<=1e6?n:0;};

/* ---- Dairn JSON（surface-result 或既有 observation）---- */
function fromDairnJson(raw,context){
  let doc;try{doc=JSON.parse(raw);}catch(_){throw Error('Adapter: Dairn JSON is not valid JSON');}
  if(doc.schema==='dairn.quality-observation.v1'){
    assert(Array.isArray(doc.findings)&&Array.isArray(doc.metrics),'invalid observation arrays');
    return {...baseObservation(context),findings:doc.findings.slice(0,MAX_FINDINGS),metrics:doc.metrics.slice(0,100),tests:doc.tests||null};
  }
  if(doc.schema==='dairn.surface-result.v1'){
    const obs=baseObservation(context);
    obs.domain='surface';
    assert(Array.isArray(doc.changes),'surface result changes[] missing');
    obs.findings=doc.changes.slice(0,MAX_FINDINGS).map(c=>({rule_id:'surface.'+c.change,severity:'warning',
      fingerprint:null,fingerprint_basis:'heuristic',location:{path:c.path,line:null},
      message:c.symbol+' ('+c.change+')'}));
    obs.metrics.push({id:'quality.surface.changes',value:doc.changes.length,unit:'count',aggregation:'total'});
    return obs;
  }
  throw Error('Adapter: unsupported Dairn JSON schema '+String(doc&&doc.schema));
}

export function normalizeReport(adapterId,raw,context={}){
  assert(typeof raw==='string'&&raw.length>0&&raw.length<=1048576,'empty or oversized report');
  if(adapterId==='builtin:sarif')return fromSarif(raw,context);
  if(adapterId==='builtin:junit')return fromJunit(raw,context);
  if(adapterId==='builtin:dairn-json')return fromDairnJson(raw,context);
  throw Error('Adapter: unknown adapter '+adapterId);
}
export const REPORT_FORMATS={
  'sarif-2.1.0':'builtin:sarif',
  'junit-xml':'builtin:junit',
  'dairn-json':'builtin:dairn-json',
};
