<!--
Sync Impact Report
- Version change: 1.0.0 -> 1.1.0
- Modified principles: all consolidated for SOUL + CLAUDE + Spec Kit alignment
- Added sections: Governance Metadata, Compliance
- Removed sections: none
- Templates requiring updates:
  - ⚠ pending: .specify/templates/plan-template.md
  - ⚠ pending: .specify/templates/spec-template.md
  - ⚠ pending: .specify/templates/tasks-template.md
- Follow-up TODOs: none
-->

# LiquidAIty Constitution

## Governance Metadata
- Constitution Version: `1.1.0`
- Ratification Date: `2026-05-24`
- Last Amended Date: `2026-05-24`

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

## 5. AutoGen Mandatory Execution
Real agent/deck/card execution MUST route through Python AutoGen when `executionBackend` is
`python_autogen`. Silent TypeScript fallback and fake success/fallback paths are forbidden.

## 6. Canvas-First Workbench
Canvases are first-class work surfaces. Chat and orchestration must remain context-aware of
project, canvas, object, and plan state.

## 7. Current Intent Over Stale Docs
Current platform intent overrides stale framing. LiquidAIty is a general AI-native platform first;
trading-only framing and Ghostfolio-style framing are historical only.

## 8. Documentation Minimalism
Documentation must stay minimal and canonical. Do not accumulate audit-note files as long-lived
repo noise. External subtree docs are scoped and do not override LiquidAIty truth.

## 9. Runtime Truth Comes From Code
Docs/specs must not claim behavior that is not implemented and validated. Uncertainty MUST be
stated explicitly.

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
