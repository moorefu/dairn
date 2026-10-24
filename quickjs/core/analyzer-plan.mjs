/* Analyzer Selection Planner (capability-driven lazy execution).
 *
 * Sequence: observed change -> derived needs -> cached result -> declared
 * provider -> trusted policy -> execute or request authorization -> explicit
 * gap. Dairn Core contains no language parser: providers are builtin bounded
 * facts, the explicit relation registry, or project-configured external
 * analyzers. Import-mode analytic reports feed Quality Fitness; they are not
 * on-demand providers and are never presented as gate verdicts.
 */
import {sha256} from './sha256.mjs';
import {captureFacts, impactReport} from './facts.mjs';
import {readRelations} from './relations.mjs';
import {configuredAnalyzers} from './analyzers.mjs';
import {loadQualityGoals} from './quality-goals.mjs';
import {peekAnalyzerResult, executeAnalyzer} from './analyzer-runner.mjs';
import {deriveNeeds, chooseProvider, describeProviders, CAPABILITIES, assertCapability} from './analysis-needs.mjs';
import {ANALYSIS_POLICY_PATH, loadAnalysisPolicy} from './analysis-policy.mjs';

const at = (root, path) => root.replace(/\/$/, '') + '/' + path;

/* Domain-level defaults only for the surface domain this release shipped.
 * Every other capability must be declared explicitly by the analyzer config. */
const DOMAIN_CAPABILITY = Object.freeze({surface: 'surface.api-diff'});

const BUILTIN_PROVIDERS = Object.freeze([
  {
    id: 'builtin:static-facts', kind: 'builtin', mode: 'builtin', precision: 'observed-static',
    capabilities: ['change.impact', 'symbol.definition', 'dependency.impact'],
    detail: 'deterministic bounded facts from facts.mjs; heuristic, no type analysis',
  },
  {
    id: 'builtin:relations', kind: 'builtin', mode: 'builtin', precision: 'observed-static',
    capabilities: ['change.impact', 'test.selection'],
    detail: 'explicit reviewed bindings from .dairn/relations.json; never inferred from names',
  },
]);

function assertPlan(condition, message) { if (!condition) throw Error('Analyzer plan: ' + message); }

function readSafe(h, root, relative) {
  let current = root;
  for (const part of relative.split('/')) {
    current = at(current, part);
    if (h.isSymlink(current)) throw Error('symlinked path ' + relative);
  }
  if (!h.exists(current)) return null;
  return h.read(current);
}

function gitHead(h, root) {
  const revision = h.run(['git', 'rev-parse', '--verify', 'HEAD^{commit}'], root, 15);
  return !revision.timedOut && revision.code === 0 ? revision.output.trim() : null;
}

function resolveBase(h, root, base) {
  if (!base) return null;
  const revision = h.run(['git', 'rev-parse', '--verify', base + '^{commit}'], root, 15);
  return !revision.timedOut && revision.code === 0 ? revision.output.trim() : null;
}

function workspaceDirty(h, root) {
  const status = h.run(['git', 'status', '--porcelain', '--untracked-files=all'], root, 15);
  if (status.timedOut || status.code !== 0) return true;
  return status.output.trim().length > 0;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = stable(value[key]);
    return out;
  }
  return value;
}

function providerView(provider) {
  if (!provider) return null;
  const view = {id: provider.id, kind: provider.kind, precision: provider.precision};
  if (provider.kind === 'analyzer') view.domain = provider.domain || null;
  return view;
}

function buildProviders(h, root, policy) {
  const providers = BUILTIN_PROVIDERS.map(provider => Object.assign({}, provider, {auto_execute: false}));
  const warnings = [];
  let registry = null;
  try { registry = configuredAnalyzers(h, root); }
  catch (error) { warnings.push({kind: 'ANALYZER_CONFIG_UNAVAILABLE', detail: error.message}); }
  if (registry) {
    for (const def of registry.analyzers || []) {
      if ((def.mode || 'execute') !== 'execute') continue;
      const declared = Array.isArray(def.capabilities) ? def.capabilities : [];
      const capabilities = declared.length > 0 ? declared : (DOMAIN_CAPABILITY[def.domain] ? [DOMAIN_CAPABILITY[def.domain]] : []);
      if (capabilities.length === 0) continue;
      providers.push({
        id: def.id, kind: 'analyzer', mode: 'execute', precision: 'syntax', domain: def.domain,
        capabilities: capabilities.slice(),
        timeout_seconds: (def.execution && def.execution.timeout_seconds) || 120,
        auto_execute: policy.auto_execute.includes(def.id),
        detail: 'declared read-only provider; execution is bounded by trusted policy',
      });
    }
  }
  for (const id of policy.auto_execute) {
    if (!providers.some(provider => provider.kind === 'analyzer' && provider.id === id)) {
      warnings.push({kind: 'UNCONFIGURED_AUTO_EXECUTE', detail: 'policy auto_execute references an analyzer that is not configured for execute mode: ' + id});
    }
  }
  return {providers, warnings};
}

function decideNeed(h, root, need, providers, options) {
  const selection = chooseProvider(need, providers);
  const common = {
    need_id: need.id,
    capability: need.capability,
    required_precision: need.required_precision,
    priority: need.priority,
    provider: providerView(selection.provider),
    precision: selection.provider ? selection.provider.precision : null,
  };
  if (!selection.provider) {
    return Object.assign(common, {action: 'gap', reason: selection.reason, detail: selection.detail});
  }
  const provider = selection.provider;
  if (provider.kind === 'builtin') {
    return Object.assign(common, {action: 'builtin', reason: 'builtin-provider', detail: provider.detail});
  }
  const withinPolicyTimeout = provider.timeout_seconds <= options.policy.max_timeout_seconds;
  const allowlisted = options.policy.auto_execute.includes(provider.id) && withinPolicyTimeout;
  if (options.policy.reuse) {
    let cached = null;
    try { cached = peekAnalyzerResult(h, root, provider.id, {base: options.base}); }
    catch (error) { cached = {available: false, reason: 'CACHE_INSPECTION_FAILED'}; }
    if (cached && cached.available) {
      const subject = cached.subject && cached.subject.source_commit ? cached.subject.source_commit.slice(0, 12) : 'unknown';
      return Object.assign(common, {
        action: 'reuse', from_cache: true, reason: 'cached-result-reused',
        detail: 'subject ' + subject + (cached.subject && cached.subject.base_commit ? ' base ' + cached.subject.base_commit.slice(0, 12) : ''),
      });
    }
  }
  if (!options.apply) {
    return Object.assign(common, {
      action: allowlisted ? 'execute' : 'request-authorization',
      reason: allowlisted ? 'auto-execute-allowlisted' : (withinPolicyTimeout ? 'AUTO_EXECUTE_NOT_ALLOWED' : 'TIMEOUT_EXCEEDS_POLICY'),
      detail: allowlisted ? 'dry run: would execute under a bounded timeout; nothing was executed'
        : 'allowlist this id in ' + ANALYSIS_POLICY_PATH + ' or run the analyzer explicitly',
    });
  }
  if (!allowlisted) {
    return Object.assign(common, {
      action: 'request-authorization',
      reason: withinPolicyTimeout ? 'AUTO_EXECUTE_NOT_ALLOWED' : 'TIMEOUT_EXCEEDS_POLICY',
      detail: 'trusted policy does not authorize automatic execution of ' + provider.id,
    });
  }
  let run = null;
  try { run = executeAnalyzer(h, root, provider.id, {base: options.base}); }
  catch (error) {
    return Object.assign(common, {action: 'gap', reason: 'EXECUTION_FAILED', run_status: 'error', detail: error.message});
  }
  if (run && run.status === 'completed') {
    return Object.assign(common, {
      action: 'execute', reason: 'executed', from_cache: !!run.from_cache,
      run_status: run.status, run_id: run.run_id || null,
      detail: Array.isArray(run.changes) ? run.changes.length + ' observed changes' : 'completed analysis run',
    });
  }
  const status = run && run.status ? run.status : 'error';
  const detail = run && (run.error || run.reason) ? String(run.error || run.reason) : status;
  return Object.assign(common, {action: 'gap', reason: 'EXECUTION_FAILED', run_status: status, detail});
}

/**
 * Build a deterministic analyzer selection plan. Pure with respect to observed
 * project state; the only side effects are the cached-result probe and, with
 * apply=true plus explicit trusted allowlisting, the bounded analyzer execution.
 */
export function buildAnalyzerPlan(h, root, {config, base = null, task = null, capability = null, apply = false, evidence = null} = {}) {
  assertPlan(config && Array.isArray(config.modules), 'project config with modules is required');
  if (capability) assertCapability(capability);
  const head = gitHead(h, root);
  const dirty = workspaceDirty(h, root);
  const policy = loadAnalysisPolicy(h, root);
  const facts = evidence && evidence.facts ? evidence.facts : captureFacts(h, root, config);

  let impact = null;
  let impactError = null;
  if (evidence && evidence.impact !== undefined) impact = evidence.impact;
  else if (base) {
    try { impact = impactReport(h, root, config, {base}); }
    catch (error) { impactError = error.message; }
  }

  let goals = evidence ? evidence.goals : undefined;
  let goalsError = null;
  if (goals === undefined) {
    try { goals = loadQualityGoals(h, root, relative => readSafe(h, root, relative)); }
    catch (error) { goalsError = error.message; goals = null; }
  }

  let relations = evidence ? evidence.relations : null;
  let relationsError = null;
  if (evidence && evidence.relations) relations = evidence.relations;
  else if (base || !evidence) {
    try { relations = readRelations(h, root, facts, {base}); }
    catch (error) { relationsError = error.message; relations = null; }
  }

  const symbols = evidence && Array.isArray(evidence.symbols) ? evidence.symbols : [];
  const needs = deriveNeeds({
    change: impact,
    symbols,
    query: task,
    goals,
    policy,
    capabilityOnly: capability,
  });
  const {providers, warnings} = buildProviders(h, root, policy);
  const decisions = needs.map(need => decideNeed(h, root, need, providers, {policy, apply, base}));

  const unknowns = warnings.map(warning => Object.assign({}, warning));
  if (!head) unknowns.push({kind: 'GIT_UNAVAILABLE', detail: 'change, cache reuse and source binding are unavailable outside a Git repository'});
  if (impactError) unknowns.push({kind: 'CHANGE_ANALYSIS_UNAVAILABLE', detail: impactError});
  if (impact && impact.status === 'unbaselined') unknowns.push({kind: 'UNBASELINED_CHANGE', detail: 'no committed project facts at the trusted base; change needs cannot be derived'});
  if (goalsError) unknowns.push({kind: 'QUALITY_GOALS_UNAVAILABLE', detail: goalsError});
  if (relationsError) unknowns.push({kind: 'RELATIONS_UNAVAILABLE', detail: relationsError});
  if (capability && decisions.length === 0) unknowns.push({kind: 'NO_ANALYSIS_NEED', detail: 'no observed state requires capability ' + capability});

  const requiredGaps = decisions.filter(decision => decision.action === 'gap' && decision.priority === 'required');
  const pendingAuthorization = decisions.filter(decision => decision.action === 'request-authorization');
  const summary = {
    needs: decisions.length,
    reuse: decisions.filter(decision => decision.action === 'reuse').length,
    execute: decisions.filter(decision => decision.action === 'execute').length,
    builtin: decisions.filter(decision => decision.action === 'builtin').length,
    request_authorization: pendingAuthorization.length,
    gaps: decisions.filter(decision => decision.action === 'gap').length,
    gaps_required: requiredGaps.length,
    unknowns: unknowns.length,
  };
  const status = requiredGaps.length > 0 ? 'missing-capability'
    : pendingAuthorization.length > 0 ? 'needs-authorization' : 'ready';

  const plan = {
    schema: 'dairn.analyzer-plan.v1',
    subject: {
      head,
      base: base || null,
      base_commit: resolveBase(h, root, base),
      workspace: dirty ? 'dirty' : 'clean',
    },
    policy: {
      source: policy.source,
      path: policy.path,
      auto_execute: policy.auto_execute.slice(),
      max_timeout_seconds: policy.max_timeout_seconds,
      reuse: policy.reuse,
      required: policy.required.map(entry => Object.assign({}, entry)),
    },
    capability_filter: capability || null,
    needs,
    decisions,
    providers: describeProviders(providers),
    summary,
    status,
    note: 'Advisory selection only: --apply executes allowlisted read-only providers; it never lowers or substitutes trusted governance requirements.',
    gaps: decisions.filter(decision => decision.action === 'gap').map(decision => ({
      need_id: decision.need_id, capability: decision.capability, priority: decision.priority,
      reason: decision.reason, detail: decision.detail,
    })),
    unknowns,
    limitations: [
      'Selection is advisory and never a gate verdict; required governance checks still come from trusted policy.',
      'Dairn Core performs no language parsing: builtin evidence is bounded and heuristic, so dynamic, generated and reflection-based code can be missed.',
      'Import-mode analyzer reports are Quality Fitness evidence, not on-demand providers.',
      'Declared provider precision is class-level; Dairn cannot verify an analyzer really reached it.',
      'Cached results are reused only for the same analyzer config, source digest and clean working tree at the same commit.',
    ],
    generated_at: h.now(),
  };
  if (dirty) plan.limitations.push('Dirty workspace invalidates the analyzer cache; execution results are local-observation only.');
  const digestInput = Object.assign({}, plan);
  delete digestInput.plan_sha256;
  delete digestInput.generated_at;
  plan.plan_sha256 = sha256('dairn.analyzer-plan.v1\n' + JSON.stringify(stable(digestInput)));
  plan.providers.sort((a, b) => (a.kind + ':' + a.id).localeCompare(b.kind + ':' + b.id));
  return plan;
}

export function renderPlan(plan) {
  const lines = [];
  const head = plan.subject.head ? plan.subject.head.slice(0, 12) : 'none';
  lines.push('Analyzer selection plan (' + plan.schema + ')');
  lines.push('Subject: head ' + head + (plan.subject.base_commit ? ' base ' + plan.subject.base_commit.slice(0, 12) : '')
    + ' workspace ' + plan.subject.workspace);
  lines.push('Policy: ' + plan.policy.source + ' auto_execute=[' + plan.policy.auto_execute.join(',') + ']'
    + ' max_timeout=' + plan.policy.max_timeout_seconds + 's reuse=' + plan.policy.reuse);
  if (plan.needs.length === 0) lines.push('Needs: none observed');
  else {
    lines.push('Needs:');
    for (const decision of plan.decisions) {
      const provider = decision.provider ? decision.provider.id : '-';
      lines.push('  - ' + decision.capability + ' (' + decision.priority + ', precision=' + decision.required_precision + ')'
        + ' -> ' + decision.action + (decision.provider ? ' via ' + provider + '@' + decision.precision : '')
        + ' [' + decision.reason + ']');
    }
  }
  if (plan.gaps.length > 0) {
    lines.push('Gaps:');
    for (const gap of plan.gaps) lines.push('  - ' + gap.capability + ': ' + gap.reason + ' (' + gap.detail + ')');
  }
  for (const unknown of plan.unknowns) lines.push('Unknown: ' + unknown.kind + ' - ' + unknown.detail);
  lines.push('Status: ' + plan.status + ' (advisory selection; not a gate verdict)');
  return lines.join('\n');
}

export {CAPABILITIES};
