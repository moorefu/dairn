/* Dairn 任务切片账本：`.dairn/governance/tasks/*.json` 的字段、DAG 与并行写作用域校验。
 *
 * 该模块同时服务三个调用方：
 *   - `dairn tasks check|ready`（project.mjs dispatch）；
 *   - validators.mjs 的 tasks 校验器（`dairn validate`）；
 *   - work.mjs 的 slice 阶段证据（validateTaskObject）。
 * 校验是结构性的：证明字段可解析、DAG 无环无悬空、写作用域安全；它不证明
 * 任务拆分是否合理，也不构成人工审批。
 */
const join = (a, b) => a.replace(/\/$/, '') + '/' + b;
const isObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const nonempty = x => typeof x === 'string' && !!x.trim();
const TASK_ID = /^TASK-[A-Za-z0-9_-]+$/;
const STATUSES = ['ready', 'in-progress', 'done', 'blocked'];
const KINDS = ['change', 'bugfix', 'refactor', 'docs'];
const STRATEGIES = ['expand-migrate-contract'];
const ACTIVE_STATUSES = ['ready', 'in-progress'];

function normalizeScope(scope) {
  return String(scope).trim().replace(/\/+$/, '');
}

/* 写作用域是安全相对路径：允许以 / 结尾表示目录前缀，禁止绝对路径、..、
 * 反斜杠、空段与重复项。 */
function scopeProblem(scope) {
  if (!nonempty(scope)) return 'must be a non-empty string';
  const value = scope.trim();
  if (value.includes('\\')) return 'backslashes are not allowed; use posix paths';
  if (value.startsWith('/')) return 'absolute paths are not allowed';
  if (/^[A-Za-z]:/.test(value)) return 'absolute paths are not allowed';
  const trimmed = value.replace(/\/+$/, '');
  if (!trimmed) return 'empty path';
  for (const part of trimmed.split('/')) {
    if (!part) return 'empty path segment';
    if (part === '.') return 'current-directory segment is not allowed';
    if (part === '..') return 'parent-directory segments are not allowed';
  }
  return null;
}

/* 单任务对象的字段校验；不读取文件系统。 */
export function validateTaskObject(task) {
  const errors = [];
  if (!isObj(task)) return ['task must be an object'];
  const id = typeof task.id === 'string' ? task.id : '';
  if (!TASK_ID.test(id)) errors.push('invalid task id (expected TASK-[A-Za-z0-9_-]+)');
  if (!nonempty(task.title)) errors.push('missing title');
  if (!nonempty(task.acceptance)) errors.push('missing acceptance');
  if (!STATUSES.includes(task.status)) errors.push('invalid status (ready|in-progress|done|blocked)');
  if (!Array.isArray(task.blocked_by)) errors.push('blocked_by must be an array');
  else {
    const seen = new Set();
    for (const dep of task.blocked_by) {
      if (typeof dep !== 'string' || !TASK_ID.test(dep)) errors.push('invalid blocked_by entry');
      else if (seen.has(dep)) errors.push('duplicate blocked_by entry ' + dep);
      else if (dep === id) errors.push('self dependency');
      if (typeof dep === 'string') seen.add(dep);
    }
  }
  if (task.write_scopes !== undefined) {
    if (!Array.isArray(task.write_scopes)) errors.push('write_scopes must be an array');
    else {
      const seen = new Set();
      for (const scope of task.write_scopes) {
        const problem = scopeProblem(scope);
        if (problem) { errors.push('invalid write scope ' + JSON.stringify(scope) + ': ' + problem); continue; }
        const key = normalizeScope(scope);
        if (seen.has(key)) errors.push('duplicate write scope ' + scope);
        seen.add(key);
      }
    }
  }
  if (task.test_seams !== undefined) {
    if (!Array.isArray(task.test_seams) || task.test_seams.some(x => !nonempty(x))) {
      errors.push('test_seams must be an array of non-empty strings');
    }
  }
  if (task.kind !== undefined && !KINDS.includes(task.kind)) errors.push('invalid kind (change|bugfix|refactor|docs)');
  if (task.strategy !== undefined && !STRATEGIES.includes(task.strategy)) errors.push('invalid strategy (expand-migrate-contract)');
  if (task.owner !== undefined && !nonempty(task.owner)) errors.push('invalid owner');
  return errors;
}

function rel(root, file) {
  return file.slice(root.length).replace(/^\//, '');
}
function collectJson(h, dir, out) {
  if (!h.exists(dir)) return;
  for (const name of h.list(dir).sort()) {
    const full = join(dir, name);
    if (h.isDirectory(full)) collectJson(h, full, out);
    else if (name.endsWith('.json')) out.push(full);
  }
}
function loadTasks(h, root) {
  const errors = [], tasks = new Map(), files = [];
  collectJson(h, join(root, '.dairn/governance/tasks'), files);
  for (const file of files.sort()) {
    const relPath = rel(root, file), base = relPath.split('/').pop().replace(/\.json$/, '');
    let task;
    try { task = JSON.parse(h.read(file)); } catch (e) { errors.push(relPath + ': ' + (e && e.message || e)); continue; }
    for (const problem of validateTaskObject(task)) errors.push(relPath + ': ' + problem);
    if (!isObj(task) || typeof task.id !== 'string' || !TASK_ID.test(task.id)) continue;
    if (base !== task.id) errors.push(relPath + ': id does not match filename (' + task.id + ' vs ' + base + '.json)');
    if (tasks.has(task.id)) { errors.push(relPath + ': duplicate task id ' + task.id); continue; }
    tasks.set(task.id, task);
  }
  for (const [id, task] of tasks) {
    for (const dep of task.blocked_by || []) if (!tasks.has(dep)) errors.push(id + ': unknown dependency ' + dep);
  }
  const color = new Map();
  function visit(id) {
    if (color.get(id) === 1) { errors.push('cycle through ' + id); return; }
    if (color.get(id) === 2) return;
    color.set(id, 1);
    for (const dep of tasks.get(id).blocked_by || []) if (tasks.has(dep)) visit(dep);
    color.set(id, 2);
  }
  for (const id of tasks.keys()) visit(id);
  return { errors, tasks, files };
}

function reachableDependencies(tasks, id, seen = new Set()) {
  const task = tasks.get(id);
  if (!task) return seen;
  for (const dep of task.blocked_by || []) {
    if (seen.has(dep)) continue;
    seen.add(dep);
    reachableDependencies(tasks, dep, seen);
  }
  return seen;
}

function scopeOverlaps(scopesA, scopesB) {
  const hits = [];
  for (const a of scopesA) {
    const na = normalizeScope(a);
    for (const b of scopesB) {
      const nb = normalizeScope(b);
      if (na === nb || na.startsWith(nb + '/') || nb.startsWith(na + '/')) hits.push([a, b]);
    }
  }
  return hits;
}

function sortStrings(values) {
  return values.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
}

/* `dairn validate` 使用的任务校验器：字段 + DAG + 文件名一致性。 */
export function tasksValidate(h, root) {
  return loadTasks(h, root).errors;
}

/* 报告可执行前沿、切片警告与并行写作用域重叠；strict 把 warnings 提升为 errors。 */
export function tasksReport(h, root, { strict = false } = {}) {
  const { errors, tasks } = loadTasks(h, root);
  const warnings = [];
  const ids = sortStrings([...tasks.keys()]);
  const done = new Set(ids.filter(id => tasks.get(id).status === 'done'));
  const ready = ids.filter(id => {
    const task = tasks.get(id);
    return task.status === 'ready' && (task.blocked_by || []).every(dep => done.has(dep));
  });
  for (const id of ids) {
    const task = tasks.get(id);
    if (!ACTIVE_STATUSES.includes(task.status)) continue;
    const scopes = Array.isArray(task.write_scopes) ? task.write_scopes : [];
    const seams = Array.isArray(task.test_seams) ? task.test_seams : [];
    if (!seams.length) warnings.push(id + ': missing test_seams (declare the observable verification seams)');
    if (!scopes.length) warnings.push(id + ': missing write_scopes (parallel agents need explicit write boundaries)');
    if (nonempty(task.acceptance) && task.acceptance.length > 400) {
      warnings.push(id + ': acceptance is longer than 400 characters; tighten it or split the task');
    }
    if (scopes.length > 6 && task.strategy !== 'expand-migrate-contract') {
      warnings.push(id + ': more than 6 write_scopes without strategy=expand-migrate-contract; consider a smaller slice');
    }
  }
  const active = ids.filter(id => ACTIVE_STATUSES.includes(tasks.get(id).status));
  const overlaps = [];
  for (let i = 0; i < active.length; i++) {
    for (let k = i + 1; k < active.length; k++) {
      const a = active[i], b = active[k];
      const depsA = reachableDependencies(tasks, a), depsB = reachableDependencies(tasks, b);
      if (depsA.has(b) || depsB.has(a)) continue; // serialized by the DAG, not a parallel conflict
      const scopesA = Array.isArray(tasks.get(a).write_scopes) ? tasks.get(a).write_scopes : [];
      const scopesB = Array.isArray(tasks.get(b).write_scopes) ? tasks.get(b).write_scopes : [];
      const hits = scopeOverlaps(scopesA, scopesB);
      if (!hits.length) continue;
      const shared = [...new Set(hits.flatMap(pair => pair))];
      overlaps.push({ a, b, scopes: sortStrings(shared) });
      warnings.push('write scope overlap between ' + a + ' and ' + b + ': ' + shared.join(', '));
    }
  }
  sortStrings(warnings);
  if (strict) errors.push(...warnings);
  return { schema: 1, tasks: tasks.size, errors, warnings, ready, overlaps };
}

/* `dairn tasks ready` 的可执行前沿：ready 列表 + 被依赖阻塞的任务及等待对象。 */
export function tasksReady(h, root) {
  const { errors, tasks } = loadTasks(h, root);
  const ids = sortStrings([...tasks.keys()]);
  const done = new Set(ids.filter(id => tasks.get(id).status === 'done'));
  const ready = [], blocked = [];
  for (const id of ids) {
    const task = tasks.get(id);
    const waiting = (task.blocked_by || []).filter(dep => !done.has(dep));
    if (task.status === 'ready' && !waiting.length) ready.push(id);
    else if (task.status === 'ready' || task.status === 'blocked') blocked.push({ id, waiting_on: waiting });
  }
  return { schema: 1, ready, blocked, errors };
}
