# Apache AGE / ThinkGraph

## Trigger

Use only when:
- changing Apache AGE graph behavior
- writing AGE Cypher inside PostgreSQL
- working on ThinkGraph / PostgreSQL graph storage
- changing SQL/Cypher boundaries, migrations, or AGE-related queries

## Read

- SOUL.md
- AGENTS.md
- .specify/memory/constitution.md
- .skills/graph/cypher/SKILL.md
- relevant specs/*
- PostgreSQL / AGE code and migrations found with Code-Based Memory MCP

## Do

- Remember Apache AGE is a PostgreSQL graph extension.
- Check whether code is SQL, Cypher, or SQL calling Cypher.
- Preserve PostgreSQL migration discipline.
- Keep AGE behavior separate from Neo4j behavior.
- Parameterize values when possible.
- Document ontology/entity changes.
- Keep ThinkGraph's role separate from KnowGraph.

## Do Not

- Do not assume Neo4j-only Cypher features work in AGE.
- Do not change PostgreSQL schema without migration plan.
- Do not bypass Prisma/PostgreSQL conventions if they exist.
- Do not run destructive graph operations without approval.
- Do not mix database connection strings or secrets into docs.

## Validate

Inspect scripts/config first.

```powershell
Select-String -Path **\*.sql,**\*.ts,**\*.js,**\*.md -Pattern "AGE|age|cypher|PostgreSQL|postgres" -ErrorAction SilentlyContinue
```

## Docs

AGE/ThinkGraph behavior change -> relevant specs/*  
Storage architecture change -> docs/architecture.md  
Local DB/run command change -> docs/runbooks/full-stack-dev.md

## Source

Repo-native skill because public AGE-specific SKILL.md quality was weak.
