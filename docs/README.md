# Documentation Map

This is the documentation map for LiquidAIty.

## Canonical Docs
- `docs/architecture.md` (architecture truth)
- `docs/runbooks/` (run/verify workflows)
- `docs/decisions/` (Architecture Decision Records)
- audit findings should be merged into the closest living source of truth above, not kept as
  standalone audit Markdown by default

## Instruction And Governance Docs
- `SOUL.md` (Sol identity)
- `AGENTS.md` (hard coding-agent rules)
- `.specify/memory/constitution.md` (workflow and heavy-mode Spec Kit governance)
- `.skills/` (task-triggered optional skills)
- `.agents/skills/` (installed Spec Kit/Codex skills)

## Specs
- `specs/*` (feature specs, plans, tasks)

## Spec Kit
- optional heavy-mode for larger or riskier work, not the default for every task
- `.specify/templates/*`
- `.agents/skills/*`

## Historical
- `docs/old/*`
- old audit documents belong here after durable findings are extracted

## External Subtree Docs
- `Understand-Anything-main/**`
- `localcoder/**`
- `worldsignal/**`
- `data-formulator-main/**`
- `gamecanvas/**`
- `motioncanvas/**`
- `spatialcanvas/**`
- `videocanvas/**`
- `services/**`

External subtree docs are scoped to their source projects and do not override LiquidAIty truth.
