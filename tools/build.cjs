#!/usr/bin/env node
'use strict';
// npm 构建入口：QuickJS 生成 ZIP 和暂存源码，npm 生成 tarball。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const SEMVER = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-(?:(?:alpha|beta|rc)\.(?:0|[1-9][0-9]*)|nightly\.[1-9][0-9]{13}))?$/;
function packageVersion() {
  return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
}
// 标签推送时版本以标签为准（CI 通过 DAIRN_VERSION 或 GitHub 标签上下文传递）；
// 没有标签时回退 package.json。
function effectiveVersion() {
  let declared = (process.env.DAIRN_VERSION || '').trim();
  if (!declared && process.env.GITHUB_REF_TYPE === 'tag') declared = (process.env.GITHUB_REF_NAME || '').trim();
  if (!declared) return packageVersion();
  const version = declared.replace(/^v/, '');
  if (!SEMVER.test(version)) throw Error('发布版本格式无效：' + declared);
  return version;
}
let out = path.join(root, 'dist'), zipOnly = false, stageOnly = false;
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--zip-only') zipOnly = true;
  else if (process.argv[i] === '--stage-only') stageOnly = true;
  else if (process.argv[i] === '--out' && process.argv[i + 1]) out = path.resolve(process.argv[++i]);
  else throw Error('用法：npm run build -- [--out 输出目录] [--zip-only | --stage-only]');
}
function run(command, args) {
  const result = spawnSync(command, args, {cwd: root, stdio: 'inherit', windowsHide: true});
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error('构建失败，退出码：' + result.status);
}
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dairn-npm-build-'));
try {
  const fetch = process.platform === 'win32'
    ? ['powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'tools/bootstrap.ps1'), '-FetchOnly']]
    : ['/bin/sh', [path.join(root, 'tools/bootstrap.sh'), '--fetch-only']];
  const fetched = spawnSync(fetch[0], fetch[1], {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true});
  if (fetched.error) throw fetched.error;
  if (fetched.status !== 0) throw Error('获取 QuickJS 失败');
  const binary = fetched.stdout.trim();
  // 根目录 npm pack 的 tarball 版本来自 package.json，prepack 也按它构建；
  // 正式产物写到 --out，暂存包里的 package.json 会被改写为有效版本。
  const version = stageOnly ? packageVersion() : effectiveVersion();
  const args = [path.join(root, 'tools/build-zip.mjs'), '--root', root, '--qjs', binary,
    '--out', stageOnly ? temp : out, '--version', version];
  const stage = path.join(temp, 'source');
  if (!zipOnly) args.push('--stage', stage);
  if (process.platform === 'win32') run(binary, args);
  else run('/bin/sh', [binary, ...args]);
  if (!zipOnly) {
    const target = stageOnly ? root : path.join(temp, 'package');
    const runtimeTarget = path.join(target, '.dairn', 'runtime');
    fs.mkdirSync(runtimeTarget, {recursive: true});
    for (const name of ['dairn-embedded.com', 'runtime-integrity.json']) {
      fs.copyFileSync(path.join(stage, name), path.join(runtimeTarget, name));
    }
    // 与 ZIP、Wheel 保持一致：APE 必须有执行位，否则 bash（macOS 的 /bin/sh）下
    // 的 sh 加载器无法通过 command -v 定位自身，dd/gzip 会读到空输入。
    if (process.platform !== 'win32') {
      fs.chmodSync(path.join(runtimeTarget, 'dairn-embedded.com'), 0o755);
    }
    if (!stageOnly) {
      for (const name of ['bin', 'licenses']) fs.cpSync(path.join(stage, name), path.join(target, name), {recursive: true});
      fs.copyFileSync(path.join(stage, 'README.md'), path.join(target, 'README.md'));
      fs.copyFileSync(path.join(stage, 'LICENSE'), path.join(target, 'LICENSE'));
      fs.copyFileSync(path.join(stage, 'dairn'), path.join(target, 'dairn'));
      if (process.platform !== 'win32') fs.chmodSync(path.join(target, 'dairn'), 0o755);
      const pkg = JSON.parse(fs.readFileSync(path.join(stage, 'package.json'), 'utf8'));
      pkg.version = version;
      delete pkg.scripts;
      fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
      // npm 生命周期给出其 JS 入口，避免 Windows .cmd 的 shell 参数插值。
      const cli = process.env.npm_execpath;
      if (!cli) throw Error('请通过 npm run build 调用此入口');
      run(process.execPath, [cli, 'pack', target, '--offline', '--ignore-scripts',
        '--cache', path.join(temp, 'cache'), '--loglevel', 'error', '--pack-destination', out]);
    }
  }
} finally {
  fs.rmSync(temp, {recursive: true, force: true});
}
