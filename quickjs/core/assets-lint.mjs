/* 分发资产 lint：`dairn docs check` 使用的确定性发布门禁。
 *
 * 输入是 manifest.assets（[{type,path}]）与 read(type, relPath)，本模块不直接
 * 访问文件系统，便于单元测试和发布构建复用。检查三类问题：
 *   1. specs frontmatter / 稳定 ID / module / related / 相对链接；
 *   2. skills 与 agents/openai.yaml 的成对关系、frontmatter 与调用权限一致性；
 *   3. 正文与 symbols 中引用的 CLI 命令是否仍在真实命令面内，以及旧
 *      Makefile / Python 脚本命令的遗留引用。
 * 校验是结构性的：它证明命令可被解析、引用目标存在，不证明规范语义正确。
 */
const ID_RE = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const SPEC_REQUIRED = ['id', 'title', 'summary', 'kind', 'module', 'keywords', 'aliases', 'related'];
const SPEC_LISTS = ['keywords', 'aliases', 'related', 'symbols'];
const SPEC_KINDS = ['spec', 'reference'];
const SKILL_STAGES = ['stable', 'experimental', 'deprecated'];
const LEGACY_PY = new Set(['governance.py', 'docs.py', 'ci_base.py', 'ci_postcheck.py', 'lifecycle.py']);
const REPO_SEGMENTS = /^(?:docs|\.dairn|\.agents|\.github|quickjs|tools|tests|runtime|src|examples|licenses|bin|dist|build)\//;
const REPO_FILES = /^(?:AGENTS|README|CLAUDE|BUILDING|CHANGELOG|CONTRIBUTING|LICENSE|GOVERNANCE|pyproject|package|Makefile)\b/;
const TOP_COMMANDS = ['version', '--version', 'init', 'adopt', 'detect', 'upgrade', 'doctor', 'validate',
  'validate-core', 'scope', 'check', 'help', 'docs', 'skills', 'guide', 'workflow', 'work', 'analyzers', 'analyze', 'context', 'quality', 'capability', 'tasks', 'hooks', 'hook', 'notes',
  'evidence', 'gate', 'attest', 'approval', 'handoff', 'governance', 'refactor'];
const SUBCOMMANDS = {
  docs: ['find', 'show', 'context', 'check'],
  skills: ['catalog', 'list', 'add'],
  guide: ['plan', 'audit', 'scaffold', 'facts', 'drift', 'impact'],
  workflow: ['stages', 'recommend'],
  work: ['start', 'list', 'status', 'next', 'record', 'advance', 'skip', 'verify', 'finish', 'cancel', 'reopen',
    'link-check'],
  analyzers: ['list', 'templates', 'doctor', 'init'],
  analyze: ['run', 'plan', 'import'],
  quality: ['fitness'],
  capability: ['plan'],
  tasks: ['check', 'ready'],
  hooks: ['install'],
  notes: ['seal'],
  hook: ['pre-push', 'turn-end'],
  evidence: ['verify', 'inspect', 'bundle'],
  gate: ['evaluate'],
  attest: ['prepare', 'verify'],
  approval: ['evaluate'],
  governance: ['plan', 'explain', 'assess', 'recommend'],
  refactor: ['plan', 'compare', 'verify', 'status'],
};

/* 权威 CLI 命令面；测试与迁移工具可据此断言引用合法。每次返回独立副本。 */
export function commandSurface() {
  return {
    top: [...TOP_COMMANDS],
    subcommands: Object.fromEntries(Object.entries(SUBCOMMANDS).map(([name, subs]) => [name, [...subs]])),
  };
}

const posix = p => String(p).replace(/\\/g, '/');
const isString = x => typeof x === 'string';
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const compareAssetErrors = (a, b) => cmp(a.asset, b.asset) || cmp(a.message, b.message);

function parseDocument(text) {
  const lines = String(text).split(/\r?\n/);
  if ((lines[0] || '').trim() !== '---') return { error: 'missing YAML frontmatter (file must start with ---)' };
  let end = -1;
  for (let i = 1; i < lines.length; i++) if (lines[i].trim() === '---') { end = i; break; }
  if (end < 0) return { error: 'unterminated YAML frontmatter' };
  const data = {}, metaErrors = [];
  for (let i = 1; i < end; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const m = /^([A-Za-z][A-Za-z0-9-]*):[ \t]*(.*)$/.exec(line);
    if (!m) { metaErrors.push('invalid metadata line: ' + line); continue; }
    if (hasOwn(data, m[1])) { metaErrors.push('duplicate metadata key: ' + m[1]); continue; }
    data[m[1]] = m[2];
  }
  return { data, body: lines.slice(end + 1).join('\n'), metaErrors };
}

function scalarValue(data, key) {
  return hasOwn(data, key) && isString(data[key]) ? data[key].trim().replace(/^['"]|['"]$/g, '') : '';
}

function parseStringList(data, key, errors, asset) {
  if (!hasOwn(data, key)) return null;
  try {
    const value = JSON.parse(data[key]);
    if (!Array.isArray(value) || value.some(x => !isString(x) || !x.trim())) throw Error('invalid');
    return value;
  } catch (_) {
    errors.push({ asset, message: key + ' must be a JSON array of non-empty strings' });
    return null;
  }
}

function resolveSpecPath(baseDir, target) {
  const parts = baseDir ? baseDir.split('/').filter(Boolean) : [];
  for (const segment of posix(target).split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') { if (!parts.length) return null; parts.pop(); continue; }
    parts.push(segment);
  }
  return parts.join('/');
}

function repoRelativeTarget(target) {
  const stripped = posix(target).replace(/^(?:\.\.?\/)+/, '');
  return REPO_SEGMENTS.test(stripped) || REPO_FILES.test(stripped);
}

/* 把正文拆成「代码行」：fenced code block 的整体行 + 行内 code span 的内容。 */
function candidateCodeLines(body) {
  const candidates = [];
  const fence = { mark: null, lines: [] };
  const prose = [];
  for (const line of String(body).split(/\r?\n/)) {
    if (fence.mark === null) {
      const open = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (open) { fence.mark = open[1][0]; fence.lines = []; continue; }
      prose.push(line);
    } else {
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
      if (close && close[1][0] === fence.mark) {
        candidates.push(joinContinuations(fence.lines));
        fence.mark = null; fence.lines = [];
        continue;
      }
      fence.lines.push(line);
    }
  }
  if (fence.mark !== null) candidates.push(joinContinuations(fence.lines));
  for (const line of prose) {
    const re = /`+([^`\n]+)`+/g;
    let match;
    while ((match = re.exec(line)) !== null) candidates.push([match[1]]);
  }
  return candidates;
}

function joinContinuations(lines) {
  const out = [];
  let pending = '';
  for (const raw of lines) {
    let line = pending + raw;
    pending = '';
    const trimmed = line.trimEnd();
    if (trimmed.endsWith('\\')) { pending = trimmed.slice(0, -1) + ' '; continue; }
    out.push(line);
  }
  if (pending) out.push(pending);
  return out;
}

const cleanToken = token => token.replace(/^[("'`$]+/, '').replace(/[)"'`,;:.]+$/, '');
const isPlaceholder = token => {
  if (!token) return true;
  if (/^[<\[{$]/.test(token)) return true;
  if (token.includes('<') || token.includes('{') || token.includes('$')) return true;
  if (/^[A-Z][A-Z0-9_-]*$/.test(token)) return true;
  if (/^dairn-[a-z0-9-]+$/.test(token)) return true;
  return false;
};

function legacyReference(token) {
  const value = cleanToken(token);
  if (!value) return null;
  // 只把明确的旧体系脚本路径当错误：项目自有分析器（如 tools/dairn/analyzers/python/main.py）
  // 仍是合法资产，不能因为以 .py 结尾就判 legacy。
  const base = value.split('/').pop();
  if (LEGACY_PY.has(base) || value.startsWith('scripts/') || value.includes('/scripts/')) {
    return 'legacy script reference: ' + value + ' (the dairn CLI is the only supported entrypoint)';
  }
  return null;
}

/* 跳过 dairn 全局选项及其取值，返回下一个位置参数下标。 */
function skipOptions(tokens, index) {
  while (index < tokens.length && tokens[index].startsWith('-')) {
    index += tokens[index + 1] && !tokens[index + 1].startsWith('-') ? 2 : 1;
  }
  return index;
}

function validateDairnCommand(tokens, pushError) {
  let index = skipOptions(tokens, 1);
  if (index >= tokens.length) return;
  const raw = tokens[index];
  if (isPlaceholder(raw)) return;
  const parts = raw.split('/').filter(Boolean);
  const unknown = parts.filter(part => !isPlaceholder(part) && !TOP_COMMANDS.includes(part));
  if (unknown.length) { pushError('unknown dairn command: dairn ' + unknown.join(' ')); return; }
  if (parts.length !== 1 || !hasOwn(SUBCOMMANDS, parts[0])) return;
  let next = skipOptions(tokens, index + 1);
  if (next >= tokens.length) return;
  const subRaw = tokens[next];
  if (isPlaceholder(subRaw)) return;
  const unknownSubs = subRaw.split('/').filter(part => part && !isPlaceholder(part) && !SUBCOMMANDS[parts[0]].includes(part));
  if (unknownSubs.length) pushError('unknown dairn ' + parts[0] + ' subcommand: ' + unknownSubs.join(' '));
}

function scanSegment(segment, asset, seen, report) {
  const tokens = segment.split(/\s+/).map(cleanToken).filter(Boolean);
  if (!tokens.length) return;
  const commandStart = tokens.indexOf('dairn');
  const makeIndex = tokens.indexOf('make');
  if (makeIndex >= 0 && (commandStart < 0 || makeIndex < commandStart)) {
    const key = 'legacy-make:' + segment;
    if (!seen.has(key)) {
      seen.add(key);
      report.stats.references++;
      report.errors.push({ asset, message: 'legacy Make command reference: ' + segment });
    }
  }
  for (const token of tokens) {
    const legacy = legacyReference(token);
    if (!legacy) continue;
    const key = 'legacy:' + token;
    if (seen.has(key)) continue;
    seen.add(key);
    report.stats.references++;
    report.errors.push({ asset, message: legacy });
  }
  if (commandStart < 0) return;
  const key = 'dairn:' + tokens.slice(commandStart).join(' ');
  if (seen.has(key)) return;
  seen.add(key);
  report.stats.references++;
  validateDairnCommand(tokens.slice(commandStart), message => report.errors.push({ asset, message }));
}

function scanCommands(body, asset, seen, report) {
  for (const codeLines of candidateCodeLines(body)) {
    for (const rawLine of codeLines) {
      let line = String(rawLine);
      for (;;) {
        const prompt = /^\s*(?:\$|>|PS>)\s+/.exec(line);
        if (!prompt) break;
        line = line.slice(prompt[0].length);
      }
      const lineText = line.trim();
      if (!lineText || lineText.startsWith('#')) continue;
      for (const rawSegment of lineText.split(/&&|\|\||[;|]/)) {
        let segment = rawSegment.trim();
        for (;;) {
          const prompt = /^\$+\s+/.exec(segment);
          if (!prompt) break;
          segment = segment.slice(prompt[0].length).trim();
        }
        if (!segment || segment.startsWith('#')) continue;
        scanSegment(segment, asset, seen, report);
      }
    }
  }
}

function scanSymbols(symbols, asset, seen, report) {
  for (const symbol of symbols || []) {
    if (!isString(symbol) || !symbol.trim()) continue;
    const value = symbol.trim();
    if (/^dairn(?:\s|$)/.test(value) || /^make(?:\s|$)/.test(value) ||
      value.startsWith('scripts/') || /\.py\b/.test(value)) {
      const key = 'symbol:' + value;
      if (seen.has(key)) continue;
      seen.add(key);
      scanSegment(value, asset, seen, report);
    }
  }
}

function checkSpecLinks(entry, specPathSet, errors, warnings) {
  const asset = 'specs/' + entry.path;
  const baseDir = entry.path.includes('/') ? entry.path.split('/').slice(0, -1).join('/') : '';
  for (const match of String(entry.body).matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0].split('?')[0].trim();
    if (!target || target.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    if (!/\.md$/i.test(target)) continue;
    if (repoRelativeTarget(target)) continue;
    const resolved = resolveSpecPath(baseDir, target);
    if (resolved === null) continue; // escapes specs/ -> treat as repository path, outside this gate
    if (!specPathSet.has(resolved)) errors.push({ asset, message: 'broken specs link: ' + target + ' (resolved ' + resolved + ')' });
  }
}

function lintSpecs(specEntries, report) {
  const parsed = [];
  const warnings = report.warnings;
  for (const entry of specEntries) {
    const asset = 'specs/' + entry.path;
    let text;
    try { text = report.read('specs', entry.path); } catch (e) {
      report.errors.push({ asset, message: 'cannot read asset: ' + (e && e.message || e) });
      continue;
    }
    const doc = parseDocument(text);
    if (doc.error) { report.errors.push({ asset, message: doc.error }); continue; }
    for (const message of doc.metaErrors) report.errors.push({ asset, message });
    const data = doc.data, errors = [];
    for (const key of SPEC_REQUIRED) if (!hasOwn(data, key)) errors.push('missing frontmatter field: ' + key);
    for (const key of ['id', 'title', 'summary', 'kind', 'module']) {
      if (!hasOwn(data, key)) continue;
      const value = scalarValue(data, key);
      if (!value || /^["'\[{]/.test(value)) errors.push('invalid scalar frontmatter field: ' + key);
    }
    const id = scalarValue(data, 'id');
    if (id && !ID_RE.test(id)) errors.push('invalid stable ID: ' + id);
    const kind = scalarValue(data, 'kind');
    if (kind && !SPEC_KINDS.includes(kind)) errors.push('invalid kind: ' + kind + ' (expected spec|reference)');
    const moduleName = scalarValue(data, 'module');
    const specDir = entry.path.includes('/') ? entry.path.split('/')[0] : '';
    if (!specDir) errors.push('spec path must be <module>/<name>.md');
    else if (kind === 'spec' && moduleName && moduleName !== specDir) errors.push('module "' + moduleName + '" does not match specs directory "' + specDir + '"');
    const lists = {};
    for (const key of SPEC_LISTS) {
      const list = parseStringList(data, key, errors, asset);
      if (list !== null) lists[key] = list;
    }
    const knownKeys = new Set(SPEC_REQUIRED.concat('symbols'));
    for (const key of Object.keys(data)) if (!knownKeys.has(key)) warnings.push({ asset, message: 'unknown frontmatter key: ' + key });
    if (!String(doc.body).startsWith('\n# ')) errors.push('body must begin with a blank line and an # H1 heading');
    for (const message of errors) report.errors.push({ asset, message });
    parsed.push({ entry, body: doc.body, lists, id, asset });
  }
  const ids = new Map();
  for (const spec of parsed) {
    if (!spec.id) continue;
    if (ids.has(spec.id)) report.errors.push({ asset: spec.asset, message: 'duplicate stable ID: ' + spec.id + ' (also in ' + ids.get(spec.id) + ')' });
    else ids.set(spec.id, spec.entry.path);
  }
  const specPathSet = new Set(specEntries.map(entry => entry.path));
  for (const spec of parsed) {
    const related = spec.lists.related || [];
    if (spec.id) {
      for (const ref of related) {
        if (ref === spec.id) report.errors.push({ asset: spec.asset, message: 'related ID refers to itself: ' + ref });
        else if (!ids.has(ref)) report.errors.push({ asset: spec.asset, message: 'related ID does not exist: ' + ref });
      }
    }
    checkSpecLinks({ path: spec.entry.path, body: spec.body }, specPathSet, report.errors, report.warnings);
    const seen = new Set();
    scanCommands(spec.body, spec.asset, seen, report);
    scanSymbols(spec.lists.symbols || [], spec.asset, seen, report);
  }
  report.stats.specs = specEntries.length;
}

function skillNameOf(path) {
  const segments = path.split('/');
  return segments.length > 1 ? segments[0] : '';
}

function lintSkills(skillFiles, report) {
  const names = [...skillFiles.keys()].sort();
  const hasSkill = new Set(names.filter(name => skillFiles.get(name).skill));
  for (const name of names) {
    const rec = skillFiles.get(name);
    const dirAsset = 'skills/' + name;
    if (!rec.skill) report.errors.push({ asset: dirAsset, message: 'missing ' + name + '/SKILL.md' });
    if (!rec.sidecar) report.errors.push({ asset: dirAsset, message: 'missing ' + name + '/agents/openai.yaml (Skill sidecar pair required)' });
    if (!rec.skill) continue;
    const asset = 'skills/' + name + '/SKILL.md';
    let text;
    try { text = report.read('skills', name + '/SKILL.md'); } catch (e) {
      report.errors.push({ asset, message: 'cannot read asset: ' + (e && e.message || e) });
      continue;
    }
    const doc = parseDocument(text);
    if (doc.error) { report.errors.push({ asset, message: doc.error }); continue; }
    for (const message of doc.metaErrors) report.errors.push({ asset, message });
    const data = doc.data;
    if (scalarValue(data, 'name') !== name || name.length > 64) report.errors.push({ asset, message: 'name must equal the skill directory name and be <= 64 characters' });
    const description = scalarValue(data, 'description');
    if (!description || description.length > 1024) report.errors.push({ asset, message: 'missing/invalid description (<= 1024 characters)' });
    const stage = scalarValue(data, 'dairn-stage');
    if (!SKILL_STAGES.includes(stage)) report.errors.push({ asset, message: 'invalid dairn-stage (expected stable|experimental|deprecated)' });
    const replacement = scalarValue(data, 'dairn-replaced-by');
    if (stage === 'deprecated') {
      if (!replacement) report.errors.push({ asset, message: 'deprecated Skill requires dairn-replaced-by' });
      else if (!hasSkill.has(replacement) || replacement === name) report.errors.push({ asset, message: 'invalid dairn-replaced-by target: ' + replacement });
    }
    const manual = scalarValue(data, 'disable-model-invocation') === 'true';
    const manualRaw = scalarValue(data, 'disable-model-invocation');
    if (manualRaw && !['true', 'false'].includes(manualRaw)) report.errors.push({ asset, message: 'invalid disable-model-invocation (true|false)' });
    if (rec.sidecar) {
      let sidecar = '';
      try { sidecar = report.read('skills', name + '/agents/openai.yaml'); } catch (e) {
        report.errors.push({ asset: 'skills/' + name + '/agents/openai.yaml', message: 'cannot read asset: ' + (e && e.message || e) });
      }
      if (sidecar) {
        const policy = [...sidecar.matchAll(/^\s+allow_implicit_invocation:\s*(\S+)/gm)].map(m => m[1]);
        if (policy.length > 1 || (manual && JSON.stringify(policy) !== '["false"]') ||
          (!manual && policy.length && JSON.stringify(policy) !== '["true"]')) {
          report.errors.push({ asset: 'skills/' + name + '/agents/openai.yaml', message: 'inconsistent invocation policy' });
        }
        if (!sidecar.includes('interface:') || !sidecar.includes('display_name:')) {
          report.errors.push({ asset: 'skills/' + name + '/agents/openai.yaml', message: 'sidecar missing interface label (interface:/display_name:)' });
        }
      }
    }
    const seen = new Set();
    scanCommands(doc.body, asset, seen, report);
  }
  report.stats.skills = names.length;
}

/* 对 manifest 的分发资产运行全部 lint，返回稳定的 schema:1 报告。 */
export function lintAssets(assets, read) {
  if (typeof read !== 'function') throw Error('lintAssets requires read(type, relPath)');
  const report = {
    read,
    stats: { specs: 0, skills: 0, references: 0, errors: 0, warnings: 0 },
    errors: [],
    warnings: [],
  };
  const specEntries = [], skillFiles = new Map();
  const list = Array.isArray(assets) ? assets : [];
  for (const asset of list) {
    if (!asset || typeof asset !== 'object' || !isString(asset.type) || !isString(asset.path)) {
      report.errors.push({ asset: 'assets', message: 'invalid manifest asset entry' });
      continue;
    }
    const path = posix(asset.path);
    if (asset.type === 'specs') { specEntries.push({ path }); continue; }
    if (asset.type === 'skills') {
      const name = skillNameOf(path);
      if (!name) { report.errors.push({ asset: 'skills/' + path, message: 'invalid Skill asset path' }); continue; }
      const rec = skillFiles.get(name) || { skill: false, sidecar: false };
      if (path === name + '/SKILL.md') rec.skill = true;
      if (path === name + '/agents/openai.yaml') rec.sidecar = true;
      skillFiles.set(name, rec);
    }
  }
  specEntries.sort((a, b) => cmp(a.path, b.path));
  lintSpecs(specEntries, report);
  lintSkills(skillFiles, report);
  report.errors.sort(compareAssetErrors);
  report.warnings.sort(compareAssetErrors);
  report.stats.errors = report.errors.length;
  report.stats.warnings = report.warnings.length;
  return { schema: 1, stats: report.stats, errors: report.errors, warnings: report.warnings };
}
