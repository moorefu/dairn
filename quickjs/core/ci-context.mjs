/* CI PR/MR 平台元数据回退：只在真实 PR/MR 上下文中把平台元数据转成变更元信息。
 * 平台元数据不是变更清单（manifest）：它只用于缺少 `.dairn/governance/changes/<id>.json`
 * 的 CI PR/MR 场景，且只会在本地分类基线（floor）之上调高风险，绝不降低 floor。 */
const RISKS = ['L0', 'L1', 'L2'];
const MODES = ['G0', 'G1', 'G2', 'G3'];
const raise = (order, value, target) => (order.indexOf(value) >= order.indexOf(target) ? value : target);
export function isCiPullRequest(h) {
  if (h.env('GITHUB_ACTIONS') === 'true' && ['pull_request', 'pull_request_target'].includes(h.env('GITHUB_EVENT_NAME'))) return true;
  return h.env('GITLAB_CI') === 'true' && h.env('CI_PIPELINE_SOURCE') === 'merge_request_event';
}
function githubMeta(h) {
  const eventPath = h.env('GITHUB_EVENT_PATH');
  if (!eventPath) return null;
  let event;
  try { event = JSON.parse(h.read(eventPath)); }
  catch (_) { return null; }
  const pr = event && typeof event === 'object' ? event.pull_request : null;
  if (!pr || typeof pr !== 'object' || Array.isArray(pr)) return null;
  const labels = Array.isArray(pr.labels)
    ? pr.labels.map(x => (typeof x === 'string' ? x : x && typeof x.name === 'string' ? x.name : '')).filter(Boolean)
    : [];
  return {source: 'github-pr-metadata', title: typeof pr.title === 'string' ? pr.title : '',
    body: typeof pr.body === 'string' ? pr.body : '', labels};
}
function gitlabMeta(h) {
  return {source: 'gitlab-mr-metadata', title: h.env('CI_MERGE_REQUEST_TITLE') || '',
    body: h.env('CI_MERGE_REQUEST_DESCRIPTION') || '',
    labels: String(h.env('CI_MERGE_REQUEST_LABELS') || '').split(',').map(x => x.trim()).filter(Boolean)};
}
export function prChangeMeta(h, floor) {
  if (!isCiPullRequest(h)) return null;
  const platform = h.env('GITHUB_ACTIONS') === 'true' ? githubMeta(h) : gitlabMeta(h);
  // 事件文件缺失或损坏时返回 null，让引擎继续 fail closed（需要 manifest）。
  if (!platform) return null;
  let risk = floor && RISKS.includes(floor.risk) ? floor.risk : 'L0';
  let mode = floor && MODES.includes(floor.governance_mode) ? floor.governance_mode : 'G0';
  const triggers = Array.isArray(floor && floor.risk_triggers) ? [...floor.risk_triggers] : [];
  // 平台标签/正文只允许上调风险：dairn:l2 / risk:L2 -> L2+G2；dairn:g2 -> G2。
  const text = platform.labels.join('\n') + '\n' + platform.body;
  if (/dairn:l2|risk:l2/i.test(text)) {
    risk = raise(RISKS, risk, 'L2');
    mode = raise(MODES, mode, 'G2');
    triggers.push('platform-metadata:L2');
  }
  if (/dairn:g2/i.test(text)) {
    mode = raise(MODES, mode, 'G2');
    triggers.push('platform-metadata:G2');
  }
  return {source: platform.source, risk, governance_mode: mode,
    risk_triggers: [...new Set(triggers)].sort(), review_pending: risk === 'L2',
    requires_human_approval: risk === 'L2', summary: platform.title,
    rationale: String(platform.body || '').slice(0, 2000), verification: ['platform-pr-metadata']};
}
