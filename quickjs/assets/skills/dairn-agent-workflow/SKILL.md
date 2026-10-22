---
name: dairn-agent-workflow
description: Agent-first Dairn tracked software delivery. Use when coding a multi-stage task in a Dairn project; ask Dairn for the next stage, read only the relevant skill, run actual checks, and link evidence without inventing approvals.
dairn-stage: stable
---

# Dairn Agent Workflow

You (the existing coding AI Agent) **call Dairn**. Dairn NEVER silently calls an LLM or certifies your reasoning. This Skill is a tool-use protocol, not an autonomous agent service.

1. Read project `AGENTS.md`. Obtain task ID or create via `dairn work start "<goal>" --id <safe-id>`. Read `dairn work next <id> --json` and follow its `executor`, `skill`, `inputs`, `requirements`, and `completion` fields. Load only the relevant additional `dairn-*` Skill.
2. Base claims on observed project files, authoritative Specs, and actual tests. Diagnose bugs with a red-capable signal. Respect human approvals and externally protected CI requirements.
3. Record meaningful project-owned artifacts with `dairn work record <id> <path> --kind note|spec|test|review|document`. Artifacts carry content SHA256 only; they are not CI attestations.
4. At Implement, execute `dairn check --task <id> --base <trusted-base>`. The real check execution attaches a machine run to the task. A failed run stays failed and does not advance the stage. Verify with `dairn work verify <id> --require-machine-gates` and ensure HEAD has not changed. **Never synthesize a machine run JSON** in place of actual command execution.
5. For Review, write two-axis structured findings (Standards and Spec Fidelity; no Spec means `not-applicable`). For Synchronize, call `dairn guide impact --base <trusted-base>`; optionally use project-defined `--precision <stub-id>`; review explicitly bound contracts under `.dairn/relations.json`, which are suggestions requiring review rather than semantic proof. Update the relevant documents or explain why no change is needed.
6. Move with `dairn work advance <id>` and finish with `dairn work finish <id>`, subject to the verified evidence requirements. Do not claim that a recorded-complete ledger equals protected CI success, approval, merge, or release.

For any language, a project may configure a `surface-analysis` Stub in `.dairn/stubs.json`. Dairn does not bundle a language parser, and precision remains a project-supplied advisory result. Mark uncertainty explicitly.

## CI attestation and stage completion

Run `dairn check --task <id> --base <trusted-base>` for real machine evidence.
Protected CI may create and sign a statement with `dairn work attest-prepare`, and a verifier may attach it with `dairn work attest-attach`. Never sign with a key in the project checkout.
In Review, record JSON with `standards`, `spec_fidelity`, and `head` (the current Git commit).
In Synchronize, record JSON containing `status: updated|no-change`, `head`, `reviewed_docs`, and a meaningful `reason`. `no-change` is a reviewed judgment, not an automatic pass.
Use `dairn work verify <id> --require-ci-attestation` only where a protected signer and out-of-repository public trust key are configured. CLI cannot invent CI trust.
Provider-neutral: Codex reads AGENTS.md; Claude Code follows CLAUDE.md pointer; DeepSeek Harness discovers project `.agents/skills`. Dairn does not initiate AI calls.
