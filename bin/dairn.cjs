#!/usr/bin/env node
'use strict';
// 安装适配层：校验并启动同一份原生 APE，不实现治理规则或下载运行时。
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const os = require('node:os');

const base = path.resolve(__dirname, '..');
const binary = path.join(base, 'runtime', 'dairn-embedded.com');

try {
  const metadata = JSON.parse(fs.readFileSync(path.join(base, 'runtime', 'runtime-integrity.json'), 'utf8'));
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
  : [binary, '/zip/quickjs/main.mjs', ...process.argv.slice(2)];
const child = spawn(command, args, {stdio: 'inherit', cwd: process.cwd(), windowsHide: true});
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
