# Spec Kit Workflow

## Trigger

Use only when:
- starting a meaningful feature/change
- changing architecture, runtime behavior, agent rules, or dev workflow
- touching multiple files/subsystems
- user asks for spec, plan, tasks, or implementation sequence

## Read

- SOUL.md
- AGENTS.md
- .specify/memory/constitution.md
- existing relevant specs/*
- relevant code found with Code-Based Memory MCP

## Do

- Start with spec.md or update an existing spec.
- Iterate the spec until it reflects user intent.
- Create/update plan.md before implementation.
- Create/update tasks.md before implementation.
- Run Code-Based Memory MCP before significant edits.
- Run inverse audit before implementation.
- Implement the largest fully understood safe portion.
- Leave uncertain or final-detail work for a later explicit pass.
- Report uncertainty and forward plan.
- Report what remains intentionally undone.

## Do Not

- Do not code before the spec is clear.
- Do not skip plan/tasks for meaningful work.
- Do not make broad speculative rewrites.
- Do not create random scratch Markdown, duplicate maps, or unowned audit docs.
- Do not commit unless requested.

## Validate

```powershell
Get-ChildItem -Force specs -Recurse
git status --short
```

## Docs

Feature change -> relevant specs/*  
Dev workflow change -> AGENTS.md or .specify/memory/constitution.md  
Architecture decision -> docs/decisions/*
Audits are required before implementation. Temporary audit notes belong in final reports.
Durable audit findings go to canonical homes: `specs/*`, `docs/decisions/*`, `docs/runbooks/*`,
`AGENTS.md`, `SOUL.md`, matching `.skills/*`, or `docs/audits/*` for major retrospectives.

## Source

Repo-native skill based on GitHub Spec Kit usage in this repo.
