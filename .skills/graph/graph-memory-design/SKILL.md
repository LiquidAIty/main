# Graph Memory Design

## Trigger

Use only when:
- changing ThinkGraph, KnowGraph, CodeGraph, memory, ontology, provenance, or graph-shaped context
- designing entities, relationships, properties, categories, or graph ingestion
- changing how Sol or agents retrieve/use project knowledge
- converting docs, specs, code, or user intent into structured graph records

## Read

- SOUL.md
- AGENTS.md
- .specify/memory/constitution.md
- relevant specs/*
- graph/memory code found with Code-Based Memory MCP

## Do

- Model durable knowledge as entities, relationships, properties, provenance, and confidence.
- Keep current intent separate from stale/historical docs.
- Keep ThinkGraph, KnowGraph, and CodeGraph roles explicit.
- Prefer graph-shaped summaries over raw chat dumps.
- Store source/provenance with useful knowledge.
- Design for future ingestion/search/routing.
- Document ontology/entity changes.

## Do Not

- Do not treat raw transcript text as durable truth.
- Do not merge unrelated graph layers casually.
- Do not create vague memory blobs with no provenance.
- Do not overwrite current intent with stale docs.
- Do not claim graph memory behavior exists unless code supports it.

## Validate

```powershell
Select-String -Path **\*.ts,**\*.js,**\*.py,**\*.md -Pattern "ThinkGraph|KnowGraph|CodeGraph|ontology|provenance|memory" -ErrorAction SilentlyContinue
```

## Docs

Memory architecture change -> docs/architecture.md  
Entity/ontology decision -> docs/decisions/*  
Feature behavior -> relevant specs/*

## Source

Repo-native skill based on LiquidAIty's graph-native memory architecture.
