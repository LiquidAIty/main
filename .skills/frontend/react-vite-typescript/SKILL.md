# React Vite TypeScript

## Trigger

Use only when:
- editing React / TypeScript frontend files
- changing Vite config, client build, aliases, or frontend env behavior
- changing components, hooks, providers, UI state, or frontend tests
- fixing frontend compile/build/type errors

## Read

- SOUL.md
- AGENTS.md
- .specify/memory/constitution.md
- relevant specs/*
- client/package.json
- client/vite.config.* if present
- client/tsconfig*.json if present
- relevant frontend files found with Code-Based Memory MCP

## Do

- Inspect existing scripts before running commands.
- Use `.tsx` for files with JSX.
- Type props, state, events, and domain objects clearly.
- Preserve existing Vite structure, aliases, and env patterns.
- Prefer small components and hooks over giant files.
- Keep browser code free of secrets.
- Update specs/docs when behavior changes.

## Do Not

- Do not scaffold a new Vite app.
- Do not add dependencies without approval.
- Do not rewrite component trees for small fixes.
- Do not hardcode API URLs if config exists.
- Do not use `any` to hide type problems without reporting why.
- Do not claim build/typecheck passed unless run.

## Validate

Inspect scripts first.

```powershell
Get-Content client\package.json
npm --prefix client run build
npm --prefix client run typecheck
npm --prefix client run test
```

## Docs

Frontend behavior change -> relevant specs/*  
Build/dev command change -> docs/runbooks/full-stack-dev.md  
Architecture/state/routing change -> docs/architecture.md

## Source

Repo-native LiquidAIty frontend skill.
