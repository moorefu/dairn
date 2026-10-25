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
  runs.coverage={readable:0,unreadable:0,partial:0};
  for (const commit of h.list(runsRoot) || []) {
    if (!/^[0-9a-f]{40,64}$/i.test(commit)) continue;
    const dir = runsRoot + '/' + commit;
    if (!h.isDirectory(dir)) continue;
    for (const runId of h.list(dir) || []) {
      const rel = '.dairn/governance/evidence/runs/' + commit + '/' + runId + '/run.json';
      try {
        const run = JSON.parse(h.read(root.replace(/\/$/, '') + '/' + rel));
        if (run.schema !== 'dairn.check-run.v1') {runs.coverage.partial++;continue;}
        runs.coverage.readable++;
        if (windowStart && run.created_at && run.created_at < windowStart) continue;
        runs.push({run_id: run.run_id, subject_commit: commit, created_at: run.created_at || null,
          status: run.status, execution:run.execution||{}, subject:run.subject||{}, checks: (run.checks || []).map(c => ({id: c.id, module: c.module || null,
            status: c.status, argv:c.argv||null, duration_sec: typeof c.duration_sec === 'number' ? c.duration_sec : null}))});
      } catch (_) { runs.coverage.unreadable++; }
    }
  }
  return runs;
}

export function recommendAdaptations({runs, windowStart = null, windowEnd = null,
  minSamples = 10, slowMs = 120000} = {}) {
  const observed = {window: {start: windowStart, end: windowEnd}, runs: runs.length, coverage:runs.coverage||{readable:runs.length,unreadable:0,partial:0}, equivalence:'unknown-unless-complete-identity'};
  if (runs.length < minSamples)
    return {schema: 'dairn.governance-feedback.v1', status: 'insufficient-evidence', observed,
      recommendations: [], note: 'not enough run history to support any tuning claim (have ' + runs.length + ', need ' + minSamples + ')'};

  /* Per (module, check) statistics. */
  const stats = new Map();
  for (const run of runs) for (const check of run.checks) {
    const key = (check.module ? check.module + ':' : '') + check.id;
    if (!stats.has(key)) stats.set(key, {key, id: check.id, module: check.module, runs: 0, failed: 0,
      durations: [], equivalent: new Map(), unknownIdentity:0});
    const item = stats.get(key);
    item.runs += 1;
    if (check.status !== 'passed') item.failed += 1;
    if (typeof check.duration_sec === 'number') item.durations.push(check.duration_sec * 1000);
    const e=run.execution||{}, subject=run.subject||{};
    const fields=[subject.repository,subject.source_commit,subject.tree_sha,subject.base_commit,e.snapshot_before_sha256,e.policy_sha256,e.check_plan_sha256,e.toolchain_sha256,e.runtime_sha256,check.argv];
    if(fields.every(x=>x!==null&&x!==undefined&&(typeof x!=='string'||x.length>0))){
      const identity=JSON.stringify(fields), values=item.equivalent.get(identity)||[];
      values.push(check.status);item.equivalent.set(identity,values);
    }else item.unknownIdentity++;

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
    const repeated = [...item.equivalent.values()].filter(values => values.length > 2).length;
    if (repeated >= 3)
      recommendations.push({proposal: 'deduplicate-identical-runs', kind: 'REPEATED_RUNS',
        observed: {check: item.key, comparable_inputs_with_3plus_runs: repeated, unknown_identity_runs:item.unknownIdentity},
        hypothesis: '完整输入、策略、计划与工具环境身份一致的检查重复运行；本地标识不证明 CI 来源',
        proposed_action: 'share a verified job artifact while retaining the original required status',
        expected_benefit: 'lower CI compute and wait time',
        requirements_preserved: [item.key],
        requires_approval: true});
    /* POLICY_NOISE: failures that a re-run cleared — narrow scope, don't drop. */
    const failureRate = item.failed / item.runs;
    const alternates=[...item.equivalent.values()].some(values=>values.some((value,index)=>index>0&&value!==values[index-1]&&['passed','failed'].includes(value)&&['passed','failed'].includes(values[index-1])));
    if (item.failed >= 3 && failureRate >= 0.2 && item.runs >= minSamples)
      recommendations.push({proposal: alternates?'investigate-comparable-failure-alternation':'investigate-frequent-failure', kind: alternates?'SUSPECTED_FLAKY':'FREQUENT_FAILURE',
        observed: {check: item.key, runs: item.runs, failures: item.failed, failure_rate: Math.round(failureRate * 100) / 100},
        hypothesis: alternates?'可比输入出现 fail/pass 交替，需独立确认 flaky 原因':'高失败率只证明频数，尚无同输入重试因果证据',
        proposed_action: '核对真实失败原因并稳定检查；不得自动删除或缩小必需保障',
        expected_benefit: 'fewer false-positive blockages',
        requirements_preserved: [item.key],
        requires_approval: true});
  }
  recommendations.sort((a, b) => a.proposal.localeCompare(b.proposal));
  return {schema: 'dairn.governance-feedback.v1', status: recommendations.length ? 'recommendations' : 'no-action',
    observed, recommendations,
    note: 'suggestions only: none of these is applied automatically, and all require independent approval'};
}
