# @graph entity: KnowGraph Ingest
# @graph role: grounded-ingest
# @graph relates_to: KnowGraph, PlanWiki
# @graph depends_on: Neo4j, OpenAI
# @graph feeds_to: KnowGraph
"""KnowGraph ingestion pipeline using Neo4j GraphRAG KG Builder."""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from neo4j import Driver, GraphDatabase
from neo4j_graphrag.embeddings.openai import OpenAIEmbeddings
from neo4j_graphrag.experimental.components.text_splitters.base import TextSplitter
from neo4j_graphrag.experimental.components.types import (
    LexicalGraphConfig,
    TextChunk,
    TextChunks,
)
from neo4j_graphrag.experimental.pipeline.kg_builder import SimpleKGPipeline
from neo4j_graphrag.generation.prompts import ERExtractionTemplate
from neo4j_graphrag.llm.openai_llm import OpenAILLM

from neo4j_index import (
    ensure_knowledge_assertion_fulltext_index,
    ensure_vector_index,
)
from schema import KNOWGRAPH_SCHEMA
from inspection_extraction_provider import (
    build_inspection_extraction_llm_from_env,
    inspection_mode_enabled,
)

load_dotenv()

DEFAULT_CHUNK_SIZE = 1400
DEFAULT_CHUNK_OVERLAP = 200
DEFAULT_CHUNK_APPROXIMATE = True
GRAPH_METADATA_HEADER_LINE_LIMIT = 40


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


@dataclass(frozen=True)
class GraphMetadata:
    entity: str | None = None
    role: str | None = None
    relates_to: tuple[str, ...] = ()
    depends_on: tuple[str, ...] = ()
    feeds_to: tuple[str, ...] = ()

    def is_empty(self) -> bool:
        return not any(
            (
                self.entity,
                self.role,
                self.relates_to,
                self.depends_on,
                self.feeds_to,
            )
        )


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


def _normalize_optional_json_value(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None
        try:
            return json.loads(stripped)
        except Exception:
            return stripped
    return value


def _serialize_metadata_json(value: Any) -> str | None:
    normalized = _normalize_optional_json_value(value)
    if normalized is None:
        return None
    try:
        return json.dumps(normalized, sort_keys=True)
    except Exception:
        return str(normalized)


def _dedupe_strings(values: list[str]) -> tuple[str, ...]:
    deduped: list[str] = []
    seen: set[str] = set()
    for raw_value in values:
        value = raw_value.strip()
        if not value:
            continue
        folded = value.casefold()
        if folded in seen:
            continue
        seen.add(folded)
        deduped.append(value)
    return tuple(deduped)


def _strip_graph_comment_prefix(line: str) -> str:
    stripped = line.strip()
    for prefix in ("#", "//"):
        if stripped.startswith(prefix):
            return stripped[len(prefix) :].strip()
    return stripped


def _parse_graph_metadata(text: str) -> tuple[GraphMetadata | None, str]:
    lines = text.splitlines()
    entity: str | None = None
    role: str | None = None
    relates_to: list[str] = []
    depends_on: list[str] = []
    feeds_to: list[str] = []
    metadata_line_indexes: set[int] = set()

    for index, line in enumerate(lines[:GRAPH_METADATA_HEADER_LINE_LIMIT]):
        candidate = _strip_graph_comment_prefix(line)
        if not candidate.lower().startswith("@graph "):
            continue
        field_name, separator, raw_value = candidate[7:].partition(":")
        if not separator:
            continue
        field_key = field_name.strip().lower().replace("-", "_")
        value = raw_value.strip()
        if not value:
            continue
        metadata_line_indexes.add(index)
        if field_key == "entity":
            entity = value
        elif field_key == "role":
            role = value
        elif field_key == "relates_to":
            relates_to.extend(part.strip() for part in value.split(","))
        elif field_key == "depends_on":
            depends_on.extend(part.strip() for part in value.split(","))
        elif field_key == "feeds_to":
            feeds_to.extend(part.strip() for part in value.split(","))

    metadata = GraphMetadata(
        entity=entity,
        role=role,
        relates_to=_dedupe_strings(relates_to),
        depends_on=_dedupe_strings(depends_on),
        feeds_to=_dedupe_strings(feeds_to),
    )
    if not metadata_line_indexes or metadata.is_empty():
        return None, text

    stripped_lines = [
        line for index, line in enumerate(lines) if index not in metadata_line_indexes
    ]
    stripped_text = "\n".join(stripped_lines).strip()
    return metadata, stripped_text or text


def _resolve_source_path(
    *,
    document_id: str,
    source_url: str | None,
    metadata: Any = None,
) -> str:
    normalized_metadata = _normalize_optional_json_value(metadata)
    if isinstance(normalized_metadata, dict):
        file_path = str(normalized_metadata.get("file_path") or "").strip()
        if file_path:
            return file_path
    return source_url or f"web://{document_id}"


def _format_prompt_guidance_block(title: str, value: Any) -> str | None:
    normalized = _normalize_optional_json_value(value)
    if normalized is None:
        return None
    if isinstance(normalized, str):
        body = normalized.strip()
    else:
        body = json.dumps(normalized, indent=2, sort_keys=True)
    if not body:
        return None
    escaped_body = body.replace("{", "{{").replace("}", "}}")
    return f"{title}:\n{escaped_body}"


def _build_prompt_template(
    *,
    prompt_template: str | None = None,
    organizing_principle: Any = None,
    entity_taxonomy: Any = None,
    relationship_taxonomy: Any = None,
    extraction_policy: Any = None,
    research_focus: Any = None,
) -> Any | None:
    sections: list[str] = []
    base_prompt = (prompt_template or "").strip().replace("{", "{{").replace("}", "}}")
    if base_prompt:
        sections.append(base_prompt)

    guidance_blocks = [
        _format_prompt_guidance_block("Organizing principle", organizing_principle),
        _format_prompt_guidance_block("Entity taxonomy", entity_taxonomy),
        _format_prompt_guidance_block("Relationship taxonomy", relationship_taxonomy),
        _format_prompt_guidance_block("Extraction policy", extraction_policy),
        _format_prompt_guidance_block("Research focus", research_focus),
    ]
    guidance_blocks = [block for block in guidance_blocks if block]
    if guidance_blocks:
        sections.append(
            "Use the following extraction guidance to organize nodes and relationships while staying grounded in the provided source evidence.\n\n"
            + "\n\n".join(guidance_blocks)
        )

    if not sections:
        return None
    custom_instructions = "\n\n".join(sections).strip()
    return ERExtractionTemplate(
        template=f"{custom_instructions}\n\n{ERExtractionTemplate.DEFAULT_TEMPLATE}"
    )


def _normalize_provider(provider: str | None) -> str:
    normalized = (provider or "").strip().lower()
    if not normalized:
        return "openrouter"
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
    kwargs: dict[str, Any] = {
        "api_key": api_key,
        "base_url": base_url,
        "max_retries": 2,
        "timeout": 30.0,
    }
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
            default="openai_compatible",
        )
        openrouter_embedding_model = (
            _optional_env("KNOWGRAPH_OPENROUTER_EMBEDDING_MODEL")
            or "openai/text-embedding-3-large"
        )
        openrouter_embedding_dim = (
            _optional_int_env("KNOWGRAPH_OPENROUTER_EMBEDDING_DIM")
            or 3072
        )
        client_kwargs = _build_openrouter_client_kwargs(api_key, base_url)
        if openrouter_embedding_backend != "openai_compatible":
            raise RuntimeError(
                "OpenRouter KnowGraph ingestion requires openai_compatible embeddings"
            )
        embedding_kwargs = dict(client_kwargs)
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


def _count_committed_document(
    driver: Driver, database: str | None, project_id: str, document_id: str
) -> dict[str, int]:
    """Count the COMMITTED native lexical graph for one document identity."""
    result = driver.execute_query(
        """
        MATCH (d:Document {project_id: $project_id, document_id: $document_id})
        WITH count(d) AS documents
        OPTIONAL MATCH (c:Chunk {project_id: $project_id, document_id: $document_id})
        RETURN documents, count(c) AS chunks,
               sum(CASE WHEN c.embedding IS NOT NULL THEN 1 ELSE 0 END) AS embedded_chunks
        """,
        project_id=project_id,
        document_id=document_id,
        database_=database,
    )
    records = getattr(result, "records", None) or []
    return {
        "documents": int(records[0]["documents"]) if records else 0,
        "chunks": int(records[0]["chunks"]) if records else 0,
        "embedded_chunks": int(records[0]["embedded_chunks"] or 0) if records else 0,
    }


def _existing_document_counts(project_id: str, document_id: str) -> dict[str, int] | None:
    """Repeat-ingest semantics: committed counts when this document already exists.

    Runs BEFORE any pipeline/model-client construction so a repeat ingest costs no
    extraction and no embedding spend. Uses its own short-lived driver.
    """
    driver = GraphDatabase.driver(
        _required_env("NEO4J_URI"),
        auth=(_required_env("NEO4J_USER"), _required_env("NEO4J_PASSWORD")),
    )
    try:
        counts = _count_committed_document(
            driver, os.getenv("NEO4J_DATABASE") or None, project_id, document_id
        )
    finally:
        driver.close()
    return counts if counts["documents"] > 0 and counts["chunks"] > 0 else None


def _verify_native_ingest(
    driver: Driver,
    database: str | None,
    project_id: str,
    document_id: str,
    run_id: str,
) -> dict[str, int]:
    """Verify the upstream pipeline actually COMMITTED graph output (baseline law).

    The upstream kg_writer catches Neo4j ClientError and returns
    KGWriterModel(status="FAILURE") instead of raising, so a run_id alone is NEVER
    success. Identity rides the library's own native mechanisms: document_metadata
    becomes Document properties; the deterministic splitter's chunk metadata becomes
    Chunk properties (project_id, document_id, chunk_id). No re-keying, no copies.
    """
    counts = _count_committed_document(driver, database, project_id, document_id)
    if counts["documents"] == 0 or counts["chunks"] == 0:
        raise RuntimeError(
            f"ingest_write_not_committed: document {document_id} (run {run_id}) finished "
            f"with documents={counts['documents']} chunks={counts['chunks']} - the upstream "
            "writer failed or rolled back (it reports FAILURE without raising); refusing to "
            "report success over an empty graph"
        )
    return counts


def _create_runtime_pipeline(
    *,
    project_id: str,
    document_id: str,
    provider: str | None,
    model_key: str | None,
    model_id: str | None,
    agent_id: str | None,
    from_pdf: bool,
    prompt_template: Any = None,
) -> tuple[RuntimeModelConfig, Driver, str | None, SimpleKGPipeline]:
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
    if inspection_mode_enabled():
        # Dev/admin external-agent inspection socket ONLY: an outside coding agent
        # stands in at the single paid extraction boundary with no model spend.
        # Never auto-selected (env unset in production), never a fallback
        # (build_* raises if the plan is missing rather than billing the real model).
        llm = build_inspection_extraction_llm_from_env()
        print(
            "[KNOWGRAPH_RUNTIME] extraction boundary = inspection_extraction_provider "
            "(dev/admin stand-in; no paid model call)"
        )
    else:
        llm = OpenAILLM(
            model_name=runtime.model_id,
            model_params={"temperature": 0},
            **runtime.llm_client_kwargs,
        )
    if runtime.embedding_backend == "openai_compatible":
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
    driver.verify_connectivity()
    ensure_vector_index(
        driver,
        neo4j_database,
        dimensions=runtime.embedding_dimensions,
    )

    pipeline_kwargs: dict[str, Any] = {
        "llm": llm,
        "driver": driver,
        "embedder": embedder,
        "schema": KNOWGRAPH_SCHEMA,
        "from_pdf": from_pdf,
        "text_splitter": splitter,
        "on_error": "RAISE",
        "perform_entity_resolution": True,
        "lexical_graph_config": lexical_graph_config,
        "neo4j_database": neo4j_database,
    }
    if prompt_template:
        pipeline_kwargs["prompt_template"] = prompt_template

    pipeline = SimpleKGPipeline(**pipeline_kwargs)
    return runtime, driver, neo4j_database, pipeline


def _build_document_metadata(**fields: str | None) -> dict[str, str]:
    """Assemble neo4j_graphrag document metadata (values must be strings).

    `DocumentInfo.metadata` is typed `Optional[Dict[str, str]]`, so every value
    must be a string. Optional source fields (source_url, fetched_at, snippet,
    metadata_json) are None when a caller omits them, which raises a pydantic
    ValidationError before extraction even runs — drop None-valued keys instead
    of storing empty-string provenance.
    """
    return {key: value for key, value in fields.items() if value is not None}


async def ingest_pdf(
    file_path: str,
    project_id: str,
    document_id: str,
    *,
    provider: str | None = None,
    model_key: str | None = None,
    model_id: str | None = None,
    agent_id: str | None = None,
    organizing_principle: Any = None,
    entity_taxonomy_json: Any = None,
    relationship_taxonomy_json: Any = None,
    extraction_policy_json: Any = None,
) -> dict[str, Any]:
    """Run GraphRAG KG Builder ingestion for a PDF file."""
    source = Path(file_path)
    if not source.exists():
        raise FileNotFoundError(f"File not found: {file_path}")
    prompt_template = _build_prompt_template(
        organizing_principle=organizing_principle,
        entity_taxonomy=entity_taxonomy_json,
        relationship_taxonomy=relationship_taxonomy_json,
        extraction_policy=extraction_policy_json,
    )
    runtime, driver, neo4j_database, pipeline = _create_runtime_pipeline(
        project_id=project_id,
        document_id=document_id,
        provider=provider,
        model_key=model_key,
        model_id=model_id,
        agent_id=agent_id,
        from_pdf=True,
        prompt_template=prompt_template,
    )
    try:
        result = await pipeline.run_async(
            file_path=str(source),
            document_metadata=_build_document_metadata(
                project_id=project_id,
                document_id=document_id,
                source_path=str(source.resolve()),
                source_name=source.name,
                source_type="pdf_upload",
            ),
        )
        counts = _verify_native_ingest(
            driver, neo4j_database, project_id, document_id, result.run_id
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
            **counts,
        }
    finally:
        driver.close()


async def ingest_text_document(
    *,
    project_id: str,
    document_id: str,
    text: str,
    title: str | None = None,
    source_url: str | None = None,
    fetched_at: str | None = None,
    snippet: str | None = None,
    metadata: Any = None,
    provider: str | None = None,
    model_key: str | None = None,
    model_id: str | None = None,
    agent_id: str | None = None,
    prompt_template: str | None = None,
    organizing_principle: Any = None,
    entity_taxonomy: Any = None,
    relationship_taxonomy: Any = None,
    extraction_policy: Any = None,
    research_focus: Any = None,
    source_type: str = "web_research",
) -> dict[str, Any]:
    normalized_text = text.strip()
    if not normalized_text:
        raise ValueError("text is required")
    graph_metadata: GraphMetadata | None = None
    if source_type == "code_file":
        graph_metadata, stripped_text = _parse_graph_metadata(normalized_text)
        if stripped_text:
            normalized_text = stripped_text

    effective_prompt_template = _build_prompt_template(
        prompt_template=prompt_template,
        organizing_principle=organizing_principle,
        entity_taxonomy=entity_taxonomy,
        relationship_taxonomy=relationship_taxonomy,
        extraction_policy=extraction_policy,
        research_focus=research_focus,
    )
    runtime, driver, neo4j_database, pipeline = _create_runtime_pipeline(
        project_id=project_id,
        document_id=document_id,
        provider=provider,
        model_key=model_key,
        model_id=model_id,
        agent_id=agent_id,
        from_pdf=False,
        prompt_template=effective_prompt_template,
    )
    source_name = (title or source_url or f"{document_id}.txt").strip() or f"{document_id}.txt"
    source_path = _resolve_source_path(
        document_id=document_id,
        source_url=source_url,
        metadata=metadata,
    )
    metadata_json = _serialize_metadata_json(metadata)

    try:
        result = await pipeline.run_async(
            text=normalized_text,
            document_metadata=_build_document_metadata(
                project_id=project_id,
                document_id=document_id,
                source_path=source_path,
                source_name=source_name,
                source_url=source_url,
                fetched_at=fetched_at,
                snippet=snippet,
                metadata_json=metadata_json,
                source_type=source_type,
            ),
        )

        counts = _verify_native_ingest(
            driver, neo4j_database, project_id, document_id, result.run_id
        )
        ensure_vector_index(
            driver,
            neo4j_database,
            dimensions=runtime.embedding_dimensions,
        )
        ensure_knowledge_assertion_fulltext_index(driver, neo4j_database)

        return {
            "run_id": result.run_id,
            "project_id": project_id,
            "document_id": document_id,
            "provider": runtime.provider,
            "model_key": runtime.model_key,
            "model": runtime.model_id,
            "agent_id": agent_id,
            "source_url": source_url,
            "source_name": source_name,
            **counts,
            "graph_metadata": (
                {
                    "entity": graph_metadata.entity,
                    "role": graph_metadata.role,
                    "relates_to": list(graph_metadata.relates_to),
                    "depends_on": list(graph_metadata.depends_on),
                    "feeds_to": list(graph_metadata.feeds_to),
                }
                if graph_metadata
                else None
            ),
        }
    finally:
        driver.close()


async def ingest_web_documents(
    *,
    project_id: str,
    documents: list[dict[str, Any]],
    provider: str | None = None,
    model_key: str | None = None,
    model_id: str | None = None,
    agent_id: str | None = None,
    prompt_template: str | None = None,
    organizing_principle: Any = None,
    entity_taxonomy: Any = None,
    relationship_taxonomy: Any = None,
    extraction_policy: Any = None,
    research_focus: Any = None,
) -> dict[str, Any]:
    results: list[dict[str, Any]] = []
    failures: list[dict[str, str]] = []

    for raw_doc in documents:
        try:
            result = await ingest_text_document(
                project_id=project_id,
                document_id=str(raw_doc.get("document_id") or "").strip(),
                text=str(raw_doc.get("text") or raw_doc.get("full_text") or raw_doc.get("snippet") or "").strip(),
                title=str(raw_doc.get("title") or "").strip() or None,
                source_url=str(raw_doc.get("source_url") or "").strip() or None,
                fetched_at=str(raw_doc.get("fetched_at") or "").strip() or None,
                snippet=str(raw_doc.get("snippet") or raw_doc.get("summary") or "").strip() or None,
                metadata=raw_doc.get("metadata") or {},
                provider=provider,
                model_key=model_key,
                model_id=model_id,
                agent_id=agent_id,
                prompt_template=prompt_template,
                organizing_principle=organizing_principle,
                entity_taxonomy=entity_taxonomy,
                relationship_taxonomy=relationship_taxonomy,
                extraction_policy=extraction_policy,
                research_focus=research_focus,
            )
            results.append(result)
        except Exception as exc:
            failures.append(
                {
                    "document_id": str(raw_doc.get("document_id") or "").strip() or "unknown",
                    "error": str(exc),
                }
            )

    if not results:
        raise RuntimeError(
            f"web_research_ingest_failed: {failures[0]['error'] if failures else 'no_results'}"
        )

    return {
        "project_id": project_id,
        "ingested_document_count": len(results),
        "document_ids": [entry["document_id"] for entry in results],
        "results": results,
        "failures": failures,
    }
