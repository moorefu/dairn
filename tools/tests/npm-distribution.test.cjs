'use strict';
const test = require('node:test');
const {after} = test;
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const repo = path.resolve(__dirname,'../..');
const fixture = process.env.DAIRN_NPM_PACKAGE ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'dairn-npm-fixture-'));
const source = process.env.DAIRN_NPM_PACKAGE || fixture;
if (fixture) {
  fs.mkdirSync(path.join(fixture,'runtime'));
  fs.cpSync(path.join(repo,'bin'),path.join(fixture,'bin'),{recursive:true});
  fs.copyFileSync(path.join(repo,'package.json'),path.join(fixture,'package.json'));
  fs.copyFileSync(path.join(repo,'dairn.sh'),path.join(fixture,'dairn.sh'));
  for (const name of ['dairn-embedded.com','runtime-integrity.json']) fs.copyFileSync(path.join(repo,'runtime',name),path.join(fixture,'runtime',name));
  // 模拟丢失执行位的安装结果，验证启动器会补齐元数据。
  if (process.platform !== 'win32') fs.chmodSync(path.join(fixture,'runtime','dairn-embedded.com'),0o644);
  after(() => fs.rmSync(fixture,{recursive:true,force:true}));
}
const launcher = path.join(source,'bin','dairn.cjs');
const ape = path.join(source,'runtime','dairn-embedded.com');
const version = JSON.parse(fs.readFileSync(path.join(source,'package.json'),'utf8')).version;
const hash = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
function run(args=[], options={}) {
  return spawnSync(process.execPath,[launcher,...args],{
    encoding:'utf8', timeout:20000, ...options,
  });
}

test('运行时 SHA256 与包内 APE 一致', () => {
  const meta = JSON.parse(fs.readFileSync(path.join(source,'runtime','runtime-integrity.json')));
  assert.equal(hash(ape),meta.sha256);
  assert.equal(meta.engine_version,version);
});

test('版本和参数透传不修改源二进制', () => {
  const before=hash(ape);
  const p=run(['version']);
  assert.equal(p.status,0,p.stderr);
  assert.ok(p.stdout.startsWith('Dairn '+version+' —'),p.stdout);
  assert.equal(hash(ape),before);
});

test('缺少执行位的运行时在 bash 下仍可启动并补齐执行位', {skip:process.platform === 'win32'}, t => {
  if (spawnSync('bash',['-c','exit 0'],{stdio:'ignore'}).error) {
    t.skip('当前环境没有 bash');
    return;
  }
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'dairn npm exec bit '));
  try {
    const target=path.join(temp,'package');
    fs.mkdirSync(path.join(target,'runtime'),{recursive:true});
    fs.cpSync(path.join(source,'bin'),path.join(target,'bin'),{recursive:true});
    fs.copyFileSync(path.join(source,'dairn.sh'),path.join(target,'dairn.sh'));
    for(const name of ['dairn-embedded.com','runtime-integrity.json']) fs.copyFileSync(path.join(source,'runtime',name),path.join(target,'runtime',name));
    const runtime=path.join(target,'runtime','dairn-embedded.com');
    fs.chmodSync(runtime,0o644);
    const before=hash(runtime);
    // macOS 的 /bin/sh 是 bash，对无执行位的路径 command -v 会失败。
    const p=spawnSync('bash',[path.join(target,'dairn.sh'),'version'],{
      encoding:'utf8',timeout:20000,env:{...process.env,DAIRN_FAST_RUNTIME:'0'},
    });
    assert.equal(p.status,0,p.stderr);
    assert.ok(p.stdout.startsWith('Dairn '+version+' —'),p.stdout);
    assert.notEqual(fs.statSync(runtime).mode & 0o111,0,'启动器必须补齐执行位');
    assert.equal(hash(runtime),before,'启动器不得改写运行时内容');
  } finally { fs.rmSync(temp,{recursive:true,force:true}); }
});

test('CLI 非零退出码传递至 npm 启动器', () => {
  const p=run(['invalid-command-for-test']);
  assert.equal(p.status,2,p.stderr);
});

test('POSIX npm 与 shell 共用快速运行时缓存并保留退出码', {skip:process.platform === 'win32'}, t => {
  if (spawnSync('/bin/sh',['-c','command -v sha256sum'],{stdio:'ignore'}).status !== 0) {
    t.skip('当前环境使用默认 APE 启动路径');
    return;
  }
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'dairn 共享缓存 '));
  try {
    const before=hash(ape);
    const env={...process.env,DAIRN_FAST_RUNTIME:'1',DAIRN_CACHE_HOME:tmp};
    const p=run(['version'],{env,cwd:tmp});
    assert.equal(p.status,0,p.stderr);
    const cache=path.join(tmp,'native-'+before);
    const native=path.join(cache,'dairn-native');
    assert.ok(fs.statSync(native).isFile());
    const cached=hash(native);
    const shell=spawnSync('/bin/sh',[path.join(source,'dairn.sh'),'version'],{env,cwd:tmp,encoding:'utf8',timeout:20000});
    assert.equal(shell.status,0,shell.stderr);
    assert.equal(shell.stdout,p.stdout);
    assert.equal(run(['invalid-command-for-test'],{env,cwd:tmp}).status,2);
    assert.equal(hash(native),cached);
    assert.deepEqual(fs.readdirSync(cache),['dairn-native']);
    assert.equal(hash(ape),before);
  } finally { fs.rmSync(tmp,{recursive:true,force:true}); }
});

test('空格路径完整传递且项目检查通过', () => {
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'dairn npm spaces '));
  try {
    const target=path.join(tmp,'demo project');
    const init=run(['init','--path',target,'--stack','go','--sample']);
    assert.equal(init.status,0,init.stderr+'\n'+init.stdout);
    assert.ok(fs.existsSync(path.join(target,'AGENTS.md')));
    const check=run(['validate','--root',target],{cwd:tmp});
    assert.equal(check.status,0,check.stderr+'\n'+check.stdout);
    assert.match(check.stdout,/stubs: PASS/);
  } finally { fs.rmSync(tmp,{recursive:true,force:true}); }
});

test('拒绝执行已损坏的包内运行时', () => {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'dairn npm corrupted '));
  try {
    fs.cpSync(path.join(source,'bin'),path.join(temp,'bin'),{recursive:true});
    fs.cpSync(path.join(source,'runtime'),path.join(temp,'runtime'),{recursive:true});
    fs.copyFileSync(path.join(source,'dairn.sh'),path.join(temp,'dairn.sh'));
    fs.appendFileSync(path.join(temp,'runtime','dairn-embedded.com'),Buffer.from([0x00]));
    const p=spawnSync(process.execPath,[path.join(temp,'bin','dairn.cjs'),'version'],{encoding:'utf8',timeout:10000});
    assert.equal(p.status,2);
    assert.match(p.stderr,/checksum mismatch/);
  } finally { fs.rmSync(temp,{recursive:true,force:true}); }
});

test('安装不需要生命周期脚本或外部依赖', () => {
  const pkg=JSON.parse(fs.readFileSync(path.join(source,'package.json')));
  assert.deepEqual(Object.keys(pkg.dependencies||{}),[]);
  for(const name of ['preinstall','install','postinstall','prepare']) assert.ok(!pkg.scripts?.[name],name);
  assert.equal(pkg.bin.dairn,'./bin/dairn.cjs');
});
