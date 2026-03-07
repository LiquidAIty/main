"""KnowGraph ingestion pipeline using Neo4j GraphRAG KG Builder."""

from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from neo4j import Driver, GraphDatabase
from neo4j_graphrag.embeddings.openai import OpenAIEmbeddings
from neo4j_graphrag.embeddings.sentence_transformers import (
    SentenceTransformerEmbeddings,
)
from neo4j_graphrag.experimental.components.text_splitters.base import TextSplitter
from neo4j_graphrag.experimental.components.types import (
    LexicalGraphConfig,
    TextChunk,
    TextChunks,
)
from neo4j_graphrag.experimental.pipeline.kg_builder import SimpleKGPipeline
from neo4j_graphrag.llm.openai_llm import OpenAILLM

from neo4j_index import ensure_vector_index
from schema import KNOWGRAPH_SCHEMA

load_dotenv()

DEFAULT_CHUNK_SIZE = 1400
DEFAULT_CHUNK_OVERLAP = 200
DEFAULT_CHUNK_APPROXIMATE = True


def _sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class ChunkSpan:
    start_char: int
    end_char: int
    text: str


@dataclass(frozen=True)
class RuntimeModelConfig:
    provider: str
    model_key: str | None
    model_id: str
    llm_client_kwargs: dict[str, Any]
    embedding_backend: str
    embedding_model: str
    embedding_dimensions: int
    embedding_client_kwargs: dict[str, Any]


def _optional_env(name: str) -> str | None:
    value = os.getenv(name)
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed or None


def _optional_int_env(name: str) -> int | None:
    raw = _optional_env(name)
    if raw is None:
        return None
    try:
        value = int(raw)
    except Exception:
        return None
    if value <= 0:
        return None
    return value


def _adjust_chunk_start(text: str, approximate_start: int) -> int:
    start = approximate_start
    if start > 0 and not text[start].isspace() and not text[start - 1].isspace():
        while start > 0 and not text[start - 1].isspace():
            start -= 1
        if start == 0 and text and not text[0].isspace():
            start = approximate_start
    return start


def _adjust_chunk_end(text: str, start: int, approximate_end: int) -> int:
    end = approximate_end
    if end < len(text):
        while end > start and not text[end].isspace() and not text[end - 1].isspace():
            end -= 1
        if end == start:
            end = approximate_end
    return end


def _split_with_offsets(
    text: str,
    chunk_size: int,
    chunk_overlap: int,
    approximate: bool,
) -> list[ChunkSpan]:
    if chunk_size <= 0:
        raise ValueError("chunk_size must be > 0")
    if chunk_overlap >= chunk_size:
        raise ValueError("chunk_overlap must be < chunk_size")
    if not text:
        return []

    step = chunk_size - chunk_overlap
    chunks: list[ChunkSpan] = []
    approximate_start = 0
    skip_adjust_chunk_start = False
    text_length = len(text)
    end = 0

    while end < text_length:
        if approximate:
            start = (
                approximate_start
                if skip_adjust_chunk_start
                else _adjust_chunk_start(text, approximate_start)
            )
            approximate_end = min(start + chunk_size, text_length)
            end = _adjust_chunk_end(text, start, approximate_end)
            skip_adjust_chunk_start = end == approximate_end
        else:
            start = approximate_start
            end = min(start + chunk_size, text_length)

        chunk_text = text[start:end]
        chunks.append(ChunkSpan(start_char=start, end_char=end, text=chunk_text))
        approximate_start = start + step

    return chunks


class DeterministicFixedSizeSplitter(TextSplitter):
    """Splitter that assigns deterministic chunk ids from content and offsets."""

    def __init__(
        self,
        *,
        project_id: str,
        document_id: str,
        chunk_size: int = DEFAULT_CHUNK_SIZE,
        chunk_overlap: int = DEFAULT_CHUNK_OVERLAP,
        approximate: bool = DEFAULT_CHUNK_APPROXIMATE,
    ) -> None:
        self.project_id = project_id
        self.document_id = document_id
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.approximate = approximate

    async def run(self, text: str) -> TextChunks:
        spans = _split_with_offsets(
            text=text,
            chunk_size=self.chunk_size,
            chunk_overlap=self.chunk_overlap,
            approximate=self.approximate,
        )
        chunks: list[TextChunk] = []
        for index, span in enumerate(spans):
            text_hash = _sha256_hex(span.text)
            chunk_key = f"{self.document_id}:{span.start_char}:{span.end_char}:{text_hash}"
            chunk_id = _sha256_hex(chunk_key)
            metadata = {
                "chunk_id": chunk_id,
                "start_char": span.start_char,
                "end_char": span.end_char,
                "text_hash": text_hash,
                "project_id": self.project_id,
                "document_id": self.document_id,
            }
            chunks.append(
                TextChunk(
                    text=span.text,
                    index=index,
                    metadata=metadata,
                    uid=chunk_id,
                )
            )
        return TextChunks(chunks=chunks)


def _required_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required env var: {name}")
    return value


def _normalize_provider(provider: str | None) -> str:
    normalized = (provider or "").strip().lower()
    if not normalized:
        return "openai"
    if normalized in ("openai", "openrouter"):
        return normalized
    raise RuntimeError(f"Unsupported provider: {provider}")


def _normalize_base_url(url: str | None) -> str | None:
    if not url:
        return None
    trimmed = url.strip().rstrip("/")
    return trimmed or None


def _resolve_openrouter_openai_base_url() -> str:
    explicit = _normalize_base_url(_optional_env("OPENROUTER_OPENAI_BASE_URL"))
    if explicit:
        return explicit
    configured = _normalize_base_url(_optional_env("OPENROUTER_BASE_URL"))
    if not configured:
        return "https://openrouter.ai/api/v1"
    if configured.endswith("/v1"):
        return configured
    if configured.endswith("/api"):
        return f"{configured}/v1"
    return f"{configured}/api/v1"


def _build_openrouter_client_kwargs(api_key: str, base_url: str) -> dict[str, Any]:
    kwargs: dict[str, Any] = {"api_key": api_key, "base_url": base_url}
    default_headers: dict[str, str] = {}
    referer = _optional_env("OPENROUTER_HTTP_REFERER")
    title = _optional_env("OPENROUTER_X_TITLE") or _optional_env("OPENROUTER_APP_TITLE")
    if referer:
        default_headers["HTTP-Referer"] = referer
    if title:
        default_headers["X-Title"] = title
    if default_headers:
        kwargs["default_headers"] = default_headers
    return kwargs


def _normalize_embedding_backend(value: str | None, *, default: str) -> str:
    normalized = (value or "").strip().lower()
    if not normalized:
        return default
    if normalized in ("openai", "openai_compatible", "openai-compatible"):
        return "openai_compatible"
    if normalized in ("sentence_transformers", "sentence-transformers", "sentence"):
        return "sentence_transformers"
    raise RuntimeError(f"Unsupported embedding backend: {value}")


def _resolve_runtime_model_config(
    *,
    provider: str | None,
    model_key: str | None,
    model_id: str | None,
) -> RuntimeModelConfig:
    normalized_provider = _normalize_provider(provider)
    requested_model_key = (model_key or "").strip() or None
    resolved_model_id = (
        (model_id or "").strip()
        or requested_model_key
        or _optional_env("KNOWGRAPH_LLM_MODEL")
        or "gpt-4o-mini"
    )
    global_embedding_backend = _normalize_embedding_backend(
        _optional_env("KNOWGRAPH_EMBEDDING_BACKEND"),
        default="openai_compatible",
    )
    global_embedding_model = _optional_env("KNOWGRAPH_EMBEDDING_MODEL") or "text-embedding-3-large"
    global_embedding_dim = _optional_int_env("KNOWGRAPH_EMBEDDING_DIM") or 3072

    if normalized_provider == "openai":
        api_key = _required_env("OPENAI_API_KEY")
        base_url = _normalize_base_url(_optional_env("OPENAI_BASE_URL"))
        llm_kwargs: dict[str, Any] = {"api_key": api_key}
        embedding_kwargs: dict[str, Any] = {}
        openai_embedding_backend = _normalize_embedding_backend(
            _optional_env("KNOWGRAPH_OPENAI_EMBEDDING_BACKEND"),
            default=global_embedding_backend,
        )
        openai_embedding_model = (
            _optional_env("KNOWGRAPH_OPENAI_EMBEDDING_MODEL")
            or global_embedding_model
        )
        openai_embedding_dim = (
            _optional_int_env("KNOWGRAPH_OPENAI_EMBEDDING_DIM")
            or global_embedding_dim
        )
        if openai_embedding_backend == "openai_compatible":
            embedding_kwargs = {"api_key": api_key}
        elif openai_embedding_backend == "sentence_transformers":
            # local embedding model; no API key/base URL required
            embedding_kwargs = {}
        if base_url:
            llm_kwargs["base_url"] = base_url
            if openai_embedding_backend == "openai_compatible":
                embedding_kwargs["base_url"] = base_url
        return RuntimeModelConfig(
            provider=normalized_provider,
            model_key=requested_model_key,
            model_id=resolved_model_id,
            llm_client_kwargs=llm_kwargs,
            embedding_backend=openai_embedding_backend,
            embedding_model=openai_embedding_model,
            embedding_dimensions=openai_embedding_dim,
            embedding_client_kwargs=embedding_kwargs,
        )

    if normalized_provider == "openrouter":
        api_key = _required_env("OPENROUTER_API_KEY")
        base_url = _resolve_openrouter_openai_base_url()
        openrouter_embedding_backend = _normalize_embedding_backend(
            _optional_env("KNOWGRAPH_OPENROUTER_EMBEDDING_BACKEND"),
            default="sentence_transformers",
        )
        openrouter_embedding_model = (
            _optional_env("KNOWGRAPH_OPENROUTER_EMBEDDING_MODEL")
            or _optional_env("KNOWGRAPH_SENTENCE_TRANSFORMERS_MODEL")
            or ("all-MiniLM-L6-v2" if openrouter_embedding_backend == "sentence_transformers" else global_embedding_model)
        )
        openrouter_embedding_dim = (
            _optional_int_env("KNOWGRAPH_OPENROUTER_EMBEDDING_DIM")
            or _optional_int_env("KNOWGRAPH_SENTENCE_TRANSFORMERS_DIM")
            or (384 if openrouter_embedding_backend == "sentence_transformers" else global_embedding_dim)
        )
        client_kwargs = _build_openrouter_client_kwargs(api_key, base_url)
        embedding_kwargs = dict(client_kwargs) if openrouter_embedding_backend == "openai_compatible" else {}
        return RuntimeModelConfig(
            provider=normalized_provider,
            model_key=requested_model_key,
            model_id=resolved_model_id,
            llm_client_kwargs=dict(client_kwargs),
            embedding_backend=openrouter_embedding_backend,
            embedding_model=openrouter_embedding_model,
            embedding_dimensions=openrouter_embedding_dim,
            embedding_client_kwargs=embedding_kwargs,
        )

    raise RuntimeError(f"Unsupported provider: {provider}")


def _merge_ingested_graph(
    driver: Driver,
    *,
    database: str | None,
    project_id: str,
    document_id: str,
    file_path: str,
) -> None:
    merge_cypher = """
    MERGE (doc:Document {project_id: $project_id, document_id: $document_id})
    ON CREATE SET doc.created_at = datetime()
    SET doc.path = $file_path,
        doc.source_name = $source_name,
        doc.ingested_at = datetime(),
        doc.project_id = $project_id,
        doc.document_id = $document_id
    WITH doc
    MATCH (raw_doc:Document {project_id: $project_id, document_id: $document_id})
    MATCH (raw_chunk:Chunk)-[:HAS_CHUNK]->(raw_doc)
    WITH doc, raw_chunk, coalesce(raw_chunk.chunk_id, raw_chunk.id) AS chunk_key
    WHERE chunk_key IS NOT NULL
    MERGE (chunk:Chunk {project_id: $project_id, document_id: $document_id, chunk_id: chunk_key})
    SET chunk.text = coalesce(raw_chunk.text, chunk.text),
        chunk.chunk_index = coalesce(raw_chunk.chunk_index, raw_chunk.index, chunk.chunk_index),
        chunk.start_char = coalesce(raw_chunk.start_char, chunk.start_char),
        chunk.end_char = coalesce(raw_chunk.end_char, chunk.end_char),
        chunk.text_hash = coalesce(raw_chunk.text_hash, chunk.text_hash),
        chunk.embedding = coalesce(raw_chunk.embedding, chunk.embedding),
        chunk.project_id = $project_id,
        chunk.document_id = $document_id
    MERGE (doc)-[:HAS_CHUNK]->(chunk)
    """
    driver.execute_query(
        merge_cypher,
        project_id=project_id,
        document_id=document_id,
        file_path=file_path,
        source_name=Path(file_path).name,
        database_=database,
    )

    provenance_cypher = """
    MATCH (raw_doc:Document {project_id: $project_id, document_id: $document_id})
    MATCH (raw_chunk:Chunk)-[:HAS_CHUNK]->(raw_doc)
    WITH raw_chunk, coalesce(raw_chunk.chunk_id, raw_chunk.id) AS chunk_key
    WHERE chunk_key IS NOT NULL
    MATCH (chunk:Chunk {project_id: $project_id, document_id: $document_id, chunk_id: chunk_key})
    MATCH (entity)-[:MENTIONS]->(raw_chunk)
    WHERE NOT entity:Chunk AND NOT entity:Document
    SET entity.project_id = $project_id,
        entity.document_id = $document_id
    MERGE (chunk)-[m:MENTIONS]->(entity)
    SET m.project_id = $project_id,
        m.document_id = $document_id,
        m.chunk_id = chunk.chunk_id
    """
    driver.execute_query(
        provenance_cypher,
        project_id=project_id,
        document_id=document_id,
        database_=database,
    )

    relationship_provenance_cypher = """
    MATCH (chunk:Chunk {project_id: $project_id, document_id: $document_id})-[:MENTIONS]->(entity)
    MATCH (entity)-[rel]->(target)
    WHERE type(rel) <> 'MENTIONS'
      AND NOT target:Chunk
      AND NOT target:Document
    SET rel.project_id = $project_id,
        rel.document_id = $document_id
    """
    driver.execute_query(
        relationship_provenance_cypher,
        project_id=project_id,
        document_id=document_id,
        database_=database,
    )


async def ingest_pdf(
    file_path: str,
    project_id: str,
    document_id: str,
    *,
    provider: str | None = None,
    model_key: str | None = None,
    model_id: str | None = None,
    agent_id: str | None = None,
) -> dict[str, Any]:
    """Run GraphRAG KG Builder ingestion for a PDF file."""
    source = Path(file_path)
    if not source.exists():
        raise FileNotFoundError(f"File not found: {file_path}")

    uri = _required_env("NEO4J_URI")
    user = _required_env("NEO4J_USER")
    password = _required_env("NEO4J_PASSWORD")
    neo4j_database = os.getenv("NEO4J_DATABASE") or None

    runtime = _resolve_runtime_model_config(
        provider=provider,
        model_key=model_key,
        model_id=model_id,
    )
    print(
        f"[KNOWGRAPH_RUNTIME] project_id={project_id} document_id={document_id} provider={runtime.provider} "
        f"model={runtime.model_id} embedding_backend={runtime.embedding_backend} "
        f"embedding_model={runtime.embedding_model} embedding_dim={runtime.embedding_dimensions} "
        f"agent_id={agent_id or 'n/a'}"
    )
    llm = OpenAILLM(
        model_name=runtime.model_id,
        # KG Builder extraction uses structured response_format under the hood.
        model_params={"temperature": 0},
        **runtime.llm_client_kwargs,
    )
    if runtime.embedding_backend == "sentence_transformers":
        embedder = SentenceTransformerEmbeddings(model=runtime.embedding_model)
    elif runtime.embedding_backend == "openai_compatible":
        embedder = OpenAIEmbeddings(
            model=runtime.embedding_model,
            **runtime.embedding_client_kwargs,
        )
    else:
        raise RuntimeError(f"Unsupported embedding backend: {runtime.embedding_backend}")
    splitter = DeterministicFixedSizeSplitter(
        project_id=project_id,
        document_id=document_id,
        chunk_size=DEFAULT_CHUNK_SIZE,
        chunk_overlap=DEFAULT_CHUNK_OVERLAP,
        approximate=DEFAULT_CHUNK_APPROXIMATE,
    )
    lexical_graph_config = LexicalGraphConfig(
        document_node_label="Document",
        chunk_node_label="Chunk",
        chunk_to_document_relationship_type="HAS_CHUNK",
        next_chunk_relationship_type="RELATED_TO",
        node_to_chunk_relationship_type="MENTIONS",
        chunk_id_property="chunk_id",
        chunk_index_property="chunk_index",
        chunk_text_property="text",
        chunk_embedding_property="embedding",
    )

    driver = GraphDatabase.driver(uri, auth=(user, password))
    try:
        driver.verify_connectivity()
        ensure_vector_index(
            driver,
            neo4j_database,
            dimensions=runtime.embedding_dimensions,
        )

        pipeline = SimpleKGPipeline(
            llm=llm,
            driver=driver,
            embedder=embedder,
            schema=KNOWGRAPH_SCHEMA,
            from_pdf=True,
            text_splitter=splitter,
            on_error="RAISE",
            perform_entity_resolution=True,
            lexical_graph_config=lexical_graph_config,
            neo4j_database=neo4j_database,
        )

        result = await pipeline.run_async(
            file_path=str(source),
            document_metadata={
                "project_id": project_id,
                "document_id": document_id,
                "source_path": str(source.resolve()),
                "source_name": source.name,
            },
        )

        _merge_ingested_graph(
            driver,
            database=neo4j_database,
            project_id=project_id,
            document_id=document_id,
            file_path=str(source.resolve()),
        )
        ensure_vector_index(
            driver,
            neo4j_database,
            dimensions=runtime.embedding_dimensions,
        )

        return {
            "run_id": result.run_id,
            "project_id": project_id,
            "document_id": document_id,
            "provider": runtime.provider,
            "model_key": runtime.model_key,
            "model": runtime.model_id,
            "agent_id": agent_id,
        }
    finally:
        driver.close()
