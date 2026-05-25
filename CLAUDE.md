# CLAUDE.md - LiquidAIty Claude Code Context

## Project Overview
LiquidAIty is a graph-native AI orchestration and modeling platform that turns projects, models, tools, agents, simulations, files, data, knowledge, and user intent into interactive canvases with executable agent workflows.

## Key Components
- `SOUL.md`: Sol identity and behavior.
- `AGENTS.md`: repo-wide coding-agent rules.
- `.specify/`: Spec Kit constitution/templates.
- `specs/`: feature specs, plans, tasks.
- `.claude/`: Claude Code settings, hooks, and skills.
- `.agents/skills/`: Spec Kit/Codex skills.
- `docs/architecture.md`: architecture truth.
- `docs/runbooks/`: run and verification workflows.
- `docs/decisions/`: Architecture Decision Records.
- `apps/`, `services/`, `client/`: runtime code surfaces.

## Read First
Claude Code should read:
1. `SOUL.md`
2. `AGENTS.md`
3. `.specify/memory/constitution.md`
4. `docs/architecture.md`
5. `docs/runbooks/full-stack-dev.md`
6. relevant `specs/*`

## Best Practices
- Keep edits surgical.
- Use Code-Based Memory MCP first.
- Use Spec Kit for major features.
- Do not invent architecture.
- Do not create audit docs as permanent noise.
- Preserve runtime behavior.
- Keep AI context minimal and precise.

## Hard Limits
- No LangChain.
- No Zorro.
- No fake fallback runtime.
- No unverified runtime claims.
- No secrets in committed files.
- No broad rewrites without approval.

## Validation
Use PowerShell commands.
Run the smallest useful validation for the change.
Always report tests that were not run and why.
