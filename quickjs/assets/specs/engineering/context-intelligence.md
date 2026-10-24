---
id: dairn.engineering.context-intelligence
title: Dairn Context Intelligence (Phase 1 Task-Aware Context Pack)
summary: Task-aware retrieval and context construction over project engineering memory, returning sourced paths, symbols, Specs, tests and change relations in a flat bounded pack with explicit precision, provenance and UNKNOWNs; Phase 1 adds no vector database.
kind: spec
module: engineering
keywords: ["context", "retrieval", "context pack", "engineering memory", "context intelligence", "上下文解析", "检索"]
aliases: ["Dairn Context Intelligence", "task-aware context"]
related: ["dairn.engineering.analyzer-selection", "dairn.engineering.impact-analysis", "dairn.engineering.relation-index", "dairn.docs.discovery", "dairn.engineering.project-guidance"]
symbols: ["dairn context", "dairn analyze plan", "dairn guide impact", "dairn handoff", "dairn docs find"]
---

# Dairn Context Intelligence (Phase 1 MVP)

Dairn Context Intelligence is **task-aware retrieval and context construction over project engineering memory**. Its goal is not a faster grep: it answers engineering-context questions (where is the entry, who calls it, which contract or test protects it, what changed, which least set of files must be loaded) with real paths, lines and symbols, the source SHA and precision labels. When evidence is missing it omits the item or reports an UNKNOWN; it never invents relations from name similarity, and a pack is never a Gate verdict.

## Four layers

- **L1 Text Search** — literal search delegated to `git grep` for path and line locations. Cheap, direct, never requires an index; Dairn does not reimplement a search engine.
- **L2 Code Intelligence** — bounded facts symbols, imports and module edges, the explicit relation registry, and external analyzers, LSP or SCIP results supplied through the Analyzer Selection Planner. Precision labeled.
- **L3 Engineering Memory** — Specs index, Agent Notes, ADR, contracts, tests reached through explicit relations, and Git history.
- **L4 Change Context** — the observed diff and impact report, the deterministic Governance Plan, verification state, and unresolved gaps or Evidence.

## Command contract

```sh
dairn context <query...> [--base <ref>] [--change] [--for <focus>] [--limit <1..40>] [--json] [--out <path>]
```

`--change` pulls L4 change context for the current diff and requires `--base <trusted-ref>`; without it the pack records `CHANGE_CONTEXT_UNAVAILABLE`. `--for` selects an advisory focus shaping only: `security`, `threat-analysis`, `test`, `testing`, `performance`, `architecture`, `compatibility` or `impact`. `--limit` bounds `minimal_files` and text matches (default 12, range 1..40). `--json` keeps stdout pure JSON; `--out` writes the JSON pack to a new file (an existing file is never overwritten, and the governance evidence tree is refused) while stdout still prints the pack.

The command is read-only: it reads `.dairn/lock.json` for project config and does not verify or upgrade the runtime lock. Exit codes: `0` a pack was produced with status `ok` or `partial`, `1` status `empty` (no evidence), `2` usage or configuration error. A no-evidence run reports `NO_EVIDENCE`; it never fabricates relations or items.

## Context pack schema

Flat schema `dairn.context-pack.v1` (no nested layers wrapper):

```json
{
  "schema": "dairn.context-pack.v1",
  "status": "ok|partial|empty",
  "query": "raw query string",
  "query_terms": [],
  "focus": {"name": "security", "suggested_capabilities": ["security.scan"], "note": "advisory"},
  "subject": {"head": "…", "base": "…", "base_commit": "…", "workspace": "clean|dirty"},
  "requested_change": false,
  "change": {"status": "…", "baseline_source": "…", "counts": {"changes": 0, "affected_documents": 0}, "impacts": [{"path": "…", "category": "…", "level": "…", "confidence": "…"}], "downstream_modules": [], "note": "…"},
  "text_matches": [{"path": "…", "line": 1, "text": "…", "score": 0}],
  "symbols": [{"path": "…", "symbol": "…", "language": "…", "module": "…", "score": 0, "reason": "declared-symbol-name-match"}],
  "relations": {"status": "available|absent", "source": "…", "matches": [], "explicit_bindings": 0, "note": "…"},
  "documents": {"specs": [{"id": "…", "path": "…", "score": 0}], "notes": [{"path": "…", "title": "…", "date": "…", "score": 0}], "scanned_notes": 0},
  "history": {"available": true, "commits": [{"sha": "…", "date": "…", "subject": "…"}], "scanned": 0, "matched": 0},
  "governance": {"status": "not-requested|ready|unavailable", "plan_sha256": null, "plan_status": null, "requirements": [], "gaps": []},
  "verification": {"status": "executed-at-head|stale|unknown|not-executed|unavailable", "local_observed": 0, "stale": 0, "unknown": 0, "note": "…"},
  "analysis_plan": {"schema": "dairn.analyzer-plan.v1", "status": "…", "summary": {}, "decisions": [], "gaps": [], "unknowns": [], "limitations": []},
  "minimal_files": [{"path": "…", "score": 0, "reasons": []}],
  "unknowns": [{"kind": "MISSING_CAPABILITY", "detail": "…"}],
  "provenance": {"head": "…", "base_commit": "…", "generated_at": "…", "sources": ["git", "project-facts", "assets-manifest", "explicit-relations", "handoff-local-history"], "precision": "observed-static+text", "note": "…"},
  "limitations": [],
  "pack_sha256": "…"
}
```

`status` is `ok` when evidence exists and no UNKNOWN remains, `partial` when evidence exists with one or more UNKNOWNs, and `empty` when no layer produced a citable location. `change` is `{"status": "not-requested"}` without `--base`. `analysis_plan` embeds a full dry-run `dairn.analyzer-plan.v1` (always `apply: false`); it does not become a gate verdict. `governance` restates the deterministic Governance Plan when `--base` is given and uses the same trusted policy at HEAD; `verification` restates local handoff evidence only, never trusted CI. `pack_sha256` is deterministic over the pack minus `pack_sha256` and `provenance.generated_at`.

## Unknown kinds

The pack emits exactly these kinds: `OPAQUE_SOURCE`, `NO_EVIDENCE`, `TEXT_SEARCH_UNAVAILABLE`, `TEXT_RESULTS_TRUNCATED`, `SPEC_INDEX_UNAVAILABLE`, `NOTES_INDEX_UNAVAILABLE`, `HISTORY_UNAVAILABLE`, `CHANGE_CONTEXT_UNAVAILABLE`, `CHANGE_ANALYSIS_UNAVAILABLE`, `UNBASELINED_CHANGE`, `GOVERNANCE_UNAVAILABLE`, `VERIFICATION_UNAVAILABLE`, `MISSING_CAPABILITY`, `ANALYSIS_PLAN_UNAVAILABLE`.

## Precision, provenance and no-fabrication rules

- Text matches are always `text` precision and come from delegated `git grep`; the scan is capped at 200 matches and truncation is reported as `TEXT_RESULTS_TRUNCATED`.
- Symbols come from bounded declaration scans (`observed-static` class) or from a declared provider; symbols outside byte limits are `OPAQUE_SOURCE`.
- Relations are selected only when the observed symbol path was matched by the declaration scan: a binding from the reviewed `.dairn/relations.json` registry is explicit reviewed evidence, and Dairn never infers bindings from name similarity.
- No layer may state semantic claims, compatibility conclusions or gate verdicts from heuristic evidence.
- Missing evidence is reported in `unknowns`; it is never guessed, and a gap is never reported as a pass.
- An empty pack means "no citable evidence", not a positive answer.
- The pack is advisory. It does not replace real checks, trusted governance or human review.

## Bounds and performance rules

- `minimal_files` and `text_matches` are bounded by `--limit` (default 12, maximum 40); Spec documents at most 8; Agent Notes hit at most 10; symbols at most 40; relation matches at most 20; change impacts at most 40; downstream modules at most 20; Git history at most 10 commits out of the last 60.
- The Agent Notes scan walks at most depth 3 and 200 files; unreadable or oversized files are skipped, not guessed.
- Output is deterministic and stable-ordered; the same observed state yields the same pack.
- Simple literal queries are answered directly by L1 with no mandatory index and no vector database.
- Semantic or vector retrieval is a future optional provider validated by real tasks; it is not part of this MVP.
- Dairn does not take over the agent's search loop or tool permissions.

## Relationship to existing commands

`docs find` returns Spec metadata, `docs show` loads one full Spec, `guide impact` reports conservative change impact, `handoff` renders a read-only takeover summary, and `analyze plan` derives capability needs, reuse and execution authorization. `context` composes these sources with precision labels and explicit unknowns; it duplicates no rule and replaces no command or gate.

## Non-goals (Phase 1)

- No vector database, embedding index or semantic retrieval claim.
- No bundled LSP, SCIP or language parser in Core; external code intelligence arrives through analyzer selection (Phase 2).
- No takeover of agent tool permissions, and no mandatory repository-wide index.
- No gate verdict and no trust promotion of imported or heuristic evidence.

## Measurement plan (planned evaluation, not measured results)

A/B real engineering tasks: A uses native rg, read, git and LSP; B uses the same tools plus Dairn Context Intelligence. Metrics: time-to-first-correct-edit-location, relevant-Spec and relevant-test discovery rate, agent tool-call count, context token usage, stale or incorrect relation rate, missed-test rate, and extra index cost and latency. Adversarial cases: same-name functions, dynamic dispatch, generated code, stale ADR, missing SCIP index, and uncommitted workspace changes.

Current facts, not claims of superiority: the heuristic scan in facts.mjs caps at 500 source files and 128 KiB per file; module impact propagation is bounded; Dairn currently cannot claim search superiority over ripgrep, LSP or Sourcegraph.

## Phases

- **Phase 1 (this PR)** — Context Resolver MVP returning sourced paths, symbols, Specs, tests and change relations.
- **Phase 2** — Analyzer Code Intelligence: external index or AST through the Analyzer Selection Planner.
- **Phase 3** — Engineering Memory Retrieval: ADR, Git, Incident, Quality Fitness, Refactor Contract and Evidence with staleness judgment.
- **Phase 4** — Agent Harness integration: minimal context packs on demand for Claude Code and Codex; Dairn does not take over their tool permissions.
