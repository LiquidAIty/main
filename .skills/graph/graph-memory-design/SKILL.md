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
- Use OWL/RDF/JSON-LD as the semantic organizing format (`@context`, `@id`, `@type`).
- Use existing ontology concepts (classes, object properties, data properties, individuals, labels, comments, source refs, provenance).
- Do not invent a custom ontology language.
- Use `SemanticGraphRecord` (or a strict adapter into it) for durable ThinkGraph/KnowGraph records.
- Keep current intent separate from stale/historical docs.
- Keep ThinkGraph, KnowGraph, and CodeGraph roles explicit.
- Graph memory is not raw chat and not loose summaries.
- Prefer graph-shaped records over transcript dumps.
- Store source/provenance with useful knowledge.
- Design for future ingestion/search/routing.
- Document ontology/entity changes.
- Require every record to include: `kind`, `label`, `summary`, `sourceRefs`, `confidence`, `provenance`, `writer`, `writeMode`.
- Category theory is emergent from typed records, typed relationships, data properties, paths, vectors, and later ML. Do not implement or expose category theory directly.
- Treat `GraphUpdateRequest` as request-only unless a graph agent explicitly accepts/applies it.
- Enforce writer boundaries:
  - ThinkGraph writes: `thinkgraph-agent`
  - KnowGraph writes: `knowgraph-agent`
  - CodeGraph writes: `codegraph-agent` (when enabled)
  - Sol / WorkspaceHarness / ChatPlanCompanion: request/query only, no direct write

## Do Not

- Do not treat raw transcript text as durable truth.
- Do not merge unrelated graph layers casually.
- Do not create vague memory blobs with no provenance.
- Do not overwrite current intent with stale docs.
- Do not claim graph memory behavior exists unless code supports it.
- Do not store loose summary blobs with no source refs/provenance.
- Do not fake graph writes or fake successful persistence.
- Do not write fallback junk summaries.
- Do not generate random word-node graphs or road-sign graph UI.
- Do not create source-backed claims without `sourceRef`.
- Do not create graph records without confidence and provenance.

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
