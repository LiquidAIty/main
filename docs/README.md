# Documentation Map

This is the documentation map for LiquidAIty.

## Current Working Order
- `spec.md` first
- `plan.md` next
- `tasks.md` next
- explicit user approval of scope
- implementation after the spec/plan/tasks truth pass is accepted

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

## Root Markdown Audit
- `README.md` is the repo entrypoint, not a feature contract.
- `CODE.md` is a working memo, not canonical product or implementation truth.
- `MEMORY.md` is a workflow note, subordinate to `AGENTS.md` and `.specify/memory/constitution.md`.
- `launch-readiness.md` is historical planning context, not the current Stage 0 contract.
- `policy.md` is a legacy workflow memo, not the governing authority.
- `ROOT_REPO_OPERATING_GUIDE.md` is an operator note that must be re-verified before use.
- `repo-map.md` is a generated snapshot, not a source of truth.
- `codebase-memory.md`, `MAGENTIC_CBM_CODER_WORKFLOW.md`, and `MAGENTIC_LONGFORM_PROMPT.md` are reference notes, not active product specs.

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
