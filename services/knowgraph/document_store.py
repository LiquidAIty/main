"""Immutable source passages and vector retrieval in KnowGraph's existing Neo4j."""
# Entity: KnowGraph
# Relationship: Stores versioned raw documents and exact source passages separately from verified Knows and visible Entities, using the existing Neo4j and embedding owners.
# Entity: Document Retrieval
# Relationship: Embeds bounded batches, publishes an import atomically, and returns Project-scoped semantic matches with exact source context and no automatic knowledge extraction.

from __future__ import annotations

import asyncio
import hashlib
import json
import math
from datetime import date, datetime, timezone
from typing import Any
from uuid import NAMESPACE_URL, uuid5

import graphiti_runtime
from graphiti_identity import graphiti_project_group_id

MAX_DOCUMENT_CHARS = 2_000_000
MAX_PAGES = 2_000
MAX_PASSAGES = 4_000
PASSAGE_CHARS = 1_800
PASSAGE_OVERLAP = 180
EXTRACTION_VERSION = "page-text-v1"
CHUNKING_VERSION = "page-paragraph-v1"
_INGEST_LOCK = asyncio.Lock()


def _text(value: Any, field: str, limit: int = 256) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > limit or "\x00" in value:
        raise ValueError(f"document_{field}_invalid")
    return value.strip()


def _identity(*parts: Any) -> str:
    return str(uuid5(NAMESPACE_URL, "source-document:" + json.dumps(parts, ensure_ascii=False)))


def passage_spans(text: str, size: int = PASSAGE_CHARS, overlap: int = PASSAGE_OVERLAP) -> list[tuple[int, int]]:
    """Unicode character offsets into unmodified extracted page text; end exclusive."""
    if size <= 0 or overlap < 0 or overlap >= size:
        raise ValueError("document_chunk_parameters_invalid")
    spans = []
    start = 0
    while start < len(text):
        end = min(start + size, len(text))
        if end < len(text):
            paragraph = text.rfind("\n\n", start + size // 2, end)
            if paragraph >= 0:
                end = paragraph + 2
        if text[start:end].strip():
            spans.append((start, end))
        if end == len(text):
            break
        start = max(start + 1, end - overlap)
    return spans


def _embedding_space(runtime: Any) -> tuple[str, str, str]:
    identity = json.dumps([runtime.provider, runtime.embedding_model, runtime.embedding_dimensions,
                           runtime.embedding_client_kwargs.get("base_url", "https://api.openai.com/v1")])
    space = hashlib.sha256(identity.encode()).hexdigest()
    # Only generated hex enters Cypher identifiers. Different model spaces never
    # share a vector label/index, even when their dimensions happen to match.
    return space, f"DocumentEmbedding_{space[:16]}", f"document_vector_{space[:16]}"


def _vectors(values: Any, count: int, dimensions: int) -> list[list[float]]:
    if not isinstance(values, list) or len(values) != count:
        raise ValueError("document_embedding_count_invalid")
    for vector in values:
        if not isinstance(vector, list) or len(vector) != dimensions or not any(vector):
            raise ValueError("document_embedding_dimension_invalid")
        if any(isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x) for x in vector):
            raise ValueError("document_embedding_value_invalid")
    return values


async def _indexes(driver: Any, runtime: Any) -> str:
    _space, label, name = _embedding_space(runtime)
    for node in ("DocumentVersion", "DocumentPage", "DocumentPassage"):
        await driver.execute_query(
            f"CREATE CONSTRAINT {node.lower()}_identity IF NOT EXISTS FOR (n:{node}) REQUIRE n.uuid IS UNIQUE")
    await driver.execute_query(
        f"CREATE VECTOR INDEX {name} IF NOT EXISTS FOR (p:{label}) ON (p.embedding) "
        "OPTIONS {indexConfig: {`vector.dimensions`: $dimensions, `vector.similarity_function`: 'cosine'}}",
        dimensions=runtime.embedding_dimensions,
    )
    await driver.execute_query("CALL db.awaitIndex($name, 60)", name=name)
    return name


def _public_document(properties: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in properties.items() if key != "source_execution_json"} | {
        "source_execution": json.loads(properties.get("source_execution_json") or "null"),
    }


async def _existing(driver: Any, project_id: str, version_id: str) -> dict[str, Any] | None:
    rows = graphiti_runtime.graphiti_records(await driver.execute_query(
        "MATCH (d:DocumentVersion {uuid:$uuid,project_id:$project}) RETURN properties(d) AS document",
        uuid=version_id, project=project_id, routing_="r",
    ))
    return dict(rows[0]["document"]) if rows else None


async def ingest_pages(*, project_id: str, document_id: str, pages: list[str], source_name: str,
                       source_reference: str, source_checksum: str, publication_date: str | None = None,
                       source_url: str | None = None, source_execution: dict | None = None) -> dict[str, Any]:
    project_id = _text(project_id, "project")
    group = graphiti_project_group_id(project_id)
    document_id = _text(document_id, "id")
    source_name = _text(source_name, "name", 512)
    source_reference = _text(source_reference, "reference", 4096)
    if not isinstance(source_checksum, str) or len(source_checksum) != 64 or any(c not in "0123456789abcdef" for c in source_checksum):
        raise ValueError("document_checksum_invalid")
    if publication_date:
        date.fromisoformat(publication_date)
    if source_url and not source_url.startswith(("https://", "http://")):
        raise ValueError("document_source_url_invalid")
    if (not pages or len(pages) > MAX_PAGES or any(not isinstance(page, str) for page in pages)
            or sum(len(page) for page in pages) > MAX_DOCUMENT_CHARS):
        raise ValueError("document_text_limit")
    if not any(page.strip() for page in pages):
        raise ValueError("document_ocr_required")
    version_id = _identity(project_id, document_id, source_checksum)
    passage_rows = [{"uuid": _identity(version_id, page_number, start, end),
                     "page_number": page_number, "start": start, "end": end,
                     "text": text[start:end]}
                    for page_number, text in enumerate(pages, 1) for start, end in passage_spans(text)]
    if len(passage_rows) > MAX_PASSAGES:
        raise ValueError("document_passage_limit")
    if _INGEST_LOCK.locked():
        raise ValueError("document_ingest_busy")
    async with _INGEST_LOCK:
        driver, _database = graphiti_runtime.create_graphiti_driver()
        embedder = None
        try:
            runtime, embedder = graphiti_runtime.create_graphiti_embedder()
            space, label, _index = _embedding_space(runtime)
            existing = await _existing(driver, project_id, version_id)
            if existing:
                if existing.get("embedding_space") != space:
                    raise ValueError("document_embedding_space_changed")
                return {"status": "already_indexed", "idempotent": True,
                        "document": _public_document(existing), "passage_count": existing["passage_count"]}
            await _indexes(driver, runtime)
            for offset in range(0, len(passage_rows), 16):
                batch = passage_rows[offset:offset + 16]
                vectors = _vectors(await embedder.create_batch([row["text"] for row in batch]),
                                   len(batch), runtime.embedding_dimensions)
                for row, vector in zip(batch, vectors, strict=True):
                    row["embedding"] = vector
            properties = {
                "uuid": version_id, "project_id": project_id, "group_id": group,
                "document_id": document_id, "document_version": source_checksum,
                "document_checksum": source_checksum, "source_name": source_name,
                "source_reference": source_reference, "source_url": source_url,
                "publication_date": publication_date, "retrieval_date": datetime.now(timezone.utc).isoformat(),
                "extraction_version": EXTRACTION_VERSION, "chunking_version": CHUNKING_VERSION,
                "embedding_space": space, "embedding_provider": runtime.provider,
                "embedding_model_version": runtime.embedding_model, "embedding_revision_known": False,
                "embedding_dimensions": runtime.embedding_dimensions,
                "page_count": len(pages), "passage_count": len(passage_rows),
                "source_execution_json": json.dumps(source_execution, ensure_ascii=False),
            }
            async with driver.transaction() as tx:
                result = await tx.run("MERGE (d:DocumentVersion {uuid:$uuid}) ON CREATE SET d += $properties "
                                      "RETURN properties(d) AS document", uuid=version_id, properties=properties)
                row = await result.single()
                summary = await result.consume()
                created = summary.counters.nodes_created > 0
                if not row or row["document"].get("embedding_space") != space:
                    raise ValueError("document_version_conflict")
                if created:
                    result = await tx.run(
                        "MATCH (d:DocumentVersion {uuid:$uuid}) UNWIND $pages AS page "
                        "CREATE (p:DocumentPage {uuid:page.uuid,page_number:page.page_number,text:page.text}) "
                        "CREATE (d)-[:HAS_PAGE]->(p)", uuid=version_id,
                        pages=[{"uuid": _identity(version_id, "page", n), "page_number": n, "text": text}
                               for n, text in enumerate(pages, 1)])
                    await result.consume()
                    for offset in range(0, len(passage_rows), 64):
                        result = await tx.run(
                            f"MATCH (d:DocumentVersion {{uuid:$uuid}}) UNWIND $passages AS passage "
                            f"CREATE (p:DocumentPassage:{label}) SET p = passage, p.project_id=$project, "
                            "p.document_id=$document, p.document_version=$version, p.embedding_space=$space "
                            "CREATE (d)-[:HAS_PASSAGE]->(p)", uuid=version_id, project=project_id,
                            document=document_id, version=source_checksum, space=space,
                            passages=passage_rows[offset:offset + 64])
                        await result.consume()
            saved = await _existing(driver, project_id, version_id)
            if not saved or saved["passage_count"] != len(passage_rows):
                raise RuntimeError("document_readback_failed")
            return {"status": "indexed" if created else "already_indexed", "idempotent": not created,
                    "document": _public_document(saved), "passage_count": len(passage_rows)}
        finally:
            await driver.close()
            if embedder is not None:
                await embedder.client.close()


async def ingest_text(*, text: str, source_url: str, **metadata: Any) -> dict[str, Any]:
    _text(text, "text", MAX_DOCUMENT_CHARS)
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    return await ingest_pages(pages=[text], source_checksum=digest, source_reference=source_url,
                              source_url=source_url, **metadata)


def _public_passage(row: Any) -> dict[str, Any]:
    passage = dict(row["passage"])
    passage.pop("embedding", None)
    passage["chunk_id"] = passage.pop("uuid")
    return {**passage, "document": _public_document(dict(row["document"])),
            "offset_basis": "zero-based end-exclusive Unicode characters in retained extracted page text"}


async def search_passages(*, project_id: str, query: str, limit: int = 5,
                          document_ids: list[str] | None = None) -> dict[str, Any]:
    project_id = _text(project_id, "project")
    graphiti_project_group_id(project_id)
    query = _text(query, "query", 2000)
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 20:
        raise ValueError("document_search_limit_invalid")
    if document_ids is not None and (len(document_ids) > 32 or any(not isinstance(x, str) or not x for x in document_ids)):
        raise ValueError("document_filter_invalid")
    driver, _database = graphiti_runtime.create_graphiti_driver()
    embedder = None
    try:
        runtime, embedder = graphiti_runtime.create_graphiti_embedder()
        space, _label, index = _embedding_space(runtime)
        statuses = graphiti_runtime.graphiti_records(await driver.execute_query(
            "SHOW VECTOR INDEXES YIELD name,state WHERE name=$name RETURN state", name=index, routing_="r"))
        if len(statuses) != 1 or statuses[0]["state"] != "ONLINE":
            raise ValueError("document_vector_index_unavailable")
        vector = _vectors([await embedder.create(query)], 1, runtime.embedding_dimensions)[0]
        rows = graphiti_runtime.graphiti_records(await driver.execute_query(
            "CALL db.index.vector.queryNodes($index,$candidates,$vector) YIELD node,score "
            "WITH node,score WHERE node.project_id=$project AND node.embedding_space=$space "
            "AND ($documents IS NULL OR node.document_id IN $documents) "
            "MATCH (d:DocumentVersion {project_id:$project})-[:HAS_PASSAGE]->(node) "
            "RETURN node{.*,embedding:null} AS passage,properties(d) AS document,score "
            "ORDER BY score DESC LIMIT $limit", index=index, candidates=min(256, max(32, limit * 8)),
            vector=vector, project=project_id, space=space, documents=document_ids, limit=limit, routing_="r"))
        return {"matches": [{**_public_passage(row), "similarity": row["score"]} for row in rows],
                "embedding_model_version": runtime.embedding_model,
                "candidate_coverage": "bounded", "exhaustive": False,
                "note": "Similarity is retrieval relevance, not fact verification. Scoped filters can underfill bounded nearest-neighbor results."}
    finally:
        await driver.close()
        if embedder is not None:
            await embedder.client.close()


async def get_passage(*, project_id: str, passage_id: str, context_chars: int = 1200) -> dict[str, Any]:
    project_id = _text(project_id, "project")
    graphiti_project_group_id(project_id)
    passage_id = _text(passage_id, "passage_id")
    if isinstance(context_chars, bool) or not isinstance(context_chars, int) or not 0 <= context_chars <= 4000:
        raise ValueError("document_context_limit_invalid")
    driver, _database = graphiti_runtime.create_graphiti_driver()
    try:
        rows = graphiti_runtime.graphiti_records(await driver.execute_query(
            "MATCH (d:DocumentVersion {project_id:$project})-[:HAS_PASSAGE]->(p:DocumentPassage {uuid:$uuid}) "
            "MATCH (d)-[:HAS_PAGE]->(page:DocumentPage {page_number:p.page_number}) "
            "RETURN p{.*,embedding:null} AS passage,properties(d) AS document,page.text AS page_text",
            project=project_id, uuid=passage_id, routing_="r"))
        if len(rows) != 1:
            raise LookupError("document_passage_not_found")
        value = _public_passage(rows[0])
        page_text = rows[0]["page_text"]
        if page_text[value["start"]:value["end"]] != value["text"]:
            raise RuntimeError("document_passage_integrity_failed")
        start, end = max(0, value["start"] - context_chars), min(len(page_text), value["end"] + context_chars)
        return {**value, "context": {"text": page_text[start:end], "start": start, "end": end}}
    finally:
        await driver.close()
