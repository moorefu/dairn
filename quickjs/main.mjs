/* Actual official qjs invocation: qjs quickjs/main.mjs check --root ... */
import {host} from './host/qjs.mjs';
import {main} from './core/engine.mjs';
import {dispatch,isProjectCommand} from './core/project.mjs';
import * as std from 'std';
const args = scriptArgs.slice(1);
const code = isProjectCommand(args) ? dispatch(host,args) : main(host,args);
std.exit(code);
