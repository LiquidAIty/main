# Neo4j / KnowGraph

## Trigger

Use only when:
- changing Neo4j-specific code, schema, constraints, indexes, or Cypher
- working on KnowGraph
- using Neo4j drivers, sessions, transactions, Aura, or Neo4j-style Cypher
- debugging graph query behavior specific to Neo4j

## Read

- SOUL.md
- AGENTS.md
- .specify/memory/constitution.md
- .skills/graph/cypher/SKILL.md
- relevant specs/*
- Neo4j code/config found with Code-Based Memory MCP

## Do

- Use Neo4j-specific Cypher only when target is Neo4j.
- Use driver/session/transaction patterns already present in repo.
- Use parameters for values.
- Check constraints/indexes before changing query shape.
- Preserve entity/relationship naming unless migration is specified.
- Keep KnowGraph's role separate from ThinkGraph / Apache AGE.

## Do Not

- Do not assume Apache AGE supports every Neo4j feature.
- Do not run deletes/detaches without approval.
- Do not mix Neo4j connection config with PostgreSQL config.
- Do not expose credentials in docs or frontend code.
- Do not make graph writes invisible to docs/specs.

## Validate

Inspect repo scripts first.

```powershell
Select-String -Path **\*.ts,**\*.js,**\*.env*,**\*.md -Pattern "neo4j|Neo4j|bolt|cypher" -ErrorAction SilentlyContinue
```

## Docs

KnowGraph behavior change -> relevant specs/*  
Neo4j architecture change -> docs/architecture.md  
Connection/runbook change -> docs/runbooks/full-stack-dev.md

## Source

Repo-native skill from Neo4j/Cypher working patterns.
