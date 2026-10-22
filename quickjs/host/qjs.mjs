/* 基于 QuickJS std/os 的宿主适配层。 */
import * as std from 'std';
import * as os from 'os';
const SEP = '/';
function normalize(path) {
  let value = path.replace(/\\/g, '/');
  // Cosmopolitan 使用 /C/ 映射盘符；外部 Windows 工具需要 C:/。
  if (os.platform === 'win32') value = value.replace(/^\/([A-Za-z])(?=\/|$)/, '$1:');
  if (/^[A-Za-z]:\/$/.test(value)) return value[0].toUpperCase() + ':/';
  return value.replace(/\/$/, '') || '/';
}
function exists(p) { return os.stat(p)[1] === 0; }
function mkdirs(p) {
  const path = normalize(p);
  // Windows drive roots are not ordinary path components: calling mkdir on
  // `C:` can fail even when `C:/` exists. Keep the root as a prefix and only
  // create the remaining components.
  let prefix = '';
  let rest = path;
  const drive = /^([A-Za-z]:)\//.exec(path);
  if (drive) { prefix = drive[1] + '/'; rest = path.slice(3); }
  else if (path.startsWith('//')) {
    const unc = path.slice(2).split('/');
    if (unc.length >= 2 && unc[0] && unc[1]) {
      prefix = '//' + unc[0] + '/' + unc[1];
      rest = unc.slice(2).join('/');
    }
  } else if (path.startsWith('/')) { prefix = '/'; rest = path.slice(1); }
  const parts = rest.split('/');
  let built = prefix;
  for (const part of parts) {
    if (!part) continue;
    built = built ? (built.endsWith('/') ? built + part : built + '/' + part) : part;
    const err = os.mkdir(built);
    // Cosmopolitan's Windows personality can report EEXIST for an existing
    // drive-mounted parent while os.stat is denied by the sandbox. Continue
    // for that errno; a genuinely missing component still fails on creation.
    if (err !== 0 && err !== -183 && !exists(built)) throw new Error('mkdir failed: ' + built + ' ' + err);
  }
}
function read(path) { const t = std.loadFile(path); if (t === null) throw new Error('Cannot read: ' + path); return t; }
/* 二进制读取：APE/制品不能用 std.loadFile（按文本解码会破坏字节）。
 * QuickJS os.read 接受 ArrayBuffer；这里是 launcher 内建 SHA256 的基础。 */
function readBytes(path, limit = 64 * 1024 * 1024) {
  const target = normalize(path);
  const fd = os.open(target, os.O_RDONLY, 0o666);
  if (fd < 0) throw new Error('Cannot open for binary read: ' + path + ' (' + fd + ')');
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const buf = new ArrayBuffer(65536);
      const n = os.read(fd, buf, 0, 65536);
      if (n < 0) throw new Error('Binary read failed: ' + path + ' (' + n + ')');
      if (n === 0) break;
      total += n;
      if (total > limit) throw new Error('File exceeds binary read limit: ' + path);
      chunks.push(new Uint8Array(buf.slice(0, n)));
    }
  } finally {
    os.close(fd);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
  return out;
}
function write(path, content) {
  const f = std.open(path, 'w'); if (!f) throw new Error('Cannot write: ' + path);
  let closeResult;
  try { f.puts(content); f.flush(); } finally { closeResult = f.close(); }
  if (closeResult !== 0) throw new Error('File close failed: '+path+' ('+closeResult+')');
}
let seq = 0;
function executable(name, cwd) {
  if (os.platform !== 'win32') return name;
  const qualified = /[\\/]|^[A-Za-z]:/.test(name);
  const path = std.getenv('PATH') || '';
  const dirs = qualified ? [''] : (path.includes(';') || /^[A-Za-z]:/.test(path) ? path.split(';') : path.split(':'));
  // Windows PATH 不执行无扩展名的 POSIX 包装脚本；显式路径仍允许无扩展名 APE。
  const suffixes = /\.[^\\/]+$/.test(name) ? [''] : qualified ? ['.exe', '.com', ''] : ['.exe', '.com'];
  for (const dir of dirs) for (const suffix of suffixes) {
    let candidate = normalize((dir ? dir.replace(/^"|"$/g, '') + '/' : '') + name + suffix);
    if (!/^(?:\/|[A-Za-z]:\/)/.test(candidate)) candidate = normalize(cwd + '/' + candidate);
    const [info, err] = os.stat(candidate);
    if (err === 0 && (info.mode & os.S_IFMT) === os.S_IFREG) {
      if (/\.(cmd|bat)$/i.test(candidate)) throw new Error('Batch files require an explicit cmd.exe argv: ' + name);
      return candidate;
    }
  }
  throw new Error('Executable not found on PATH: ' + name);
}
function run(argv, cwd, timeout = 120, capture = true) {
  if (!Array.isArray(argv) || !argv.length || !argv.every(s => typeof s === 'string' && s)) throw new Error('Command must be argv array');
  if (!Number.isFinite(timeout) || timeout < 1 || timeout > 3600) throw new Error('Invalid timeout');
  const temp = (std.getenv('TMPDIR') || std.getenv('TEMP') || std.getenv('TMP') || (os.platform === 'win32' ? 'C:/Windows/Temp' : '/tmp')) + SEP + 'dairn-' + os.getpid() + '-' + (Date.now()) + '-' + (++seq) + '.txt';
  let fd = -1;
  try {
    // Open output once; the child never sees shell-escaped string command lines.
    if (capture) {
      fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600);
      if (fd < 0) throw new Error('Cannot open command output: ' + fd);
    }
    const opts = { cwd, block: false, usePath: true };
    if (capture) { opts.stdout = fd; opts.stderr = fd; }
    const start = Date.now();
    const command = [executable(argv[0], cwd), ...argv.slice(1)];
    const pid = os.exec(command, opts);
    if (pid <= 0) throw new Error('Cannot start process: ' + argv[0] + ' (' + pid + ')');
    if (fd >= 0) { os.close(fd); fd = -1; }
    let exitCode = null, timedOut = false;
    while (exitCode === null) {
      const [got, status] = os.waitpid(pid, os.WNOHANG);
      if (got < 0) throw new Error('waitpid failed: ' + got);
      if (got === pid) {
        // Cosmopolitan 在 Windows 返回原始 DWORD 退出码，POSIX 才使用编码状态。
        const signal = status & 0x7f;
        exitCode = os.platform === 'win32' ? status : signal === 0 ? (status >> 8) & 0xff : -signal;
        break;
      }
      if (Date.now() - start >= timeout * 1000) {
        timedOut = true;
        os.kill(pid, os.SIGTERM);
        os.sleep(150);
        const [reaped] = os.waitpid(pid, os.WNOHANG);
        if (reaped === 0) { os.kill(pid, os.SIGKILL ?? 9); os.waitpid(pid, 0); }
        exitCode = null;
        break;
      }
      os.sleep(25);
    }
    // Reject excessive output BEFORE allocating a potentially huge JavaScript string.
    // A process with unbounded logging still needs an outer CI disk quota.
    let output = '';
    if (capture) {
      const [info, err] = os.stat(temp);
      if (err !== 0) throw new Error('Cannot stat command output: '+err);
      if (info.size > 1048576) throw new Error('Command output exceeded 1 MiB');
      output = std.loadFile(temp) ?? '';
      if (output.length > 1048576) throw new Error('Command output exceeded 1 MiB');
    }
    // Git for Windows crashes with an access violation when its stdout/stderr
    // handles are inherited file descriptors created by Cosmopolitan (exit code
    // is a negative Windows exception). Python/node tolerate the same handles.
    // Fall back to Git's own POSIX sh, which performs the redirection itself.
    if (os.platform === 'win32' && capture && exitCode !== null && exitCode < 0 && isGitCommand(argv)) {
      const retried = runGitViaSh(argv, cwd, timeout);
      if (retried) return retried;
    }
    return { code: exitCode, output, timedOut, duration_sec: Math.round((Date.now() - start) / 10) / 100 };
  } finally {
    if (fd >= 0) os.close(fd);
    if (capture) os.remove(temp);
  }
}
function isGitCommand(argv) {
  if (!argv || !argv.length) return false;
  const base = normalize(String(argv[0])).split('/').pop().toLowerCase();
  return base === 'git' || base === 'git.exe';
}
function quoteSh(value) { return "'" + String(value).replace(/'/g, "'\\''") + "'"; }
function findGitShell(argv, cwd) {
  const candidates = [];
  const override = std.getenv('DAIRN_GIT_SH');
  if (override) candidates.push(normalize(override));
  try {
    const exe = normalize(executable(argv[0], cwd));
    const dir = exe.replace(/\/[^/]*$/, '');
    candidates.push(dir + '/sh.exe', dir + '/../bin/sh.exe', dir + '/../usr/bin/sh.exe');
  } catch (_) { /* fall through to override/PATH probes */ }
  for (const candidate of candidates) if (candidate && exists(candidate)) return candidate;
  return null;
}
function runGitViaSh(argv, cwd, timeout) {
  const sh = findGitShell(argv, cwd);
  if (!sh) throw new Error('git crashed under redirected stdio on Windows and Git sh.exe was not found; set DAIRN_GIT_SH to Git for Windows bin/sh.exe');
  const base = (std.getenv('TMPDIR') || std.getenv('TEMP') || std.getenv('TMP') || 'C:/Windows/Temp') + SEP + 'dairn-git-' + os.getpid() + '-' + (Date.now()) + '-' + (++seq);
  const out = base + '.out.txt';
  const errOut = base + '.err.txt';
  const start = Date.now();
  try {
    // 成功时只回传 stdout：Windows autocrlf 会在 stderr 打印换行警告，
    // 与 `-z` 路径列表混合会破坏机器解析；失败时把 stderr 附回以便诊断。
    const cmd = argv.map(quoteSh).join(' ') + ' 1> ' + quoteSh(out) + ' 2> ' + quoteSh(errOut);
    const pid = os.exec([sh, '-c', cmd], { cwd, block: false, usePath: true });
    if (pid <= 0) throw new Error('Cannot start Git sh wrapper: ' + pid);
    let exitCode = null, timedOut = false;
    while (exitCode === null) {
      const [got, status] = os.waitpid(pid, os.WNOHANG);
      if (got < 0) throw new Error('waitpid failed: ' + got);
      if (got === pid) {
        // Cosmo 在 Windows 返回原始 DWORD（sh.exe 的 128 就是 128），
        // 不能套用 POSIX status 编码，否则 128 会被算成 0。
        if (os.platform === 'win32') exitCode = status;
        else {
          const signal = status & 0x7f;
          exitCode = signal === 0 ? (status >> 8) & 0xff : -signal;
        }
        break;
      }
      if (Date.now() - start >= timeout * 1000) {
        timedOut = true;
        os.kill(pid, os.SIGTERM);
        os.sleep(150);
        const [reaped] = os.waitpid(pid, os.WNOHANG);
        if (reaped === 0) { os.kill(pid, os.SIGKILL ?? 9); os.waitpid(pid, 0); }
        exitCode = null;
        break;
      }
      os.sleep(25);
    }
    const readLimited = path => {
      const [info, err] = os.stat(path);
      if (err !== 0) return '';
      if (info.size > 1048576) throw new Error('Command output exceeded 1 MiB');
      const text = std.loadFile(path) ?? '';
      if (text.length > 1048576) throw new Error('Command output exceeded 1 MiB');
      return text;
    };
    let output = readLimited(out);
    if (timedOut || exitCode !== 0) output += readLimited(errOut);
    return { code: exitCode, output, timedOut, duration_sec: Math.round((Date.now() - start) / 10) / 100 };
  } finally {
    os.remove(out);
    os.remove(errOut);
  }
}
function realpath(path) {
  const normalized = normalize(path);
  const [absolute, err] = os.realpath(normalized);
  // 目录存在不代表路径已解析；解析失败时禁止绕过目录联接/符号链接边界。
  if (err !== 0) throw new Error('realpath failed: ' + path + ' (' + err + ')');
  const result = normalize(absolute);
  if (os.platform === 'win32') {
    // Cosmo realpath 只展开 Windows 词法路径；逐层拒绝联接，防止假 canonical 路径越界。
    let current = result;
    while (current && !/^[A-Za-z]:\/$/.test(current) && !/^\/\/[^/]+\/[^/]+$/.test(current)) {
      const [info, status] = os.lstat(current);
      if (status !== 0) throw new Error('lstat failed: ' + current + ' (' + status + ')');
      if ((info.mode & os.S_IFMT) === os.S_IFLNK) throw new Error('Windows 路径包含目录联接或符号链接: ' + current);
      const end = current.lastIndexOf('/');
      current = end === 2 && /^[A-Za-z]:/.test(current) ? current.slice(0, 3) : current.slice(0, end);
    }
  }
  return result;
}
export const host = {
  read, readBytes, write, exists, mkdirs, realpath, run,
  writeExclusive(path,content){
    const fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600);
    if(fd<0)throw Error('Refuse existing/temp path: '+path);
    const f=std.fdopen(fd,'w');if(!f){os.close(fd);throw Error('fdopen failed');}
    try{f.puts(content);f.flush();}finally{f.close();}
  },
  rename(a,b) { const rc=os.rename(a,b); if(rc!==0) throw new Error("rename failed: "+a+" -> "+b+" ("+rc+")"); },
  rmdir(p) {const rc=os.remove(p);if(rc!==0)throw new Error('rmdir failed: '+p+' ('+rc+')');},
  remove(p) { const rc=os.remove(p); if(rc!==0) throw new Error("remove failed: "+p+" ("+rc+")"); },
  isSymlink(p) {const [info,err]=os.lstat(p); return err===0 && (info.mode & os.S_IFMT)===os.S_IFLNK;},
  isDirectory(p) { const [entry,err]=os.stat(p); return err===0 && (entry.mode & os.S_IFMT)===os.S_IFDIR; },
  list(path) { const [entries, err] = os.readdir(path); if (err !== 0) throw new Error('readdir failed: ' + path); return entries.filter(name=>name!=='.' && name!=='..'); },
  env(name) { return std.getenv(name); },
  readStdin(limit = 65536) {
    // Agent hook 事件从 stdin 传入；限制读取上限，避免无界输入占用内存。
    if (!Number.isFinite(limit) || limit < 1) throw new Error('Invalid stdin read limit');
    const max = Math.min(Math.floor(limit), 65536);
    let text;
    try { text = std.in.readAsString(max); }
    catch (e) { throw new Error('Cannot read stdin: ' + (e && e.message ? e.message : String(e))); }
    if (typeof text !== 'string') throw new Error('Cannot read stdin as text');
    return text;
  },
  sleep(ms) {
    if (!Number.isFinite(ms) || ms < 0 || ms > 3600000) throw new Error('Invalid sleep duration');
    os.sleep(Math.floor(ms));
  },
  chmod(path, mode) {
    // Windows 的 Git 不依赖执行位；POSIX 上优先用 os.chmod，缺失时退化到系统 chmod 命令。
    const absolute = normalize(path);
    if (os.platform === 'win32') return;
    if (typeof os.chmod === 'function') {
      try { if (os.chmod(absolute, mode) === 0) return; } catch (_) { /* fall through */ }
    }
    const cwd = absolute.slice(0, absolute.lastIndexOf('/')) || '/';
    const result = this.run(['chmod', mode.toString(8), absolute], cwd, 15);
    if (result.timedOut || result.code !== 0) throw new Error('chmod failed: ' + path);
  },
  now() { return new Date().toISOString(); },
  log(s) { print(s); },
  error(s) { std.err.puts(s + '\n'); std.err.flush(); },
  cwd() { const [p, err] = os.getcwd(); if (err !== 0) throw new Error('getcwd failed'); return normalize(p); }
};
