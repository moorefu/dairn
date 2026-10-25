// 报告边界：矛盾、残缺与超限输入均不能归一化成零失败。
import {normalizeReport} from '../core/report-adapters.mjs';
const equal=(a,b)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error(JSON.stringify({actual:a,expected:b}));};
const rejected=(format,raw)=>{let error;try{normalizeReport(format,raw);}catch(e){error=e;}if(!error)throw Error('应拒绝报告：'+raw.slice(0,180));};
const suite=(body,attrs='tests="1" failures="1" errors="0" skipped="0"')=>`<testsuite ${attrs}>${body}</testsuite>`;
const bad='<testcase name="bad"><failure/></testcase>';
equal(normalizeReport('builtin:junit',suite(bad)).tests,{total:1,failed:1,errored:0,skipped:0});
equal(normalizeReport('builtin:junit',suite(bad.replace('<failure/>','<failure message="expected 2 > 1"/>'))).tests.failed,1);
equal(normalizeReport('builtin:junit',suite('<testcase name=\'bad\'><error/></testcase>',
  'tests="1" failures="0" errors="1" skipped="0"')).tests,{total:1,failed:0,errored:1,skipped:0});
for(const xml of [
  suite(bad,'tests="1" failures="0" errors="0" skipped="0"'),
  suite(bad,'tests="1" errors="0" skipped="0"'),
  suite(bad,'tests="1" failures="NaN" errors="0" skipped="0"'),
  suite(bad,'tests="2" failures="1" errors="0" skipped="0"'),
  suite(bad).replace('</testsuite>',''),
  suite(bad).replace('</testcase>','</testsuite>'),
  suite(bad).replace('tests="1"','tests="1" tests="1"'),
  '<testsuites tests="0">'+suite(bad)+'</testsuites>',
  '<junk>'+suite(bad)+'</junk>',
  suite(bad)+suite(bad),
  suite('<testcase name="x"><failure/><error/></testcase>'),
  suite('<testcase name="x">&unknown;</testcase>'),
  suite('<testcase name="x" invalid/>'),
  suite('<testcase name="\ufffe"/>'),
  suite('<testcase name="\ud800"/>'),
  suite('<testcase name="&#xD800;"/>'),
  suite('<testcase name="x"><properties/></testcase>'),
]) rejected('builtin:junit',xml);
const empty=suite('', 'tests="0" failures="0" errors="0" skipped="0"');
equal(normalizeReport('builtin:junit',empty).tests.total,0);
equal(normalizeReport('builtin:junit','<testsuites>'+suite(bad)+empty+'</testsuites>').tests.failed,1);
for(const [field,max] of [['findings',500],['metrics',100]]){
  const doc={schema:'dairn.quality-observation.v1',findings:[],metrics:[]};
  doc[field]=Array.from({length:max},()=>({}));
  equal(normalizeReport('builtin:dairn-json',JSON.stringify(doc))[field].length,max);
  doc[field].push({});rejected('builtin:dairn-json',JSON.stringify(doc));
}
rejected('builtin:dairn-json',JSON.stringify({schema:'dairn.surface-result.v1',changes:Array(501).fill({})}));
const log=typeof print==='function'?print:console.log;
log('报告适配器结构、计数与超限负向测试：通过');
