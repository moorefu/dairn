---
id: dairn.engineering.relation-index
title: Explicit Spec-to-Symbol-to-Test-to-Document relation index
summary: A project-owned reviewed relationship registry and optional project-supplied analyzer Stubs enrich static impact hints without claiming semantic proof.
kind: spec
module: engineering
keywords: ["spec symbol", "relations", "project stub", "impact analysis"]
aliases: ["project relation graph"]
related: ["dairn.engineering.impact-analysis", "dairn.engineering.project-guidance"]
symbols: ["dairn guide impact", ".dairn/relations.json"]
---

# Explicit Relation Index

Optional project-owned `.dairn/relations.json`:

```json
{
  "schema": 1,
  "bindings": [
    {
      "spec_id": "project.auth",
      "symbol": {"path": "hello.go", "name": "Greeting"},
      "tests": ["hello_test.go"],
      "docs": ["docs/PROJECT_GUIDE.md"]
    }
  ]
}
```

Every explicit binding must reference an observed public symbol, existing authoritative Spec ID, existing tests and documents, and safe unsymlinked paths. Dairn rejects malformed, stale, or duplicated bindings. These links assert design intent; they do not prove code implements the Spec. Source-pattern matching alone never creates an explicit relationship.

`dairn guide impact --base <trusted-ref>` reads the **base revision** relation registry when present, not a replacement submitted in the same PR. This prevents a proposed registry edit from silently erasing existing affected contract links. This still is not a proof of semantic compliance.

## Optional project Stub precision

For higher precision the **project** configures `.dairn/stubs.json`, and calls `dairn guide impact --base <trusted-ref> --precision <stub-id>`. Dairn Core executes a safe argv Stub protocol and validates structured results; it does not embed Go or any other language's parser. A reference Go AST Stub is available only in the source archive under `examples/stubs/go-surface/main.go`. Each project chooses, verifies and versions its own analyzer and toolchain. Missing, failed or malformed requested precision must fail closed. These results remain static analysis hints, not typed compatibility proof or Spec Fidelity approval.
