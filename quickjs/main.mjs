/* Actual official qjs invocation: qjs quickjs/main.mjs check --root ... */
import {host} from './host/qjs.mjs';
import {main} from './core/engine.mjs';
import {dispatch,isProjectCommand} from './core/project.mjs';
import * as std from 'std';
import {beginObservation} from './core/observe.mjs';
const args = scriptArgs.slice(1);
let observeRoot=host.cwd();
for(let i=0;i<args.length-1;i++)if(args[i]==='--root'||args[i]==='--path')observeRoot=args[++i];
try{observeRoot=host.realpath(observeRoot);}catch(_){/* 未初始化目标不强制创建观测存储 */}
const finish=beginObservation(host,observeRoot,args);
const diagnostics=[];let observationContext={};
const observedHost={...host,observationFile:finish.pending_path,observationContext(value){observationContext=value;},error(message){for(const c of ['RUNTIME_LOCK_DRIFT','DAIRN_NOT_AVAILABLE','RUNTIME_PROMOTION_REQUIRED','POLICY_UNTRUSTED'])if(String(message).includes(c)&&!diagnostics.includes(c))diagnostics.push(c);host.error(message);}};
let code=2;
try{code=isProjectCommand(args)?dispatch(observedHost,args):main(observedHost,args);}finally{finish(code,diagnostics,observationContext);}
std.exit(code);
