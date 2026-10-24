---
id: dairn.engineering.analyzer-selection
title: Capability-Driven Analyzer Selection and Lazy Execution
summary: Dairn deterministically derives analysis needs, matches project-declared providers at the required precision floor, reuses valid cached results and only executes policy-allowlisted bounded read-only analyzers; Core keeps no language-specific engine and every missing capability is an explicit gap.
kind: spec
module: engineering
keywords: ["analyzer selection", "capability", "precision ladder", "lazy execution", "analyze plan", "analysis policy", "分析器选择", "按需执行"]
aliases: ["Analyzer Capability-Driven Lazy Execution", "analyzer selection planner"]
related: ["dairn.engineering.portable-analyzers", "dairn.engineering.impact-analysis", "dairn.engineering.analyzers-attestation", "dairn.engineering.relation-index", "dairn.engineering.context-intelligence"]
symbols: ["dairn analyze plan", "dairn analyze run", "dairn analyzers list", "dairn guide impact"]
---

# Capability-Driven Analyzer Selection and Lazy Execution

Dairn Core contains **no language-specific deep analysis engine**: no Go AST, Java parser, TypeScript compiler wrapper or full public-interface analyzer. Core keeps the decision layer: derive analysis needs, discover project-configured providers, evaluate precision, cost, trust and permission, reuse valid results, execute only when authorized, normalize reports, bind provenance and report gaps explicitly. This applies to all Dairn analyzers; Surface Analysis is one capability, not a special subsystem. The planner output is an advisory decision record, never a Gate verdict.

## Capability catalog

Capabilities are the only coupling between a need and a provider. The catalog is lowercase dotted, stable order:

`change.impact`, `symbol.definition`, `symbol.references`, `surface.api-diff`, `contract.compatibility`, `dependency.impact`, `architecture.rules`, `complexity.metrics`, `test.selection`, `test.quality`, `coverage.summary`, `security.scan`, `performance.benchmark`, `reliability.checks`.

## Precision ladder and catalog floors

Weakest to strongest: `text` < `reported` < `heuristic` < `observed-static` < `syntax` < `semantic` < `contract`.

A need requires a precision floor; a provider declares or is assumed a class:

| Capability | Required precision |
| --- | --- |
| `change.impact`, `symbol.definition`, `dependency.impact`, `test.selection`, `performance.benchmark` | `observed-static` |
| `test.quality`, `coverage.summary`, `security.scan` | `reported` |
| `surface.api-diff`, `architecture.rules`, `complexity.metrics`, `reliability.checks` | `syntax` |
| `symbol.references`, `contract.compatibility` | `semantic` |

Builtin static facts are `observed-static`; the explicit reviewed relation registry is `observed-static` on its own axis (reviewed, not semantic proof); project execute analyzers are assumed `syntax`; import reports carry their own class but never satisfy an on-demand execution need. Precision is a class claim, not measured proof: Dairn cannot verify that a provider really reached it.

## Provider model

| Provider | Capabilities | Precision | Execution |
| --- | --- | --- | --- |
| `builtin:static-facts` | `change.impact`, `symbol.definition`, `dependency.impact` | `observed-static` | never executes project binaries; serves already-observed bounded facts |
| `builtin:relations` | `change.impact`, `test.selection` | `observed-static` | reads explicit `.dairn/relations.json` bindings |
| project analyzer, `mode=execute` | declared `capabilities` in `.dairn/analyzers.json`; `domain=surface` defaults to `surface.api-diff` | `syntax` | may run on demand, bounded and read-only, only after authorization |
| project analyzer, `mode=import` | declared capabilities | per report | never selected as an on-demand provider; `unverified-import` observations for Quality Fitness only |

Only the `surface` domain is executable in this release. Selection picks the cheapest provider that meets the required floor: builtin before analyzer, then policy-allowlisted, then smaller declared timeout, then provider id. No matching provider is a gap `NO_PROVIDER`; a provider below the floor is a gap `PRECISION_INSUFFICIENT`. A required need is never silently skipped.

## Trusted analysis policy

`.dairn/governance/analysis.json` is optional; schema `dairn.analysis-policy.v1`. Unknown top-level keys and unknown `required` entry keys are rejected (fail closed), and a symlinked policy path is refused.

```json
{
  "schema": "dairn.analysis-policy.v1",
  "auto_execute": ["py-surface"],
  "max_timeout_seconds": 120,
  "reuse": true,
  "required": [
    {"capability": "contract.compatibility", "when": "surface-change"}
  ]
}
```

- `auto_execute`: analyzer ids allowed to run autonomously under `--apply`; each id must name a configured `mode=execute` analyzer, and unrecognized ids surface as plan unknowns (`UNCONFIGURED_AUTO_EXECUTE`) instead of being honored. Default `[]`: nothing auto-runs.
- `max_timeout_seconds`: integer 1..300, default 120.
- `reuse`: boolean, default true.
- `required`: at most 16 entries `{capability, when, precision?}`; `when` is `always`, `change`, `surface-change` or `downstream-change`. The optional `precision` extension may only **raise** that capability's catalog floor.

An absent file means the safe default: `auto_execute: []`, `reuse: true`, 120 seconds, no extra needs. Where keys are present, project values override the defaults; an invalid file fails closed as a usage/configuration error (exit code 2) and is never silently replaced by defaults. Policy can only add needs or raise floors: it can never lower a catalog requirement, and no analyzer can reduce a trusted policy requirement.

## Derive analysis needs

Derivation is deterministic and never calls a model. From changed modules, public-surface changes, downstream modules, matched observed symbols, trusted quality goals and policy:

- Any observed change → `change.impact` **required**, plus `test.selection` advisory.
- Public-surface change → `surface.api-diff` **required**.
- Source-layout-only change → `surface.api-diff` **advisory**, not required.
- Observed downstream modules greater than zero → `contract.compatibility` **required**.
- Query or symbol evidence → `symbol.definition` **required**; `symbol.references` **required** only on reference intent (`--capability symbol.references`, or query terms such as reference, caller, used by, 引用, 调用).
- A quality goal with `enforcement: required` maps its objective to the required capability; an advisory goal becomes an advisory need.
- `policy.required` entries with `when` satisfied add or raise needs; `--capability` filters derivation to one capability.

Needs carry `id` (`need-N`), `capability`, `priority` (`required` or `advisory`), `required_precision`, `scope` (`paths` at most 50, `modules` at most 20) and `reasons` (at most 12).

## Plan contract

```sh
dairn analyze plan [--base <ref>] [--task <text>] [--capability <cap>] [--apply] [--json] [--out <path>]
```

`--task` is an advisory label only; it is not resolved as a work or task id. `--capability` filters needs. Default invocation is a dry run: no tool executes, including allowlisted analyzers. `--apply` executes only allowlisted, read-only execute-mode providers within the timeout budget. `--json` keeps stdout pure JSON; `--out` writes the same JSON to a new file (an existing file is never overwritten) and does not change stdout.

Output schema `dairn.analyzer-plan.v1`:

```json
{
  "schema": "dairn.analyzer-plan.v1",
  "subject": {"head": "…", "base": "…", "base_commit": "…", "workspace": "clean|dirty"},
  "policy": {"source": "project|default", "path": "…", "auto_execute": [], "max_timeout_seconds": 120, "reuse": true, "required": []},
  "capability_filter": null,
  "needs": [{"id": "need-1", "capability": "surface.api-diff", "priority": "required", "required_precision": "syntax", "scope": {"paths": [], "modules": []}, "reasons": []}],
  "decisions": [{"need_id": "need-1", "capability": "surface.api-diff", "required_precision": "syntax", "priority": "required", "provider": {"id": "…", "kind": "builtin|analyzer", "precision": "…"}, "precision": "…", "action": "builtin|reuse|execute|request-authorization|gap", "reason": "…", "detail": "…", "from_cache": false, "run_status": "…", "run_id": "…"}],
  "providers": [{"id": "…", "kind": "builtin|analyzer", "precision": "…", "domain": "surface"}],
  "summary": {"needs": 0, "reuse": 0, "execute": 0, "builtin": 0, "request_authorization": 0, "gaps": 0, "gaps_required": 0, "unknowns": 0},
  "status": "ready|needs-authorization|missing-capability",
  "note": "advisory selection; never a gate verdict",
  "gaps": [{"need_id": "…", "capability": "…", "priority": "required", "reason": "NO_PROVIDER|PRECISION_INSUFFICIENT|EXECUTION_FAILED", "detail": "…"}],
  "unknowns": [{"kind": "…", "detail": "…"}],
  "limitations": [],
  "generated_at": "…",
  "plan_sha256": "…"
}
```

`subject` binds the observed head and base commit and whether the workspace is clean; `providers` is the sorted view of discovered providers. `note` and `limitations` state the advisory status and known limits. `plan_sha256` is deterministic over the plan minus `plan_sha256` and `generated_at`.

Decision reasons are lowercase for satisfied/bounded states: `builtin-provider`, `cached-result-reused`, `auto-execute-allowlisted`, `executed`; and uppercase for blocked or failed states: `AUTO_EXECUTE_NOT_ALLOWED`, `TIMEOUT_EXCEEDS_POLICY`, `NO_PROVIDER`, `PRECISION_INSUFFICIENT`, `EXECUTION_FAILED`. Authorization and timeout blocks appear as `decision.reason`, not as capability gaps.

Plan unknown kinds: `GIT_UNAVAILABLE`, `CHANGE_ANALYSIS_UNAVAILABLE`, `UNBASELINED_CHANGE`, `QUALITY_GOALS_UNAVAILABLE`, `RELATIONS_UNAVAILABLE`, `NO_ANALYSIS_NEED`, `ANALYZER_CONFIG_UNAVAILABLE`, `UNCONFIGURED_AUTO_EXECUTE`. There is no `unknown` status: when Git is absent the plan stays `ready` or `needs-authorization` and records `GIT_UNAVAILABLE`.

Exit codes: `0` plan ready; `3` needs authorization or missing capability; `2` usage or configuration error.

## Reuse, invalidation and authorization

A result may be reused only when `policy.reuse` is true and a cached result exists for the same effective subject: analyzer config, source digest, toolchain fingerprint, subject/base and a clean working tree. Reuse keeps the cached provenance, is labeled as a local cache and never re-executes the tool; a dirty workspace invalidates the cache. Analyzer results are advisory observations: they may be reused as evidence inputs but never become Gate verdicts. `--apply` records `execute` with `run_status` and `run_id`, or an explicit gap `EXECUTION_FAILED`; it never runs an analyzer that is not both allowlisted and within the timeout budget.

## Three hard constraints

1. **Automatic discovery is not automatic installation.** Dairn may inspect existing tools, registries and templates, but must never install dependencies, download binaries or mutate the environment without explicit authorization.
2. **Automatic selection is not unconditional execution.** Only allowlisted, bounded, read-only execute analyzers may auto-run. Build scripts, untrusted project commands, networked analysis, or anything that may modify sources requires explicit authorization or isolation.
3. **"No analyzer needed" does not waive a required check.** When trusted governance requires compatibility or verification, a missing analyzer yields `MISSING_CAPABILITY`/`UNKNOWN`, never a silent success.

## Relationship to other contracts

The Analyzer Selection Planner is a shared base capability used by Context Intelligence, Impact Analysis, Quality Fitness and the Governance Planner: unified selection, lazy execution, shared results, independent evidence verdicts. [Portable Analyzers](portable-analyzers.md) defines the analyzer config and request/response protocol; [Analyzer Attestation](analyzers-attestation.md) defines run, cache and CI evidence boundaries; [Impact Analysis](impact-analysis.md) produces the bounded observed change that feeds needs; [Relation Index](relation-index.md) is the explicit registry provider; [Context Intelligence](context-intelligence.md) embeds a dry-run plan in every context pack.

Core never becomes an analysis engine. Any future language analyzer is a project-configured provider selected through this contract, not a parser embedded in Dairn.
