/* 有界、按需的工具环境身份。无法识别任一执行器时保留 unknown。 */
import {sha256} from './sha256.mjs';
export function toolchainIdentity(h,root,executors,runtimeSha=null){
  const tools=[],seen=new Set();
  for(const executor of executors||[]){
    const program=executor.argv?.[0];if(typeof program!=='string')return {sha256:null,status:'unknown'};
    if(seen.has(program))continue;seen.add(program);
    const name=program.replace(/\\/g,'/').split('/').pop().replace(/\.exe$/i,'').toLowerCase();
    const version=/^python(?:\d+(?:\.\d+)*)?$/.test(name)||['node','npm','cargo','rustc','git','java'].includes(name)?'--version':name==='go'?'version':null;
    if(!version)return {sha256:null,status:'unknown',reason:'执行器没有受控版本探测协议'};
    const result=h.run([program,version],root,10);
    if(result.timedOut||result.code!==0||!String(result.output||'').trim())return {sha256:null,status:'unknown',reason:'工具版本无法读取'};
    tools.push({executable_sha256:sha256(program),version_sha256:sha256(String(result.output).trim())});
  }
  tools.sort((a,b)=>a.executable_sha256.localeCompare(b.executable_sha256));
  const environment={};for(const key of ['PATH','OS','GOTOOLCHAIN','GOPROXY','CGO_ENABLED','PYTHONPATH','NODE_OPTIONS','CFLAGS','GOFLAGS'])environment[key]=sha256(String(h.env?.(key)||''));
  const identity={tools,environment,runtime_sha256:runtimeSha};
  return {sha256:tools.length?sha256(JSON.stringify(identity)):null,status:tools.length?'observed':'unknown',identity};
}
