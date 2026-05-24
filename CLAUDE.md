# CLAUDE.md

This file is a thin Claude/Anthropic adapter for LiquidAIty.
It does not redefine project architecture.

## Canonical Read Order
Claude must follow this hierarchy:

1. `.specify/memory/constitution.md`
2. `AGENTS.md`
3. `SOUL.md`
4. `docs/architecture.md`
5. `docs/runbooks/full-stack-dev.md`
6. Relevant `specs/*` artifacts for the active feature
7. `docs/README.md` for trust boundaries (canonical vs historical vs external)

## Mandatory Rules
- Use Code-Based Memory MCP before significant edits.
- Run inverse audit before implementation.
- Do not invent architecture or bypass canonical docs.
- Preserve AutoGen mandatory execution behavior for real runs.
- No silent TypeScript fallback runtime.
- No fake diagnostic fallback unless explicitly requested by the user.
- Do not introduce LangChain.
- Do not recommend or introduce Zorro.
- Keep changes surgical and report uncertainty explicitly.

## Required Report Format
- files changed
- tests run
- risks
- uncertainty
- forward plan
