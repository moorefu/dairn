# Agent Note: Context Intelligence Phase 1 — task-aware context packs

Status: implemented

## Problem

Coding agents and humans repeatedly spend context on broad search-and-read loops. Existing Dairn entry points are single-purpose: `docs find` returns Spec metadata only, `guide impact` returns conservative change hints, `handoff` renders a read-only takeover summary, and `analyze plan` reports capability needs and authorization. None of them answers, in one deterministic artefact, the question an agent actually has: *where is the entry point, who calls it, which contract or test protects it, what changed, and which least set of files must I load?* Callers also lack a uniform place to see provenance and gaps, so they infer relations from name similarity or trust stale memory. At the same time, a vector-search rewrite would add index cost, staleness and unverifiable semantic claims before any measured benefit exists.

## Decision

Phase 1 ships `dairn context`, a task-aware resolver returning a bounded, sourced context pack. The normative contract is [the Context Intelligence spec](../../../../quickjs/assets/specs/engineering/context-intelligence.md).

- The pack (`dairn.context-pack.v1`) composes four layers: L1 Text Search (delegated `git grep`, no index required), L2 Code Intelligence (facts symbols/imports/module edges, explicit relation registry, external analyzers/LSP/SCIP through the Analyzer Selection Planner), L3 Engineering Memory (Specs index, Agent Notes, ADR, contracts, tests via explicit relations, Git history), and L4 Change Context (diff/impact, Governance Plan, verification state, gaps/Evidence).
- Every item carries a precision label and its source SHA/provenance. Text matches are always `text`; heuristic layers never state semantic claims. Identity matches must be exact-ish (id, symbol, path), never a name-similarity Spec binding.
- Missing evidence is explicit: typed UNKNOWN entries cover missing capability, unavailable text search/history/governance, unbaselined change and other gaps; the normative kind list lives in the spec.
- Bounds keep the pack cheap and stable: a user-selectable `--limit` for minimal files and text matches, plus fixed caps for Specs, notes, symbols, relations, history and change impacts; ordering is deterministic (exact limits are normative in the spec).
- Simple literal queries bypass heavy retrieval and answer directly from L1. There is no mandatory repository-wide index and **no vector database in this MVP**. Semantic retrieval is deferred to a future optional provider validated by real tasks.
- Output is advisory: a pack is not a gate verdict, does not replace real checks, and Dairn does not take over the agent's search loop or tool permissions.
- Exit codes distinguish a produced pack (including partial), no evidence, and usage/configuration errors; the exact contract is normative in the spec. The goal is explicitly *not* a faster grep; the measurement plan compares native rg/read/git/LSP against the same tools plus this resolver on real tasks.

## Alternatives considered

- **Build the vector database and embedding index now.** Rejected: no measured task benefit yet, plus index build cost, extra dependency, staleness, and semantic claims Dairn cannot verify. Deferred as an optional future provider.
- **Extend `handoff` to carry task context.** Rejected: handoff is a read-only takeover summary for a different consumer; mixing retrieval layers would bloat it and blur two contracts.
- **Extend `docs find` to return code symbols and specs.** Rejected: `docs find` must stay a cheap Spec-metadata entry point; injecting code intelligence would make it slower and less predictable.
- **Reproduce the agent's search loop or expose a tool API it must call.** Rejected: Dairn does not own the harness or its permissions; it should produce evidence the agent chooses to load.
- **Require a prebuilt repo-wide index for every query.** Rejected: violates the "no mandatory index" rule and makes simple literal lookup slower than rg.
- **Heuristically bind Specs to symbols from name similarity.** Rejected: produces exactly the plausible-but-wrong relations the pack exists to avoid; only explicit reviewed relations may bind.

## Consequences

Benefits: one deterministic artefact answers the placement/coverage question with real paths, lines, symbols and provenance; gaps are visible instead of guessed; agents can load a minimal file set; the pack reuses existing facts, relation registry, impact report, governance and plan rather than creating a second knowledge store; and there is no new infrastructure dependency.

Limits and unverified claims: the pack cannot state semantic compatibility or ownership it cannot observe; same-name functions, dynamic dispatch, generated code and reflection may be missed; text matches are literal and may be noisy; a stale ADR or stale explicit relation is reported as stored (with precision) rather than silently corrected; the heuristic scan in `facts.mjs` is capped at 500 source files and 128 KiB per file and module impact propagation is bounded; and Dairn currently cannot claim search superiority over ripgrep, LSP or Sourcegraph. Phase 2 (external index/AST through the planner), Phase 3 (staleness judgment over engineering memory) and Phase 4 (harness integration for Claude Code/Codex) remain future work. The measurement plan in the spec is planned evaluation, not measured results.

Current verification: the asset gate `dairn docs check` validates the spec and its registered CLI references; behavioral coverage (pack determinism, bounds, unknown handling, provenance) belongs to the unit and integration tests in `quickjs/tests/` that the PR must run. This Note does not itself prove a test ran.
