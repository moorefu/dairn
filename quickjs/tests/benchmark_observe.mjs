/* 只测本地事件捕获组件；不包含整条 CLI 的启动、缓存或业务检查成本。 */
import * as os from 'os';
import * as std from 'std';
import {host} from '../host/qjs.mjs';
import {beginObservation} from '../core/observe.mjs';
const root=(std.getenv('TMPDIR')||host.cwd())+'/observe-benchmark-'+os.getpid()+'-'+Date.now();
host.mkdirs(root+'/.dairn');host.write(root+'/.dairn/lock.json','{}');
const measure=()=>{const start=Date.now();beginObservation(host,root,['doctor'])(0);return Date.now()-start;};
const first=measure(),enabled=Array.from({length:100},measure);
host.write(root+'/.dairn/observe/config.json','{"mode":"disabled"}');
const disabled=Array.from({length:100},measure),percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1];
print(JSON.stringify({schema:'dairn.observe-benchmark.v1',platform:os.platform,disk_type:'unknown-not-measured',fixture:'isolated-local-event-capture',samples:100,first_invocation_ms:first,
  enabled:{p50_ms:percentile(enabled,.5),p95_ms:percentile(enabled,.95)},disabled:{p50_ms:percentile(disabled,.5),p95_ms:percentile(disabled,.95)},
  limitation:'单机事件捕获组件测量，不代表 CLI 端到端或 Windows/其他磁盘的性能承诺'}));
