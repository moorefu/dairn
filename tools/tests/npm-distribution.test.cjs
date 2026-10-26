'use strict';
// npm 安装适配层回归：校验包内运行时、版本透传、POSIX 共用根启动器、错误退出码。
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {test, before, after} = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
// CI 用 DAIRN_NPM_PACKAGE 指向构建脚本产出的未打包目录；本地直接用仓库根。
const SOURCE = path.resolve(process.env.DAIRN_NPM_PACKAGE || ROOT);
const POSIX = process.platform !== 'win32';
const SOURCE_RUNTIME = (!process.env.DAIRN_NPM_PACKAGE && process.env.DAIRN_TEST_RUNTIME) || path.join(SOURCE, '.dairn', 'runtime', 'dairn-embedded.com');
const SOURCE_INTEGRITY = path.join(path.dirname(SOURCE_RUNTIME), 'runtime-integrity.json');
const SOURCE_LAUNCHER = path.join(SOURCE, 'dairn');
const metadata = JSON.parse(fs.readFileSync(SOURCE_INTEGRITY, 'utf8'));
const engineVersion = metadata.engine_version;
const temporary = [];

before(() => {
  assert.ok(fs.existsSync(SOURCE_RUNTIME), '需要先构建运行时（python tools/build.py）');
  assert.ok(fs.existsSync(SOURCE_LAUNCHER), '需要仓库根 dairn 启动器');
});
after(() => {
  for (const dir of temporary) fs.rmSync(dir, {recursive: true, force: true});
});

function cleanEnv(extra = {}) {
  const env = {...process.env};
  for (const name of ['DAIRN_RUNTIME', 'DAIRN_RUNTIME_FILE', 'DAIRN_RUNTIME_DIR', 'DAIRN_RUNTIME_SOURCE']) delete env[name];
  return {...env, ...extra};
}

/** 复制出与 npm 发布包同布局的夹具目录（含 bin/dairn.cjs、根 dairn、.dairn/runtime）。 */
function fixture(prefix = 'dairn-npm-') {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporary.push(target);
  fs.mkdirSync(path.join(target, 'bin'), {recursive: true});
  fs.mkdirSync(path.join(target, '.dairn', 'runtime'), {recursive: true});
  fs.copyFileSync(path.join(SOURCE, 'package.json'), path.join(target, 'package.json'));
  fs.copyFileSync(path.join(SOURCE, 'LICENSE'), path.join(target, 'LICENSE'));
  fs.copyFileSync(path.join(SOURCE, 'bin', 'dairn.cjs'), path.join(target, 'bin', 'dairn.cjs'));
  fs.copyFileSync(SOURCE_LAUNCHER, path.join(target, 'dairn'));
  fs.copyFileSync(SOURCE_RUNTIME, path.join(target, '.dairn', 'runtime', 'dairn-embedded.com'));
  fs.copyFileSync(SOURCE_INTEGRITY, path.join(target, '.dairn', 'runtime', 'runtime-integrity.json'));
  return target;
}

function runWrapper(target, args, extra = {}) {
  return spawnSync(process.execPath, [path.join(target, 'bin', 'dairn.cjs'), ...args], {
    encoding: 'utf8', cwd: target, env: cleanEnv(extra), timeout: 180000,
  });
}

function runLauncher(target, args) {
  return spawnSync('/bin/sh', [path.join(target, 'dairn'), ...args], {
    encoding: 'utf8', cwd: target, env: cleanEnv(), timeout: 180000,
  });
}

function sha(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

test('分发包完整性清单与运行时载荷一致', () => {
  assert.equal(metadata.schema, 1);
  assert.equal(metadata.binary, 'dairn-embedded.com');
  assert.equal(sha(SOURCE_RUNTIME), metadata.sha256);
});

test('npm 包元数据指向唯一启动器与运行时载荷', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(SOURCE, 'package.json'), 'utf8'));
  assert.equal(pkg.license, 'MIT');
  assert.equal(pkg.bin.dairn, './bin/dairn.cjs');
  for (const entry of ['dairn', '.dairn/runtime/', 'bin/dairn.cjs']) assert.ok(pkg.files.includes(entry), entry);
  for (const script of ['preinstall', 'install', 'postinstall']) assert.equal(pkg.scripts?.[script], undefined);
});

test('包装层透传版本并保持运行时字节不变', () => {
  const target = fixture();
  const before = sha(path.join(target, '.dairn', 'runtime', 'dairn-embedded.com'));
  const result = runWrapper(target, ['--version']);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.trim().startsWith(`Dairn ${engineVersion}`), result.stdout);
  assert.equal(sha(path.join(target, '.dairn', 'runtime', 'dairn-embedded.com')), before);
});

test('未知命令按内核退出码失败', () => {
  const result = runWrapper(fixture(), ['definitely-not-a-command']);
  assert.equal(result.status, 2, result.stderr);
});

test('损坏的运行时被拒绝执行', () => {
  const target = fixture();
  fs.writeFileSync(path.join(target, '.dairn', 'runtime', 'dairn-embedded.com'), 'not a runtime');
  const result = runWrapper(target, ['--version']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /checksum mismatch|invalid runtime/);
});

test('缺失完整性清单被拒绝执行', () => {
  const target = fixture();
  fs.rmSync(path.join(target, '.dairn', 'runtime', 'runtime-integrity.json'));
  const result = runWrapper(target, ['--version']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /invalid runtime|ENOENT/);
});

test('安装路径含空格时仍可执行', () => {
  const target = fixture(`dairn npm spaces ${Date.now()}-`);
  const result = runWrapper(target, ['--version']);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`Dairn ${engineVersion}`));
});

test('POSIX：包装层委托仓库根 dairn 启动器', {skip: !POSIX}, () => {
  const target = fixture();
  fs.rmSync(path.join(target, 'dairn'));
  const result = runWrapper(target, ['--version']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /dairn/);
});

test('POSIX：包装层与根启动器执行同一运行时', {skip: !POSIX}, () => {
  const target = fixture();
  const launcher = runLauncher(target, ['--version']);
  const wrapper = runWrapper(target, ['--version']);
  assert.equal(launcher.status, 0, launcher.stderr);
  assert.equal(wrapper.status, 0, wrapper.stderr);
  assert.equal(wrapper.stdout, launcher.stdout);
});

test('POSIX：根启动器保持原载荷权限与字节', {skip: !POSIX}, () => {
  const target = fixture();
  const runtime = path.join(target, '.dairn', 'runtime', 'dairn-embedded.com');
  fs.chmodSync(runtime, 0o644);
  const result = runLauncher(target, ['--version']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.statSync(runtime).mode & 0o777,0o644);
  assert.equal(sha(runtime),sha(SOURCE_RUNTIME));
});

test('POSIX：符号链接运行时被拒绝执行', {skip: !POSIX}, () => {
  const target = fixture();
  const runtime = path.join(target, '.dairn', 'runtime', 'dairn-embedded.com');
  fs.rmSync(runtime);
  fs.symlinkSync(SOURCE_RUNTIME, runtime);
  const result = runWrapper(target, ['--version']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /regular file|invalid runtime/);
});

test('安装入口隔离继承的候选覆盖', () => {
  const target=fixture();
  const result=runWrapper(target,['version'],{DAIRN_RUNTIME:path.join(target,'missing-candidate.com')});
  assert.equal(result.status,0,result.stdout+result.stderr);
});
