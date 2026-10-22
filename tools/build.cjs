#!/usr/bin/env node
'use strict';
// npm 构建入口：QuickJS 生成 ZIP 和暂存源码，npm 生成 tarball。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
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
  const args = [path.join(root, 'tools/build-zip.mjs'), '--root', root, '--qjs', binary, '--out', stageOnly ? temp : out];
  const stage = path.join(temp, 'source');
  if (!zipOnly) args.push('--stage', stage);
  if (process.platform === 'win32') run(binary, args);
  else run('/bin/sh', [binary, ...args]);
  if (!zipOnly) {
    const target = stageOnly ? root : path.join(temp, 'package');
    fs.mkdirSync(path.join(target, 'runtime'), {recursive: true});
    for (const name of ['dairn-embedded.com', 'runtime-integrity.json']) {
      fs.copyFileSync(path.join(stage, name), path.join(target, 'runtime', name));
    }
    if (!stageOnly) {
      for (const name of ['bin', 'licenses']) fs.cpSync(path.join(stage, name), path.join(target, name), {recursive: true});
      fs.copyFileSync(path.join(stage, 'README.md'), path.join(target, 'README.md'));
      fs.copyFileSync(path.join(stage, 'dairn.sh'), path.join(target, 'dairn.sh'));
      const pkg = JSON.parse(fs.readFileSync(path.join(stage, 'package.json'), 'utf8'));
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
