# Skill: KnowGraph — source-backed evidence

@skill id=knowgraph
@type Skill
@status active
@graph knowgraph
@store neo4j
@related_to thinkgraph
@related_to skillgraph

## Purpose

KnowGraph is the **factual, source-backed research evidence graph**: entities,
sources, assertions, excerpts, dates, contracts, filings, patents, news, and market
observations. Store: Neo4j. Accessed through MCP. It is separate from ThinkGraph —
the two never silently merge or fall back into one another.

## Authority

- **Research agents** WRITE validated source-backed evidence to KnowGraph (only).
- The **Harness** READS KnowGraph through MCP — it NEVER writes KnowGraph.
- Mag One does not write ThinkGraph through any KnowGraph path.
- There is NO Harness-visible `knowgraph.write` / `knowgraph.apply_delta`.

## MCP tools (Harness-only, read)

`knowgraph.get_slice`, `knowgraph.search`, `knowgraph.inspect_evidence`,
`knowgraph.get_source_context`. They return bounded, evidence-aware structures with
stable `know:<id>` refs, canonical entity identity, source-backed assertions,
evidence/source refs, dates/freshness, confidence/status, and contradictions/gaps.

## Rules

- Entity-first extraction happens upstream (research pipeline), not in the Harness.
- Keep source, assertion, evidence, time, and confidence/provenance attached.
- Facts and derived conclusions stay separate — never treat a ThinkGraph hypothesis
  as a KnowGraph fact.
- Do not hide legacy bad evidence (e.g. the RDW self-loop); it is repaired upstream,
  not masked.
- Return stable evidence/source/entity refs so the Harness can cite and the
  ThinkGraph can reference them.
