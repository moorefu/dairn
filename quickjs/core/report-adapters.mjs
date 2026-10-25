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
// 受限 XML 词法器完整消费输入，再用栈验证父子关系和计数。
// 不使用宽松正则提取局部节点，以免残缺 XML 被当作完整报告。
function fromJunit(raw,context){
  const xml=raw.replace(/^\uFEFF?\s*<\?xml\s+version=["']1\.0["'](?:\s+encoding=["'][A-Za-z0-9._-]+["'])?\s*\?>/,'').trim();
  assert(!/<!|<\?/i.test(xml),'JUnit XML contains refused constructs (DOCTYPE/ENTITY/CDATA/PI)');
  const total={tests:0,failures:0,errors:0,skipped:0},findings=[],stack=[];
  let root=null,suites=0,elements=0,cases=0,pos=0;
  const count=(value)=>{assert(typeof value==='string'&&/^\d+$/.test(value),'missing or invalid JUnit count');
    const n=Number(value);assert(Number.isSafeInteger(n)&&n<=1e6,'invalid JUnit count');return n;};
  const verify=(attrs,actual,required)=>{
    for(const key of Object.keys(total))if(required||Object.hasOwn(attrs,key))
      assert(count(attrs[key])===actual[key],'contradictory JUnit '+key);
  };
  const close=()=>{
    const node=stack.pop();
    if(node.name==='testsuite'){
      verify(node.attrs,node.counts,true);suites++;
      for(const key of Object.keys(total))total[key]+=node.counts[key];
    }
    if(!stack.length){
      if(node.name==='testsuites')verify(node.attrs,total,false);
      root=node;
    }
  };
  while(pos<xml.length){
    if(xml[pos]!=='<'){
      let end=xml.indexOf('<',pos);if(end<0)end=xml.length;
      const text=xml.slice(pos,end);validateXmlText(text);
      assert(!text.includes(']]>'),'invalid XML text');
      assert(!text.trim()||['failure','error','skipped'].includes(stack[stack.length-1]?.name),'unexpected JUnit text');
      pos=end;continue;
    }
    let end=pos+1,quote=null;
    for(;end<xml.length;end++){
      const c=xml[end];
      if(quote){if(c===quote)quote=null;}
      else if(c==='"'||c==="'")quote=c;
      else if(c==='>')break;
    }
    assert(end<xml.length,'unclosed JUnit tag');
    const token=xml.slice(pos,end+1);pos=end+1;
    const closing=/^<\/([A-Za-z][\w.-]*)\s*>$/.exec(token);
    if(closing){assert(stack.length&&stack[stack.length-1].name===closing[1],'mismatched JUnit tag');close();continue;}
    const open=/^<([A-Za-z][\w.-]*)([\s\S]*?)(\/?)>$/.exec(token);
    assert(open,'invalid JUnit tag');
    assert(++elements<=20000,'too many JUnit elements');
    const name=open[1],attrs=parseAttrs(open[2]),parent=stack[stack.length-1];
    if(!parent)assert(!root&&['testsuites','testsuite'].includes(name),'JUnit XML must have one testsuite root');
    else if(parent.name==='testsuites')assert(name==='testsuite','invalid testsuites child');
    else if(parent.name==='testsuite')assert(name==='testcase','invalid testsuite child');
    else if(parent.name==='testcase')assert(['failure','error','skipped'].includes(name)&&!parent.outcome,'invalid or multiple testcase outcomes');
    else assert(false,'nested JUnit outcome');
    const node={name,attrs};
    if(name==='testsuite')node.counts={tests:0,failures:0,errors:0,skipped:0};
    if(name==='testcase'){
      assert(typeof attrs.name==='string'&&attrs.name.length>0,'testcase name missing');
      assert(++cases<=5000,'too many JUnit testcases');parent.counts.tests++;
    }
    if(['failure','error','skipped'].includes(name)){
      parent.outcome=name;
      const suite=stack[stack.length-2];
      suite.counts[{failure:'failures',error:'errors',skipped:'skipped'}[name]]++;
      if(name!=='skipped'){
        findings.push({rule_id:'junit.'+name,severity:'error',fingerprint:null,fingerprint_basis:'heuristic',
          location:{path:context.source_path||null,line:null},
          message:((parent.attrs.classname?parent.attrs.classname+' :: ':'')+parent.attrs.name).slice(0,400)});
        assert(findings.length<=MAX_FINDINGS,'too many findings');
      }
    }
    stack.push(node);if(open[3])close();
  }
  assert(!stack.length&&root&&suites>0,'incomplete JUnit XML');
  const obs=baseObservation(context);
  obs.tests={total:total.tests,failed:total.failures,errored:total.errors,skipped:total.skipped};
  obs.findings=findings;
  obs.metrics.push({id:'quality.tests.failed',value:total.failures+total.errors,unit:'count',aggregation:'total'});
  return obs;
}
function validateXmlText(text){
  for(const char of text){
    const n=char.codePointAt(0);
    assert(n===9||n===10||n===13||(n>=32&&n<=0xd7ff)||(n>=0xe000&&n<=0xfffd)||(n>=0x10000&&n<=0x10ffff),'invalid XML character');
  }
  assert(!/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(text),'invalid XML entity');
  for(const match of text.matchAll(/&#(x[0-9a-fA-F]+|\d+);/g)){
    const n=match[1][0]==='x'?parseInt(match[1].slice(1),16):Number(match[1]);
    assert(n===9||n===10||n===13||(n>=32&&n<=0xd7ff)||(n>=0xe000&&n<=0xfffd)||(n>=0x10000&&n<=0x10ffff),'invalid XML entity codepoint');
  }
}
function parseAttrs(text){
  const attrs={};let rest=text;
  while(rest.trim()){
    const match=/^\s+([A-Za-z_][\w.-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/.exec(rest);
    assert(match,'invalid JUnit attributes');
    assert(!Object.hasOwn(attrs,match[1]),'duplicate JUnit attribute');
    const value=match[2]===undefined?match[3]:match[2];validateXmlText(value);
    attrs[match[1]]=value;rest=rest.slice(match[0].length);
  }
  return attrs;
}

/* ---- Dairn JSON（surface-result 或既有 observation）---- */
function fromDairnJson(raw,context){
  let doc;try{doc=JSON.parse(raw);}catch(_){throw Error('Adapter: Dairn JSON is not valid JSON');}
  if(doc.schema==='dairn.quality-observation.v1'){
    assert(Array.isArray(doc.findings)&&Array.isArray(doc.metrics),'invalid observation arrays');
    assert(doc.findings.length<=MAX_FINDINGS&&doc.metrics.length<=100,'too many findings or metrics');
    return {...baseObservation(context),findings:doc.findings,metrics:doc.metrics,tests:doc.tests||null};
  }
  if(doc.schema==='dairn.surface-result.v1'){
    const obs=baseObservation(context);
    obs.domain='surface';
    assert(Array.isArray(doc.changes),'surface result changes[] missing');
    assert(doc.changes.length<=MAX_FINDINGS,'too many surface changes');
    obs.findings=doc.changes.map(c=>({rule_id:'surface.'+c.change,severity:'warning',
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
