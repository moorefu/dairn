# Agent Note: Capability-driven lazy analyzer execution

Status: implemented

## Problem

The shipped Analyzer protocol (`.dairn/analyzers.json`, `dairn.analyzer-request.v1` / `dairn.surface-result.v1`) already treats analysis as project-owned external tools, but every entry point still required a human or Agent to choose one explicitly: `analyze run <id>` executed whatever id was typed, and `guide impact --analyzer <id>` selected a precision source by hand. The result had four gaps:

- There was no explicit model of **what evidence is needed**. When no Go/Java/TypeScript provider was configured, Dairn could not say "compatibility is unverified because no semantic provider exists"; callers inferred coverage from prose.
- Execution authorization depended on the caller remembering the right flags. Candidate, cached, needs-authorization and missing-capability states were not distinguishable in one structured output.
- Making Surface Analysis a special Core subsystem (embedded parsers or a language-specific front end) would tie Core to language and toolchain versions, enlarge the trusted execution surface, and still not cover project-private tools.
- Quality goals, trusted policy requirements and observed change had no common merge point, so the same analyzer result could be re-executed by several commands and reused by none.

## Decision

Dairn now separates **analysis needs** from **analysis execution** and owns only the decision layer. The normative contract is [the Analyzer Selection spec](../../../../quickjs/assets/specs/engineering/analyzer-selection.md).

- A fixed canonical capability namespace (`change.impact`, `symbol.definition`, `symbol.references`, `surface.api-diff`, `contract.compatibility`, `dependency.impact`, `architecture.rules`, `complexity.metrics`, `test.selection`, `test.quality`, `coverage.summary`, `security.scan`, `performance.benchmark`, `reliability.checks`) is the only coupling between a need and a provider.
- Needs declare a required precision on the ladder `text < reported < heuristic < observed-static < syntax < semantic < contract`. Providers are builtin bounded facts (`observed-static`), the explicit relation registry, project `mode=execute` analyzers (`syntax`), and project `mode=import` reports, which never satisfy execution needs.
- `dairn analyze plan` emits an advisory plan with needs, decisions, gaps and unknowns; its status distinguishes ready, authorization pending and missing capability. The default run is a dry run; only trusted policy may authorize execution, and every blocked or missing capability stays visible in the plan. Exact schema, statuses, reasons and exit codes are normative in the spec, not repeated here.
- A trusted project policy (`.dairn/governance/analysis.json`, `dairn.analysis-policy.v1`) is the only source that may auto-execute anything or add required needs. It can raise a requirement, never lower it; absent means safe defaults, invalid fails closed.
- Cached results are reused only for the same effective subject (head, base, analyzer definition digest, toolchain fingerprint, clean worktree) and stay advisory.
- Three constraints are normative: automatic discovery is not automatic installation; automatic selection is not unconditional execution; "no analyzer needed" does not waive a required check.

### Legacy adjustment mapping

`stubs.mjs` is replaced by the generic Analyzer Registry/Runner; the 11 language surface templates become optional project-owned providers rather than Core parsers; the heuristic surface scan in `facts.mjs` remains as explicitly labeled `observed-static` clues that a future provider can replace without touching Core; there is no legacy `guide impact --precision` interface (it never shipped) because selection is planner-driven, with `--analyzer`/`--capability` kept only as explicit overrides; the standalone Surface response protocol is unified into Analysis Run / Quality Observation; and interface-signature detection is now an extensible API/Contract capability rather than a fixed Surface feature.

## Alternatives considered

- **Embed language analyzers in Core** (Go AST, Java parser, TypeScript compiler wrapper, full public-interface analyzer). Rejected: Core would depend on every language toolchain and version, the trusted execution surface and release size would grow, and project-private analysis tools would still be unsupported.
- **Keep explicit command + manual `--analyzer` selection** as the only interface. Rejected: no shared need model, no explicit gap state, no safe default, and each command re-runs analyzers independently.
- **Execute every configured analyzer eagerly, without cache**. Rejected: unbounded cost and latency, and default invocation would run project commands without an authorization boundary, contradicting the read-only default.
- **Treat imported reports as on-demand providers**. Rejected: imported data is `unverified-import`; letting it satisfy required execution needs would promote untrusted evidence into a capability claim.
- **Let analyzers or agents lower required precision / required capabilities**. Rejected: untrusted sources must not reduce a trusted lower bound; this is the same fail-closed rule used by the risk policy.
- **Auto-install a missing analyzer or tool when no provider matches**. Rejected: conflicts with deterministic, offline, no-environment-mutation operation; the planner reports a gap instead.

## Consequences

Benefits: the Core boundary is now enforceable and testable (no language parsers, no shell interpolation, no network); missing evidence becomes machine-readable instead of silent; the default is no execution; valid cached results are reused across commands; and Context Intelligence, Impact Analysis, Quality Fitness and the Governance Planner share one selection layer while keeping independent evidence verdicts.

Costs and limits: precision is a class-level claim, so Dairn cannot prove an analyzer truly reached `syntax` or `semantic`; builtin facts remain heuristic and bounded, so dynamic, generated and reflection-based code can be missed; only the surface domain is executable in this release; projects take on a new policy file to unlock auto-execution; cache invalidation is conservative (a dirty worktree always invalidates); a plan is advisory and its status is never a gate verdict. Unresolved gaps and authorization requests require a human or Agent follow-up, not a fabricated pass.

Current verification: the asset gate `dairn docs check` validates the published specs and registered CLI references, and the behavioral contract is designed as deterministic test seams (need derivation, policy validation, provider matching, dry-run behavior, cache reuse/invalidation, plan schema) to be proven by the unit and integration tests in `quickjs/tests/`. Those are the checks the PR must run before merge; this Note does not itself prove that any test ran, nor that any particular analyzer is accurate.
