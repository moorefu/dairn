/* Capability Assessment (consolidated plan §12): discover what verification
 * the project actually has — never a second hand-maintained fact store.
 * Statuses are independent evidence classes, not a linear ladder (§12.2):
 *   declared   — an argv exists in project.json
 *   detected   — the command actually resolves on this host
 *   executable — (not probed here; a real run is the only proof)
 *   ci-verified — NEVER self-reported: only the signed CI chain can say this,
 *                 and no local output of this module may claim it.
 * Results are cacheable/rewuildable facts (.dairn/cache/), not authority. */
import {resolvePolicy, requiredChecksFor} from './policy-resolver.mjs';

function ok(value, message) { if (!value) throw Error('Capabilities: ' + message); }
function join(root, path) { return root.replace(/\/$/, '') + '/' + path; }

/* Probe whether argv[0] resolves to a runnable command. A timeout means the
 * process started (interactive REPL etc.) — resolvable, not missing. The
 * 127/9009 exit codes are the POSIX/cmd.exe "not found" conventions. */
function probeTool(h, root, argv0) {
  if (argv0 === 'dairn') return 'detected'; /* built-in stack-check launcher */
  let result;
  try { result = h.run([argv0], root, 5); }
  catch (_) { return 'missing-tool'; } /* process never started: not resolvable */
  if (result.timedOut) return 'detected';
  const text = String(result.output || '');
  if (result.code === 127 || result.code === 9009 || /command not found|not recognized|无法找到/i.test(text))
    return 'missing-tool';
  return 'detected';
}

export function assessCapabilities(h, root, policyJson, {risk = 'L1', timeout = 30} = {}) {
  ok(policyJson && typeof policyJson === 'object', 'policy required');
  const policy = resolvePolicy(policyJson);
  ok(policy, 'policy missing or invalid');
  let required = [];
  try { required = requiredChecksFor(policy, risk); } catch (_) { required = []; }
  const modules = [];
  for (const module of policy.modules || []) {
    const checks = [];
    const declared = new Set(Object.keys(module.checks || {}));
    const union = [...new Set([...required, ...declared])].sort();
    for (const id of union) {
      const cfg = (module.checks || {})[id];
      if (!cfg || !Array.isArray(cfg.argv) || !cfg.argv.length) {
        checks.push({check_id: id, status: 'unconfigured', tool: null, required: required.includes(id)});
        continue;
      }
      const tool = probeTool(h, join(root, module.path || '.'), cfg.argv[0]);
      checks.push({check_id: id, status: tool === 'detected' ? 'detected' : tool,
        tool: cfg.argv[0], argv: cfg.argv, required: required.includes(id)});
    }
    modules.push({name: module.name, path: module.path, checks});
  }
  const all = modules.flatMap(m => m.checks);
  const summary = {declared: all.filter(c => c.status !== 'unconfigured').length,
    detected: all.filter(c => c.status === 'detected').length,
    missing_tools: all.filter(c => c.status === 'missing-tool').length,
    unconfigured: all.filter(c => c.status === 'unconfigured').length};
  /* Required-but-missing is what CI must block on; capability gaps never
   * downgrade to "skip" (T08). */
  const gaps = all.filter(c => c.required && c.status !== 'detected')
    .map(c => ({kind: 'MISSING_CAPABILITY', module: modules.find(m => m.checks.includes(c)).name,
      check_id: c.check_id, reason: c.status === 'unconfigured' ? 'no argv configured' : 'tool not resolvable: ' + c.tool}));
  return {schema: 'dairn.capability-assessment.v1', risk, modules, summary, gaps,
    notes: ['executable/ci-verified are not probed locally: only real runs and the signed CI chain establish them'],
    discovery_timestamp: null /* filled by the caller with h.now() */};
}

/* Discovery for adoption (§12.3): what exists in an existing repository —
 * language stacks, CI pipelines, test manifests — reported as suggestions.
 * Read-only; any write requires --apply. */
export function discoverRepository(h, root) {
  const findings = {stacks: [], ci: [], test_manifests: []};
  const exists = p => h.exists(join(root, p)) && !h.isDirectory(join(root, p));
  const stackMarkers = [['go.mod', 'go'], ['Cargo.toml', 'rust'], ['pyproject.toml', 'python'],
    ['package.json', 'vue-or-node'], ['pom.xml', 'java'], ['build.gradle', 'java'],
    ['build.gradle.kts', 'java'], ['nginx.conf', 'openresty']];
  for (const [marker, stack] of stackMarkers) if (exists(marker)) findings.stacks.push({marker, stack});
  const ciMarkers = [['.github/workflows', 'github-actions'], ['.gitlab-ci.yml', 'gitlab-ci'],
    ['.circleci/config.yml', 'circleci'], ['Jenkinsfile', 'jenkins']];
  for (const [marker, name] of ciMarkers) if (h.exists(join(root, marker))) findings.ci.push({marker, name});
  const testMarkers = ['Makefile', 'go.sum', 'pytest.ini', 'tox.ini', 'jest.config.js', 'vitest.config.ts'];
  for (const marker of testMarkers) if (exists(marker)) findings.test_manifests.push(marker);
  findings.stacks.sort((a, b) => a.stack.localeCompare(b.stack));
  findings.ci.sort((a, b) => a.name.localeCompare(b.name));
  return findings;
}
