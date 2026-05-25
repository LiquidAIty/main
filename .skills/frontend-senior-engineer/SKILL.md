---
name: frontend-senior-engineer
description: Senior frontend engineering skill for LiquidAIty React, TypeScript, Vite, Tailwind, canvas, and UI work.
source: adapted from diegosouzapw/awesome-omni-skills skills/senior-frontend-v2/SKILL.md, which packages sickn33/antigravity-awesome-skills senior-frontend material.
license: review upstream license before external redistribution
category: frontend
---

# Frontend Senior Engineer

## Purpose

Use this skill for meaningful LiquidAIty frontend work: React components, Vite client behavior, TypeScript props/state, Tailwind styling, canvas UI, performance, accessibility, and frontend review.

## Required Reads

1. `SOUL.md`
2. `AGENTS.md`
3. `.specify/memory/constitution.md`
4. relevant `specs/*`
5. `docs/architecture.md`
6. `docs/runbooks/full-stack-dev.md`
7. nearby frontend components/hooks/styles found with Code-Based Memory MCP

## Activation

Use when the task involves:

- React or TypeScript frontend files
- Vite build/dev behavior
- Tailwind or CSS styling
- component creation/refactor
- canvas/card/panel/rail UI
- accessibility or interaction behavior
- frontend performance
- frontend testing strategy

## Strategy

LiquidAIty frontend work should preserve the current app shape instead of scaffolding a new app. Treat the UI as a canvas-first, object-aware workspace. Avoid road-sign UI, generic labels, huge rewrites, and new dependencies unless explicitly approved.

## Workflow

1. Confirm user intent and whether this needs a new or updated Spec Kit spec.
2. Use Code-Based Memory MCP to inspect the actual frontend structure, imports, component ownership, package scripts, and nearby patterns.
3. Identify the smallest safe component/hook/state/style boundary.
4. Preserve Vite, TypeScript, Tailwind, and existing client conventions.
5. Implement only the largest fully understood safe portion.
6. Validate with the closest existing scripts.
7. Update relevant specs/docs when behavior or commands change.
8. Report files changed, docs updated, validation, risks, uncertainty, and forward plan.

## Do

- Keep components typed and focused.
- Use `.tsx` for JSX.
- Prefer explicit domain names over generic UI names.
- Preserve object-aware canvas behavior.
- Keep glass/liquid UI readable and usable.
- Keep responsive layout intact.
- Use stable props and small hooks where helpful.
- Inspect existing scripts before running build/test commands.

## Do Not

- Do not scaffold a new Vite/React app inside the repo.
- Do not rewrite large component trees for small fixes.
- Do not add Next.js assumptions unless the repo actually uses Next.js.
- Do not add road-sign UI or obvious labels unless requested.
- Do not add dependencies without approval.
- Do not use `any` to hide type problems without reporting why.
- Do not hardcode secrets or API URLs into frontend code.
- Do not claim the frontend builds unless validated or clearly not run.

## Validation

Inspect scripts first:

```powershell
Get-Content client\package.json
```

Then use existing scripts when available:

```powershell
npm --prefix client run build
npm --prefix client run typecheck
npm --prefix client run test
```

If the repo uses Nx targets for frontend validation, use the actual target from `nx.json` / `project.json` instead of guessing.

## Documentation Update Rule

- Feature behavior change → update relevant `specs/*`.
- Build/dev command change → update `docs/runbooks/full-stack-dev.md`.
- Architecture/routing/state ownership change → update `docs/architecture.md`.
- Design convention change → update the relevant spec or existing docs; do not create random audit docs.

## Source Attribution

Adapted from the real public skill `skills/senior-frontend-v2/SKILL.md` in `diegosouzapw/awesome-omni-skills`, which itself documents provenance from `sickn33/antigravity-awesome-skills` senior frontend material. This LiquidAIty version removes broad scaffolder assumptions and adds repo-specific rules.
