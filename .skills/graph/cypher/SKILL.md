# Cypher

## Trigger

Use only when:
- writing or reviewing Cypher queries
- changing graph read/write behavior
- working with entities, relationships, properties, paths, labels, or graph traversals
- touching Neo4j or Apache AGE query logic

## Read

- SOUL.md
- AGENTS.md
- .specify/memory/constitution.md
- relevant specs/*
- graph code/schema/migrations found with Code-Based Memory MCP

## Do

- Identify whether the target is Neo4j or Apache AGE before writing Cypher.
- Parameterize user-provided values.
- Model entities, relationships, properties, and provenance explicitly.
- Keep labels/types stable unless migrating intentionally.
- Explain whether the query reads, writes, updates, deletes, or migrates graph data.
- Prefer small, reviewable queries.
- Check indexes/constraints when query performance matters.

## Do Not

- Do not run destructive Cypher without explicit approval.
- Do not assume Neo4j Cypher and Apache AGE Cypher are identical.
- Do not concatenate raw user input into queries.
- Do not change ontology/entity names casually.
- Do not hide graph writes inside generic helper functions without docs.
- Do not treat raw chat as durable graph truth.

## Validate

Inspect actual scripts first.

```powershell
Select-String -Path **\*.ts,**\*.js,**\*.sql -Pattern "MATCH|MERGE|CREATE|cypher|Neo4j|AGE" -ErrorAction SilentlyContinue
```

## Docs

Graph behavior change -> relevant specs/*  
Ontology/entity change -> docs/architecture.md or docs/decisions/*  
Query/runbook change -> docs/runbooks/full-stack-dev.md

## Source

Repo-native skill because no high-quality public Neo4j/AGE skill source was found.
