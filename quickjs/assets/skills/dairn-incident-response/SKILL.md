---
name: dairn-incident-response
description: Use during production incidents, outages, data-integrity risks, security events, rollback or failover; preserve operational timeline and drive recovery, postmortem and corrective actions.
dairn-stage: stable
---

# Incident response and learning

Read `dairn.operations.incident` and `dairn.governance.lifecycle`. First identify risk and incident owner, use the existing incident service / ticket as the primary record, or create `INC-YYYYMMDD-NNN` only if a separate local record is required; keep severity, impact, timeline and any source feedback. For an active severe failure prioritize authorized containment, safety and restoration; do NOT wait for repo PR/CI or documentation before emergency response. Dairn's local commands cannot operate production, approve changes, or fetch dashboards.

Record observations and evidence references as events, identify known unknowns, mitigation and rollback results, then move through detected/mitigating/monitoring/resolved. Separate restored availability from permanent correction. Link relevant Bug/Release evidence or external references when they exist; do not force all five record types. Track monitoring gaps and necessary Action owners. For SEV1/SEV2 invoke `dairn-postmortem`; require `reviewed` before `closed`. Reopen when recurrence proves a resolution unsafe. Review tests, alert coverage, feature flag defaults, runbook gaps, and trace which corrective actions remain unfinished. Do not ascribe blame or fabricate timestamps.
