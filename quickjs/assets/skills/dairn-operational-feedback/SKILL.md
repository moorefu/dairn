---
name: dairn-operational-feedback
description: Use when collecting production metrics, alerts, support tickets, logs, performance regressions, or deployment observations and deciding whether to open an incident, bug or corrective action.
dairn-stage: stable
---

# Run-time feedback intake

Read `dairn.governance.lifecycle`, `dairn.operations.feedback`, and `dairn.operations.traceability` via `make docs-find` and `make docs-show` before classifying reports. Choose one authoritative alert, support ticket or optional `FB-YYYYMMDD-NNN` record. Preserve source, owner, impact and signal references on that main record; deduplicate alert storms. Do not ingest secrets or raw identifiable data. When a separate local intake is necessary, use `make lifecycle-create RECORD_ID=... SOURCE=... TITLE=... OWNER=... ACTOR=... REASON=...` and add evidence. Existing monitoring or Issue references do not require a redundant JSON record; CLI authorship claims are not verified identities.

Check impact and urgency first. Escalate user harm / security / service outage as Incident using `dairn-incident-response`; use `dairn-bugfix` for a reproducible defect and an Action for ongoing preventive work. Cross-link existing local records using `make lifecycle-link`; external tickets remain stable evidence references. If deemed duplicate or not-actionable, document why and add a reference. `linked` never means fixed. Run `make lifecycle-check` and report owner, record ID, triage status, signal window and missing facts without inventing a resolution.
