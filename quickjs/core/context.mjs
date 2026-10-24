/* Dairn Context Intelligence — task-aware context resolver (MVP).
 *
 * Builds a minimal, provenance-bound context pack from layered evidence:
 *   L1 text search (git grep), L2 observed symbols + explicit relations,
 *   L3 engineering memory (Specs, Notes, Git history), L4 change context
 *   (impact, governance plan, verification at HEAD).
 *
 * Nothing here is semantic code navigation: every match keeps its source and
 * precision class, missing evidence is reported as UNKNOWN, and the pack never
 * becomes a gate verdict. Text search is delegated, not reimplemented.
 */
import {sha256} from './sha256.mjs';
import {captureFacts, impactReport} from './facts.mjs';
import {readRelations} from './relations.mjs';
import {loadQualityGoals} from './quality-goals.mjs';
import {captureHandoff} from './handoff.mjs';
import {planForChange} from './governance-plan.mjs';
import {buildAnalyzerPlan} from './analyzer-plan.mjs';

const ASSETS = '/zip/quickjs/assets/';
const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 40;
const MAX_SCAN_BYTES = 200000;
const FOCUS_CAPABILITIES = Object.freeze({
  security: ['security.scan'],
  'threat-analysis': ['security.scan'],
  test: ['test.selection', 'test.quality'],
  testing: ['test.selection', 'test.quality'],
  performance: ['performance.benchmark'],
  architecture: ['architecture.rules'],
  compatibility: ['surface.api-diff', 'contract.compatibility'],
  impact: ['change.impact', 'contract.compatibility'],
});

const at = (root, path) => root.replace(/\/$/, '') + '/' + path;
const txt = value => String(value === null || value === undefined ? '' : value);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = stable(value[key]);
    return out;
  }
  return value;
}

function frontmatterId(text) {
  for (const line of String(text).split(/\r?\n/).slice(0, 30)) {
    const match = /^id:\s*(\S+)\s*$/.exec(line);
    if (match) return match[1].replace(/^["']|["']$/g, '');
  }
  return null;
}

function firstLine(text) {
  for (const line of String(text).split(/\r?\n/)) if (line.trim()) return line.trim();
  return '';
}

function scoreText(text, terms) {
  const lowered = String(text || '').toLowerCase();
  let score = 0;
  for (const term of terms) {
    let index = lowered.indexOf(term);
    while (index !== -1 && score < 50) { score += 1; index = lowered.indexOf(term, index + term.length); }
  }
  return score;
}

function tokenize(query) {
  const terms = [];
  const seen = new Set();
  const add = term => {
    const value = String(term || '').toLowerCase();
    if (value.length < 2 || terms.length >= 12 || seen.has(value)) return;
    seen.add(value); terms.push(value);
  };
  const text = txt(query).toLowerCase();
  const re = /[a-z0-9][a-z0-9_.-]{2,}/g;
  let match;
  while ((match = re.exec(text))) add(match[0]);
  const chars = [];
  for (const char of text) if (/[\u3400-\u9fff]/.test(char)) chars.push(char);
  for (let index = 0; index + 1 < chars.length && terms.length < 10; index += 1) add(chars[index] + chars[index + 1]);
  return terms;
}

function gitRun(h, root, args, timeout) {
  try { return h.run(args, root, timeout || 20); }
  catch (error) { return {code: 127, timedOut: false, output: String(error && error.message || error)}; }
}

function gitHead(h, root) {
  const result = gitRun(h, root, ['git', 'rev-parse', '--verify', 'HEAD^{commit}'], 15);
  return result.code === 0 && !result.timedOut ? result.output.trim() : null;
}

function resolveCommit(h, root, ref) {
  if (!ref) return null;
  const result = gitRun(h, root, ['git', 'rev-parse', '--verify', ref + '^{commit}'], 15);
  return result.code === 0 && !result.timedOut ? result.output.trim() : null;
}

function gitTextSearch(h, root, terms) {
  if (terms.length === 0) return {available: true, hits: [], truncated: false, note: 'no ASCII/CJK query terms; text search not attempted'};
  const args = ['git', 'grep', '-n', '-I', '--no-color'];
  for (const term of terms.slice(0, 6)) args.push('-e', term);
  args.push('--');
  const result = gitRun(h, root, args, 25);
  if (result.timedOut) return {available: false, hits: [], reason: 'git grep timed out'};
  if (result.code !== 0 && result.code !== 1) return {available: false, hits: [], reason: 'git grep failed: ' + txt(result.output).slice(0, 160)};
  const hits = [];
  const seen = new Set();
  let truncated = false;
  for (const rawLine of txt(result.output).split(/\r?\n/)) {
    if (!rawLine) continue;
    const parsed = /^(.+?):(\d+):(.*)$/.exec(rawLine);
    if (!parsed) continue;
    const key = parsed[1] + ':' + parsed[2];
    if (seen.has(key)) continue;
    seen.add(key);
    if (hits.length >= 200) { truncated = true; break; }
    hits.push({path: parsed[1], line: Number(parsed[2]), text: parsed[3].trim().slice(0, 240), score: scoreText(parsed[3], terms)});
  }
  hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.line - b.line);
  return {available: true, hits, truncated};
}

function specDocuments(h) {
  let manifest;
  try { manifest = JSON.parse(h.read(ASSETS + 'manifest.json')); }
  catch (error) { return null; }
  const docs = [];
  for (const asset of manifest.assets || []) {
    if (asset.type !== 'specs') continue;
    let text;
    try { text = h.read(ASSETS + 'specs/' + asset.path); } catch (error) { continue; }
    docs.push({id: frontmatterId(text), path: asset.path, text});
  }
  return docs;
}

function specMatches(specDocs, terms) {
  if (!specDocs || specDocs.length === 0) return [];
  const matches = [];
  for (const spec of specDocs) {
    const score = scoreText(txt(spec.id) + '\n' + spec.text.slice(0, 20000), terms);
    if (score <= 0) continue;
    matches.push({id: spec.id, path: spec.path, score});
  }
  matches.sort((a, b) => b.score - a.score || txt(a.id).localeCompare(txt(b.id)));
  return matches.slice(0, 8);
}

function symbolMatches(facts, terms) {
  const matches = [];
  for (const file of facts.code_surfaces || []) {
    for (const entry of file.symbols || []) {
      const name = String(entry).split(':')[0];
      const lower = name.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (lower === term) score += 5;
        else if (lower.includes(term)) score += 3;
        else if (name.length >= 3 && term.includes(lower)) score += 1;
      }
      if (score > 0) matches.push({path: file.path, symbol: name, language: file.language, module: file.module, score, reason: 'declared-symbol-name-match'});
    }
  }
  matches.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.symbol.localeCompare(b.symbol));
  return matches.slice(0, 40);
}

function relationMatches(relations, terms, symbolPaths) {
  if (!relations || !Array.isArray(relations.bindings) || relations.bindings.length === 0) return [];
  // Only bindings whose declared symbol was matched by the observed symbol scan.
  // A registry binding is reviewed evidence; name similarity is never used to select it.
  const paths = new Set(symbolPaths);
  return relations.bindings.filter(binding => paths.has(binding.symbol.path)).slice(0, 20);
}

function scanNotes(h, root, terms) {
  const base = at(root, '.agents/notes');
  if (!h.exists(base) || !h.isDirectory(base)) return {available: false, notes: [], reason: 'no .agents/notes directory'};
  const files = [];
  const walk = (directory, rel, depth) => {
    if (depth > 3 || files.length >= 200) return;
    let names;
    try { names = h.list(directory); } catch (error) { return; }
    for (const name of names.sort()) {
      const full = at(directory, name);
      const nextRel = rel ? rel + '/' + name : name;
      if (h.isSymlink(full)) continue;
      if (h.isDirectory(full)) walk(full, nextRel, depth + 1);
      else if (name.endsWith('.md')) files.push(nextRel);
    }
  };
  walk(base, '', 0);
  const matches = [];
  for (const rel of files) {
    let text;
    try { text = h.read(at(base, rel)); } catch (error) { continue; }
    if (text.length > MAX_SCAN_BYTES) continue;
    const score = scoreText(rel + '\n' + text.slice(0, 20000), terms);
    if (score <= 0) continue;
    const title = firstLine(text).replace(/^#\s*Agent Note:\s*/i, '');
    const date = /^(\d{4}-\d{2}-\d{2})/.exec(rel.split('/').pop());
    matches.push({path: '.agents/notes/' + rel, title, date: date ? date[1] : null, score});
  }
  matches.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return {available: true, notes: matches.slice(0, 10), scanned: files.length};
}

function historyMatches(h, root, terms) {
  const result = gitRun(h, root, ['git', 'log', '--all', '-n', '60', '--format=%H%x09%cs%x09%s'], 20);
  if (result.timedOut || result.code !== 0) return {available: false, commits: [], reason: 'git log unavailable'};
  const commits = [];
  for (const line of txt(result.output).split(/\r?\n/)) {
    if (!line) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    commits.push({sha: parts[0], date: parts[1], subject: parts.slice(2).join(' ')});
  }
  const matched = terms.length > 0
    ? commits.filter(commit => terms.some(term => commit.subject.toLowerCase().includes(term)))
    : commits.slice(0, 10);
  return {available: true, commits: matched.slice(0, 10), scanned: commits.length, matched: matched.length};
}

function governanceLayer(h, root, base) {
  if (!base) return {status: 'not-requested', note: 'pass --base <trusted-ref> to include governance planning'};
  try {
    const outcome = planForChange(h, root, {base});
    const plan = outcome && outcome.plan ? outcome.plan : outcome;
    return {
      status: 'ready',
      plan_sha256: outcome && outcome.plan_sha256 || null,
      plan_status: plan && plan.status || null,
      requirements: ((plan && plan.requirements) || []).slice(0, 40),
      gaps: ((plan && plan.gaps) || []).slice(0, 20),
      quality_goals: plan && plan.quality_goals || null,
    };
  } catch (error) {
    return {status: 'unavailable', error: txt(error && error.message || error).slice(0, 200)};
  }
}

function verificationLayer(handoff) {
  const view = handoff && handoff.verification;
  if (!view) return {status: 'unavailable', note: 'handoff verification view unavailable'};
  const local = (view.local_observed || []).length;
  const stale = (view.stale || []).length;
  const unknown = (view.unknown || []).length;
  return {
    status: local > 0 ? 'executed-at-head' : stale > 0 ? 'stale' : unknown > 0 ? 'unknown' : 'not-executed',
    local_observed: local,
    stale,
    unknown,
    note: local > 0
      ? 'machine-observed local runs at HEAD; still not trusted CI evidence'
      : stale > 0 ? 'existing evidence belongs to a different commit' : 'no machine evidence at HEAD; run the required checks',
  };
}

function analysisLayer(h, root, options) {
  try {
    const plan = buildAnalyzerPlan(h, root, {
      config: options.config,
      base: options.base,
      task: options.query,
      evidence: {facts: options.facts, impact: options.impact, goals: options.goals, relations: options.relations, symbols: options.symbols},
    });
    return {
      status: plan.status,
      plan_sha256: plan.plan_sha256,
      summary: plan.summary,
      decisions: plan.decisions.map(decision => ({
        capability: decision.capability, priority: decision.priority, action: decision.action,
        provider: decision.provider ? decision.provider.id : null, precision: decision.precision, reason: decision.reason,
      })),
      gaps: plan.gaps,
      unknowns: plan.unknowns,
      limitations: plan.limitations,
    };
  } catch (error) {
    return {status: 'unavailable', error: txt(error && error.message || error).slice(0, 200)};
  }
}

/**
 * Build a provenance-bound context pack. Read-only: it launches no analyzer and
 * writes no file. The embedded analyzer plan is always a dry run.
 */
export function buildContextPack(h, root, {config, query = '', base = null, change = false, focus = null, limit = DEFAULT_LIMIT} = {}) {
  if (!config || !Array.isArray(config.modules)) throw Error('Context: project config with modules is required');
  const limited = Number.isInteger(limit) ? Math.max(1, Math.min(MAX_LIMIT, limit)) : DEFAULT_LIMIT;
  const terms = tokenize(query);
  const requestedChange = !!change || !!base;
  const head = gitHead(h, root);
  const facts = captureFacts(h, root, config);

  let impact = null;
  let impactError = null;
  if (base) {
    try { impact = buildContextImpact(h, root, config, base); }
    catch (error) { impactError = txt(error && error.message || error).slice(0, 200); }
  }

  let goals = null;
  try { goals = loadQualityGoals(h, root, relative => readSafe(h, root, relative)); }
  catch (error) { goals = null; }
  let relations = null;
  try { relations = readRelations(h, root, facts, {base}); }
  catch (error) { relations = null; }

  let handoff = null;
  try { handoff = captureHandoff(h, root, {base}); }
  catch (error) { handoff = null; }

  const textSearch = gitTextSearch(h, root, terms);
  const specs = specDocuments(h);
  const specHits = specMatches(specs, terms);
  const symbols = symbolMatches(facts, terms);
  const relationHits = relationMatches(relations, terms, symbols.map(symbol => symbol.path));
  const notes = scanNotes(h, root, terms);
  const history = historyMatches(h, root, terms);
  const governance = governanceLayer(h, root, base);
  const verification = verificationLayer(handoff);
  const analysis = analysisLayer(h, root, {config, base, query, facts, impact, goals, relations, symbols});

  const evidencePaths = new Map();
  const addPath = (path, reason, weight) => {
    if (typeof path !== 'string' || path.length === 0) return;
    if (!evidencePaths.has(path)) evidencePaths.set(path, {path, reasons: [], score: 0});
    const entry = evidencePaths.get(path);
    if (entry.reasons.length < 6 && !entry.reasons.includes(reason)) entry.reasons.push(reason);
    entry.score += weight;
  };
  for (const symbol of symbols) addPath(symbol.path, 'symbol:' + symbol.symbol, 3);
  for (const hit of textSearch.hits.slice(0, limited * 2)) addPath(hit.path, 'text-match', 2);
  for (const binding of relationHits) {
    addPath(binding.symbol.path, 'explicit-relation:' + binding.spec_id, 2);
    for (const test of binding.tests || []) addPath(test, 'relation-test', 2);
  }
  for (const item of (impact && impact.impacts) || []) {
    addPath(item.path, 'changed:' + (item.category || 'unknown'), item.level === 'informational' ? 1 : 2);
  }
  const minimalFiles = [...evidencePaths.values()]
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, limited)
    .map(entry => ({path: entry.path, score: entry.score, reasons: entry.reasons.slice()}));

  const unknowns = [];
  const unknown = (kind, detail) => unknowns.push({kind, detail});
  const opaque = (facts.code_surfaces || []).filter(surface => surface.opaque).length;
  if (opaque > 0) unknown('OPAQUE_SOURCE', opaque + ' source file(s) could not be scanned within byte limits; declarations there are UNKNOWN');
  if (textSearch.available === false) unknown('TEXT_SEARCH_UNAVAILABLE', textSearch.reason);
  if (textSearch.truncated) unknown('TEXT_RESULTS_TRUNCATED', 'git grep output capped at 200 matches');
  if (!specs || specs.length === 0) unknown('SPEC_INDEX_UNAVAILABLE', 'no authoritative Spec assets found');
  if (!notes.available) unknown('NOTES_INDEX_UNAVAILABLE', notes.reason || 'notes unavailable');
  if (!history.available) unknown('HISTORY_UNAVAILABLE', history.reason || 'git history unavailable');
  if (change && !base) unknown('CHANGE_CONTEXT_UNAVAILABLE', 'pass --base <trusted-ref> to bind change and governance layers');
  if (impactError) unknown('CHANGE_ANALYSIS_UNAVAILABLE', impactError);
  if (impact && impact.status === 'unbaselined') unknown('UNBASELINED_CHANGE', 'no committed project facts at the trusted base');
  if (governance.status === 'unavailable') unknown('GOVERNANCE_UNAVAILABLE', governance.error);
  if (verification.status === 'unavailable') unknown('VERIFICATION_UNAVAILABLE', verification.note);
  if (analysis.status === 'missing-capability') {
    for (const gap of analysis.gaps.filter(item => item.priority === 'required')) unknown('MISSING_CAPABILITY', gap.capability + ': ' + gap.reason);
  }
  if (analysis.status === 'unavailable') unknown('ANALYSIS_PLAN_UNAVAILABLE', analysis.error);

  const hasEvidence = minimalFiles.length > 0 || symbols.length > 0 || textSearch.hits.length > 0
    || specHits.length > 0 || relationHits.length > 0 || notes.notes.length > 0 || history.commits.length > 0
    || ((impact && impact.impacts) || []).length > 0;
  if (!hasEvidence) unknown('NO_EVIDENCE', 'no layer produced a citable location; the pack is an empty result, not a positive answer');
  const status = !hasEvidence ? 'empty' : unknowns.length > 0 ? 'partial' : 'ok';
  const focusView = focus ? {
    name: String(focus),
    suggested_capabilities: FOCUS_CAPABILITIES[String(focus)] || [],
    note: 'Focus is advisory context shaping; it never changes required governance checks.',
  } : null;

  const pack = {
    schema: 'dairn.context-pack.v1',
    status,
    query: txt(query),
    query_terms: terms,
    focus: focusView,
    subject: {
      head,
      base: base || null,
      base_commit: resolveCommit(h, root, base),
      workspace: handoff && handoff.workspace ? handoff.workspace.status : (gitRun(h, root, ['git', 'status', '--porcelain'], 15).output.trim() ? 'dirty' : 'clean'),
    },
    requested_change: requestedChange,
    change: impact ? {
      status: impact.status,
      baseline_source: impact.baseline_source,
      counts: impact.counts || {changes: 0, affected_documents: 0},
      impacts: (impact.impacts || []).slice(0, 40).map(item => ({
        path: item.path, category: item.category, level: item.level, confidence: item.confidence,
      })),
      downstream_modules: (impact.downstream_modules || []).slice(0, 20),
      note: impact.note || null,
    } : {status: 'not-requested'},
    text_matches: textSearch.hits.slice(0, limited),
    symbols,
    relations: {
      status: relations ? 'available' : 'absent',
      source: relations ? relations.source : null,
      matches: relationHits,
      explicit_bindings: relations ? relations.bindings.length : 0,
      note: 'Bindings come only from the reviewed .dairn/relations.json registry; Dairn never infers them from names.',
    },
    documents: {
      specs: specHits,
      notes: notes.notes,
      scanned_notes: notes.scanned || 0,
    },
    history,
    governance,
    verification,
    analysis_plan: analysis,
    minimal_files: minimalFiles,
    unknowns,
    provenance: {
      head,
      base_commit: resolveCommit(h, root, base),
      generated_at: h.now(),
      sources: ['git', 'project-facts', 'assets-manifest', 'explicit-relations', 'handoff-local-history'],
      precision: 'observed-static+text',
      note: 'Heuristic context assembly: verify every location before editing; absent facts are UNKNOWN, not false.',
    },
    limitations: [
      'Context packs are evidence assembly, not semantic code navigation; definitions come from bounded declaration scans.',
      'Text matches show locations to inspect; they are not proof of relevance or behavior.',
      'No vector index is used: semantic retrieval stays an optional future provider.',
      'The embedded analyzer plan is a dry run and never a gate verdict.',
    ],
  };
  if (specHits.length > 0 && specs) pack.documents.scanned_specs = specs.length;
  const digestInput = JSON.parse(JSON.stringify(pack));
  delete digestInput.pack_sha256;
  delete digestInput.provenance.generated_at;
  pack.pack_sha256 = sha256('dairn.context-pack.v1\n' + JSON.stringify(stable(digestInput)));
  return pack;
}

function readSafe(h, root, relative) {
  if (typeof relative !== 'string' || relative.length === 0 || relative.startsWith('/')) return null;
  let current = root;
  for (const part of relative.split('/')) {
    if (!part || part === '.' || part === '..') return null;
    current = at(current, part);
    if (h.isSymlink(current)) throw Error('symlinked path ' + relative);
  }
  if (!h.exists(current) || h.isDirectory(current)) return null;
  return h.read(current);
}

function buildContextImpact(h, root, config, base) {
  return impactReport(h, root, config, {base});
}

export function renderContextPack(pack) {
  const lines = [];
  const head = pack.subject.head ? pack.subject.head.slice(0, 12) : 'none';
  lines.push('Dairn context pack (' + pack.schema + ')');
  lines.push('Query: ' + (pack.query || '(none)') + '  terms=[' + pack.query_terms.join(',') + ']');
  lines.push('Subject: head ' + head + (pack.subject.base_commit ? ' base ' + pack.subject.base_commit.slice(0, 12) : '')
    + ' workspace ' + pack.subject.workspace);
  if (pack.focus) lines.push('Focus: ' + pack.focus.name + (pack.focus.suggested_capabilities.length ? ' [' + pack.focus.suggested_capabilities.join(',') + ']' : ''));
  lines.push('Status: ' + pack.status);
  if (pack.symbols.length > 0) {
    lines.push('Symbols:');
    for (const symbol of pack.symbols.slice(0, 12)) lines.push('  ' + symbol.path + ' — ' + symbol.symbol + ' (' + symbol.module + ')');
  }
  if (pack.text_matches.length > 0) {
    lines.push('Text matches:');
    for (const hit of pack.text_matches.slice(0, 8)) lines.push('  ' + hit.path + ':' + hit.line + ' — ' + hit.text.slice(0, 100));
  }
  if (pack.relations.matches.length > 0) {
    lines.push('Contracts (explicit relations):');
    for (const binding of pack.relations.matches.slice(0, 8)) lines.push('  ' + binding.spec_id + ' -> ' + binding.symbol.path + '#' + binding.symbol.name + ' tests=' + binding.tests.length);
  }
  if (pack.documents.specs.length > 0) {
    lines.push('Specs:');
    for (const spec of pack.documents.specs.slice(0, 6)) lines.push('  ' + spec.id + ' (' + spec.path + ')');
  }
  if (pack.documents.notes.length > 0) {
    lines.push('Notes:');
    for (const note of pack.documents.notes.slice(0, 6)) lines.push('  ' + note.path + ' — ' + note.title);
  }
  if (pack.history.commits.length > 0) {
    lines.push('History:');
    for (const commit of pack.history.commits.slice(0, 6)) lines.push('  ' + commit.sha.slice(0, 8) + ' ' + commit.date + ' ' + commit.subject);
  }
  const change = pack.change;
  if (change && change.status !== 'not-requested') {
    lines.push('Change: ' + change.status + ' — ' + change.counts.changes + ' impacts'
      + (change.downstream_modules.length ? '; downstream: ' + change.downstream_modules.join(',') : ''));
  } else lines.push('Change: not requested');
  lines.push('Governance: ' + pack.governance.status + (pack.governance.plan_status ? ' (' + pack.governance.plan_status + ', ' + pack.governance.gaps.length + ' gaps)' : ''));
  lines.push('Verification: ' + pack.verification.status + ' — ' + pack.verification.note);
  lines.push('Analysis plan: ' + pack.analysis_plan.status + (pack.analysis_plan.summary ? ' (' + pack.analysis_plan.summary.needs + ' needs, ' + pack.analysis_plan.summary.gaps_required + ' required gaps)' : ''));
  for (const decision of (pack.analysis_plan.decisions || [])) lines.push('  ' + decision.capability + ' -> ' + decision.action + ' [' + decision.reason + ']');
  if (pack.minimal_files.length > 0) {
    lines.push('Minimal files:');
    for (const file of pack.minimal_files) lines.push('  ' + file.path + ' (' + file.reasons.join('; ') + ')');
  }
  for (const item of pack.unknowns) lines.push('UNKNOWN ' + item.kind + ': ' + item.detail);
  lines.push('Provenance: ' + pack.provenance.sources.join(',') + ' (precision ' + pack.provenance.precision + ')');
  lines.push('Note: ' + pack.provenance.note);
  return lines.join('\n');
}

export {DEFAULT_LIMIT, MAX_LIMIT};
