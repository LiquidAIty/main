# KnowGraph — Sourced Knowledge

@skill id=knowgraph
@type Skill
@status active
@graph knowgraph
@store neo4j

Use for researched entities, source-backed claims, relationships, evidence and time context.
Recovered from `2ddadeeb^` and refreshed September 9, 2026. Graphiti is the current semantic
ingestion/search owner over Neo4j; the existing research agent retains sourced findings.

Read current granted tools from the application catalog. The current read family includes
`graphiti.search_nodes`, `graphiti.search_memory_facts`, and `graphiti.get_episodes`; verify
arguments and availability rather than copying historical `knowgraph.*` contracts. Research
intake is owned by the existing `services/knowgraph/ingest.py` path. A saved grant remains
necessary for a tool call; this document does not grant capability.

An episode is source input submitted to Graphiti, not a substitute for the extracted entities
and relationships. Preserve its source and date references so an extracted fact is explainable.
A queued episode does not prove materialization. URL fetching and document parsing must be
verified at the existing intake boundary; receiving a URL does not prove its body was read.

Keep entity identity, assertion, evidence, time, and uncertainty distinct. Preserve changes in
claims rather than overwriting an entity with a dated report. Source publication/retrieval time
and the period a fact describes are different. Research notes may be longer than ThinkGraph
intent notes, but should answer something useful about the entity rather than repeat a report.

Use native relationships and their factual explanation. Do not invent `relates to` edges,
confidence values, dates or identity aliases. A source mention is not proof of an asserted
relationship. Native extraction quality must be inspected independently of visualization.

ThinkGraph holds reasoning/intent; CodeGraph holds repository structure; profile skills hold
operating procedures. Do not silently merge these into KnowGraph or ingest test instructions.
See [conversation-graph-acceptance.md](conversation-graph-acceptance.md) for independent
ingestion, recall, source attribution and visible product proof.
