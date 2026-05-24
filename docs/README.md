# Documentation Map

This file declares documentation trust boundaries for LiquidAIty.
Full markdown-system audit: `docs/DOCUMENTATION_SYSTEM_AUDIT.md`.

## Hierarchy Of Truth
1. `.specify/memory/constitution.md`  
   Highest-level Spec Kit governance for spec-driven development.
2. `AGENTS.md`  
   Hard coding-agent operating rules for this repo.
3. `SOUL.md`  
   Assistant/persona behavior and communication rules.
4. `docs/architecture.md`  
   Canonical technical architecture.
5. `docs/runbooks/full-stack-dev.md`  
   Canonical local run/verify workflow.
6. `specs/*`  
   Feature-level specifications, plans, and tasks.
7. `.agents/skills/*`  
   Spec Kit / Codex skill commands. Generated or tool-managed unless explicitly edited.
8. `CLAUDE.md` and optional `.claude/*`  
   Claude/Anthropic adapter instructions that point back to canonical hierarchy.
9. `docs/decisions/*`  
   Architecture Decision Records (ADRs).
10. `docs/old/*`  
    Historical docs only; not current truth unless explicitly referenced.
11. External subtree docs  
    Source-project docs only; they do not override LiquidAIty architecture.

## Canonical Docs (LiquidAIty Truth)
- `SOUL.md`
- `AGENTS.md`
- `CLAUDE.md`
- `policy.md`
- `docs/architecture.md`
- `docs/runbooks/full-stack-dev.md`
- `docs/AGENT_RUNTIME_README.md`
- `docs/README.md` (this map)
- `docs/decisions/*` (ADRs and ADR index)

Use these first for implementation and governance decisions.

## Spec Kit Docs (Generated/Spec Workflow)
- `.specify/memory/constitution.md`
- `.specify/templates/*`
- `.specify/scripts/*`
- `specs/*` (feature specs, plans, tasks)

These govern spec-first workflow and feature-level intent, not runtime code truth by themselves.

## Historical Docs (Do Not Delete Yet)
- `docs/old/*`
- `ROOT_REPO_OPERATING_GUIDE.md`
- `launch-readiness.md`
- `MEMORY.md`
- `CODE.md`
- `repo-map.md`

Treat as context/history unless explicitly promoted back to canonical.

## External Subtree Docs (Scoped to Their Source Projects)
- `Understand-Anything-main/**`
- `localcoder/**`
- `worldsignal/**`
- `data-formulator-main/**`
- `gamecanvas/**`
- `motioncanvas/**`
- `spatialcanvas/**`
- `videocanvas/**`
- `services/**` (service-local docs)

These do not override LiquidAIty architecture or runtime policy.

## Architecture vs Specs Rule
- `docs/architecture.md` is canonical for system architecture truth.
- `specs/*` define feature intent, planning, and tasks.
- Specs must link to canonical docs instead of duplicating them.
