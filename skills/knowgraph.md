# KnowGraph — Sourced Knowledge

@skill id=knowgraph
@type Skill
@status active
@graph knowgraph
@store neo4j

Use for researched entities, source-backed claims, relationships, evidence and time context.
Graphiti is the current semantic ingestion/search owner over Neo4j; the saved KnowGraph Card retains
sourced findings through its granted Graphiti operations.

Read current granted tools from the application catalog. The current read family includes
`graphiti.get_know`, `graphiti.search_knows`, `graphiti.get_entity_knows`, `graphiti.search_nodes`,
`graphiti.search_memory_facts`, and `graphiti.get_episodes`; verify
arguments and availability rather than copying historical `knowgraph.*` contracts. Card research writes
one first-class cited Know per source-backed observation through `graphiti.add_know`; each Know has one exact
Entity attachment and remains a Graphiti episode for extraction, retrieval and optional Saga continuity. The separate
`services/knowgraph/ingest.py` path owns Main PDF attachment ingestion. A saved grant remains necessary
for a tool call; this document does not grant capability.

An episode is source input submitted to Graphiti, not a substitute for the extracted entities
and relationships. Preserve its source and date references so an extracted fact is explainable.
A queued episode does not prove materialization. The saved KnowGraph root uses Hermes'
`grounded-citations` skill with actual web retrieval, exact extracted-page evidence, and its
evidence verification gate before intake; receiving a URL does not prove its body was read.
Python rails must not create a competing citation ledger or re-fetch the source as a second
research authority.

Keep entity identity, assertion, evidence, time, and uncertainty distinct. Preserve changes in
claims rather than overwriting an entity with a dated report. Source publication/retrieval time
and the period a fact describes are different. Research notes may be longer than ThinkGraph
intent notes, but should answer something useful about the entity rather than repeat a report.

Use provider relationships and their factual explanation. Do not invent `relates to` edges,
confidence values, dates or identity aliases. A source mention is not proof of an asserted
relationship. Graphiti extraction quality must be inspected independently of visualization.

ThinkGraph holds reasoning/intent; CodeGraph holds repository structure; profile skills hold
operating procedures. Do not silently merge these into KnowGraph or ingest test instructions.
Test ingestion, recall, source attribution, and visible product proof independently.
