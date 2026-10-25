#!/usr/bin/env node
/* 从 quickjs/assets/templates/project/launcher/ 装配仓库根启动器 `dairn` 与 `dairn.cmd`。
 *
 * 根启动器是模板生成物：初始化/升级写入目标项目的脚本、分发 ZIP/npm/Wheel 里的
 * 脚本都与这里生成的仓库根文件字节一致。`--check` 只比较不写盘，供门禁使用。
 */
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {launcherScripts} from '../quickjs/core/scaffold.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const templates = join(repo, 'quickjs/assets/templates/project');
const readTemplate = rel => readFileSync(join(templates, rel), 'utf8');
const scripts = launcherScripts(readTemplate);
const targets = [
  {path: join(repo, 'dairn'), content: scripts.posix, label: 'dairn (POSIX)'},
  {path: join(repo, 'dairn.cmd'), content: scripts.windows, label: 'dairn.cmd (Windows)'},
];
const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');
const check = process.argv.includes('--check');
let failed = false;
for (const target of targets) {
  let actual = null;
  try { actual = readFileSync(target.path, 'utf8'); } catch (_) { actual = null; }
  if (check) {
    if (actual === null) {
      console.error('ERROR missing root launcher: ' + target.path + ' (run node tools/render-launchers.mjs)');
      failed = true;
    } else if (actual !== target.content) {
      console.error('ERROR stale root launcher: ' + target.path + ' (run node tools/render-launchers.mjs)');
      failed = true;
    } else {
      console.log('OK ' + target.label + ' sha256=' + sha256(actual));
    }
    continue;
  }
  writeFileSync(target.path, target.content, 'utf8');
  console.log('wrote ' + target.label + ' sha256=' + sha256(target.content));
}
if (failed) process.exit(1);
