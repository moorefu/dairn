/* Worker 排空原生管道，主线程保留同步 run 接口；不调用 shell。 */
import * as os from 'os';

const parent = os.Worker.parent;
parent.onmessage = ({data}) => {
  parent.onmessage = null;
  const state = new Int32Array(data.state);
  const readers = new Set();
  let pid = -1, reaped = false, endedAt = null, timer = null;
  let total = 0, done = false;
  const start = Date.now();
  function closeReader(fd) {
    os.setReadHandler(fd, null);
    os.close(fd);
    readers.delete(fd);
  }
  function finish(error = 0) {
    if (done) return;
    done = true;
    if (timer !== null) os.clearTimeout(timer);
    for (const fd of [...readers]) closeReader(fd);
    Atomics.store(state, 5, error);
    Atomics.store(state, 0, 2);
  }
  function stop() {
    if (pid > 0 && !reaped) {
      const killed = os.kill(pid, os.SIGKILL ?? 9);
      if (killed !== 0) throw Error('kill: ' + killed);
      const [got] = os.waitpid(pid, 0);
      if (got !== pid) throw Error('waitpid: ' + got);
      reaped = true;
    }
  }
  function fail(error) {
    try { stop(); } catch (_) { /* 原错误仍以非零状态交回主线程。 */ }
    finish(Number.isInteger(error) && error < 0 ? error : -1);
  }
  try {
    Atomics.store(state, 0, 1);
    const pipes = [os.pipe(), os.pipe()];
    try {
      for (const pair of pipes) {
        if (pair.length !== 2 || pair.some(fd => fd < 0)) throw Error('pipe failed');
        readers.add(pair[0]);
      }
      pid = os.exec(data.argv, {cwd:data.cwd, block:false, usePath:false,
                              stdout:pipes[0][1], stderr:pipes[1][1]});
      Atomics.store(state, 1, pid);
      if (pid <= 0) throw Error('exec: ' + pid);
    } finally {
      for (const pair of pipes) if (pair[1] >= 0) os.close(pair[1]);
    }
    for (let index = 0; index < pipes.length; index++) {
      const fd = pipes[index][0], target = index === 0 ? data.stdout : data.stderr;
      os.setReadHandler(fd, () => {
        try {
          const buffer = new ArrayBuffer(65536);
          const count = os.read(fd, buffer, 0, buffer.byteLength);
          if (count < 0) throw count;
          if (count === 0) {
            closeReader(fd);
            if (reaped && readers.size === 0) finish();
            return;
          }
          total += count;
          if (total > 1048576) {
            Atomics.store(state, 4, 1);
            stop();
            finish();
            return;
          }
          let offset = 0;
          while (offset < count) {
            const written = os.write(target, buffer, offset, count - offset);
            if (written <= 0) throw written || -1;
            offset += written;
          }
        } catch (error) { fail(error); }
      });
    }
    const poll = () => {
      timer = null;
      if (done) return;
      try {
        if (!reaped) {
          const [got, code] = os.waitpid(pid, os.WNOHANG);
          if (got < 0) throw got;
          if (got === pid) {
            reaped = true;
            endedAt = Date.now();
            Atomics.store(state, 2, code);
          } else if (Date.now() - start >= data.timeout * 1000) {
            Atomics.store(state, 3, 1);
            stop();
            endedAt = Date.now();
          }
        }
        // 已退出的子进程不应因后台后代继承管道而无限等待 EOF；给排空留足
        // 余量，避免负载高时把已写入但尚未读到的输出截断。
        if (reaped && (readers.size === 0 || Date.now() - endedAt >= 1000)) finish();
        else timer = os.setTimeout(poll, 10);
      } catch (error) { fail(error); }
    };
    poll();
  } catch (error) { fail(error); }
};
