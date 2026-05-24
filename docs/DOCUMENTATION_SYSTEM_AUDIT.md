# Documentation System Audit (2026-05-24)

This audit defines the current markdown landscape and the unification path.

## Scope
- Repository root: `C:\Projects\main`
- File type: `*.md`
- Excluded from actionable count: `node_modules`, `vendor`, `.git`, `dist`, `build`, `coverage`

## Inventory Summary
- Total markdown files including dependency/vendor areas: `3917`
- Actionable markdown files in repo work areas: `187`

## Unified Hierarchy Of Truth
1. `.specify/memory/constitution.md` (governance constitution)
2. `AGENTS.md` (coding-agent operating rules)
3. `SOUL.md` (assistant/operator identity and behavior)
4. `docs/architecture.md` (canonical technical architecture)
5. `docs/runbooks/full-stack-dev.md` (canonical run/verify workflow)
6. `specs/*` (feature-level spec/plan/tasks)
7. `docs/README.md` (doc system map and trust boundaries)
8. `CLAUDE.md` and optional `.claude/*` (adapter layer only)
9. `docs/decisions/*` (ADRs)
10. `docs/old/*` and root legacy docs (historical context)
11. external subtree docs (source-project scoped only)

## What Exists Now

### Canonical LiquidAIty Docs (active truth)
- `AGENTS.md`
- `SOUL.md`
- `CLAUDE.md` (thin adapter)
- `policy.md`
- `docs/architecture.md`
- `docs/runbooks/full-stack-dev.md`
- `docs/AGENT_RUNTIME_README.md`
- `docs/README.md`
- `docs/AGENT_INSTRUCTION_MAP.md`

### Spec Kit / Generated Governance Layer
- `.specify/memory/constitution.md`
- `.specify/templates/*`
- `.specify/extensions/*`
- `.agents/skills/*`
- `specs/001-liquidaity-spec-governance/{spec.md,plan.md,tasks.md}`

### Historical / Legacy (keep, but do not treat as source of truth)
- `ROOT_REPO_OPERATING_GUIDE.md`
- `launch-readiness.md`
- `MEMORY.md`
- `CODE.md`
- `repo-map.md`
- `docs/old/*`

### External Subtree Doc Systems (do not override LiquidAIty truth)
- `Understand-Anything-main/**`
- `localcoder/**`
- `worldsignal/**`
- `data-formulator-main/**`
- `gamecanvas/**`
- `motioncanvas/**`
- `spatialcanvas/**`
- `videocanvas/**`
- `services/**` (service-local docs)

## Conflicts And Overlaps Found
1. Multiple instruction systems now coexist (`AGENTS.md`, `SOUL.md`, `CLAUDE.md`, Spec Kit constitution, skill docs).  
   Resolution: treat `CLAUDE.md` as adapter only; canonical hierarchy stays in `docs/README.md`.

2. Legacy root docs overlap with current architecture/runtime docs.  
   Resolution: keep legacy docs marked historical; avoid deleting in this pass.

3. External subtree docs contain their own architectures and agent instructions.  
   Resolution: explicitly scope as external; they cannot redefine LiquidAIty runtime truth.

## Non-Negotiable Runtime Governance (confirmed)
- AutoGen mandatory for real execution rails.
- No silent TypeScript runtime fallback.
- Diagnostics allowed; fake success paths forbidden.
- Code-Based Memory MCP required before significant edits.

## Safe Condense Plan (No Deletions In This Pass)
1. Keep one entrypoint: `docs/README.md`.
2. Keep one governance constitution: `.specify/memory/constitution.md`.
3. Keep one agent-ops policy file: `AGENTS.md` (with adapters pointing back).
4. Keep legacy docs in place, but classify as historical.
5. Keep external subtree docs in place, but classify as non-authoritative for LiquidAIty.

## Files/Folders Likely Created In The "Claude-Inspired" Structuring Pass
- `.specify/**`
- `.agents/skills/**`
- `specs/001-liquidaity-spec-governance/**`
- `CLAUDE.md`
- `docs/AGENT_INSTRUCTION_MAP.md`

These are now integrated into the hierarchy above instead of standing alone.
