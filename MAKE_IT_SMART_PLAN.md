# Make It Smart: Concrete Implementation Plan

## Current State (from audit)
- ✅ RAG DB layer: DONE (`00_rag_core.sql` + `01_rag_weighted.sql`)
- ✅ RAG REST endpoint: DONE (`POST /api/rag/search` calls `api.rag_topk_weighted()`)
- ✅ LangGraph agent: REAL (Agent-0 uses ChatOpenAI, StateGraph, ToolNode)
- ❌ RAG tool in agent: STUB (agents/tools/rag.ts returns mock)
- ⚠️ MCP tools in agent: PARTIAL (registry exists, routes exist, not wired to agent)

## The Problem
Agent-0 has the brain (LLM + LangGraph) but can't reach the tools (RAG, MCP).

## The Solution
Wire RAG and MCP tools into `createAgentTools()` so Agent-0 can call them.

---

## Step 1: Confirm RAG Endpoint Works

**File:** `scripts/test-rag-search.ps1`

**Current:** Hits `http://localhost:3000/api/rag/search` (old port)

**Action:** Update to port 4000 (main.ts) and run:

```powershell
# From repo root:
cd apps/backend
npm run dev
# In another terminal:
pwsh scripts/test-rag-search.ps1
```

**Expected:** ✓ Test PASSED + one row of RAG results

---

## Step 2: Implement Real RAG Tool

**File:** `apps/backend/src/agents/tools/rag.ts`

**Replace with:**

```typescript
import { z } from 'zod';
import { makeZodTool } from '../lang/tools/zodTools';

export function createRagTool() {
  return makeZodTool({
    name: 'rag_search',
    description: 'Search the knowledge base using weighted RAG (semantic + recency + signal). Returns top-k chunks.',
    schema: z.object({
      query: z.string().describe('Natural language query or topic to search for'),
      k: z.number().int().min(1).max(50).default(5).describe('Number of results (1-50)'),
      w_rec: z.number().min(0).max(1).default(0.1).describe('Weight for recency (0-1)'),
      w_sig: z.number().min(0).max(1).default(0.1).describe('Weight for signal/confidence (0-1)')
    }),
    func: async ({ query, k, w_rec, w_sig }) => {
      try {
        // For now, we'll use a simple mock embedding.
        // TODO: In production, call an embedding model (e.g., OpenAI text-embedding-3-small)
        // to convert `query` to a vector, then pass it to /api/rag/search.
        const mockEmbedding = Array(1536).fill(0).map(() => Math.random() * 0.01);

        const res = await fetch('http://localhost:4000/api/rag/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            embedding: mockEmbedding,
            k,
            w_rec,
            w_sig
          })
        });

        if (!res.ok) {
          return {
            success: false,
            error: `RAG search failed: HTTP ${res.status}`,
            items: []
          };
        }

        const data = await res.json();
        if (!data.ok) {
          return {
            success: false,
            error: data.error || 'Unknown RAG error',
            items: []
          };
        }

        // Transform rows into agent-friendly format
        const items = (data.rows || []).map((row: any) => ({
          doc_id: row.doc_id,
          chunk_id: row.chunk_id,
          score: row.score,
          cos_dist: row.cos_dist,
          chunk: row.chunk,
          src: row.src,
          created_at: row.created_at
        }));

        return {
          success: true,
          query,
          k,
          weights: data.weights,
          items
        };
      } catch (err: any) {
        console.error('[RAG Tool] Error:', err?.message || err);
        return {
          success: false,
          error: err?.message || 'RAG tool error',
          items: []
        };
      }
    }
  });
}
```

**Key points:**
- Uses `makeZodTool` (same as memory_op, knowledge_graph)
- Calls `/api/rag/search` internally
- Returns structured results for agent to use
- TODO: Replace mock embedding with real embedding model call

---

## Step 3: Register RAG Tool in createAgentTools()

**File:** `apps/backend/src/agents/lang/tools/agentFactoryTools.ts`

**Current return (line 109):**
```typescript
return [memoryTool, kgTool, kgQueryTool];
```

**Change to:**
```typescript
import { createRagTool } from '../tools/rag';  // Add import at top

// ... inside createAgentTools function, before return:
const ragTool = createRagTool();

return [memoryTool, kgTool, kgQueryTool, ragTool];
```

**That's it.** Agent-0 now has `rag_search` as a tool.

---

## Step 4: Test Agent-0 with RAG

**Endpoint:** `POST /api/agents/boss`

**Request:**
```json
{
  "goal": "Use the rag_search tool to find information about LiquidAIty and summarize what you find."
}
```

**Expected response:**
- Agent calls `rag_search` tool
- Tool returns chunks from your KB
- Agent summarizes and includes in answer
- Logs show `[RAG Tool]` messages

**Test with curl:**
```bash
curl -X POST http://localhost:4000/api/agents/boss \
  -H "Content-Type: application/json" \
  -d '{"goal":"Use rag_search to find info about LiquidAIty and summarize it."}'
```

---

## Step 5: Wire One MCP Tool (brave-search)

**File:** `apps/backend/src/agents/tools/mcp.ts`

**Current:** Just a catalog of MCP servers (no execution).

**Add a new function at the end:**

```typescript
import { z } from 'zod';
import { makeZodTool } from '../lang/tools/zodTools';

export function createMcpSearchTool() {
  return makeZodTool({
    name: 'mcp_web_search',
    description: 'Search the web using Brave Search via MCP. Returns top results with title, URL, and snippet.',
    schema: z.object({
      query: z.string().describe('Search query'),
      count: z.number().int().min(1).max(20).default(5).describe('Number of results')
    }),
    func: async ({ query, count }) => {
      try {
        // Call the MCP execute-tool endpoint
        const res = await fetch('http://localhost:4000/api/mcp/execute-tool', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            server: 'brave-search',  // or whatever MCP server name is configured
            tool: 'search',
            input: { query, count }
          })
        });

        if (!res.ok) {
          return {
            success: false,
            error: `MCP search failed: HTTP ${res.status}`,
            results: []
          };
        }

        const data = await res.json();
        if (!data.ok) {
          return {
            success: false,
            error: data.error || 'Unknown MCP error',
            results: []
          };
        }

        // Transform results
        const results = (data.results || []).map((r: any) => ({
          title: r.title,
          url: r.url,
          snippet: r.snippet
        }));

        return {
          success: true,
          query,
          count,
          results
        };
      } catch (err: any) {
        console.error('[MCP Search Tool] Error:', err?.message || err);
        return {
          success: false,
          error: err?.message || 'MCP search tool error',
          results: []
        };
      }
    }
  });
}
```

---

## Step 6: Register MCP Tool in createAgentTools()

**File:** `apps/backend/src/agents/lang/tools/agentFactoryTools.ts`

**Add import at top:**
```typescript
import { createMcpSearchTool } from '../tools/mcp';
```

**Change return (line 109):**
```typescript
const ragTool = createRagTool();
const mcpSearchTool = createMcpSearchTool();

return [memoryTool, kgTool, kgQueryTool, ragTool, mcpSearchTool];
```

**Agent-0 now has `mcp_web_search` as a tool.**

---

## Step 7: Test Agent-0 with MCP

**Endpoint:** `POST /api/agents/boss`

**Request:**
```json
{
  "goal": "Use mcp_web_search to find recent news about AI and summarize the top 3 results."
}
```

**Expected:**
- Agent calls `mcp_web_search` tool
- Tool hits `/api/mcp/execute-tool`
- Results returned and summarized
- Logs show `[MCP Search Tool]` messages

---

## Step 8: SIM Integration Pattern

Once Steps 1–7 are done, SIM can talk to your agent in two ways:

### Pattern A: SIM → Agent-0 (full orchestration)

**In SIM UI, create an HTTP tool:**
```json
{
  "name": "liquidaity_agent",
  "type": "http",
  "method": "POST",
  "url": "http://localhost:4000/api/agents/boss",
  "headers": {
    "Content-Type": "application/json"
  },
  "body": {
    "goal": "{{ input }}"
  }
}
```

**Then in any SIM workflow:**
```
[User Input] → liquidaity_agent → [Agent-0 with RAG + MCP] → [Output]
```

### Pattern B: SIM → RAG Search (direct KB lookup)

**In SIM UI, create another HTTP tool:**
```json
{
  "name": "liquidaity_rag_search",
  "type": "http",
  "method": "POST",
  "url": "http://localhost:4000/api/rag/search",
  "headers": {
    "Content-Type": "application/json"
  },
  "body": {
    "embedding": "{{ embedding_vector }}",
    "k": 5,
    "w_rec": 0.1,
    "w_sig": 0.1
  }
}
```

**Use this when SIM needs raw KB search without full agent orchestration.**

---

## Checklist

- [ ] Step 1: Run `test-rag-search.ps1` and confirm ✓ PASSED
- [ ] Step 2: Replace `agents/tools/rag.ts` with real implementation
- [ ] Step 3: Add `ragTool` to `createAgentTools()` return
- [ ] Step 4: Test `/api/agents/boss` with RAG prompt
- [ ] Step 5: Add `createMcpSearchTool()` to `agents/tools/mcp.ts`
- [ ] Step 6: Add `mcpSearchTool` to `createAgentTools()` return
- [ ] Step 7: Test `/api/agents/boss` with MCP prompt
- [ ] Step 8: Document SIM HTTP tool patterns (copy JSON above)

---

## Next: What to Do After This

1. **Real embeddings:** Replace mock embedding in rag.ts with actual call to OpenAI text-embedding-3-small or similar.
2. **MCP server setup:** Ensure brave-search (or chosen MCP server) is actually installed and running.
3. **Error handling:** Add retry logic and better error messages.
4. **Caching:** Add Redis layer for hot RAG queries.
5. **Auth:** Add bearer token validation if needed.

---

**Status:** Ready to implement  
**Estimated time:** 30 min (Steps 1–7), 10 min (Step 8)
