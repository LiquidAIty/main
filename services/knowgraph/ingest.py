# @graph entity: KnowGraph Ingest
# @graph role: grounded-ingest
# @graph relates_to: KnowGraph, Graphiti
# @graph depends_on: Neo4j, Graphiti
# @graph feeds_to: KnowGraph
"""KnowGraph ingestion through Graphiti's temporal episode/fact engine."""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import NAMESPACE_URL, uuid5

from dotenv import load_dotenv
from graphiti_identity import graphiti_project_group_id

load_dotenv()

GRAPHITI_VERSION = "0.29.3"
GRAPHITI_EPISODE_NAMESPACE = "liquidaity:knowgraph:episode"
DEFAULT_NEO4J_DATABASE = "neo4j"


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
class PdfSourceSection:
    title: str
    page_start: int
    page_end: int
    text: str


def _required_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required env var: {name}")
    return value


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
    return value if value > 0 else None


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
    global_backend = _normalize_embedding_backend(
        _optional_env("KNOWGRAPH_EMBEDDING_BACKEND"),
        default="openai_compatible",
    )
    global_model = _optional_env("KNOWGRAPH_EMBEDDING_MODEL") or "text-embedding-3-large"
    global_dimensions = _optional_int_env("KNOWGRAPH_EMBEDDING_DIM") or 3072

    if normalized_provider == "openai":
        api_key = _required_env("OPENAI_API_KEY")
        base_url = _normalize_base_url(_optional_env("OPENAI_BASE_URL"))
        llm_kwargs: dict[str, Any] = {
            "api_key": api_key,
            "max_retries": 2,
            "timeout": 30.0,
        }
        embedding_kwargs = dict(llm_kwargs)
        if base_url:
            llm_kwargs["base_url"] = base_url
            embedding_kwargs["base_url"] = base_url
        return RuntimeModelConfig(
            provider=normalized_provider,
            model_key=requested_model_key,
            model_id=resolved_model_id,
            llm_client_kwargs=llm_kwargs,
            embedding_backend=global_backend,
            embedding_model=(
                _optional_env("KNOWGRAPH_OPENAI_EMBEDDING_MODEL") or global_model
            ),
            embedding_dimensions=(
                _optional_int_env("KNOWGRAPH_OPENAI_EMBEDDING_DIM")
                or global_dimensions
            ),
            embedding_client_kwargs=embedding_kwargs,
        )

    api_key = _required_env("OPENROUTER_API_KEY")
    base_url = _resolve_openrouter_openai_base_url()
    embedding_backend = _normalize_embedding_backend(
        _optional_env("KNOWGRAPH_OPENROUTER_EMBEDDING_BACKEND"),
        default="openai_compatible",
    )
    if embedding_backend != "openai_compatible":
        raise RuntimeError(
            "OpenRouter KnowGraph ingestion requires openai_compatible embeddings"
        )
    client_kwargs = _build_openrouter_client_kwargs(api_key, base_url)
    return RuntimeModelConfig(
        provider=normalized_provider,
        model_key=requested_model_key,
        model_id=resolved_model_id,
        llm_client_kwargs=dict(client_kwargs),
        embedding_backend=embedding_backend,
        embedding_model=(
            _optional_env("KNOWGRAPH_OPENROUTER_EMBEDDING_MODEL")
            or "openai/text-embedding-3-large"
        ),
        embedding_dimensions=(
            _optional_int_env("KNOWGRAPH_OPENROUTER_EMBEDDING_DIM") or 3072
        ),
        embedding_client_kwargs=dict(client_kwargs),
    )


def _sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _episode_identity(project_id: str, document_id: str, text: str) -> tuple[str, str]:
    fingerprint = _sha256_hex(text)
    identity = (
        f"{GRAPHITI_EPISODE_NAMESPACE}:{project_id}:{document_id}:{fingerprint}"
    )
    return str(uuid5(NAMESPACE_URL, identity)), fingerprint


def _coerce_reference_time(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        parsed = value
    else:
        raw = str(value).strip()
        if not raw:
            return None
        try:
            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _reference_time(fetched_at: str | None, metadata: Any = None) -> datetime:
    explicit = _coerce_reference_time(fetched_at)
    if explicit:
        return explicit
    normalized = _normalize_optional_json_value(metadata)
    if isinstance(normalized, dict):
        for key in (
            "reference_time",
            "published_at",
            "publication_date",
            "event_time",
            "date",
        ):
            parsed = _coerce_reference_time(normalized.get(key))
            if parsed:
                return parsed
    return datetime.now(timezone.utc)


def _guidance_text(
    *,
    prompt_template: str | None = None,
    organizing_principle: Any = None,
    entity_taxonomy: Any = None,
    relationship_taxonomy: Any = None,
    extraction_policy: Any = None,
    research_focus: Any = None,
) -> str | None:
    sections: list[str] = []
    for title, value in (
        ("Task-specific extraction guidance", prompt_template),
        ("Organizing principle", organizing_principle),
        ("Entity taxonomy", entity_taxonomy),
        ("Relationship taxonomy", relationship_taxonomy),
        ("Extraction policy", extraction_policy),
        ("Research focus", research_focus),
    ):
        normalized = _normalize_optional_json_value(value)
        if normalized is None:
            continue
        body = (
            normalized.strip()
            if isinstance(normalized, str)
            else json.dumps(normalized, sort_keys=True)
        )
        if body:
            sections.append(f"{title}: {body}")
    return "\n".join(sections) or None


def _create_graphiti_runtime(
    *,
    provider: str | None,
    model_key: str | None,
    model_id: str | None,
) -> tuple[RuntimeModelConfig, Any, str]:
    # Graphiti enables anonymous PostHog telemetry by default. KnowGraph has no
    # product requirement to send runtime metadata to a second external system.
    os.environ.setdefault("GRAPHITI_TELEMETRY_ENABLED", "false")
    try:
        from graphiti_core import Graphiti
        from graphiti_core.cross_encoder.openai_reranker_client import (
            OpenAIRerankerClient,
        )
        from graphiti_core.driver.neo4j_driver import Neo4jDriver
        from graphiti_core.embedder.openai import (
            OpenAIEmbedder,
            OpenAIEmbedderConfig,
        )
        from graphiti_core.llm_client.config import LLMConfig
        from graphiti_core.llm_client.openai_client import OpenAIClient
        from graphiti_core.llm_client.openai_generic_client import OpenAIGenericClient
        from openai import AsyncOpenAI
    except ImportError as exc:
        raise RuntimeError(
            f"graphiti-core=={GRAPHITI_VERSION} is required for KnowGraph ingestion"
        ) from exc

    runtime = _resolve_runtime_model_config(
        provider=provider,
        model_key=model_key,
        model_id=model_id,
    )
    llm_config = LLMConfig(
        api_key=runtime.llm_client_kwargs["api_key"],
        model=runtime.model_id,
        base_url=runtime.llm_client_kwargs.get("base_url"),
        temperature=0,
    )
    llm_transport = AsyncOpenAI(**runtime.llm_client_kwargs)
    if runtime.provider == "openrouter":
        llm_client = OpenAIGenericClient(
            config=llm_config,
            client=llm_transport,
            structured_output_mode="json_object",
        )
    else:
        llm_client = OpenAIClient(config=llm_config, client=llm_transport)

    embedding_transport = AsyncOpenAI(**runtime.embedding_client_kwargs)
    embedder = OpenAIEmbedder(
        config=OpenAIEmbedderConfig(
            embedding_model=runtime.embedding_model,
            embedding_dim=runtime.embedding_dimensions,
            api_key=runtime.embedding_client_kwargs["api_key"],
            base_url=runtime.embedding_client_kwargs.get("base_url"),
        ),
        client=embedding_transport,
    )
    reranker = OpenAIRerankerClient(config=llm_config, client=llm_transport)
    database = _optional_env("NEO4J_DATABASE") or DEFAULT_NEO4J_DATABASE
    graph_driver = Neo4jDriver(
        _required_env("NEO4J_URI"),
        _required_env("NEO4J_USER"),
        _required_env("NEO4J_PASSWORD"),
        database=database,
    )
    return (
        runtime,
        Graphiti(
            graph_driver=graph_driver,
            llm_client=llm_client,
            embedder=embedder,
            cross_encoder=reranker,
            store_raw_episode_content=True,
        ),
        database,
    )


def _records(result: Any) -> list[Any]:
    records = getattr(result, "records", None)
    if records is not None:
        return list(records)
    if isinstance(result, tuple) and result and isinstance(result[0], list):
        return result[0]
    return []


async def _find_existing_episode_id(
    graphiti: Any,
    *,
    candidate_episode_id: str,
    project_id: str,
    document_id: str,
    content_fingerprint: str,
) -> str | None:
    result = await graphiti.driver.execute_query(
        """
        MATCH (episode:Episodic)
        WHERE episode.uuid = $candidate_episode_id
           OR (
                episode.group_id = $group_id
                AND episode.project_id = $project_id
                AND episode.document_id = $document_id
                AND episode.content_fingerprint = $content_fingerprint
           )
        RETURN episode.uuid AS uuid
        LIMIT 1
        """,
        candidate_episode_id=candidate_episode_id,
        group_id=graphiti_project_group_id(project_id),
        project_id=project_id,
        document_id=document_id,
        content_fingerprint=content_fingerprint,
        routing_="r",
    )
    records = _records(result)
    if not records:
        return None
    existing_id = str(records[0].get("uuid") or "").strip()
    return existing_id or None


async def _record_episode_authority(
    graphiti: Any,
    *,
    episode_id: str,
    project_id: str,
    document_id: str,
    source_name: str,
    source_path: str,
    source_type: str,
    source_url: str | None,
    fetched_at: str | None,
    snippet: str | None,
    metadata_json: str | None,
    content_fingerprint: str,
    provider: str,
    model_id: str,
    agent_id: str | None,
) -> None:
    await graphiti.driver.execute_query(
        """
        MATCH (episode:Episodic {uuid: $episode_id})
        SET episode.project_id = $project_id,
            episode.document_id = $document_id,
            episode.source_name = $source_name,
            episode.source_path = $source_path,
            episode.source_type = $source_type,
            episode.source_url = $source_url,
            episode.fetched_at = $fetched_at,
            episode.snippet = $snippet,
            episode.metadata_json = $metadata_json,
            episode.content_fingerprint = $content_fingerprint,
            episode.extraction_provider = $provider,
            episode.extraction_model = $model_id,
            episode.extraction_agent_id = $agent_id,
            episode.graphiti_version = $graphiti_version
        """,
        episode_id=episode_id,
        project_id=project_id,
        document_id=document_id,
        source_name=source_name,
        source_path=source_path,
        source_type=source_type,
        source_url=source_url,
        fetched_at=fetched_at,
        snippet=snippet,
        metadata_json=metadata_json,
        content_fingerprint=content_fingerprint,
        provider=provider,
        model_id=model_id,
        agent_id=agent_id,
        graphiti_version=GRAPHITI_VERSION,
    )


async def _ingest_episode(
    *,
    project_id: str,
    document_id: str,
    text: str,
    source_name: str,
    source_path: str,
    source_type: str,
    source_url: str | None,
    fetched_at: str | None,
    snippet: str | None,
    metadata: Any,
    provider: str | None,
    model_key: str | None,
    model_id: str | None,
    agent_id: str | None,
    guidance: str | None,
    reference_time: datetime,
) -> dict[str, Any]:
    from graphiti_core.nodes import EpisodeType

    candidate_episode_id, content_fingerprint = _episode_identity(
        project_id, document_id, text
    )
    runtime, graphiti, _database = _create_graphiti_runtime(
        provider=provider,
        model_key=model_key,
        model_id=model_id,
    )
    try:
        existing_episode_id = await _find_existing_episode_id(
            graphiti,
            candidate_episode_id=candidate_episode_id,
            project_id=project_id,
            document_id=document_id,
            content_fingerprint=content_fingerprint,
        )
        if existing_episode_id:
            return {
                "status": "already_ingested",
                "run_id": candidate_episode_id,
                "episode_id": existing_episode_id,
                "project_id": project_id,
                "document_id": document_id,
                "provider": runtime.provider,
                "model_key": runtime.model_key,
                "model": runtime.model_id,
                "agent_id": agent_id,
                "source_url": source_url,
                "source_name": source_name,
                "content_fingerprint": content_fingerprint,
                "idempotent": True,
                "graphiti_version": GRAPHITI_VERSION,
            }

        result = await graphiti.add_episode(
            name=source_name,
            episode_body=text,
            source_description=source_url or source_path,
            reference_time=reference_time,
            source=EpisodeType.text,
            # Graphiti's group_id is the graph namespace, not the Neo4j
            # database name. Project scope keeps search and temporal evolution
            # isolated while the existing Neo4j driver remains the one store.
            group_id=graphiti_project_group_id(project_id),
            update_communities=False,
            custom_extraction_instructions=guidance,
        )
        episode_id = str(result.episode.uuid)
        await _record_episode_authority(
            graphiti,
            episode_id=episode_id,
            project_id=project_id,
            document_id=document_id,
            source_name=source_name,
            source_path=source_path,
            source_type=source_type,
            source_url=source_url,
            fetched_at=fetched_at,
            snippet=snippet,
            metadata_json=_serialize_metadata_json(metadata),
            content_fingerprint=content_fingerprint,
            provider=runtime.provider,
            model_id=runtime.model_id,
            agent_id=agent_id,
        )
        return {
            "status": "ingested",
            "run_id": candidate_episode_id,
            "episode_id": episode_id,
            "project_id": project_id,
            "document_id": document_id,
            "provider": runtime.provider,
            "model_key": runtime.model_key,
            "model": runtime.model_id,
            "agent_id": agent_id,
            "source_url": source_url,
            "source_name": source_name,
            "content_fingerprint": content_fingerprint,
            "idempotent": False,
            "graphiti_version": GRAPHITI_VERSION,
            "entity_count": len(result.nodes),
            "fact_count": len(result.edges),
        }
    finally:
        await graphiti.driver.close()


def _pdf_source_sections(
    reader: Any,
    source_name: str,
    *,
    single_episode_max_chars: int = 180_000,
) -> list[PdfSourceSection]:
    page_texts = [(page.extract_text() or "").strip() for page in reader.pages]
    complete_text = "\n\n".join(text for text in page_texts if text).strip()
    if not complete_text:
        return []
    if len(complete_text) <= single_episode_max_chars:
        return [
            PdfSourceSection(
                title="Complete document",
                page_start=1,
                page_end=len(page_texts),
                text=complete_text,
            )
        ]

    starts: dict[int, list[str]] = {}
    for item in getattr(reader, "outline", []) or []:
        if isinstance(item, list):
            continue
        title = " ".join(str(getattr(item, "title", item) or "").split())
        if not title:
            continue
        try:
            page_index = int(reader.get_destination_page_number(item))
        except Exception:
            continue
        if 0 <= page_index < len(page_texts):
            starts.setdefault(page_index, []).append(title)

    if len(starts) < 2:
        raise ValueError(
            f"Large PDF has no usable authored outline: {source_name}. "
            "Refusing an arbitrary fixed-size split."
        )
    if 0 not in starts:
        starts[0] = ["Front matter"]

    ordered_starts = sorted(starts)
    sections: list[PdfSourceSection] = []
    for index, page_index in enumerate(ordered_starts):
        next_page_index = (
            ordered_starts[index + 1]
            if index + 1 < len(ordered_starts)
            else len(page_texts)
        )
        section_text = "\n\n".join(
            text for text in page_texts[page_index:next_page_index] if text
        ).strip()
        if not section_text:
            continue
        sections.append(
            PdfSourceSection(
                title=" / ".join(starts[page_index]),
                page_start=page_index + 1,
                page_end=next_page_index,
                text=section_text,
            )
        )
    return sections


async def ingest_pdf(
    file_path: str,
    project_id: str,
    document_id: str,
    *,
    source_name: str | None = None,
    provider: str | None = None,
    model_key: str | None = None,
    model_id: str | None = None,
    agent_id: str | None = None,
    prompt_template: str | None = None,
    organizing_principle: Any = None,
    entity_taxonomy_json: Any = None,
    relationship_taxonomy_json: Any = None,
    extraction_policy_json: Any = None,
) -> dict[str, Any]:
    """Extract PDF text locally, then ingest source-authored Graphiti episodes."""
    source = Path(file_path)
    if not source.exists():
        raise FileNotFoundError(f"File not found: {file_path}")
    try:
        from pypdf import PdfReader
    except ImportError as exc:
        raise RuntimeError("pypdf is required for KnowGraph PDF ingestion") from exc
    reader = PdfReader(str(source))
    sections = _pdf_source_sections(reader, source.name)
    if not sections:
        raise ValueError(f"PDF contains no extractable text: {file_path}")
    base_source_name = (source_name or source.name).strip() or source.name
    source_path = str(source.resolve())
    reference_time = datetime.fromtimestamp(source.stat().st_mtime, tz=timezone.utc)
    guidance = _guidance_text(
        prompt_template=prompt_template,
        organizing_principle=organizing_principle,
        entity_taxonomy=entity_taxonomy_json,
        relationship_taxonomy=relationship_taxonomy_json,
        extraction_policy=extraction_policy_json,
    )
    results: list[dict[str, Any]] = []
    for index, section in enumerate(sections):
        episode_body = (
            f"SOURCE DOCUMENT: {base_source_name}\n"
            f"SOURCE SECTION: {section.title}\n"
            f"PDF PAGES: {section.page_start}-{section.page_end}\n\n"
            f"{section.text}"
        )
        results.append(
            await _ingest_episode(
                project_id=project_id,
                document_id=document_id,
                text=episode_body,
                source_name=f"{base_source_name} :: {section.title}",
                source_path=source_path,
                source_type="pdf_upload",
                source_url=None,
                fetched_at=None,
                snippet=None,
                metadata={
                    "file_path": source_path,
                    "source_name": base_source_name,
                    "section_title": section.title,
                    "page_start": section.page_start,
                    "page_end": section.page_end,
                    "section_index": index,
                    "section_count": len(sections),
                },
                provider=provider,
                model_key=model_key,
                model_id=model_id,
                agent_id=agent_id,
                guidance=guidance,
                reference_time=reference_time,
            )
        )

    document_text = "\n\n".join(section.text for section in sections)
    document_run_id, document_fingerprint = _episode_identity(
        project_id, document_id, document_text
    )
    first = results[0]
    newly_ingested = [result for result in results if not result.get("idempotent")]
    return {
        "status": "ingested" if newly_ingested else "already_ingested",
        "run_id": document_run_id,
        "episode_id": first["episode_id"],
        "episode_ids": [result["episode_id"] for result in results],
        "project_id": project_id,
        "document_id": document_id,
        "provider": first["provider"],
        "model_key": first["model_key"],
        "model": first["model"],
        "agent_id": agent_id,
        "source_url": None,
        "source_name": base_source_name,
        "content_fingerprint": document_fingerprint,
        "idempotent": not newly_ingested,
        "graphiti_version": GRAPHITI_VERSION,
        "section_count": len(results),
        "entity_count": sum(int(result.get("entity_count") or 0) for result in results),
        "fact_count": sum(int(result.get("fact_count") or 0) for result in results),
        "sections": [
            {
                "title": section.title,
                "page_start": section.page_start,
                "page_end": section.page_end,
                "episode_id": result["episode_id"],
                "status": result["status"],
            }
            for section, result in zip(sections, results, strict=True)
        ],
    }


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
    source_name = (
        title or source_url or f"{document_id}.txt"
    ).strip() or f"{document_id}.txt"
    normalized_metadata = _normalize_optional_json_value(metadata)
    source_path = source_url or f"web://{document_id}"
    if isinstance(normalized_metadata, dict):
        source_path = (
            str(normalized_metadata.get("file_path") or "").strip() or source_path
        )
    return await _ingest_episode(
        project_id=project_id,
        document_id=document_id,
        text=normalized_text,
        source_name=source_name,
        source_path=source_path,
        source_type=source_type,
        source_url=source_url,
        fetched_at=fetched_at,
        snippet=snippet,
        metadata=metadata,
        provider=provider,
        model_key=model_key,
        model_id=model_id,
        agent_id=agent_id,
        guidance=_guidance_text(
            prompt_template=prompt_template,
            organizing_principle=organizing_principle,
            entity_taxonomy=entity_taxonomy,
            relationship_taxonomy=relationship_taxonomy,
            extraction_policy=extraction_policy,
            research_focus=research_focus,
        ),
        reference_time=_reference_time(fetched_at, metadata),
    )


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
                text=str(
                    raw_doc.get("text")
                    or raw_doc.get("full_text")
                    or raw_doc.get("snippet")
                    or ""
                ).strip(),
                title=str(raw_doc.get("title") or "").strip() or None,
                source_url=str(raw_doc.get("source_url") or "").strip() or None,
                fetched_at=str(raw_doc.get("fetched_at") or "").strip() or None,
                snippet=str(
                    raw_doc.get("snippet") or raw_doc.get("summary") or ""
                ).strip()
                or None,
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
                    "document_id": str(
                        raw_doc.get("document_id") or ""
                    ).strip()
                    or "unknown",
                    "error": str(exc),
                }
            )
    if not results:
        raise RuntimeError(
            "web_research_ingest_failed: "
            + (failures[0]["error"] if failures else "no_results")
        )
    return {
        "project_id": project_id,
        "ingested_document_count": len(results),
        "document_ids": [entry["document_id"] for entry in results],
        "results": results,
        "failures": failures,
    }
