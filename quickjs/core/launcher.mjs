/* 项目内 Dairn launcher 与 vendored runtime 的契约实现。
 *
 * 本模块刻意不 import 任何其它 core 模块（尤其不 import project/work/engine），
 * 以避免循环依赖：project.mjs 生成/注册 launcher，engine/work 只消费
 * launcherInfo/verifyLauncher 的只读结果。
 *
 * launcher 解析顺序（脚本内置，不自动安装）：
 *   DAIRN_BIN -> <root>/.dairn/runtime/dairn-embedded.com -> PATH 中的 dairn -> exit 127。
 * launcher 文件由调用方（project.mjs）写入并纳入 lock 管理；`launcher.json`
 * 是项目自有配置，不参与受管哈希。本模块不写任何文件（有意不导出
 * installLauncherFiles；写盘与 chmod 由 project.mjs 负责）。二进制哈希不能
 * 通过 h.read（APE 是二进制，QuickJS 的 loadFile 会按文本处理），因此
 * sha256File 调用系统工具。
 */
import {sha256Bytes, sha256} from './sha256.mjs';
import {POSIX_LAUNCHER_LINES, WINDOWS_LAUNCHER_LINES, RUNTIME_SOURCE_ENV} from './launcher-scripts.mjs';
const join = (a, b) => a.replace(/\/$/, '') + '/' + b;
const file = (h, p) => h.exists(p) && !h.isDirectory(p);
const isObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const posix = p => String(p).replace(/\\/g, '/');
const HEX64 = /^[0-9a-f]{64}$/;
const safeRelPath = value => {
  const path = posix(value).trim();
  if (!path || path.startsWith('/') || /^[A-Za-z]:/.test(path)) return false;
  return !path.split('/').some(part => !part || part === '.' || part === '..');
};

export const LAUNCHER_POSIX = '.dairn/bin/dairn';
export const LAUNCHER_WINDOWS = '.dairn/bin/dairn.cmd';
export const LAUNCHER_CONFIG = '.dairn/launcher.json';
export const RUNTIME_DIR = '.dairn/runtime';
export const RUNTIME_BINARY = '.dairn/runtime/dairn-embedded.com';
export const RUNTIME_INTEGRITY = '.dairn/runtime/runtime-integrity.json';

/* 返回 launcher 脚本文本。POSIX 用 LF；.cmd 用 CRLF，与 .dairn/.gitattributes
 * 的 eol 声明一致，保证跨平台 checkout 后受管哈希稳定。 */
export function launcherScripts() {
  return {
    posix: POSIX_LAUNCHER_LINES.join('\n') + '\n',
    windows: WINDOWS_LAUNCHER_LINES.join('\r\n') + '\r\n',
  };
}

export function defaultLauncherConfig(version = null) {
  return {
    schema: 1,
    launcher: LAUNCHER_POSIX,
    windows_launcher: LAUNCHER_WINDOWS,
    mode: 'external',
    runtime: null,
    generated_by: version === undefined ? null : version,
  };
}

function invalidConfig(message) {
  return Error('Invalid ' + LAUNCHER_CONFIG + ': ' + message);
}

/* 读取项目自有 launcher 配置；文件不存在时返回 external 默认值。 */
export function readLauncherConfig(h, root) {
  const path = join(root, LAUNCHER_CONFIG);
  if (!file(h, path)) return defaultLauncherConfig(null);
  let raw;
  try { raw = h.read(path); } catch (e) { throw Error('Cannot read ' + LAUNCHER_CONFIG + ': ' + (e && e.message || e)); }
  let config;
  try { config = JSON.parse(raw); } catch (e) { throw invalidConfig('invalid JSON (' + (e && e.message || e) + ')'); }
  if (!isObj(config)) throw invalidConfig('expected an object');
  if (config.schema !== 1) throw invalidConfig('unsupported schema ' + JSON.stringify(config.schema));
  if (!['external', 'vendored'].includes(config.mode)) throw invalidConfig('mode must be external|vendored');
  if (typeof config.launcher !== 'string' || !config.launcher.trim()) throw invalidConfig('missing launcher path');
  if (typeof config.windows_launcher !== 'string' || !config.windows_launcher.trim()) throw invalidConfig('missing windows_launcher path');
  if (config.mode === 'vendored') {
    const runtime = config.runtime;
    if (!isObj(runtime)) throw invalidConfig('vendored mode requires runtime');
    for (const key of ['path', 'integrity', 'version', 'sha256']) {
      if (typeof runtime[key] !== 'string' || !runtime[key].trim()) throw invalidConfig('missing runtime.' + key);
    }
    if (!safeRelPath(runtime.path) || !safeRelPath(runtime.integrity)) throw invalidConfig('runtime.path/integrity must be safe repository-relative paths');
    if (!HEX64.test(runtime.sha256)) throw invalidConfig('runtime.sha256 must be 64 lowercase hex characters');
    return { ...defaultLauncherConfig(config.generated_by), mode: 'vendored', launcher: config.launcher, windows_launcher: config.windows_launcher, runtime: { ...runtime } };
  }
  return { ...defaultLauncherConfig(config.generated_by), launcher: config.launcher, windows_launcher: config.windows_launcher };
}

/* launcher 的稳定调用信息；work/doctor 用它生成 Agent 不应猜测的命令。 */
export function launcherInfo(h, root) {
  const config = readLauncherConfig(h, root);
  const runtime = config.mode === 'vendored' && isObj(config.runtime)
    ? { path: config.runtime.path, integrity: config.runtime.integrity, version: config.runtime.version, sha256: config.runtime.sha256 }
    : null;
  return {
    resolved: LAUNCHER_POSIX,
    windows: LAUNCHER_WINDOWS,
    mode: config.mode,
    invocation: './' + LAUNCHER_POSIX,
    windows_invocation: LAUNCHER_WINDOWS.replace(/\//g, '\\'),
    runtime,
  };
}

/* 计算仓库内二进制文件的 SHA256：优先用 host.readBytes + 内建 sha256Bytes
 * （跨平台、离线、不依赖系统工具），读取不可用时才回退
 * sha256sum -> shasum -a 256 -> certutil -hashfile。 */
export function sha256File(h, root, relPath) {
  const rel = safeRelPath(relPath) ? posix(relPath).trim() : null;
  if (!rel) throw Error('Unsafe path for SHA256: ' + relPath);
  const absolute = join(root, rel);
  if (!file(h, absolute)) throw Error('Cannot hash missing file: ' + rel);
  const windows = h.env('OS') === 'Windows_NT';
  const target = windows ? absolute.replace(/\//g, '\\') : absolute;
  // 首选内建：host.readBytes + sha256Bytes，不依赖系统工具，也不受 certutil 输出重定向限制。
  try {
    if (typeof h.readBytes === 'function') return sha256Bytes(h.readBytes(absolute));
  } catch (_) { /* fall through to external tools */ }
  const attempts = [
    ['sha256sum', [target]],
    ['shasum', ['-a', '256', target]],
    ['certutil', ['-hashfile', target, 'SHA256']],
  ];
  const failures = [];
  const digestOf = output => {
    const text = String(output || '');
    // certutil 在某些 Windows 版本把摘要按空格分组（ab cd ...）；先找只含 hex/空白的行。
    for (const line of text.split(/\r?\n/)) {
      const compact = line.replace(/[^0-9a-fA-F]/g, '');
      if (compact.length === 64 && /^[0-9a-fA-F\s]*$/.test(line.trim())) return compact.toLowerCase();
    }
    // sha256sum/shasum 把摘要放在行首，后跟路径。
    const match = /[0-9a-fA-F]{64}/.exec(text);
    return match ? match[0].toLowerCase() : null;
  };
  for (const [tool, args] of attempts) {
    let result;
    try { result = h.run([tool, ...args], root, 60); } catch (e) { failures.push(tool + ': ' + (e && e.message || e)); continue; }
    if (result.timedOut) { failures.push(tool + ': timeout'); continue; }
    if (result.code !== 0) { failures.push(tool + ': exit ' + result.code); continue; }
    const digest = digestOf(result.output);
    if (!digest) { failures.push(tool + ': no 64-hex digest in output'); continue; }
    return digest;
  }
  throw Error('no SHA256 tool available for ' + rel + ' (tried sha256sum, shasum -a 256, certutil -hashfile; ' + failures.join('; ') + ')');
}

/* 运行时的实际来源（由启动器通过 DAIRN_RUNTIME_SOURCE 传入）。
 * 只作为 doctor 的观察字段，不参与信任判断：unknown 不表示错误。 */
export function runtimeSource(h) {
  let value = null;
  try { value = h.env(RUNTIME_SOURCE_ENV); } catch (_) { value = null; }
  const text = typeof value === 'string' ? value.trim() : '';
  return ['vendored', 'external', 'path', 'packaged'].includes(text) ? text : 'unknown';
}

/* 将运行中 runtime 内嵌的 engine_sources 与当前工作树比较，回答
 * “这个运行时是否由当前源码构建”。这是陈旧度提示，不是门禁：
 * - 非源码 checkout 返回 not-source-repo（安装后的项目无从比较）；
 * - 运行时未携带 engine_sources 时返回 unknown，不猜测；
 * - 差异只列前 20 项，完整数量见 stale_count。
 * 运行时身份仍由 doctor 的 runtime_sha256 / lock 校验负责，二者不要混用。 */
export function runtimeFreshness(h, root, engineSources) {
  const sources = Array.isArray(engineSources) ? engineSources.filter(isObj) : [];
  if (!sources.length) {
    return {status: 'unknown', checked: 0, stale_sources: [], stale_count: 0,
      note: 'runtime carries no engine source digests; rebuild the runtime to enable freshness checks'};
  }
  if (!file(h, join(root, 'quickjs/main.mjs'))) {
    return {status: 'not-source-repo', checked: 0, stale_sources: [], stale_count: 0,
      note: 'current directory is not a Dairn source checkout; freshness is only measurable there'};
  }
  const stale = [];
  for (const source of sources) {
    const rel = typeof source.path === 'string' ? posix(source.path).trim() : '';
    const expected = typeof source.sha256 === 'string' ? source.sha256 : '';
    if (!safeRelPath(rel) || !HEX64.test(expected) || !rel.startsWith('quickjs/')) { stale.push(rel || '<invalid>'); continue; }
    const target = join(root, rel);
    if (!file(h, target)) { stale.push(rel); continue; }
    let actual = null;
    try { actual = sha256(h.read(target)); } catch (_) { stale.push(rel); continue; }
    if (actual !== expected) stale.push(rel);
  }
  const status = stale.length ? 'outdated' : 'current';
  return {status, checked: sources.length, stale_sources: stale.slice(0, 20), stale_count: stale.length,
    note: status === 'current'
      ? 'working tree matches the embedded engine sources'
      : 'working tree differs from the embedded engine sources; rebuild and vendor the runtime before verifying source changes'};
}

/* 注册已放入 .dairn/runtime/ 的官方运行时；只读校验，写盘由调用方负责。 */
export function vendorRuntime(h, root, fromPath, { version = null } = {}) {
  const raw = posix(String(fromPath === undefined || fromPath === null ? '' : fromPath).trim());
  if (!raw) throw Error('--vendor-runtime requires a path: ' + RUNTIME_DIR);
  if (raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) throw Error('--vendor-runtime must be a repository-relative path: ' + fromPath);
  const cleaned = raw.replace(/^(?:\.\/)+/, '').replace(/\/+$/, '');
  const segments = cleaned.split('/');
  if (segments.some(part => !part || part === '.' || part === '..')) throw Error('Unsafe --vendor-runtime path: ' + fromPath);
  if (cleaned !== RUNTIME_DIR && cleaned !== RUNTIME_BINARY) {
    throw Error('--vendor-runtime must point to ' + RUNTIME_DIR + ' or ' + RUNTIME_BINARY + ': ' + fromPath);
  }
  const rootReal = h.realpath(root);
  let cursor = root;
  for (const part of cleaned.split('/')) {
    cursor = join(cursor, part);
    if (h.isSymlink(cursor)) throw Error('Refuse symlinked runtime path: ' + cleaned);
    if (!h.exists(cursor)) throw Error('Missing runtime path: ' + cleaned + ' (place the official Dairn runtime there first)');
  }
  const real = h.realpath(cursor);
  if (real !== rootReal && !real.startsWith(rootReal + '/')) throw Error('Runtime path escapes the project root: ' + fromPath);
  for (const rel of [RUNTIME_BINARY, RUNTIME_INTEGRITY]) {
    if (h.isSymlink(join(root, rel))) throw Error('Refuse symlinked runtime file: ' + rel);
  }
  if (!file(h, join(root, RUNTIME_BINARY))) throw Error('Missing vendored runtime binary: ' + RUNTIME_BINARY);
  if (!file(h, join(root, RUNTIME_INTEGRITY))) throw Error('Missing vendored runtime integrity file: ' + RUNTIME_INTEGRITY);
  let integrity;
  try { integrity = JSON.parse(h.read(join(root, RUNTIME_INTEGRITY))); } catch (e) {
    throw Error('Invalid ' + RUNTIME_INTEGRITY + ': ' + (e && e.message || e));
  }
  if (!isObj(integrity)) throw Error('Invalid ' + RUNTIME_INTEGRITY + ': expected an object');
  if (typeof integrity.sha256 !== 'string' || !HEX64.test(integrity.sha256)) {
    throw Error('Invalid ' + RUNTIME_INTEGRITY + ' sha256 (expected 64 lowercase hex characters)');
  }
  if (typeof integrity.engine_version !== 'string' || !integrity.engine_version.trim()) {
    throw Error('Invalid ' + RUNTIME_INTEGRITY + ' engine_version');
  }
  const actual = sha256File(h, root, RUNTIME_BINARY);
  if (actual !== integrity.sha256) {
    throw Error('Vendored runtime sha256 mismatch: ' + RUNTIME_BINARY + ' is ' + actual + ' but ' + RUNTIME_INTEGRITY + ' declares ' + integrity.sha256);
  }
  const expected = version === undefined || version === null || version === '' ? null : String(version).trim();
  if (expected && integrity.engine_version !== expected) {
    throw Error('runtime version ' + integrity.engine_version + ' differs from the running Dairn version ' + expected + '; vendor the matching Dairn release');
  }
  return {
    schema: 1,
    mode: 'vendored',
    runtime: {
      path: RUNTIME_BINARY,
      integrity: RUNTIME_INTEGRITY,
      version: integrity.engine_version,
      sha256: actual,
    },
  };
}

/* doctor 使用的非抛错检查：返回 {ok,problems,info}。 */
export function verifyLauncher(h, root) {
  const problems = [];
  const missing = rel => { if (!file(h, join(root, rel))) problems.push('launcher missing: ' + rel + ' (run dairn upgrade --apply)'); };
  missing(LAUNCHER_POSIX);
  missing(LAUNCHER_WINDOWS);
  let config;
  try { config = readLauncherConfig(h, root); } catch (e) {
    problems.push('launcher config: ' + (e && e.message || e));
    return { ok: false, problems, info: null };
  }
  if (config.launcher !== LAUNCHER_POSIX) problems.push('launcher.json launcher path differs from managed ' + LAUNCHER_POSIX);
  if (config.windows_launcher !== LAUNCHER_WINDOWS) problems.push('launcher.json windows_launcher path differs from managed ' + LAUNCHER_WINDOWS);
  if (config.mode === 'external' && file(h, join(root, RUNTIME_BINARY))) {
    // launcher 脚本按“文件存在”解析 vendored 运行时；mode 只是治理记录。
    // 不一致时 doctor 必须报错，避免出现“实际跑 vendored、账面写 external”的漂移。
    problems.push('launcher.json mode=external but ' + RUNTIME_BINARY + ' exists; run dairn upgrade --vendor-runtime .dairn/runtime --apply (or remove the runtime)');
  }
  if (config.mode === 'vendored') {
    const runtime = config.runtime || {};
    const binaryRel = runtime.path || RUNTIME_BINARY;
    const integrityRel = runtime.integrity || RUNTIME_INTEGRITY;
    if (!file(h, join(root, binaryRel))) problems.push('missing vendored runtime: ' + binaryRel);
    if (!file(h, join(root, integrityRel))) problems.push('missing vendored runtime integrity: ' + integrityRel);
    let integrity = null;
    if (file(h, join(root, integrityRel))) {
      try { integrity = JSON.parse(h.read(join(root, integrityRel))); } catch (e) {
        problems.push('runtime integrity is not valid JSON: ' + (e && e.message || e));
      }
    }
    if (integrity && !isObj(integrity)) problems.push('runtime integrity must be a JSON object');
    else if (integrity) {
      if (typeof integrity.sha256 !== 'string' || !HEX64.test(integrity.sha256)) {
        problems.push('runtime-integrity.json sha256 is not 64 lowercase hex characters');
      } else if (integrity.sha256 !== runtime.sha256) {
        problems.push('runtime-integrity.json sha256 differs from launcher.json runtime.sha256');
      }
    }
    if (HEX64.test(runtime.sha256) && file(h, join(root, binaryRel))) {
      try {
        const actual = sha256File(h, root, binaryRel);
        if (actual !== runtime.sha256) problems.push('vendored runtime sha256 mismatch: ' + binaryRel + ' is ' + actual + ' but launcher.json records ' + runtime.sha256);
      } catch (e) {
        problems.push('cannot verify vendored runtime SHA256: ' + (e && e.message || e));
      }
    }
  }
  let info = null;
  try { info = launcherInfo(h, root); } catch (_) { info = null; }
  return { ok: problems.length === 0, problems, info };
}
