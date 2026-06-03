<!--
Sync Impact Report
- Version change: 1.2.2 -> 1.3.0
- Modified principles: 4. Spec Kit Lifecycle Governance -> 4. Spec Kit Lifecycle Governance
- Modified principles: 8. Documentation Minimalism -> 8. Documentation Minimalism
- Modified principles: 9. Runtime Truth Comes From Code -> 9. Runtime Truth Comes From Code
- Added sections: Governance Metadata, Compliance
- Removed sections: none
- Templates requiring updates:
  - ✅ updated: .specify/templates/plan-template.md
  - ✅ updated: .specify/templates/spec-template.md
  - ✅ updated: .specify/templates/tasks-template.md
  - ✅ updated: docs/README.md
- Follow-up TODOs: none
-->

# LiquidAIty Constitution

## Governance Metadata
- Constitution Version: `1.3.0`
- Ratification Date: `2026-05-24`
- Last Amended Date: `2026-06-02`

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
Default work flow is intent inversion, Code-Based Memory MCP, inverse audit, safe slice
implementation, validation, and a final report. Spec Kit is optional heavy-mode, not mandatory for
every meaningful task. Spec Kit MUST be used when a spec clearly reduces risk, especially for
major new features, schema or database changes, runtime architecture changes, user-facing behavior
contracts, or multi-step work with non-obvious sequencing or scope risk. When heavy-mode is used,
agents MUST create or update the closest relevant spec folder and keep `spec.md`, `plan.md`, and
`tasks.md` current while avoiding duplicate specs and speculative sprawl for untouched systems.

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
Audits are required before implementation. Temporary audit notes belong in implementation reports.
Audit findings MUST be routed to the closest living source of truth (`specs/*`, `docs/decisions/*`,
`docs/runbooks/*`, `docs/architecture.md`, `AGENTS.md`, `SOUL.md`, or matching `.skills/*`).
Standalone audit Markdown files are not the default. Historical audit files must be moved to
`docs/old/` or deleted after durable findings are extracted unless explicitly kept by user choice.
New Markdown files are allowed only when they have clear owner/purpose, correct folder, durable
value, no better existing home, and scoped content.

## 9. Runtime Truth Comes From Code
Docs/specs must not claim behavior that is not implemented and validated. Uncertainty MUST be
stated explicitly.
Honest loading states, explicit diagnostics, error reporting, and hard failures are allowed when
they reflect real runtime status. Lazy loading, loading states, error boundaries, retries,
diagnostics, and explicit disabled or unavailable states are allowed when they report the real
state of the system. User-facing flows MUST NOT ship fake substitute product behavior such as fake
replacement pages, mock product flows, sample data shown as real state, stub workflows presented
as live, pretend-success responses, or substitute UI that masks broken or missing implementation.
If a surface is broken or unimplemented, the correct response is to expose the real status and fix
the implementation rather than inventing alternate behavior.

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
