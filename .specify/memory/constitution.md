<!--
Sync Impact Report
- Version change: 1.1.0 -> 1.2.0
- Modified principles: 5. AutoGen Mandatory Execution -> 5. AutoGen Mandatory Execution
- Modified principles: 9. Runtime Truth Comes From Code -> 9. Runtime Truth Comes From Code
- Added sections: Governance Metadata, Compliance
- Removed sections: none
- Templates requiring updates:
  - ✅ updated: .specify/templates/plan-template.md
  - ✅ updated: .specify/templates/tasks-template.md
  - ✅ reviewed: .specify/templates/spec-template.md
- Follow-up TODOs: none
-->

# LiquidAIty Constitution

## Governance Metadata
- Constitution Version: `1.2.0`
- Ratification Date: `2026-05-24`
- Last Amended Date: `2026-06-01`

## 1. Sol-Centered Identity
LiquidAIty agent identity is defined in `SOUL.md`. All coding agents MUST align behavior with
Sol identity and current project intent before implementation.

## 2. Graph-Native Project Truth
LiquidAIty project truth is graph-native. Meaningful state SHOULD be represented as entities,
relationships, properties, provenance, or structured artifacts where practical.

## 3. Code-Based Memory MCP First
Before significant edits, agents MUST use Code-Based Memory MCP for discovery and impact
analysis, then confirm with targeted file inspection.

## 4. Spec Kit Lifecycle Governance
Major feature work MUST follow Spec Kit lifecycle:
`$speckit-constitution` -> `$speckit-specify` -> `$speckit-plan` -> `$speckit-tasks` ->
`$speckit-implement`.
When revisiting a meaningful subsystem, agents MUST create or update the closest relevant spec
folder and keep `spec.md`, `plan.md`, and `tasks.md` current; avoid duplicate specs and
speculative sprawl for untouched systems.

## 5. AutoGen Mandatory Execution
Real agent/deck/card execution MUST route through Python AutoGen when `executionBackend` is
`python_autogen`. Silent TypeScript fallback, fake success paths, substitute runtimes, and
fallback implementations are forbidden.

## 6. Canvas-First Workbench
Canvases are first-class work surfaces. Chat and orchestration must remain context-aware of
project, canvas, object, and plan state.

## 7. Current Intent Over Stale Docs
Current platform intent overrides stale framing. LiquidAIty is a general AI-native platform first;
trading-only framing and Ghostfolio-style framing are historical only.

## 8. Documentation Minimalism
Documentation must stay minimal and canonical. Do not accumulate audit-note files as long-lived
repo noise. External subtree docs are scoped and do not override LiquidAIty truth.
Temporary working notes must not become repo noise. Durable knowledge must be stored in specs,
architecture docs, runbooks, decisions, SOUL.md, or AGENTS.md as appropriate.
Audits are required before implementation. Temporary audit notes belong in implementation reports;
durable audit findings must be routed to canonical homes (`specs/*`, `docs/decisions/*`,
`docs/runbooks/*`, `AGENTS.md`, `SOUL.md`, matching `.skills/*`, or `docs/audits/*` for major
retrospectives with clear scope, date, owner, findings, and action items).
New Markdown files are allowed only when they have clear owner/purpose, correct folder, durable
value, no better existing home, and scoped content.

## 9. Runtime Truth Comes From Code
Docs/specs must not claim behavior that is not implemented and validated. Uncertainty MUST be
stated explicitly.
User-facing flows MUST NOT ship fallback UI, fallback data, stubs, mockups, placeholders, demo
wires, or "not ready yet" substitute surfaces as product behavior. If a surface is broken or
unimplemented, the correct response is to expose the real status, add error reporting, and fix the
implementation rather than inventing alternate behavior.

Meaningful work must use intent inversion, code/context audit, safe planning, safe 80%
implementation, validation, and a final report. Agents must make useful safe progress without
overreaching into uncertain or high-risk work.

## 10. Security And Secrets
Secrets MUST not be committed to docs or code. Secret values belong in env files or secret
managers.

## Compliance
- Required implementation report fields: files changed, tests run, risks, uncertainty, forward plan.
- Amendment policy:
  - MAJOR: breaking governance changes
  - MINOR: new principle or materially expanded constraint
  - PATCH: clarifications without policy change
- Compliance review happens during spec/plan/tasks updates and before merge.
