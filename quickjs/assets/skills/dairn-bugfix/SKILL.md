---
name: dairn-bugfix
description: Use when a defect is reported by tests, production signals, incidents or customers; reproduce, implement a minimal fix, prove regression, trace release deployment and observation before closing.
dairn-stage: stable
---

# Defect remediation loop

Read `dairn.operations.defect` and `dairn.operations.traceability` and activate relevant `dairn-stack-*` skills. First locate an existing Issue, ticket or `BUG-YYYYMMDD-NNN` record as the single defect owner. Do not create a duplicate BUG/FB/INC record unless its independent lifecycle requires one. Link the originating Feedback/Incident only when those records exist. Confirm environment, affected releases, expected/actual behavior, reproduction path and root-cause confidence. Capture a negative test before the fix where possible; explain when reproduction is probabilistic or unavailable.

Use the ordinary Dairn design/implementation flow, real Makefile checks and PR/MR review. In the owning Issue/BUG record keep reproduction, fix reference and verification evidence; local `BUG` fields `details.reproduction`, `details.fix_ref`, and `details.verification_ref` apply only when a local record is selected. Record a regression test that would have caught the issue and update the current technical Spec only where behavior changed. Create an Agent Note only for a durable new design decision, not for every bug. State `fixed` only for verified code; for production bugs require an actual Release link and post-deployment signal before `closed`. On recurrence reopen with new evidence; do not erase prior history.

## Tight feedback before hypotheses

Follow `dairn.engineering.feedback` and `dairn-tdd`: try to create a **red-capable command** that reproduces this exact symptom (unit, network fixture, event replay, differential harness). Minimise the failing input before generating several falsifiable hypotheses and instrumenting one variable at a time. State the actual red evidence, expected outcome, environment and bounded repetition. If production restoration precedes repro or a reproducible loop is unavailable, record the gap and use authorized recovery; do not invent success. Preserve a real green signal and run original unminimised scenario after the change. Keep data/secret redaction throughout.

## Red-capable diagnosis

Start from one executable reproduction that fails on the observed bug and passes once fixed; record exact command, output and test seam. Prefer tight public-interface probes over speculation; instrument or reduce a failing case if the original reproduction is noisy. After green, capture the unchanged probe and a regression test. Redact secrets in any evidence.
