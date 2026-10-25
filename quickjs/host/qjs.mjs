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
/* 二进制写入：复制 vendored 运行时（APE）必须保真，不能用 std.open(w) 文本写。 */
function writeBytes(path, bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const target = normalize(path);
  const fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o666);
  if (fd < 0) throw new Error('Cannot open for binary write: ' + path + ' (' + fd + ')');
  let offset = 0;
  try {
    while (offset < data.length) {
      const n = os.write(fd, data.buffer, offset, data.length - offset);
      if (n <= 0) throw new Error('Binary write failed: ' + path + ' (' + n + ')');
      offset += n;
    }
  } finally { os.close(fd); }
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
function openCapture(cwd) {
  const explicit = std.getenv('TMPDIR');
  const local = normalize(cwd) + '/.dairn/tmp';
  const directories = explicit ? [explicit] : [std.getenv('TEMP'), std.getenv('TMP')].filter(Boolean);
  if (!directories.length) directories.push(os.platform === 'win32' ? 'C:/Windows/Temp' : '/tmp');
  if (!explicit && exists(normalize(cwd) + '/.dairn/lock.json')) directories.push(local);
  const failures = [];
  for (const directory of [...new Set(directories.filter(Boolean).map(normalize))]) {
    try {
      if (directory === local) {
        // 自动回退仅使用项目内部目录，拒绝链接将捕获文件导向项目外部。
        for (const path of [normalize(cwd) + '/.dairn', local]) {
          const [entry, error] = os.lstat(path);
          if (error === 0 && (entry.mode & os.S_IFMT) === os.S_IFLNK) throw Error('临时目录包含符号链接');
        }
        mkdirs(local);
        if (!realpath(local).startsWith(realpath(cwd).replace(/\/$/, '') + '/')) throw Error('临时目录越出项目');
      }
      const path = directory + SEP + 'dairn-' + os.getpid() + '-' + Date.now() + '-' + (++seq) + '.txt';
      const fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600);
      if (fd >= 0) return {path, fd, directory};
      failures.push(path + ' (' + fd + ')');
    } catch (error) { failures.push(directory + ': ' + error.message); }
  }
  throw Error('Cannot open command output: ' + failures.join('; ') + '; set TMPDIR/TEMP to a writable directory');
}
function run(argv, cwd, timeout = 120, capture = true) {
  if (!Array.isArray(argv) || !argv.length || !argv.every(s => typeof s === 'string' && s)) throw new Error('Command must be argv array');
  if (!Number.isFinite(timeout) || timeout < 1 || timeout > 3600) throw new Error('Invalid timeout');
  let temp = null, errorTemp = null;
  let fd = -1, errorFd = -1;
  try {
    if (capture) {
      const opened = openCapture(cwd);
      temp = opened.path; fd = opened.fd;
    }
    const start = Date.now();
    const command = [executable(argv[0], cwd), ...argv.slice(1)];
    // Git 成功时只回传 stdout：Windows autocrlf 会在 stderr 打印换行警告，
    // 与 `-z` 路径列表或 JSON 输出混合会破坏机器解析。其他工具保持合并输出。
    const mergeStderr = !isGitCommand(argv);
    let exitCode = null, timedOut = false;
    // Windows 原生子进程无法可靠继承 Cosmopolitan 打开的文件描述符：直接重定向
    // 会让输出回到控制台，Python 等工具还会以非零状态退出。所有带捕获的原生子
    // 进程都经 Worker 建立真实管道并由同一进程持续排空。
    if (os.platform === 'win32' && capture) {
      const opened = openCapture(cwd);
      errorTemp = opened.path; errorFd = opened.fd;
      const result = runWindowsPipes(command, cwd, timeout, fd, errorFd >= 0 ? errorFd : fd);
      exitCode = result.code; timedOut = result.timedOut;
    } else {
      // Windows 已在 executable() 中按 PATHEXT 解析为绝对路径，不能再次搜索
      // PATH；POSIX 保留 execvp 的 PATH 解析（git/go/python3 等是裸命令名）。
      const opts = {cwd, block:false, usePath: os.platform !== 'win32'};
      if (capture) { opts.stdout = fd; opts.stderr = fd; }
      const pid = os.exec(command, opts);
      if (pid <= 0) throw new Error('Cannot start process: ' + argv[0] + ' (' + pid + ')');
      if (fd >= 0) { os.close(fd); fd = -1; }
      while (exitCode === null) {
        const [got, status] = os.waitpid(pid, os.WNOHANG);
        if (got < 0) throw new Error('waitpid failed: ' + got);
        if (got === pid) {
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
          break;
        }
        os.sleep(25);
      }
    }
    if (fd >= 0) { os.close(fd); fd = -1; }
    if (errorFd >= 0) { os.close(errorFd); errorFd = -1; }
    // Reject excessive output BEFORE allocating a potentially huge JavaScript string.
    // A process with unbounded logging still needs an outer CI disk quota.
    let output = '';
    if (capture) {
      const [info, err] = os.stat(temp);
      if (err !== 0) throw new Error('Cannot stat command output: '+err);
      if (info.size > 1048576) throw new Error('Command output exceeded 1 MiB');
      output = std.loadFile(temp) ?? '';
      if (errorTemp && (mergeStderr || timedOut || exitCode !== 0)) output += std.loadFile(errorTemp) ?? '';
      if (output.length > 1048576) throw new Error('Command output exceeded 1 MiB');
    }
    const dllInitFailed = os.platform === 'win32' &&
      (exitCode === -1073741502 || exitCode === 3221225794);
    if (dllInitFailed) output += (output ? '\n' : '') +
      'Windows 子进程初始化失败 (0xC0000142): ' + argv[0] +
      '；工具可能已安装，请核对进程权限、DLL 和执行环境。';
    return { code: exitCode, output, timedOut, duration_sec: Math.round((Date.now() - start) / 10) / 100 };
  } finally {
    if (fd >= 0) os.close(fd);
    if (errorFd >= 0) os.close(errorFd);
    if (temp) os.remove(temp);
    if (errorTemp) os.remove(errorTemp);
  }
}
function isGitCommand(argv) {
  if (!Array.isArray(argv) || !argv.length) return false;
  const base = normalize(String(argv[0])).split('/').pop().toLowerCase();
  return base === 'git' || base === 'git.exe';
}
function runWindowsPipes(argv, cwd, timeout, stdout, stderr) {
  const worker = new os.Worker('./native-process.mjs');
  const state = new Int32Array(new SharedArrayBuffer(24));
  const start = Date.now();
  worker.postMessage({argv, cwd, timeout, stdout, stderr, state:state.buffer});
  while (Atomics.load(state, 0) !== 2) {
    const elapsed = Date.now() - start;
    if ((Atomics.load(state, 0) === 0 && elapsed > 5000) || elapsed > timeout * 1000 + 5000) {
      const pid = Atomics.load(state, 1);
      if (pid > 0) os.kill(pid, os.SIGKILL ?? 9);
      throw Error('Native process capture worker timed out');
    }
    os.sleep(10);
  }
  if (Atomics.load(state, 4)) throw Error('Command output exceeded 1 MiB');
  if (Atomics.load(state, 5)) throw Error('Native process capture failed: ' + Atomics.load(state, 5));
  const timedOut = !!Atomics.load(state, 3);
  return {code:timedOut ? null : Atomics.load(state, 2), timedOut};
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
  read, readBytes, write, writeBytes, exists, mkdirs, realpath, run,
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
