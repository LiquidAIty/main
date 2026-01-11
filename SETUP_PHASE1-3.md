# Phase 1-3 Setup and Testing Guide

## 🎯 What Was Implemented

### Phase 1: Multi-Agent DB Backend
- **Database schema** for multiple agents per project with sectioned prompts
- **Backend store functions** for CRUD operations
- **API routes** for agent management

### Phase 2: Agent Runner (Test Harness)
- **Agent executor endpoint** that switches behavior based on agent type
- **Knowledge Builder Agent** (kg_ingest) - ingests text into KG
- **Knowledge Reader Agent** (kg_read) - queries KG and returns context packets

### Phase 3: Agent Builder UI
- **Agent selector** dropdown with create/delete
- **Sectioned prompt editor** (Role, Goal, Constraints, IO Schema, Memory Policy)
- **Test harness** with input/output display
- **Model selector** with temperature and max_tokens controls

---

## 📋 Setup Steps

### 1. Run Database Migration

```bash
# Connect to your PostgreSQL database
psql -U postgres -d liquidaity -f db/20_project_agents_multi.sql
```

This will:
- Create `ag_catalog.project_agents` table
- Migrate existing single-agent configs to "Default Agent" rows
- Add helper functions for prompt assembly

### 2. Install Dependencies (if needed)

Backend dependencies should already be installed, but verify:

```bash
cd apps/backend
npm install
```

Frontend:
```bash
cd client
npm install
```

### 3. Restart Backend Server

```bash
cd apps/backend
npm run serve
```

The server should start on port 4000 and mount the new routes:
- `/api/projects/:projectId/agents` (CRUD)
- `/api/projects/:projectId/agents/:agentId/run` (test harness)

### 4. Start Frontend

```bash
cd client
npm run dev
```

---

## 🧪 Testing Workflow

### Test 1: Create Knowledge Builder Agent

1. **Navigate to Agent Builder mode**:
   - Go to `http://localhost:5173/agentbuilder?mode=agents`
   - Select a project from the dropdown

2. **Create new agent**:
   - Click "+ New Agent" button
   - Name: "Knowledge Builder"
   - Type: "Knowledge Builder - Ingests text and extracts entities/relationships into knowledge graph"
   - Click "Create"

3. **Configure agent** (Plan tab):
   - **Model**: Select "DeepSeek Chat (OpenRouter)"
   - **Temperature**: 0
   - **Max Tokens**: 2048
   - **Role**: "You are a knowledge extraction specialist. Extract entities and relationships from text."
   - **Goal**: "Parse the input text and identify all entities (people, places, concepts) and their relationships."
   - **Constraints**: "Only extract factual information. Do not infer or assume relationships."
   - **IO Schema**: "Input: raw text. Output: entities and relations in JSON format."
   - **Memory Policy**: "No memory required. Process each input independently."
   - Click "Save Agent"

4. **Test the agent** (Dashboard tab):
   - **Test Input**: 
     ```
     Alice works at TechCorp as a software engineer. 
     She collaborates with Bob on the AI project. 
     TechCorp is located in San Francisco.
     ```
   - Click "Run Test"
   - **Expected Output**:
     ```json
     {
       "message": "Knowledge ingestion completed",
       "chunks_written": 1,
       "embeddings_written": 1,
       "entities_upserted": 4,
       "relations_upserted": 3
     }
     ```

5. **Verify in Knowledge tab**:
   - Switch to "Knowledge" tab
   - Click "Load project subgraph"
   - Should see entities: Alice, Bob, TechCorp, San Francisco
   - Should see relationships between them

### Test 2: Create Knowledge Reader Agent

1. **Create new agent**:
   - Click "+ New Agent"
   - Name: "Knowledge Reader"
   - Type: "Knowledge Reader - Queries knowledge graph and returns context packets"
   - Click "Create"

2. **Configure agent** (Plan tab):
   - **Model**: "DeepSeek Chat (OpenRouter)"
   - **Role**: "You are a knowledge retrieval specialist. Find relevant information from the knowledge graph."
   - **Goal**: "Search the knowledge graph for entities and relationships matching the query."
   - **Constraints**: "Only return information that exists in the graph. Do not generate new information."
   - **IO Schema**: "Input: search query. Output: context packet with entities and relations."
   - **Memory Policy**: "Use graph structure as memory. Return connected subgraphs."
   - Click "Save Agent"

3. **Test the agent** (Dashboard tab):
   - **Test Input**: `Alice`
   - Click "Run Test"
   - **Expected Output**:
     ```json
     {
       "context_packet": {
         "query": "Alice",
         "entities": [
           {
             "type": "Person",
             "name": "Alice",
             "attrs": {},
             "confidence": 0.9
           },
           {
             "type": "Company",
             "name": "TechCorp",
             "attrs": {},
             "confidence": 0.9
           }
         ],
         "relations": [
           {
             "type": "WORKS_AT",
             "from": { "type": "Person", "name": "Alice" },
             "to": { "type": "Company", "name": "TechCorp" },
             "confidence": 0.9
           }
         ],
         "metadata": {
           "entity_count": 2,
           "relation_count": 1,
           "source": "kg_read_agent",
           "timestamp": "2026-01-04T..."
         }
       }
     }
     ```

### Test 3: Verify Multiple Agents Per Project

1. **Switch between agents**:
   - Use the agent selector dropdown
   - Select "Knowledge Builder"
   - Verify Plan tab shows its configuration
   - Select "Knowledge Reader"
   - Verify Plan tab shows different configuration

2. **Test both agents**:
   - Run Knowledge Builder with new text
   - Run Knowledge Reader to query the new data
   - Verify both work independently

---

## 🔍 Troubleshooting

### Backend Not Starting

**Error**: `Cannot find module './projectAgents.routes'`

**Fix**: Verify file exists at `apps/backend/src/routes/projectAgents.routes.ts`

### Database Migration Fails

**Error**: `relation "ag_catalog.project_agents" already exists`

**Fix**: Migration is idempotent. If table exists, it will skip creation. Check if migration completed successfully:

```sql
SELECT COUNT(*) FROM ag_catalog.project_agents;
```

### Agent Runner Returns 404

**Error**: `POST /api/projects/:projectId/agents/:agentId/run` returns 404

**Fix**: Verify routes are mounted in `apps/backend/src/routes/index.ts`:

```typescript
router.use('/projects', projectAgents);
```

### Frontend Shows "Agent not found"

**Fix**: 
1. Check browser console for errors
2. Verify backend is running on port 4000
3. Check network tab for API calls
4. Verify `VITE_BACKEND_URL` in `.env` (should be `/api` or `http://localhost:4000/api`)

### LLM Chunking Fails

**Error**: `[LLM chunking] failed: ...`

**Expected**: System falls back to deterministic chunking automatically. Check console for:
```
[LLM chunking] fallback to deterministic: N chunks
```

This is normal if OpenRouter API key is not configured or rate limited.

### No Entities Extracted

**Issue**: Agent runs successfully but `entities_upserted: 0`

**Causes**:
1. LLM extraction failed (check `errors` array in response)
2. Text too short or no meaningful entities
3. OpenRouter API key not configured

**Fix**: Check backend logs for extraction errors:
```
[KG][ingest] WARNING provider=openrouter model=...
```

---

## 📊 API Endpoints Reference

### Agent Management

```bash
# List agents
GET /api/projects/:projectId/agents

# Get specific agent
GET /api/projects/:projectId/agents/:agentId

# Create agent
POST /api/projects/:projectId/agents
{
  "name": "string",
  "agent_type": "kg_ingest|kg_read|llm_chat",
  "model": "string",
  "role_text": "string",
  "goal_text": "string",
  ...
}

# Update agent
PUT /api/projects/:projectId/agents/:agentId
{
  "role_text": "string",
  "goal_text": "string",
  ...
}

# Delete agent
DELETE /api/projects/:projectId/agents/:agentId
```

### Agent Execution

```bash
# Run agent
POST /api/projects/:projectId/agents/:agentId/run
{
  "input": "string (required)",
  "context": {} (optional)
}

# Response
{
  "ok": true,
  "agent_id": "uuid",
  "agent_name": "string",
  "agent_type": "kg_ingest|kg_read|llm_chat",
  "output": { ... },
  "side_effects": { ... },
  "errors": ["string"]
}
```

---

## 🎨 UI Components

### Agent Selector
- **Location**: Top of right panel in agents mode
- **Features**: Dropdown + New Agent button + Delete button

### Plan Tab (Agents Mode)
- **Sectioned Prompt Editor**:
  - Model selector (5 options)
  - Temperature slider (0-2)
  - Max Tokens input (256-8192)
  - Role textarea
  - Goal textarea
  - Constraints textarea
  - IO Schema textarea
  - Memory Policy textarea
  - Save button

### Dashboard Tab (Agents Mode)
- **Test Harness**:
  - Test input textarea
  - Run Test button
  - Result display with:
    - Status (Success/Failed)
    - Output (JSON formatted)
    - Side Effects (JSON formatted)
    - Errors list

### Knowledge Tab
- **Unchanged**: Existing graph explorer
- **Auto-refresh**: After successful kg_ingest test run

---

## ✅ Success Criteria

- [x] Can create multiple agents per project
- [x] Can edit agent configuration with sectioned prompts
- [x] Can save agent configuration to DB
- [x] Can run Knowledge Builder agent and see KG writes
- [x] Can run Knowledge Reader agent and get context packet
- [x] Can switch between agents without losing configuration
- [x] Graph auto-refreshes after kg_ingest test
- [x] No doc_id/src fields exposed in agent UI
- [x] All agent behavior determined by DB config, not hardcoded

---

## 🚀 Next Steps (Future Enhancements)

1. **LLM Chat Agent**: Implement llm_chat executor type using LangGraph agent0
2. **Agent Versioning**: Add version history for agent configs
3. **Agent Templates**: Pre-built agent templates for common tasks
4. **Tool Integration**: Add MCP tools to agent configuration
5. **Agent Chaining**: Allow agents to call other agents
6. **Batch Testing**: Run multiple test cases at once
7. **Performance Metrics**: Track agent execution time and success rate
8. **Agent Marketplace**: Share and import agent configs

---

## 📝 Files Modified/Created

### Backend
- ✅ `db/20_project_agents_multi.sql` - Database schema
- ✅ `apps/backend/src/services/projectAgentsStore.ts` - Store functions
- ✅ `apps/backend/src/routes/projectAgents.routes.ts` - API routes
- ✅ `apps/backend/src/routes/index.ts` - Route mounting
- ✅ `apps/backend/src/routes/projects.routes.ts` - Export runIngestPipeline

### Frontend
- ✅ `client/src/lib/projectAgentsApi.ts` - API client
- ✅ `client/src/components/AgentManager.tsx` - Agent management UI
- ✅ `client/src/pages/agentbuilder.tsx` - Integration

### Documentation
- ✅ `PHASE1-3_IMPLEMENTATION_STATUS.md` - Implementation summary
- ✅ `SETUP_PHASE1-3.md` - This file
