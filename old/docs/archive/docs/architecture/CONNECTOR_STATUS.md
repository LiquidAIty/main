# Connector Status

This document tracks the status of all external service integrations and connectors.

## MCP (Model Context Protocol)

**Status:** PARTIAL  
**Location:** `apps/backend/src/agents/mcp-controller.ts`, `apps/backend/src/routes/mcp-tools.routes.ts`

### What Works
- Tool registry with hardcoded tool list
- REST API routes for tool management
- Tool listing endpoints
- Install/uninstall endpoints (in-memory only)

### What's Stubbed
- All tool execution returns mock data
- `collectYouTubeData()` - Returns mock transcript
- `collectNewsData()` - Returns mock articles
- `buildKnowledgeGraph()` - Returns mock nodes
- `checkHallucination()` - Returns mock confidence scores

### Configuration
- `apps/backend/mcp.config.json` - MCP server config (filesystem, github, supabase)
- `apps/backend/src/agents/mcp-tool-registry.ts` - awesome-mcp-servers list

### Next Steps
1. Wire real MCP server connections
2. Replace mock data with actual tool execution
3. Test with real MCP servers

---

## n8n (Workflow Automation)

**Status:** STUB  
**Location:** `apps/backend/src/agents/tools/n8n.ts`, `apps/backend/src/agents/connectors/n8n.ts`

### What Works
- Connector interface with env var configuration
- `safeFetch` wrapper for secure HTTP calls
- Webhook URL construction

### What's Stubbed
- `n8nTool.run()` returns fake job ID: `stub-{random}`
- No actual workflow execution
- No real webhook calls

### Configuration
- `N8N_BASE_URL` - Base URL for n8n instance
- `N8N_API_KEY` - API key for authentication
- `N8N_WEBHOOK_URL` - Webhook endpoint
- `ALLOWED_INGEST_HOSTS` - Whitelist for external calls

### Next Steps
1. Configure n8n instance
2. Wire real webhook calls
3. Test workflow execution
4. Handle async workflow results

---

## Graphlit (Document Ingestion)

**Status:** UNCONFIGURED  
**Location:** `apps/backend/src/connectors/graphlit.mcp.ts`

### What Works
- Client wrapper with proper error handling
- API call structure for ingest/embed/retrieve
- URL security checks with `assertUrlAllowed`

### What's Missing
- `GRAPHLIT_MCP_URL` - MCP server URL
- `GRAPHLIT_API_KEY` - API authentication key
- `ALLOWED_INGEST_HOSTS` - Host whitelist configuration

### API Methods
- `ingest(params)` - Ingest URL, file, or text
- `embed(params)` - Generate embeddings
- `retrieve(params)` - Query documents

### Next Steps
1. Set up Graphlit account and get API key
2. Configure environment variables
3. Test ingestion pipeline
4. Integrate with RAG system

---

## InfraNodus (Topic Analysis)

**Status:** UNCONFIGURED  
**Location:** `apps/backend/src/connectors/infranodus.mcp.ts`

### What Works
- Client wrapper with `safeFetch`
- API endpoints for topic analysis
- Proper error handling and timeouts

### What's Missing
- `INFRANODUS_BASE_URL` - API base URL (defaults to `https://api.infranodus.com`)
- `INFRANODUS_API_KEY` - API authentication key
- `ALLOW_HOSTS_INFRANODUS` - Host whitelist

### API Methods
- `topicOverview(text)` - Extract main topics
- `contentGaps(params)` - Find gaps in content
- `generateQuestions(params)` - Generate research questions
- `saveGraph(params)` - Save topic graph

### Next Steps
1. Set up InfraNodus account and get API key
2. Configure environment variables
3. Test topic extraction
4. Integrate with ThinkGraph for gap analysis

---

## Neo4j (KnowGraph)

**Status:** ACTIVE  
**Location:** `services/knowgraph/*`

### What Works
- Python service for PDF ingestion
- Graph queries and traversals
- Entity/relationship extraction
- Evidence-backed fact storage

### Configuration
- Neo4j connection configured in Python service
- Fully operational and production-ready

### Integration
- Used for grounded, evidence-backed knowledge
- Separate from ThinkGraph (provisional reasoning)
- Queried by backend routes at `/api/knowgraph/*`

---

## Apache AGE (ThinkGraph)

**Status:** ACTIVE  
**Location:** `db/` SQL functions, `ag_catalog` schema

### What Works
- Graph storage in PostgreSQL
- Cypher query support
- RAG integration
- Entity/relationship persistence

### Configuration
- PostgreSQL with Apache AGE extension
- Schema: `ag_catalog`
- Fully operational and production-ready

### Integration
- Used for provisional, subjective reasoning
- Separate from KnowGraph (grounded facts)
- Queried by backend routes at `/api/v2/projects/:projectId/kg/*`

---

## Market Data Services

**Status:** MOCK_FALLBACK  
**Location:** `apps/backend/src/services/marketDataService.ts`

### What Works
- Real API integrations for:
  - Alpha Vantage (stocks, forex)
  - Finnhub (stocks)
  - Polygon.io (stocks)

### What's Stubbed
- Falls back to `generateMockStockData()` when API keys missing
- Falls back to `generateMockForexData()` when API keys missing

### Configuration
- `ALPHA_VANTAGE_API_KEY` - Alpha Vantage key
- `FINNHUB_API_KEY` - Finnhub key
- `POLYGON_API_KEY` - Polygon.io key

### Next Steps
1. Configure API keys for production
2. Remove or clearly mark mock fallbacks
3. Add rate limiting and caching

---

## Sentiment Analysis

**Status:** MOCK_FALLBACK  
**Location:** `apps/backend/src/services/sentimentService.ts`

### What Works
- Real Hugging Face API integration
- Batch sentiment analysis

### What's Stubbed
- Falls back to `mockSentimentAnalysis()` when `HUGGINGFACE_API_KEY` missing
- Keyword-based mock sentiment

### Configuration
- `HUGGINGFACE_API_KEY` - Hugging Face API key

### Next Steps
1. Configure Hugging Face API key
2. Remove or clearly mark mock fallback
3. Add caching for repeated queries

---

## Report Generation

**Status:** MOCK_FALLBACK  
**Location:** `apps/backend/src/services/reportGenerationService.ts`

### What Works
- Real Gemini API integration
- Structured report generation

### What's Stubbed
- Falls back to `generateMockReportContent()` when `GEMINI_API_KEY` missing
- Template-based mock reports

### Configuration
- `GEMINI_API_KEY` - Google Gemini API key

### Next Steps
1. Configure Gemini API key
2. Remove or clearly mark mock fallback
3. Add report templates and styling

---

## Media Services (News/Social)

**Status:** MOCK_FALLBACK  
**Location:** `apps/backend/src/services/mediaService.ts`

### What Works
- Real API integrations for:
  - NewsAPI (news articles)
  - Twitter API (social mentions)

### What's Stubbed
- Falls back to `generateMockNewsArticles()` when keys missing
- Falls back to `generateMockSocialMediaMentions()` when keys missing

### Configuration
- `NEWS_API_KEY` - NewsAPI key
- `TWITTER_API_KEY` - Twitter API key

### Next Steps
1. Configure API keys for production
2. Remove or clearly mark mock fallbacks
3. Add caching and rate limiting

---

## Summary Table

| Connector | Status | Real Implementation | Mock/Stub | Needs Config |
|-----------|--------|---------------------|-----------|--------------|
| MCP | PARTIAL | Registry, routes | Tool execution | No |
| n8n | STUB | Interface | All execution | Yes |
| Graphlit | UNCONFIGURED | Client wrapper | N/A | Yes |
| InfraNodus | UNCONFIGURED | Client wrapper | N/A | Yes |
| Neo4j | ACTIVE | Full | None | No |
| Apache AGE | ACTIVE | Full | None | No |
| Market Data | MOCK_FALLBACK | API calls | Fallback | Yes |
| Sentiment | MOCK_FALLBACK | API calls | Fallback | Yes |
| Reports | MOCK_FALLBACK | API calls | Fallback | Yes |
| Media | MOCK_FALLBACK | API calls | Fallback | Yes |

---

## For Graph Import

When the knowledge graph reasons about system capabilities, it should understand:

- **ACTIVE** connectors are production-ready
- **PARTIAL** connectors have real parts but incomplete execution
- **STUB** connectors are placeholders only
- **UNCONFIGURED** connectors are ready but need API keys
- **MOCK_FALLBACK** connectors work but need keys for production use

This helps the system give honest answers about what external integrations actually work.
