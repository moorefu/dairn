/* 原生 QuickJS 宿主契约测试，必须使用真正的 QuickJS 解释器运行。 */
import * as std from 'std';
import * as os from 'os';
import {host} from '../host/qjs.mjs';
import {sha256Bytes} from '../core/sha256.mjs';

const qjs = std.getenv('DAIRN_QJS_BIN');
if (!qjs) throw new Error('DAIRN_QJS_BIN 必须指向待验证的原生 QuickJS 解释器绝对路径');
const cwd = host.realpath(host.cwd());
const tests = [];
function test(label, fn) {
  try { fn(); tests.push({name:label,status:'passed'}); print('PASS '+label); }
  catch (error) { tests.push({name:label,status:'failed',reason:String(error)}); std.err.puts('FAIL '+label+': '+String(error)+'\n'); }
}
function assert(ok, why) { if (!ok) throw new Error(why); }
const base = (std.getenv('TMPDIR') || std.getenv('TEMP') || std.getenv('TMP') || cwd).replace(/\\/g, '/') + '/dairn-qjs-native 中文 '+os.getpid()+'-'+Date.now();
host.mkdirs(base);
const child = base + '/child.mjs';
const failing = base + '/fail.mjs';
const sleeping = base + '/sleep.mjs';
try {
  test('std/os, filesystem, UTF-8, realpath', () => {
    const file=base+'/utf8.txt'; host.write(file,'中文😀 / native QuickJS\n');
    assert(host.read(file)==='中文😀 / native QuickJS\n','utf8 differs');
    assert(host.exists(file),'file missing');
    assert(host.isDirectory(base),'temp directory not recognized');
    assert(host.list(base).includes('utf8.txt'),'readdir omitted file');
    assert(host.realpath(base).length>0,'realpath empty');
  });
  host.write(child,"import * as std from 'std'; print('native-child-stdout'); std.err.puts('native-child-stderr\\n'); std.exit(0);\n");
  host.write(failing,"import * as std from 'std'; print('deliberate-failure'); std.exit(13);\n");
  host.write(sleeping,"import * as os from 'os'; os.sleep(4000);\n");
  test('argv process execution and combined stdout/stderr capture', () => {
    const r=host.run([qjs,child],cwd,10);
    assert(!r.timedOut && r.code===0,'child status '+JSON.stringify(r));
    assert(r.output.includes('native-child-stdout'),'stdout not captured');
    assert(r.output.includes('native-child-stderr'),'stderr not captured');
  });
  test('nonzero exit code propagates', () => {
    const r=host.run([qjs,failing],cwd,10);
    assert(r.code===13 && !r.timedOut,'nonzero status lost: '+JSON.stringify(r));
  });
  test('同时排空超过管道容量的 stdout 和 stderr', () => {
    host.write(child,"import * as std from 'std'; print('x'.repeat(131072)); std.out.flush(); std.err.puts('y'.repeat(131072)); std.err.flush(); std.exit(0);\n");
    const r=host.run([qjs,child],cwd,10);
    assert(r.code===0&&!r.timedOut,'大输出阻塞或失败: '+JSON.stringify({code:r.code,timedOut:r.timedOut}));
    assert(r.output.includes('x'.repeat(131072))&&r.output.includes('y'.repeat(131072)),'输出被截断');
  });
  test('输出超过 1 MiB 时拒绝并清理子进程', () => {
    host.write(child,"import * as std from 'std'; print('z'.repeat(2097152)); std.exit(0);\n");
    let rejected=false;
    try { host.run([qjs,child],cwd,10); }
    catch(error) { rejected=String(error).includes('output exceeded 1 MiB'); }
    assert(rejected,'超量输出未被拒绝');
  });
  test('argv preserves spaces, quotes and shell metacharacters', () => {
    const args=['a b','quote"value','x&echo injected','100%','中文😀'];
    host.write(child,"import * as std from 'std'; print(JSON.stringify(scriptArgs.slice(1))); std.exit(0);\n");
    const r=host.run([qjs,child,...args],base,10);
    assert(r.code===0 && r.output.trim()===JSON.stringify(args),'argv changed: '+JSON.stringify(r));
    assert(host.realpath(host.cwd())===cwd,'child changed parent cwd');
  });
    test('timeout terminates/reaps child', () => {
      const start=Date.now(), r=host.run([qjs,sleeping],cwd,1);
      assert(r.timedOut && r.code===null,'timeout not detected: '+JSON.stringify(r));
      assert(Date.now()-start<3500,'timeout exceeded upper bound');
    });
  test('missing executable fails closed', () => {
    let failed=false;
    try {const r=host.run([base+'/definitely-missing'],cwd,3); failed=r.code!==0 || r.timedOut;}
    catch(_) {failed=true;}
    assert(failed,'missing command was reported passed');
  });
  if (os.platform === 'win32') test('DLL 初始化失败保留退出码与诊断', () => {
    const tool = base + '/failed-tool.exe';
    const script = base + '/dll-init.mjs';
    const bytes = host.readBytes(qjs);
    const fd = os.open(tool, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600);
    assert(fd >= 0, '无法创建退出码夹具');
    try { assert(os.write(fd, bytes.buffer, 0, bytes.length) === bytes.length, '夹具写入不完整'); }
    finally { os.close(fd); }
    try {
      host.write(script, "import * as std from 'std'; std.exit(-1073741502);\n");
      const result = host.run([tool, script], cwd, 10);
      assert(result.code === -1073741502 || result.code === 3221225794, '退出码丢失');
      assert(result.output.includes('0xC0000142'), '缺少初始化失败诊断');
    } finally { os.remove(tool); os.remove(script); }
  });
  test('invalid arguments rejected', () => {
    let failed=false;try{host.run('sh -c exit 0',cwd,1);}catch(_){failed=true;}
    assert(failed,'string command accepted instead of argv');
  });
  test('binary readBytes and internal SHA256 (launcher vendoring)', () => {
    const file=base+'/binary.bin';
    const bytes=new Uint8Array([0,1,2,254,255,13,10,65]);
    const fd=os.open(file, os.O_WRONLY|os.O_CREAT|os.O_EXCL, 0o600);
    assert(fd>=0,'cannot create binary fixture: '+fd);
    const written=os.write(fd, bytes.buffer, 0, bytes.length);
    os.close(fd);
    assert(written===bytes.length,'binary write failed: '+written);
    const read=host.readBytes(file);
    assert(read.length===bytes.length,'binary length differs: '+read.length);
    assert(Array.from(read).join(',')===Array.from(bytes).join(','),'binary bytes differ');
    assert(sha256Bytes(read)==='3d804d24c5e0d6a98067c572e217c58c372be51996e187c389cfec2fdd3734ae','sha256 differs');
    os.remove(file);
  });
  test('Git 非零退出和 stderr 被保留', () => {
    // QuickJS/cosmopolitan 在 Windows 不替应用 PATHEXT；显式 .exe 是原生
    // os.exec 的契约，避免把命令解析失败误判成 Git 内容错误。
    const git=os.platform==='win32'?'git.exe':'git';
    const r=host.run([git,'rev-parse','--verify','refs/heads/dairn-definitely-missing-ref'],cwd,15);
    assert(r.code!==0,'git nonzero status lost: '+JSON.stringify(r));
    assert(/fatal|unknown revision|Needed a single revision/i.test(String(r.output||'')),
           'git error output missing: '+JSON.stringify(r.output));
  });
  if(os.platform!=='win32')test('Git 成功 stdout 不混入环境警告，失败仍保留 stderr',()=>{
    const git=base+'/git';
    host.write(git,"#!/bin/sh\nprintf '%s\\n' '{\"head\":\"fixture\"}'\necho environment-warning >&2\nexit \"${1:-0}\"\n");
    host.chmod(git,0o700);
    try{
      const success=host.run([git,'0'],cwd,10);
      assert(success.code===0&&JSON.parse(success.output).head==='fixture','Git 警告污染机器输出：'+JSON.stringify(success));
      const failed=host.run([git,'17'],cwd,10);
      assert(failed.code===17&&failed.output.includes('environment-warning'),'Git 失败诊断丢失');
    }finally{os.remove(git);}
  });
  test('ES2021/2022 features used by core are available', () => {
    assert('Ａ'.normalize('NFKC')==='A','String.normalize unavailable');
    assert([1,2,3].at(-1)===3,'Array.prototype.at unavailable');
  });
} finally {
  for(const p of [base+'/utf8.txt',child,failing,sleeping]) os.remove(p);
  os.remove(base);
}
const failed=tests.filter(x=>x.status==='failed').length;
print('DAIRN_NATIVE_HOST_RESULT '+JSON.stringify({engine:'native-qjs',platform:os.platform,passed:tests.filter(x=>x.status==='passed').length,failed,skipped:tests.filter(x=>x.status==='skipped').length,tests}));
std.exit(failed?1:0);
