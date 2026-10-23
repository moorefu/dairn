/* Pure validation and platform-snapshot adjudication of SCM approval facts.
 * Network/API access belongs to ci/providers/* fetch helpers; this module only
 * consumes normalized snapshots and never trusts PR-attached JSON (§9). */
const PROVIDERS = ['github','gitlab'];
const STATUSES = ['PASS','FAIL','INDETERMINATE'];
const HEX = /^[0-9a-f]{40,64}$/i;
function ok(value, message) { if (!value) throw Error('Approval: ' + message); }
export function validateApprovalVerdict(verdict) {
  const errors = [];
  const check = (value, message) => { if (!value) errors.push(message); };
  check(verdict && verdict.schema === 'dairn.approval-verdict.v1', 'schema must be dairn.approval-verdict.v1');
  check(PROVIDERS.includes(verdict?.provider), 'provider invalid');
  check(STATUSES.includes(verdict?.status), 'status invalid');
  check(typeof verdict?.subject?.repository === 'string' && verdict.subject.repository.length > 0, 'subject.repository required');
  check(Number.isInteger(verdict?.subject?.number) && verdict.subject.number > 0, 'subject.number invalid');
  check(HEX.test(verdict?.subject?.reviewed_head_sha || ''), 'reviewed_head_sha invalid');
  for (const field of ['eligible_reviewer_ids','review_ids','rule_ids','reasons']) check(Array.isArray(verdict?.[field]), field + ' must be array');
  check(typeof verdict?.observed_at === 'string' && verdict.observed_at.length > 0, 'observed_at required');
  return errors;
}
export function approvalVerdict(input) {
  const result = {...input, schema:'dairn.approval-verdict.v1'};
  const errors = validateApprovalVerdict(result); ok(!errors.length, errors.join('; '));
  return result;
}
export function verifyApproval(verdict, policy = {}) {
  const errors = validateApprovalVerdict(verdict);
  if (errors.length) return {status:'INDETERMINATE', reasons:errors};
  if (verdict.status !== 'PASS') return {status:verdict.status, reasons:[...(verdict.reasons || [])]};
  const min = Number(policy.min_count || 0);
  if (verdict.eligible_reviewer_ids.length < min) return {status:'FAIL', reasons:['insufficient eligible approvals']};
  return {status:'PASS', reasons:[]};
}

/* ---------- Platform snapshot adjudication (APR-01..08, localizable parts) ---------- */
function baseVerdict(provider, snapshot, status, reasons, eligible, reviews) {
  return approvalVerdict({schema:'dairn.approval-verdict.v1', provider,
    subject:{repository:snapshot.repository, number:snapshot.number, reviewed_head_sha:snapshotHead(snapshot)},
    status, eligible_reviewer_ids:eligible, review_ids:reviews, rule_ids:[],
    observed_at:snapshot.fetched_at, reasons});
}
function snapshotHead(snapshot) {
  return snapshot?.head_sha || snapshot?.pr?.head_sha || snapshot?.mr?.head_sha || '';
}
function snapshotGate(snapshot, schema, required) {
  const reasons = [];
  if (!snapshot || snapshot.schema !== schema) reasons.push('unexpected snapshot schema');
  if (snapshot?.fetch_ok === false) reasons.push('provider fetch failed; approval state undeterminable'); // APR-07
  if (snapshot?.truncated === true) reasons.push('review list truncated (pagination); approval state undeterminable');
  for (const field of required) if (snapshot?.[field] === undefined || snapshot?.[field] === null) reasons.push('snapshot incomplete: ' + field);
  if (snapshot?.pr?.fetch_error) reasons.push('pr fetch error: ' + snapshot.pr.fetch_error);
  if (snapshot?.mr?.fetch_error) reasons.push('mr fetch error: ' + snapshot.mr.fetch_error);
  if (snapshot?.approvals?.fetch_error) reasons.push('approvals fetch error: ' + snapshot.approvals.fetch_error);
  if (!snapshot?.fetched_at) reasons.push('snapshot has no fetch timestamp');
  if (!HEX.test(snapshotHead(snapshot))) reasons.push('snapshot head sha invalid');
  return reasons;
}

/* GitHub: an Approved review counts only when it is a human (not Bot/App),
 * not the PR author, not dismissed, and recorded against the current head
 * (reviews predating the last push are stale per GitHub protection rules). */
function indeterminate(provider, snapshot, reasons) {
  const head = snapshotHead(snapshot);
  return {schema:'dairn.approval-verdict.v1', provider, status:'INDETERMINATE',
    subject:{repository:snapshot?.repository ?? 'unknown', number:snapshot?.number ?? 0,
      reviewed_head_sha:HEX.test(head) ? head : '0'.repeat(40)},
    eligible_reviewer_ids:[], review_ids:[], rule_ids:[], observed_at:snapshot?.fetched_at || 'unknown', reasons};
}
export function githubApprovalVerdict(snapshot, policy = {}) {
  const incomplete = snapshotGate(snapshot, 'dairn.approval-snapshot.github.v1', ['repository','number','pr','reviews']);
  if (incomplete.length) return indeterminate('github', snapshot, incomplete);
  const reasons = [];
  const pr = snapshot.pr;
  if (pr.merged === true) reasons.push('pull request already merged');
  else if (pr.state !== 'open') reasons.push('pull request state is ' + String(pr.state));
  const eligible = [], reviewIds = [];
  for (const review of snapshot.reviews || []) {
    reviewIds.push(String(review.id ?? review.user_login ?? '?'));
    if (review.state !== 'APPROVED') continue;
    if (review.dismissed_at) continue;                                   // APR-04 dismissed
    if (review.user_type && review.user_type !== 'User') continue;       // APR-02 Bot/App
    if (review.bot === true) continue;
    if (review.user_login === pr.user_login) continue;                   // APR-01 author self-approval
    if (review.commit_id && pr.head_sha && review.commit_id !== pr.head_sha) continue; // stale review after push (APR-03)
    if (eligible.includes(review.user_login)) continue;
    eligible.push(review.user_login);
  }
  const min = Number(policy.min_count ?? 1);
  if (min > 0 && eligible.length < min) reasons.push('insufficient eligible approvals: ' + eligible.length + ' < ' + min +
    ' (eligible: ' + (eligible.join(',') || 'none') + ')');
  const status = reasons.length ? 'FAIL' : 'PASS';
  return {...baseVerdict('github', snapshot, status, reasons, eligible, reviewIds)};
}

/* GitLab: approvals_syncing/checking are undetermined; bot approvals and the
 * MR author never count; the approved flag alone is meaningless without the
 * eligible reviewer list (APR-05). */
export function gitlabApprovalVerdict(snapshot, policy = {}) {
  const incomplete = snapshotGate(snapshot, 'dairn.approval-snapshot.gitlab.v1', ['repository','number','mr','approvals']);
  if (incomplete.length) return indeterminate('gitlab', snapshot, incomplete);
  const reasons = [];
  const mr = snapshot.mr, approvals = snapshot.approvals;
  if (approvals.syncing === true || approvals.checking === true)       // APR-06
    return indeterminate('gitlab', snapshot, ['approval state is syncing/checking']);
  if (mr.state !== 'opened') reasons.push('merge request state is ' + String(mr.state));
  const eligible = [], reviewIds = [];
  for (const approver of approvals.approved_by || []) {
    reviewIds.push(String(approver.username ?? '?'));
    if (approver.bot === true) continue;                                // APR-02
    if (approver.username === mr.author_username) continue;             // APR-01
    if (!eligible.includes(approver.username)) eligible.push(approver.username);
  }
  const min = Number(policy.min_count ?? 1);
  if (min > 0 && eligible.length < min) reasons.push('insufficient eligible approvals: ' + eligible.length + ' < ' + min +
    ' (eligible: ' + (eligible.join(',') || 'none') + ')');
  // Edition/license cannot expose rule data: undeterminable, not failing (§9.3).
  if (policy.rules_required && !Array.isArray(approvals.rules))
    return indeterminate('gitlab', snapshot, reasons.concat(['approval rules unavailable for this edition']));
  const status = reasons.length ? 'FAIL' : 'PASS';
  return {...baseVerdict('gitlab', snapshot, status, reasons, eligible, reviewIds)};
}

export function platformVerdict(snapshot, policy = {}) {
  const provider = snapshot?.schema === 'dairn.approval-snapshot.gitlab.v1' ? 'gitlab'
    : snapshot?.schema === 'dairn.approval-snapshot.github.v1' ? 'github' : null;
  ok(provider, 'unknown approval snapshot schema');
  return provider === 'github' ? githubApprovalVerdict(snapshot, policy) : gitlabApprovalVerdict(snapshot, policy);
}
