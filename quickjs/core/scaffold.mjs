/* 项目脚手架文本与启动器脚本的装配层。
 *
 * 文本事实源不再是 core 代码里的内联字面量，而是 quickjs/assets/templates/project/：
 *   - 它们随治理运行时嵌入（/zip/quickjs/assets/templates/project/...），
 *     由 init/adopt/upgrade 渲染进目标项目（AGENTS.md 导航块、README、PROJECT_GUIDE、
 *     GOVERNANCE_SPEC、CLAUDE.md、.gitattributes、CI 模板、根启动器）；
 *   - 仓库根 `dairn` / `dairn.cmd` 由 tools/render-launchers.mjs 用同一份模板生成，
 *     分发 ZIP / npm / Wheel 携带的启动器与仓库根文件字节一致；
 *   - 模板随运行时资产一起嵌入并打包；它们不是 Spec/Skill，`dairn docs check` 不校验其
 *     内容，字节稳定性由 tools/tests/test_project_scaffold.py 的黄金哈希回归覆盖。
 *
 * 本模块只做读取、换行归一、占位符替换与启动器 CRLF 装配，不持有业务文案。
 * 占位符形如 {{DAIRN_PROJECT_NAME}}：未知占位符或未使用变量都会 fail closed。
 */
const TEMPLATES = '/zip/quickjs/assets/templates/project/';
const PLACEHOLDER = /\{\{([A-Z0-9_]+)\}\}/g;
const cache = new Map();

/* 返回绑定到当前宿主读取能力的模板读取器；模板在解释器进程内只读一次。 */
export function templateReader(h) {
  return function readTemplate(rel) {
    const cached = cache.get(rel);
    if (cached !== undefined) return cached;
    const path = TEMPLATES + rel;
    let text;
    try { text = String(h.read(path)); } catch (e) {
      throw Error('Cannot read scaffold template: ' + path + ' (' + (e && e.message || e) + ')');
    }
    text = text.replace(/\r\n/g, '\n');
    if (!text) throw Error('Empty scaffold template: ' + path);
    cache.set(rel, text);
    return text;
  };
}

/* 仅供测试或长驻宿主在重建运行时后重新加载。 */
export function resetTemplateCache() { cache.clear(); }

/* 用 vars 替换模板占位符；缺变量或多传变量都视为装配错误。 */
export function fillTemplate(readTemplate, rel, vars) {
  const used = new Set();
  const rendered = readTemplate(rel).replace(PLACEHOLDER, (match, key) => {
    if (!Object.prototype.hasOwnProperty.call(vars, key)) {
      throw Error('Unknown scaffold placeholder ' + key + ' in ' + rel);
    }
    used.add(key);
    return String(vars[key]);
  });
  for (const key of Object.keys(vars)) {
    if (!used.has(key)) throw Error('Unused scaffold placeholder ' + key + ' in ' + rel);
  }
  return rendered;
}

/* AGENTS.md 受管导航块（不含外层标题与空行），保证既有项目只更新块内文本。 */
export function navigation(readTemplate) {
  const text = readTemplate('agents-navigation.md');
  return text.endsWith('\n') ? text.slice(0, -1) : text;
}

export function ciTemplate(readTemplate, provider) {
  return readTemplate(provider === 'github' ? 'ci-github.yml' : 'ci-gitlab.yml');
}

export function projectReadme(readTemplate, config) {
  const profile = config.modules.map(m => '- `' + m.path + '` — ' + m.profiles.join(', ')).join('\n');
  return fillTemplate(readTemplate, 'project-readme.md', {
    DAIRN_PROJECT_NAME: config.name,
    DAIRN_MODULE_LIST: profile,
  });
}

export function projectGuide(readTemplate, config) {
  const lines = config.modules.map(m => {
    const checks = Object.entries(m.checks || {}).map(([kind, x]) =>
      '  - ' + kind + ': `' + x.argv.join(' ') + '` (cwd: `' + x.cwd + '`)').join('\n');
    return '- **' + m.name + '** (`' + m.path + '`; ' + m.profiles.join(', ') + ')\n' + checks;
  }).join('\n');
  return fillTemplate(readTemplate, 'project-guide.md', {
    DAIRN_PROJECT_NAME: config.name,
    DAIRN_MODULE_COMMANDS: lines,
  });
}

export function governanceSpec(readTemplate) { return readTemplate('governance-spec.md'); }
export function claudeMd(readTemplate) { return readTemplate('claude.md'); }
export function rootGitattributes(readTemplate) { return readTemplate('gitattributes-root.txt'); }
export function dairnGitattributes(readTemplate) { return readTemplate('gitattributes-dairn.txt'); }

/* 启动器模板以 LF 存储：POSIX 版原样输出；Windows 版装配为 CRLF，
 * 与 .dairn/.gitattributes 的 eol 声明和 lock 受管哈希一致。 */
export function launcherScripts(readTemplate) {
  const posixSource = readTemplate('launcher/dairn.sh');
  const windowsSource = readTemplate('launcher/dairn.cmd');
  const posix = posixSource.endsWith('\n') ? posixSource : posixSource + '\n';
  const windows = (windowsSource.endsWith('\n') ? windowsSource : windowsSource + '\n').replace(/\n/g, '\r\n');
  return {posix, windows};
}
