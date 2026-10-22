/* Thin host backed only by official QuickJS std/os, no BusyBox. */
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
    return { code: exitCode, output, timedOut, duration_sec: Math.round((Date.now() - start) / 10) / 100 };
  } finally {
    if (fd >= 0) os.close(fd);
    if (capture) os.remove(temp);
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
  read, write, exists, mkdirs, realpath, run,
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
  now() { return new Date().toISOString(); },
  log(s) { print(s); },
  error(s) { std.err.puts(s + '\n'); std.err.flush(); },
  cwd() { const [p, err] = os.getcwd(); if (err !== 0) throw new Error('getcwd failed'); return normalize(p); }
};
