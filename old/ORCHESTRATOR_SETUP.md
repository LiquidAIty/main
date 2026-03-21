# LiquidAIty Orchestrator Setup

## Overview

The LiquidAIty orchestrator integrates:
- **Neo4j** - Knowledge graph (entities, relations, vectors, signals, forecasts, provenance)
- **Graphlit MCP** - RAG ingestion/retrieval (we don't maintain data connectors)
- **InfraNodus MCP** - Topic gaps and research-question generation
- **ESN-RLS** - Online time-series forecasting microservice
- **LangGraph** - Agent orchestration

## Quick Start

### 1. Neo4j (Docker)

```bash
docker run -d --name neo4j \
  -p 7474:7474 -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/changeme \
  -e NEO4J_dbms_security_procedures_unrestricted=apoc.* \
  neo4j:5.24
```

### 2. ESN-RLS Microservice

```bash
cd services/esn_rls
python3 -m venv .venv && source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

Service runs on http://localhost:5055

### 3. Backend (with env)

```bash
cd apps/backend
cp ../../.env.example ../../.env   # fill keys/urls
npm install
npm run build
npm start
```

## Environment Variables

Required in `.env`:

```bash
# Neo4j
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=changeme

# Graphlit MCP (optional - for RAG)
GRAPHLIT_MCP_URL=https://your-graphlit-mcp
GRAPHLIT_API_KEY=gl_***

# InfraNodus MCP (optional - for gap analysis)
INFRANODUS_MCP_URL=https://smithery/infranodus
INFRANODUS_API_KEY=in_***

# ESN-RLS
ESN_SERVICE_URL=http://localhost:5055

# OpenAI
OPENAI_API_KEY=sk-***
```

## API Endpoints

### Main Orchestrator

**POST /api/agent/boss**

Full pipeline: ingest → build KG → enrich with gaps → forecast with ESN → answer with RAG → write back to KG

```bash
curl -X POST http://localhost:4000/api/agent/boss \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "demo",
    "goal": "What are the main themes in the attached PDF and who are the key entities?",
    "mode": "full"
  }'
```

Response:
```json
{
  "ok": true,
  "result": {
    "answer": "## Analysis Results...",
    "entities": [{"id": "...", "labels": ["Entity"], "properties": {...}}],
    "docs": [{"id": "...", "content": "...", "score": 0.95}],
    "gaps": [{"from": "topic1", "to": "topic2", "strength": 0.8}],
    "forecasts": [{"entityId": "...", "horizon": 14, "model": "ESN-RLS"}],
    "writes": {
      "entities": ["entity-1", "entity-2"],
      "relations": ["doc-1-ABOUT->entity-1"],
      "gaps": ["gap-topic1-topic2"],
      "forecasts": ["forecast-entity-1-123456"]
    }
  }
}
```

### Legacy Mode

Use `"mode": "legacy"` to run the old orchestrator behavior.

### MCP Proxy Routes

**POST /api/mcp/graphlit/ingest** - Ingest URL/file/text  
**POST /api/mcp/graphlit/retrieve** - Retrieve documents  
**POST /api/mcp/infranodus/content-gaps** - Find content gaps  
**POST /api/mcp/infranodus/generate-questions** - Generate research questions

## Architecture

### Pipeline Flow

```
User Query
    ↓
plan (extract entities)
    ↓
ingest_or_retrieve (Graphlit MCP)
    ↓
build_kg (write to Neo4j)
    ↓
gap_enrich (InfraNodus MCP)
    ↓
forecast (ESN-RLS if time-series exists)
    ↓
compose_answer (assemble response)
    ↓
Result
```

### Data Flow

1. **Entities** → Neo4j `(:Entity {id, name, ...})`
2. **Documents** → Neo4j `(:Document)-[:ABOUT]->(:Entity)`
3. **Gaps** → Neo4j `(:Gap {from, to, strength})`
4. **Forecasts** → Neo4j `(:Forecast {model:'ESN-RLS', horizon:14})-[:FOR]->(:Entity)`
5. **Time Series** → Neo4j `(:Entity)-[:HAS_SIGNAL]->(:Signal {points:[{t,v}]})`

## Testing

### RAG Only

```bash
curl -X POST http://localhost:4000/api/agent/boss \
  -H "Content-Type: application/json" \
  -d '{"goal":"What are the main themes in the attached PDF and who are the key entities?"}'
```

Expect: `result.answer` + `result.writes.entities[]`

### Gap Analysis

```bash
curl -X POST http://localhost:4000/api/agent/boss \
  -H "Content-Type: application/json" \
  -d '{"goal":"Find gaps across the last 5 press releases of ACME and propose research questions"}'
```

Expect: `result.gaps[]` populated via InfraNodus

### Forecast

Pre-load time-series data, then:

```bash
curl -X POST http://localhost:4000/api/agent/boss \
  -H "Content-Type: application/json" \
  -d '{"goal":"Forecast next 14 days for ACME daily sales and link to drivers"}'
```

Expect: `result.forecasts[0].horizon==14`

### End-to-End Write-Back

Check Neo4j has:
- `(:Forecast)-[:FOR]->(:Entity)`
- `(:Gap)-[:BETWEEN]->(:Topic)`

```cypher
MATCH (f:Forecast)-[:FOR]->(e:Entity)
RETURN f, e
LIMIT 10
```

## Developer Notes

- **Graphlit** handles ingestion/embeddings/retrieval via MCP (no data connector maintenance)
- **InfraNodus** provides topic gaps and research-question generation
- **Neo4j** is the system of record (entities, relations, vectors, signals, forecasts, provenance)
- **ESN-RLS** is an online learner—later add Prophet/Chronos/ARIMA as parallel models under `(:Forecast {model})`

## Troubleshooting

**Neo4j connection failed:**
- Check `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD` in `.env`
- Verify Neo4j is running: `docker ps | grep neo4j`

**ESN service unavailable:**
- Check service is running: `curl http://localhost:5055/health`
- Graceful fallback: orchestrator continues without forecasts

**MCP services not configured:**
- Graphlit/InfraNodus are optional
- Orchestrator logs warnings but continues

**Build errors:**
- Run `nx build backend` to check TypeScript errors
- Check all imports resolve correctly

## Commit Message

```
feat(orchestrator): wire Graphlit (MCP) + InfraNodus (MCP) + Neo4j + ESN-RLS into LangGraph pipeline; minimal connectors and endpoints; no breaking API changes
```
