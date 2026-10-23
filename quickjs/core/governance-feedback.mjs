/* Governance feedback (consolidated plan §15): evidence-backed tuning
 * suggestions only — nothing here is auto-applied, and every recommendation
 * carries its observed data and requires independent approval. With too few
 * samples the honest answer is insufficient-evidence (T31); small samples
 * never claim causal improvement. Recommendations can only narrow HOW a
 * preserved assurance is achieved, never drop the assurance itself. */

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function collectRunHistory(h, root, {windowStart = null} = {}) {
  const runsRoot = root.replace(/\/$/, '') + '/.dairn/governance/evidence/runs';
  if (!h.exists(runsRoot)) return [];
  const runs = [];
  for (const commit of h.list(runsRoot) || []) {
    if (!/^[0-9a-f]{40,64}$/i.test(commit)) continue;
    const dir = runsRoot + '/' + commit;
    if (!h.isDirectory(dir)) continue;
    for (const runId of h.list(dir) || []) {
      const rel = '.dairn/governance/evidence/runs/' + commit + '/' + runId + '/run.json';
      try {
        const run = JSON.parse(h.read(root.replace(/\/$/, '') + '/' + rel));
        if (run.schema !== 'dairn.check-run.v1') continue;
        if (windowStart && run.created_at && run.created_at < windowStart) continue;
        runs.push({run_id: run.run_id, subject_commit: commit, created_at: run.created_at || null,
          status: run.status, checks: (run.checks || []).map(c => ({id: c.id, module: c.module || null,
            status: c.status, duration_sec: typeof c.duration_sec === 'number' ? c.duration_sec : null}))});
      } catch (_) { /* unreadable history is skipped, not fabricated */ }
    }
  }
  return runs;
}

export function recommendAdaptations({runs, windowStart = null, windowEnd = null,
  minSamples = 10, slowMs = 120000} = {}) {
  const observed = {window: {start: windowStart, end: windowEnd}, runs: runs.length};
  if (runs.length < minSamples)
    return {schema: 'dairn.governance-feedback.v1', status: 'insufficient-evidence', observed,
      recommendations: [], note: 'not enough run history to support any tuning claim (have ' + runs.length + ', need ' + minSamples + ')'};

  /* Per (module, check) statistics. */
  const stats = new Map();
  for (const run of runs) for (const check of run.checks) {
    const key = (check.module ? check.module + ':' : '') + check.id;
    if (!stats.has(key)) stats.set(key, {key, id: check.id, module: check.module, runs: 0, failed: 0,
      durations: [], perCommitRuns: new Map()});
    const item = stats.get(key);
    item.runs += 1;
    if (check.status !== 'passed') item.failed += 1;
    if (typeof check.duration_sec === 'number') item.durations.push(check.duration_sec * 1000);
    if (run.subject_commit) {
      const count = item.perCommitRuns.get(run.subject_commit) || 0;
      item.perCommitRuns.set(run.subject_commit, count + 1);
    }
  }
  const recommendations = [];
  for (const item of stats.values()) {
    const medianMs = median(item.durations);
    /* CI_SLOW: point at the bottleneck first; never delete a required check. */
    if (medianMs !== null && medianMs > slowMs && item.runs >= minSamples)
      recommendations.push({proposal: 'analyze-slow-check', kind: 'CI_SLOW',
        observed: {check: item.key, runs: item.runs, median_duration_ms: Math.round(medianMs)},
        hypothesis: 'check ' + item.key + ' consistently exceeds ' + slowMs + 'ms median',
        proposed_action: 'profile the check; prefer caching and incremental selection before anything else',
        expected_benefit: 'lower CI wait time',
        requirements_preserved: [item.key],
        requires_approval: true});
    /* Repeated identical runs per commit: share verified artifacts, keep status. */
    const repeated = [...item.perCommitRuns.values()].filter(n => n > 2).length;
    if (repeated >= 3)
      recommendations.push({proposal: 'deduplicate-identical-runs', kind: 'REPEATED_RUNS',
        observed: {check: item.key, commits_with_3plus_runs: repeated},
        hypothesis: 'the same check re-runs identically for the same commit multiple times',
        proposed_action: 'share a verified job artifact while retaining the original required status',
        expected_benefit: 'lower CI compute and wait time',
        requirements_preserved: [item.key],
        requires_approval: true});
    /* POLICY_NOISE: failures that a re-run cleared — narrow scope, don't drop. */
    const flakyRate = item.failed / item.runs;
    if (item.failed >= 3 && flakyRate >= 0.2 && item.runs >= minSamples)
      recommendations.push({proposal: 'narrow-flaky-check-scope', kind: 'POLICY_NOISE',
        observed: {check: item.key, runs: item.runs, failures: item.failed, failure_rate: Math.round(flakyRate * 100) / 100},
        hypothesis: 'check ' + item.key + ' fails intermittently and passes on re-runs',
        proposed_action: 'stabilize or precisely narrow the check scope; dropping it requires protected approval',
        expected_benefit: 'fewer false-positive blockages',
        requirements_preserved: [item.key],
        requires_approval: true});
  }
  recommendations.sort((a, b) => a.proposal.localeCompare(b.proposal));
  return {schema: 'dairn.governance-feedback.v1', status: recommendations.length ? 'recommendations' : 'no-action',
    observed, recommendations,
    note: 'suggestions only: none of these is applied automatically, and all require independent approval'};
}
