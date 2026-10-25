// 原生 QuickJS 契约测试：launcher 脚本模板、运行时来源与源码陈旧度判定。
// 这些函数只读工作树、不写项目；临时目录由测试自行清理。
import * as std from 'std';
import {host as h} from '../host/qjs.mjs';
import {sha256} from '../core/sha256.mjs';
import {RUNTIME_SOURCE_ENV, RUNTIME_DIR_ENV} from '../core/launcher-scripts.mjs';
import {templateReader} from '../core/scaffold.mjs';
import {launcherScripts, runtimeFreshness, runtimeSource} from '../core/launcher.mjs';

const assert = {
  equal(actual, expected, label) {
    if (!Object.is(actual, expected)) throw Error('断言失败（' + label + '）：' + String(actual) + ' != ' + String(expected));
  },
  ok(value, label) { if (!value) throw Error('断言失败（' + label + '）：' + String(value)); },
};

const tmp = std.getenv('TMPDIR') || std.getenv('TEMP') || '.';
const base = tmp + '/dairn-launcher-' + Date.now() + '-' + Math.floor(Math.random() * 100000);
const files = [base + '/quickjs/main.mjs', base + '/quickjs/core/a.mjs'];
const dirs = [base + '/quickjs/core', base + '/quickjs', base];

try {
  h.mkdirs(base + '/quickjs/core');
  h.write(files[0], 'main');
  h.write(files[1], 'alpha');
  const sources = [
    {path: 'quickjs/main.mjs', sha256: sha256('main')},
    {path: 'quickjs/core/a.mjs', sha256: sha256('alpha')},
  ];

  const scripts = launcherScripts(templateReader(h));
  const registry = {posix: scripts.posix, windows: scripts.windows};
  assert.ok(registry.posix.includes(RUNTIME_SOURCE_ENV + '=vendored'), 'POSIX launcher 传递来源');
  assert.ok(registry.windows.includes('set "' + RUNTIME_SOURCE_ENV + '=vendored"'), 'Windows launcher 传递来源');
  assert.ok(registry.posix.includes(RUNTIME_DIR_ENV + '='), 'POSIX launcher 传递运行时目录');
  assert.ok(registry.windows.includes('set "' + RUNTIME_DIR_ENV + '='), 'Windows launcher 传递运行时目录');
  // 两份脚本必须指向同一解析路径，且缺失时给出可行动的错误码与提示。
  for (const [label, text] of [['POSIX', registry.posix], ['Windows', registry.windows.replace(/\\/g, '/')]]) {
    assert.ok(text.includes('.dairn/runtime/dairn-embedded.com'), label + ' 解析 vendored 运行时');
    assert.ok(text.includes('DAIRN_NOT_AVAILABLE'), label + ' 缺失运行时给出 DAIRN_NOT_AVAILABLE');
    assert.ok(/exit (\/b )?2/.test(text), label + ' 缺失运行时退出码 2');
  }
  // POSIX 用 LF；Windows .cmd 用 CRLF 且不得含非 ASCII 字符（cmd.exe 代码页会误解析）。
  assert.ok(registry.posix.endsWith('\n') && !registry.posix.includes('\r'), 'POSIX launcher 只用 LF');
  assert.ok(registry.windows.endsWith('\r\n'), 'Windows launcher 使用 CRLF');
  const nonAscii = registry.windows.split('').filter(ch => ch.charCodeAt(0) > 127);
  assert.equal(nonAscii.length, 0, 'Windows launcher 不含非 ASCII 字符');
  assert.ok(registry.posix.split('\n').length > 10 && registry.windows.split('\r\n').length > 10, '脚本行数非空');
  // 模板是启动器的唯一源码；哈希固定用于发现任何意外改动（仓库根/分发/项目内共用）。
  assert.equal(sha256(registry.posix), 'ac8e9110ccbd6984eedf0ae2a2e14c821b33e2350165f233dba912b1c75267ee', 'POSIX launcher 模板哈希稳定');
  assert.equal(sha256(registry.windows), '23eba37f99b09dd6661a85b469780acebe8af8eaaae73481c1b4d4cea4e20ee9', 'Windows launcher 模板哈希稳定');

  const source = runtimeSource(h);
  const envSource = h.env(RUNTIME_SOURCE_ENV);
  if (!envSource) assert.equal(source, 'unknown', '未由 launcher 启动时来源为 unknown');
  else assert.ok(['vendored', 'external', 'packaged'].includes(source), '来源取值受控：' + source);

  const current = runtimeFreshness(h, base, sources);
  assert.equal(current.status, 'current', '工作树与内嵌源码一致');
  assert.equal(current.checked, 2, '检查条目数');
  assert.equal(current.stale_count, 0, '无陈旧源码');

  h.write(files[1], 'alpha2');
  const outdated = runtimeFreshness(h, base, sources);
  assert.equal(outdated.status, 'outdated', '改动源码后报告 outdated');
  assert.equal(outdated.stale_sources[0], 'quickjs/core/a.mjs', '指出陈旧源码路径');
  assert.equal(outdated.stale_count, 1, '陈旧条目数');

  assert.equal(runtimeFreshness(h, base, []).status, 'unknown', '缺少摘要时不猜测');
  assert.equal(runtimeFreshness(h, base, [{path: 'docs/readme.md', sha256: sha256('x')}]).status, 'outdated', '非引擎源码视为不可信条目');
  assert.equal(runtimeFreshness(h, base + '/absent', sources).status, 'not-source-repo', '非源码 checkout 不报告陈旧');
} finally {
  for (const path of files) { try { h.remove(path); } catch (_) {} }
  for (const path of dirs) { try { h.rmdir(path); } catch (_) {} }
}

print('QuickJS 原生 launcher 运行时常量与陈旧度测试：通过');
std.exit(0);
