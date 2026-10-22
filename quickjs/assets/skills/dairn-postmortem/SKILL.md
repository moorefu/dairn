---
name: dairn-postmortem
description: Use for SEV1/SEV2 incidents or voluntarily requested incident reviews; create an evidence-grounded blameless postmortem and track corrective actions with owners and verification.
dairn-stage: stable
disable-model-invocation: true
---

# Evidence-led Postmortem

Read `dairn.operations.incident`, load the Incident record and existing evidence. Create `docs/postmortems/<INC-ID>.md` by hand with the seven-section template (Summary, Impact, Timeline, Contributing factors, Detection and response, Corrective actions, Verification); there is no CLI initializer and template correctness is not machine-proven, so run `dairn validate` after writing. Populate verifiable summary, user impact, chronology including uncertainty, contributors, detection effectiveness, response and specific actions. Do not invent logs, RCA or approvals. Distinguish observed facts from hypotheses, and mark gaps explicitly.

Assign corrective actions with stable ACT IDs, owners and future verification steps; link each action to the Incident. Review SLO/alerting blind spots, regression tests, failure containment, rollback and documentation. The `reviewed` incident state is not proof of independent human review; require actual review in GitHub/GitLab/incident management tool. If corrective work involves a durable architecture or process choice, create a separate Agent Note linked to the Incident; don't put operational chronology in Notes. Close only when formal artifact + evidence + action tracking are present, not when every long-term Action is already done.
