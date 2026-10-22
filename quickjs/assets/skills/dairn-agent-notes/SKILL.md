---
name: dairn-agent-notes
description: Use when creating, changing lifecycle state, reviewing, consolidating, or archiving durable Agent Notes, including architecture and process decisions. Enforces the Dairn note format and archive-safety workflow.
dairn-stage: stable
---

# Durable Agent Notes

## Scope and authority

Read [the Agent Note contract](../../../docs/AGENT_NOTES_SPEC.md), the current active notes, and affected production code first. Agent Notes preserve *why*, rejected alternatives, enduring guarantees, and costs. The existing code, current API docs, and tests own what executes. Never write a Note for a merely mechanical edit just to satisfy a form; Dairn's organizational L2 rule is stricter than DeepSeek Harness's creation policy, so name that policy distinction during review.

## Decide if a new Note is needed

1. Search active `implemented/`, `proposed/`, and `rejected/` notes for the same decision or mechanism. Update the existing owning note for changed factual paths/defaults; do not duplicate its rationale.
2. Select one closed class and a `YYYY-MM-DD-topic-title.md` filename. The date is the date of first proposal and stays unchanged across moves. `security` is a Dairn-only extended class.
3. Choose `proposed` for future work, `implemented` only for actual shipped behavior, or `rejected` with a one-line substantive reason.
4. Write real alternatives and why they lost. Never invent an alternative to make the checker green.
5. Keep future acceptance tasks in the change manifest/tests after implementation. Implemented Notes state present facts, costs and benefits, and current verification.

## Lifecycle transitions

- `proposed → implemented`: move the file, change status, replace Proposal with Decision, remove future-plan headings, replace acceptance/risk checklists with observed consequences and verification; review the shipped code first.
- `proposed → rejected`: move the file, add a meaningful `Status: rejected — <reason>` and freeze its rationale.
- Changes that reverse a settled decision require a NEW linked Note, not silent rewriting of the old decision. Partial supersession keeps both records linked.
- On every new Note search for fully and partially superseded decisions; consolidate only if every unique rationale and consequence survives. Review all inbound links before deletion.

## Archive and purge

Only completed `implemented` decisions can be archived. Classify by future value (ownership rules, security invariants, protocol compatibility and reintroduction conditions generally stay active), not age or length. To archive, move the original file under `archived/<class>/`, insert only `Archived: YYYY-MM-DD` directly below the `Status: implemented` line, run `make seal-archive` and `make notes-check BASE=<trusted-base>`. The CI verifier checks old manifest entries against the base commit and prevents edited old seals. Never repair links *inside* sealed notes; repair active inbound links.

Dairn v1.3 does not automatically verify content-level bilingual parity; projects requiring English/Chinese parity must add a separate gate until full triplet/section-hash support is implemented. Do not claim parity from a successful `notes-check`.

## Verify and report

Run `make notes-check BASE=<verified-base>`, then the relevant `make gate BASE=<verified-base>`. Report link changes, lifecycle changes, decision replacements, and checks actually run. Format checking cannot prove that alternatives are truthful, that a decision shipped, or that human approval happened.


## Separate operational records

Incident timelines, customer complaints, ongoing Bug tasks, Release deployments and corrective Action items are not Agent Notes. Use the lifecycle ledger and separate Postmortems for those facts. Write a new Agent Note only when investigation results in a durable architecture, process, testing or security decision; link records rather than copying chronologies.
