# CURRENT MVP (Dual-Graph AI System)

Updated: March 6, 2026

## Product Statement
AI that separates what users think from what evidence shows, and reasons between them.

## Core MVP Scope (Current)
- Investigation workspace with persistent chat/project state
- ThinkGraph memory and retrieval (Postgres AGE path)
- KnowGraph evidence ingestion from attachments (Neo4j GraphRAG KG Builder path)
- Combined context usage in assistant workflows
- Traceable ingest/status visibility in UI dashboard

## Graph Roles
- ThinkGraph: user reasoning state (ideas, questions, decisions, tasks)
- KnowGraph: evidence graph (documents, entities, claims, provenance)

## What Is Implemented Now
- Agent Builder supports separate graph agents:
  - `kg_ingest` shown as **ThinkGraph**
  - `knowgraph` shown as **KnowGraph**
- Neo4j ingest endpoint exists via backend proxy:
  - `POST /api/knowgraph/ingest`
- KnowGraph graph exploration endpoints exist:
  - `GET /api/knowgraph/graph`
  - `GET /api/knowgraph/expand`
- Knowledge panel visualizes ThinkGraph + KnowGraph + Mixed nodes.

## Current Implementation Notes
- KnowGraph ingest is currently PDF-based (official Neo4j pipeline).
- Attachment UI now enforces PDF-only uploads for KnowGraph.
- Backend proxy now forwards multipart ingest using fetch/FormData and returns upstream response body safely.

## Immediate Next Milestones
1. Add explicit "Bridge View" panel for ThinkGraph node <-> KnowGraph evidence links.
2. Persist reasoning trace schema per response (`hypothesis -> evidence -> conclusion`).
3. Add citation badges in chat responses tied to KnowGraph evidence IDs.
4. Add contradiction/gap detectors as post-response analyzers.

## Acceptance Checks (MVP)
1. Upload a PDF through UI attachment button and receive `ok: true`.
2. Verify KnowGraph has `Document` + `Chunk` nodes for the project in Neo4j.
3. Open Knowledge tab and confirm KnowGraph nodes render for that project.
4. Ask a follow-up question in Assist and verify graph-backed continuity behavior.
