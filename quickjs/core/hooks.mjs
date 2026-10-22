/* Agent hook 集成：turn-end 会话锚定与本地 hooks 安装。
 * 锚点只是 local-unattributed 的过程证据：它证明某个会话在某个 HEAD 上结束，
 * 不证明动作合理、测试通过或经过审批，也不等于受保护 CI 的 Ed25519 声明。
 */
import {sha256} from './sha256.mjs';
import {invariant, relative} from './policy.mjs';
import {appendSessionAnchor,activeTaskIds} from './work.mjs';
const join = (root, rel) => (rel === '.' ? root : root.replace(/\/$/, '') + '/' + rel);
const at = (dir, name) => dir.replace(/\/$/, '') + '/' + name;
const taskIdRe = /^[a-z][a-z0-9-]{1,63}$/;
const HOOK_DIR = '.dairn/hooks';
const GIT_PRE_PUSH = '.git/hooks/pre-push';
const GIT_PRE_PUSH_BODY = '#!/bin/sh\nset -eu\nexec sh "$(git rev-parse --show-toplevel)/.dairn/hooks/pre-push" "$@"\n';

function envValue(h, name) {
  const value = h.env(name);
  return typeof value === 'string' ? value.trim() : '';
}
function detectProvider(h) {
  const declared = envValue(h, 'DAIRN_SESSION_PROVIDER');
  if (declared) return declared;
  if (envValue(h, 'DSH_SESSION_ID')) return 'dsh';
  if (envValue(h, 'CLAUDE_SESSION_ID') || envValue(h, 'CLAUDE_CODE_SESSION_ID')) return 'claude';
  if (envValue(h, 'CODEX_SESSION_ID')) return 'codex';
  return null;
}
function envSession(h, provider) {
  const generic = envValue(h, 'DAIRN_SESSION_ID');
  if (generic) return generic;
  if (provider === 'dsh') return envValue(h, 'DSH_SESSION_ID') || null;
  if (provider === 'claude') return envValue(h, 'CLAUDE_SESSION_ID') || envValue(h, 'CLAUDE_CODE_SESSION_ID') || null;
  if (provider === 'codex') return envValue(h, 'CODEX_SESSION_ID') || null;
  return envValue(h, 'DSH_SESSION_ID') || envValue(h, 'CLAUDE_SESSION_ID') ||
    envValue(h, 'CLAUDE_CODE_SESSION_ID') || envValue(h, 'CODEX_SESSION_ID') || null;
}
function text(value) {
  if (typeof value === 'string') return value.trim() ? value.trim() : null;
  if (typeof value === 'number') return String(value);
  return null;
}
function utcStamp(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(String(iso));
  if (!match) return String(iso).replace(/[^0-9TZ]/g, '');
  return match[1] + match[2] + match[3] + 'T' + match[4] + match[5] + match[6] + 'Z';
}
function parsePayload(h, o) {
  let raw = typeof o.payload === 'string' ? o.payload.trim() : '';
  if (!raw && o.stdin) {
    try { raw = h.readStdin(65536).trim(); }
    catch (e) { throw new Error('Cannot read hook payload from stdin: ' + (e && e.message ? e.message : String(e))); }
  }
  if (!raw) return {};
  let payload;
  try { payload = JSON.parse(raw); }
  catch (e) { throw new Error('Invalid hook payload JSON: ' + (e && e.message ? e.message : String(e))); }
  invariant(payload && typeof payload === 'object' && !Array.isArray(payload), 'Hook payload must be a JSON object');
  return payload;
}
export function runTurnEnd(h, root, o) {
  const opts = o || {};
  const payload = parsePayload(h, opts);
  let provider = text(opts.provider) || text(payload.provider) || detectProvider(h);
  let session_id = text(opts.session) || text(payload.session_id) || text(payload.sessionId) ||
    text(payload['thread-id']) || envSession(h, provider);
  const event = text(opts.event) || text(payload.hook_event_name) || text(payload.type) || 'turn-end';
  const turn = payload.turn_id ?? payload.turnId ?? payload['turn-id'] ?? null;
  const transcript = text(payload.transcript_path);
  let task = text(opts.task);
  if (!task) {
    const active = activeTaskIds(h, root);
    invariant(active.length > 0, 'No active Dairn task; start one with dairn work start');
    invariant(active.length === 1, 'Multiple active Dairn tasks (' + active.join(', ') + '); select one with --task');
    task = active[0];
  }
  invariant(taskIdRe.test(task), 'Invalid task id: ' + task);
  const headResult = h.run(['git', 'rev-parse', '--verify', 'HEAD^{commit}'], root, 15);
  invariant(!headResult.timedOut && headResult.code === 0, 'Cannot resolve current Git HEAD for session anchor');
  const head = String(headResult.output || '').trim().split(/\r?\n/)[0].trim();
  invariant(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(head), 'Unexpected Git HEAD value: ' + head);
  let attribution = 'attributed';
  if (!provider || !session_id) {
    invariant(opts.allow_unattributed,
      'Cannot attribute session: pass --provider and --session (or use --allow-unattributed to record an explicitly unattributed anchor)');
    provider = 'unattributed';
    session_id = 'none';
    attribution = 'unattributed';
  }
  const created_at = h.now();
  const name = task + '-' + utcStamp(created_at) + '-' + sha256(task + '|' + head + '|' + created_at + '|' + Math.random()).slice(0, 6) + '.json';
  const rel = '.dairn/governance/evidence/session/' + name;
  const body = JSON.stringify({schema: 1, task_id: task, provider, session_id, event, turn, transcript,
    head, attribution, created_at}, null, 2) + '\n';
  h.mkdirs(join(root, '.dairn/governance/evidence/session'));
  h.writeExclusive(join(root, rel), body);
  // 以落盘内容计算摘要：与账本 proofCheck 的读取路径保持一致（避免平台换行差异）。
  appendSessionAnchor(h, root, task, {path: rel, sha256: sha256(h.read(join(root, rel))), provider, session_id, head, event, created_at});
  h.log(JSON.stringify({task, anchor: rel, provider, session_id, head, attribution}, null, 2));
  return 0;
}

function hookReadme(launcher) {
  return [
    '# Dairn Agent Hooks',
    '',
    '这些脚本把 Agent 会话与本地 Git 操作接到 Dairn 的确定性命令上。',
    '锚点是 local-unattributed 的过程证据：它证明某个会话在某个 HEAD 上结束，',
    '不证明动作合理、测试通过或经过审批，也不等于受保护 CI 的 Ed25519 声明。',
    '',
    '## 安装',
    '',
    '    dairn hooks install --apply',
    '    dairn hooks install --apply --git',
    '    dairn hooks install --apply --git --force',
    '',
    '`--apply` 才写入 `.dairn/hooks/`；重复执行不会覆盖已存在文件。',
    '`--git` 另外写 `.git/hooks/pre-push`；该文件存在时默认报错，需显式 `--force` 覆盖。',
    '脚本内使用的 launcher 默认为 `dairn`；npm 本地安装或 PATH 中没有 `dairn` 时，',
    '用 `dairn hooks install --apply --launcher <POSIX 绝对路径>` 生成可执行的 hook。',
    'Windows 反斜杠路径不能直接写入 POSIX sh hook，请使用 Git Bash/WSL 可见的 POSIX 路径。',
    '当前生成脚本引用：' + launcher,
    '',
    '## Claude Code',
    '',
    '在 `.claude/settings.json` 的 Stop hook 中通过 stdin 传入事件 JSON：',
    '',
    '    {"hooks":{"Stop":[{"matcher":"","hooks":[{"type":"command","command":"sh .dairn/hooks/turn-end.sh"}]}]}}',
    '',
    '## Codex',
    '',
    '在 Codex 配置 `config.toml` 的 `notify` 中把事件 JSON 作为最后一个 argv 传给脚本：',
    '',
    '    notify = ["sh", "<abs>/.dairn/hooks/turn-end-codex.sh"]',
    '',
    '## DeepSeek Harness (DSH)',
    '',
    '在 DSH 插件的 hook 点（例如 `agent/turn-stopping` 或 `turn/end`）调用 dsh 版本。',
    '它要求 `DSH_SESSION_ID`，事件名可用 `DSH_HOOK_EVENT` 覆盖：',
    '',
    '    sh .dairn/hooks/turn-end-dsh.sh',
    '',
    '## pre-push',
    '',
    '用 `dairn hooks install --apply --git` 安装 `.git/hooks/pre-push`；',
    '也可在既有 `.git/hooks/pre-push` 末尾追加：',
    '',
    '    exec sh "$(git rev-parse --show-toplevel)/.dairn/hooks/pre-push"',
    '',
    '或直接调用 `dairn hook pre-push`。',
    '',
    '## 失败策略',
    '',
    '- `dairn hook turn-end` 在找不到唯一活跃任务、Git HEAD 或 provider/session 时默认失败（退出码 2）；',
    '  只有显式 `--allow-unattributed` 才记录为未归属锚点。',
    '- `dairn hook pre-push` 依次执行结构治理、风险门禁与活跃任务证据校验；任一失败即非零退出。',
    '  `--no-check` 只跳过风险门禁执行，结构治理与活跃任务证据仍会检查。',
    ''
  ].join('\n');
}
const hookFiles = launcher => [
  {path: HOOK_DIR + '/pre-push', mode: 0o755, body: '#!/bin/sh\nset -eu\nexec "' + launcher + '" hook pre-push\n'},
  {path: HOOK_DIR + '/turn-end.sh', mode: 0o755, body: '#!/bin/sh\nset -eu\nexec "' + launcher + '" hook turn-end --stdin\n'},
  {path: HOOK_DIR + '/turn-end-codex.sh', mode: 0o755, body: '#!/bin/sh\nset -eu\nexec "' + launcher + '" hook turn-end --payload "${1:-}"\n'},
  {path: HOOK_DIR + '/turn-end-dsh.sh', mode: 0o755,
    body: '#!/bin/sh\nset -eu\nexec "' + launcher + '" hook turn-end --provider dsh --session "${DSH_SESSION_ID:?DSH_SESSION_ID required}" --event "${DSH_HOOK_EVENT:-turn-end}"\n'},
  {path: HOOK_DIR + '/README.md', mode: 0o644, body: hookReadme(launcher)}
];
function preflightPath(h, root, rel) {
  relative(rel);
  const parts = rel.split('/');
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    current = at(current, parts[i]);
    invariant(!h.isSymlink(current), 'Refuse symlinked hook path: ' + rel);
    const last = i === parts.length - 1;
    if (h.exists(current)) {
      if (last) invariant(!h.isDirectory(current), 'Hook path is a directory: ' + rel);
      else invariant(h.isDirectory(current), 'Hook path component is not a directory: ' + rel);
    }
  }
}
export function installHooks(h, root, o) {
  const opts = o || {};
  const apply = !!opts.apply;
  const rawLauncher = typeof opts.launcher === 'string' ? opts.launcher.trim() : '';
  // launcher 会写进 POSIX shell 脚本：脚本已用双引号包裹，仍拒绝引号/换行/命令分隔符与 Windows 反斜杠路径。
  const launcher = rawLauncher || 'dairn';
  invariant(/^[^"'\n\r`$;&|<>\\]+$/.test(launcher), 'Invalid --launcher path (use a POSIX absolute path; no quotes, backslashes, newlines or shell metacharacters): ' + launcher);
  const actions = [];
  const warnings = [];
  const desired = hookFiles(launcher);
  if (opts.git) {
    const dotGit = join(root, '.git');
    invariant(h.exists(dotGit), 'Not a Git repository (missing .git): ' + root);
    if (h.isDirectory(dotGit)) desired.push({path: GIT_PRE_PUSH, mode: 0o755, body: GIT_PRE_PUSH_BODY, git: true});
    else warnings.push('Git worktree detected (.git is a file); install the pre-push hook in the primary worktree or call .dairn/hooks/pre-push manually');
  }
  // 计划阶段完成全部 preflight，apply 阶段才写文件。
  for (const item of desired) {
    preflightPath(h, root, item.path);
    if (!h.exists(join(root, item.path))) {
      actions.push({path: item.path, status: 'create', write: item});
      continue;
    }
    if (h.read(join(root, item.path)) === item.body) {
      actions.push({path: item.path, status: 'unchanged', write: item});
      continue;
    }
    if (item.git) {
      if (opts.force) actions.push({path: item.path, status: 'update', write: item});
      else {
        actions.push({path: item.path, status: 'conflict'});
        warnings.push('Existing .git/hooks/pre-push would not be overwritten; rerun with --force after reviewing it');
      }
      continue;
    }
    actions.push({path: item.path, status: 'exists'});
    warnings.push('Kept existing hook file (not overwritten): ' + item.path);
  }
  if (apply) {
    const conflicts = actions.filter(action => action.status === 'conflict');
    invariant(conflicts.length === 0,
      'Hooks install refused to overwrite: ' + conflicts.map(action => action.path).join(', ') + '; rerun with --force after review');
    h.mkdirs(join(root, HOOK_DIR));
    if (opts.git && h.isDirectory(join(root, '.git'))) h.mkdirs(join(root, '.git/hooks'));
    for (const action of actions) {
      if (!['create', 'update', 'unchanged'].includes(action.status)) continue;
      const absolute = join(root, action.path);
      if (action.status === 'create') h.writeExclusive(absolute, action.write.body);
      else if (action.status === 'update') h.write(absolute, action.write.body);
      // unchanged 也重试 chmod：上次运行时可能不支持 chmod，只留下 warning。
      try { h.chmod(absolute, action.write.mode); }
      catch (e) { warnings.push('chmod failed for ' + action.path + ': ' + (e && e.message ? e.message : String(e))); }
    }
  }
  // applied 只统计真正写盘的动作；plan（未加 --apply）必须报告 0，
  // 否则 CI/Agent 会把“计划了 5 个文件”误读为“已安装 5 个 hook”。
  const applied = apply ? actions.filter(action => action.status === 'create' || action.status === 'update').length : 0;
  return {schema: 1, apply, applied, actions: actions.map(action => ({path: action.path, status: action.status})), warnings};
}
