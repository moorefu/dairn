---
name: dairn-operational-feedback
description: Use when collecting production metrics, alerts, support tickets, logs, performance regressions, or deployment observations and deciding whether to open an incident, bug or corrective action.
dairn-stage: stable
---

# Run-time feedback intake

Read `dairn.governance.lifecycle`, `dairn.operations.feedback`, and `dairn.operations.traceability` via `dairn docs find` and `dairn docs show` before classifying reports. Choose one authoritative alert, support ticket or optional `FB-YYYYMMDD-NNN` record. Preserve source, owner, impact and signal references on that main record; deduplicate alert storms. Do not ingest secrets or raw identifiable data. When a separate local intake is necessary, write the record JSON by hand following `dairn.operations.traceability` and add evidence; there is no dedicated CLI command for local intake, so finish with `dairn validate`.

Check impact and urgency first. Escalate user harm / security / service outage as Incident using `dairn-incident-response`; use `dairn-bugfix` for a reproducible defect and an Action for ongoing preventive work. Cross-link existing local records by editing the `links` field in the record JSON; external tickets remain stable evidence references. If deemed duplicate or not-actionable, document why and add a reference. `linked` never means fixed. Run `dairn validate` (add `--base <ref>` for append-only checks) and report owner, record ID, triage status, signal window and missing facts without inventing a resolution.
