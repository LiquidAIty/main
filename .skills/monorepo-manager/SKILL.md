---
name: monorepo-manager
description: Adapted real monorepo skill for LiquidAIty. Use for Nx/workspaces/package graph/dependency/build target work.
source: adapted from TerminalSkills/skills skills/monorepo-manager/SKILL.md
license: Apache-2.0
category: development-monorepo
---

# Monorepo Manager

## Purpose

Manage LiquidAIty monorepo structure, workspace dependencies, Nx/project targets, package relationships, and build/test orchestration. This skill is derived from the real TerminalSkills `monorepo-manager` skill and adapted for LiquidAIty.

## Required Reads

1. `SOUL.md`
2. `AGENTS.md`
3. `.specify/memory/constitution.md`
4. relevant `specs/*`
5. root `package.json`
6. `nx.json`, `project.json`, workspace config, and package manifests found with Code-Based Memory MCP

## Workflow

1. Use Code-Based Memory MCP to detect the actual monorepo structure.
2. Identify package manager and workspace system before editing anything.
3. Map affected apps/libs/services and dependency direction.
4. Check whether the change needs a Spec Kit spec update.
5. Avoid moving apps/libs or changing package boundaries without explicit plan.
6. Use existing Nx/workspace targets.
7. Preserve lockfile/package consistency.
8. Validate affected projects when possible.
9. Update docs/runbooks if commands or targets change.

## Structure Detection

Check:

```powershell
Test-Path nx.json
Test-Path pnpm-workspace.yaml
Get-Content package.json
Get-ChildItem -Recurse -Include project.json,package.json -ErrorAction SilentlyContinue
```

Identify:

- apps
- libraries/packages
- backend services
- Python sidecars
- generated/build folders to ignore
- package manager and lockfile
- affected targets

## Do

- Use actual Nx targets instead of guessing.
- Prefer affected-project validation where possible.
- Keep package versions consistent.
- Respect internal dependency direction.
- Check for circular dependencies before moving code.
- Update runbooks when commands change.

## Do Not

- Do not reorganize the repo broadly in a small task.
- Do not change package manager.
- Do not edit lockfiles without explaining why.
- Do not install dependencies without approval.
- Do not treat imported/eaten repo docs as active LiquidAIty structure.
- Do not create random audit docs.

## Validation

Use discovered scripts/targets. Examples only:

```powershell
npx nx graph
npx nx show projects
npx nx affected -t build
npx nx test <project>
npm run build
```

Report if a command is unavailable.

## Documentation Update Rule

- Dev command change → `docs/runbooks/full-stack-dev.md`
- Project boundary/architecture change → `docs/architecture.md`
- Feature behavior change → relevant `specs/*`
- Architecture decision → `docs/decisions/*`

## Source Attribution

Adapted from `TerminalSkills/skills` `skills/monorepo-manager/SKILL.md`, Apache-2.0. The original skill covers workspaces, dependency sync, internal dependency graphs, Turborepo, Nx, and build orchestration.
