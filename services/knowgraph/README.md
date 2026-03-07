# KnowGraph Service

KnowGraph is a Python microservice that ingests attachment PDFs into Neo4j using Neo4j's official GraphRAG KG Builder pipeline.

## Run Locally

1. `python -m venv venv`
2. `venv\Scripts\activate` (Windows) or `source venv/bin/activate` (macOS/Linux)
3. `pip install -r requirements.txt`
4. Set environment variables:
   - `NEO4J_URI`
   - `NEO4J_USER`
   - `NEO4J_PASSWORD`
   - `OPENAI_API_KEY` (for provider `openai`)
   - `OPENROUTER_API_KEY` (for provider `openrouter`)
5. `uvicorn app:app --host 0.0.0.0 --port 8001`

## Smoke Test (Direct)

```bash
curl -X POST "http://localhost:8001/ingest" \
  -F "project_id=test" \
  -F "document_id=doc1" \
  -F "file=@./some.pdf"
```

To force runtime provider/model from Agent Builder, pass headers:

```bash
  -H "x-agent-provider: openrouter" \
  -H "x-agent-model-key: openai/gpt-5-mini" \
  -H "x-agent-model-id: openai/gpt-5-mini"
```

## Acceptance Test (End-to-End)

1. `docker compose up -d --build`
2. Ingest through backend proxy:

```bash
curl -X POST "http://localhost:4000/api/knowgraph/ingest" \
  -F "project_id=test" \
  -F "document_id=doc1" \
  -F "file=@./some.pdf"
```

3. In Neo4j Browser:

```cypher
MATCH (n) RETURN count(n);
```

```cypher
MATCH (:Document)-[:HAS_CHUNK]->(:Chunk) RETURN count(*) as c;
```

`c > 0` indicates successful chunk ingestion into KnowGraph.
