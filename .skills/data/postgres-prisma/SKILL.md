# PostgreSQL / Prisma

## Trigger

Use only when:
- changing Prisma schema, client usage, migrations, or generated client behavior
- changing PostgreSQL persistence
- touching DATABASE_URL, local DB setup, or persistence runbooks
- integrating AGE/PostgreSQL boundaries

## Read

- SOUL.md
- AGENTS.md
- .specify/memory/constitution.md
- relevant specs/*
- prisma/schema.prisma if present
- database config/migrations found with Code-Based Memory MCP

## Do

- Inspect schema before editing.
- Create a migration plan before schema changes.
- Run Prisma generate when schema changes require it.
- Keep DATABASE_URL and secrets out of committed files.
- Preserve local PostgreSQL port/config conventions.
- Coordinate with AGE skills when graph extension behavior is involved.

## Do Not

- Do not edit schema blindly.
- Do not change generated files by hand.
- Do not commit .env or credentials.
- Do not mix frontend env with server/database secrets.
- Do not change database behavior without docs/spec update.

## Validate

Inspect scripts first.

```powershell
Get-ChildItem -Recurse -Include schema.prisma,*.sql -ErrorAction SilentlyContinue
npx prisma generate
```

Use actual repo scripts if different.

## Docs

Persistence behavior change -> docs/architecture.md  
Local DB command change -> docs/runbooks/full-stack-dev.md  
Schema decision -> docs/decisions/*

## Source

Repo-native skill for LiquidAIty PostgreSQL / Prisma / AGE discipline.
