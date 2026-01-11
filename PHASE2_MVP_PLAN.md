# Phase 2 MVP Implementation Plan

## Executive Summary

**Goal**: Deliver a working demo where users chat about goals, plans/links auto-generate, knowledge auto-writes to PostgreSQL+AGE, and query agents answer with citations.

**Current State**: System has all components but knowledge ingestion fails due to missing `doc_id`/`src` validation in UI.

**Success Criteria**: No manual ingest, populated knowledge graph, cited query answers, visible agent work, compounding knowledge.

---

## Architecture Constraints (Non-Negotiable)

### Role Separation
- **Boss/Sol**: Chat, clarify, create plan (no KG read/write)
- **Knowledge Agent**: Write entities/relations/embeddings (write-only)
- **Query Agent**: Retrieve grounded knowledge with citations (read-only)
- **Agent Builder**: Orchestrate swarms (read via Query Agent)
- **Swarm Agents**: Research/generate (read via Query Agent only)

### Data Flow Law
```
User Chat → Boss → Plan+Links → Knowledge Agent → KG → Query Agent → Answers
                              ↓
                         Agent Builder → Swarms → Links → Knowledge Agent
```

**Breaking this flow = system rot**

---

## Core Data Structures

### Plan Schema
```json
{
  "title": "string",
  "goal": "string",
  "tasks": [
    {
      "id": "string",
      "text": "string",
      "status": "todo|doing|done",
      "owner": "user|agent",
      "deps": ["task_id"],
      "confidence": 0.0
    }
  ],
  "risks": [{"text": "string", "confidence": 0.0}],
  "unknowns": [{"text": "string", "confidence": 0.0}]
}
```

### LinkWorkItem Schema
```json
{
  "id": "string",
  "type": "query|url|run",
  "title": "string",
  "input": "string",
  "status": "queued|running|done|error",
  "outputs": {
    "urls": ["string"],
    "snippets": ["string"],
    "notes": "string",
    "citations": [{"url": "string", "quote": "string", "location": "string"}]
  },
  "model": {"provider": "openrouter", "name": "string"},
  "confidence": 0.0,
  "provenance": {"created_by": "boss|agent|user", "turn_id": "string"}
}
```

---

## Knowledge Agent Implementation

### Input Contract
```json
{
  "project_id": "uuid",
  "source_type": "plan_links",
  "source_id": "sha1",
  "text": "canonical_text"
}
```

### Canonical Text Format
```
<PLAN>
...normalized plan content...
</PLAN>

<LINKS>
...normalized link outputs, citations, notes...
</LINKS>
```

### Processing Pipeline
1. Compute `source_id = sha1(canonical_text)`
2. Check existing ingestion (idempotency)
3. Chunk text (1500 chars, 200 overlap)
4. Embed chunks → `ag_catalog.rag_embeddings`
5. Extract entities/relations (LLM, strict JSON)
6. Write to AGE → `:Entity`, `:REL`

### AGE Schema
**Nodes**: `:Entity {project_id, etype, name, attrs, confidence, source_id}`
**Edges**: `:REL {project_id, rtype, attrs, confidence, source_id}`

### Failure Rules
- Invalid extraction JSON → abort write
- No partial writes allowed

---

## Query Agent Implementation

### Input Contract
```json
{
  "project_id": "uuid",
  "question": "string",
  "mode": "plan|research|build|debug"
}
```

### Retrieval Pipeline
1. Vector search (pgvector) → candidate chunks
2. Extract entity mentions
3. AGE subgraph expansion
4. Synthesize answer with citations

### Output Contract
```json
{
  "answer": "string",
  "citations": [{"chunk_id": "int", "src": "string"}],
  "entities": ["string"],
  "relations": ["string"]
}
```

**Rule**: Never invent facts, only synthesize from retrieved knowledge.

---

## Agent Builder Implementation

### Build Sequence
1. Query Agent → current state summary
2. Query Agent → gaps/unknowns
3. Generate SwarmSpec
4. Execute chains
5. Write outputs to Links
6. Trigger Knowledge Agent ingest

### SwarmSpec Schema
```json
{
  "agents": [
    {"role": "research|options|critic|monitor", "model": "string"}
  ],
  "chains": [
    {"steps": ["research", "options", "critic", "summary"]}
  ],
  "deliverables": ["links", "plan_update"]
}
```

### Tooling Rules
- Swarms read via Query Agent only
- Swarms write to Links or propose Plan updates only

---

## Model Routing

| Role            | Provider   | Purpose                 |
|-----------------|------------|-------------------------|
| Boss/Sol        | ChatGPT    | Reasoning, conversation |
| Knowledge Agent | OpenRouter | Entity extraction       |
| Query Agent     | OpenRouter | Grounded synthesis      |
| Swarm Agents    | OpenRouter | Parallel research       |

---

## Phase 2 Execution Loop

```
1. Boss emits Plan + Links JSON
2. Auto-save state to /api/projects/:id/state
3. Knowledge Agent auto-ingest (no manual doc_id/src)
4. Query Agent returns answers with citations
5. Agent Builder creates swarm from knowledge gaps
6. Swarm outputs new Links
7. Knowledge Agent ingests again
```

**This loop must close automatically.**

---

## Critical Fixes Required

### Current Blocker
**File**: `client/src/pages/agentbuilder.tsx:746-752`

```typescript
// BLOCKS ALL INGESTION
if (!docId) {
  setKgIngestStatus("doc_id is required.");
  return;
}
if (!src) {
  setKgIngestStatus("src is required.");
  return;
}
```

### Fix Strategy
Auto-generate `doc_id` and `src` from Plan+Links:
- `doc_id`: `"plan_links_${projectId}_${sha1(canonical_text).slice(0,12)}"`
- `src`: `"auto_ingest_${new Date().toISOString()}"`

### Backend Already Works
- `apps/backend/src/routes/projects.routes.ts:408-608` handles full pipeline
- Chunking: ✅ (line 434-463)
- Embedding: ✅ (line 489-500)
- AGE writes: ✅ (line 350-388)
- All components functional with valid inputs

---

## Implementation Checklist

### Phase 2A: Auto-Ingest (Critical Path)
- [ ] Remove manual `doc_id`/`src` UI fields
- [ ] Add `canonicalizePlanLinks(plan, links)` function
- [ ] Auto-trigger ingest on Plan/Links save
- [ ] Add ingest status indicator (non-blocking)

### Phase 2B: Query Agent
- [ ] Create `/api/projects/:id/query` endpoint
- [ ] Implement vector search + AGE expansion
- [ ] Return citations with answers
- [ ] Add Query UI in Knowledge tab

### Phase 2C: Agent Builder
- [ ] Create `/api/projects/:id/build-swarm` endpoint
- [ ] Query gaps from knowledge
- [ ] Generate SwarmSpec
- [ ] Execute chains, write to Links
- [ ] Trigger auto-ingest

### Phase 2D: Close the Loop
- [ ] Boss → Plan+Links → Auto-ingest
- [ ] Query Agent → Cited answers
- [ ] Agent Builder → Swarms → Links → Auto-ingest
- [ ] Verify knowledge compounds

---

## Demo Acceptance Criteria

✅ **Must Have**:
- No manual ingest buttons/fields
- Knowledge graph populates automatically
- Query answers include citations
- Agent work visible in Links
- Knowledge compounds across sessions

❌ **Explicitly Out of Scope**:
- UI redesign
- Agent marketplace
- Memory tuning
- Permissions
- Performance optimization

---

## File Locations (Reference)

### Frontend
- Agent Builder UI: `client/src/pages/agentbuilder.tsx`
- API Client: `client/src/lib/api.ts`

### Backend
- Projects Routes: `apps/backend/src/routes/projects.routes.ts`
- Graph Service: `apps/backend/src/services/graphService.ts`
- Agent Store: `apps/backend/src/services/agentBuilderStore.ts`

### Database
- Schema: `db/00_pg_age_timescale_postgis_vector_FULLSTACK.sql`
- Tables: `ag_catalog.rag_chunks`, `ag_catalog.rag_embeddings`
- Graph: `liquidaity_graph` (AGE)

---

## Success Metrics

**Before Phase 2**: Empty knowledge graph, manual ingest fails
**After Phase 2**: Auto-populated graph, cited answers, visible agent work

**The system is complete when**: A user chats → knowledge writes → agents use it → more knowledge writes.
