#!/usr/bin/env node
'use strict';
// 安装适配层：校验包内 QuickJS 运行时，POSIX 共用包根 dairn 启动器。
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const os = require('node:os');

const base = path.resolve(__dirname, '..');
const runtimeDir = path.join(base, '.dairn', 'runtime');
const binary = path.join(runtimeDir, 'dairn-embedded.com');

try {
  const metadata = JSON.parse(fs.readFileSync(path.join(runtimeDir, 'runtime-integrity.json'), 'utf8'));
  const entry = fs.lstatSync(binary);
  if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('runtime is not a regular file');
  const actual = crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex');
  if (actual !== metadata.sha256) throw new Error('bundled QuickJS runtime checksum mismatch');
} catch (err) {
  console.error(`[dairn] refusing to execute invalid runtime: ${err.message}`);
  process.exit(2);
}

const windows = process.platform === 'win32';
const command = windows ? binary : '/bin/sh';
const args = windows
  ? ['/zip/quickjs/main.mjs', ...process.argv.slice(2)]
  : [path.join(base, 'dairn'), ...process.argv.slice(2)];
// 让内核拿到分发包自带的运行时载荷目录（init/adopt/upgrade 据此复制运行时）；
// Windows 直接执行 APE 时没有启动器注入，必须在这里显式传递。
const env = {...process.env, DAIRN_RUNTIME_DIR: runtimeDir, DAIRN_RUNTIME_SOURCE: 'packaged'};
const child = spawn(command, args, {stdio: 'inherit', cwd: process.cwd(), windowsHide: true, env});
let settled = false;
child.once('error', err => {
  if (settled) return;
  settled = true;
  console.error(`[dairn] launch failed: ${err.message}`);
  process.exitCode = err.code === 'ENOENT' ? 127 : 1;
});
child.once('exit', (code, signal) => {
  if (settled) return;
  settled = true;
  process.exitCode = signal ? 128 + (os.constants.signals[signal] || 1) : (code ?? 1);
});
// 将启动器接收到的终止信号传递给子进程。
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => { if (!settled && child.pid) { try { child.kill(signal); } catch {} } });
}
