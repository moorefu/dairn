/* Agent Notes 归档封存：`dairn notes seal [--apply]`。
 *
 * 扫描 `.agents/notes/archived/` 下已封存的 `.md` / `.i18n.yaml`，生成
 * sha256 清单（键是相对 archived/ 的 posix 路径）。默认只返回计划；`apply`
 * 时用临时文件 + rename 原子替换 `archived/sha256.json`。目录不存在时失败，
 * 绝不隐式创建目录；符号链接与越界路径一律拒绝。
 */
import {sha256} from './sha256.mjs';
const join = (a, b) => a.replace(/\/$/, '') + '/' + b;
const ARCHIVE_DIR = '.agents/notes/archived';
const MANIFEST = 'sha256.json';
const sealable = name => name.endsWith('.md') || name.endsWith('.i18n.yaml');

export function sealArchive(h, root, { apply = false } = {}) {
  const base = join(root, ARCHIVE_DIR);
  if (!h.exists(base)) throw Error('Archived Notes directory does not exist: ' + ARCHIVE_DIR);
  if (h.isSymlink(base)) throw Error('Refuse symlinked archived Notes directory: ' + ARCHIVE_DIR);
  if (!h.isDirectory(base)) throw Error('Archived Notes path is not a directory: ' + ARCHIVE_DIR);
  const baseReal = h.realpath(base);
  const files = [], digests = {};
  function walk(dir, relDir) {
    for (const name of h.list(dir).sort()) {
      const full = join(dir, name), relPath = relDir ? relDir + '/' + name : name;
      if (!relDir && name === MANIFEST) continue;
      if (h.isSymlink(full)) throw Error('Refuse symlink in archived Notes: ' + relPath);
      const real = h.realpath(full);
      if (real !== baseReal && !real.startsWith(baseReal + '/')) {
        throw Error('Archived Notes path escapes the archive directory: ' + relPath);
      }
      if (h.isDirectory(full)) { walk(full, relPath); continue; }
      if (!sealable(name)) continue;
      files.push(relPath);
      digests[relPath] = sha256(h.read(full));
    }
  }
  walk(base, '');
  files.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  const manifest = {};
  for (const file of files) manifest[file] = digests[file];
  const report = { schema: 1, apply: !!apply, path: ARCHIVE_DIR + '/' + MANIFEST, files, sha256: manifest };
  if (!apply) return report;
  const target = join(root, report.path);
  h.mkdirs(target.slice(0, target.lastIndexOf('/')));
  const tmp = target + '.dairn-tmp-' + Date.now();
  try {
    h.write(tmp, JSON.stringify(manifest, null, 2) + '\n');
    h.rename(tmp, target);
  } finally {
    if (h.exists(tmp)) h.remove(tmp);
  }
  return report;
}
