# @graph entity: KnowGraph Ingest
# @graph role: grounded-ingest
# @graph relates_to: KnowGraph, Graphiti
# @graph depends_on: Neo4j, Graphiti
# @graph feeds_to: KnowGraph
"""KnowGraph ingestion through Graphiti's temporal episode/fact engine."""

from __future__ import annotations

import hashlib
from importlib import metadata as importlib_metadata
import json
import math
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import NAMESPACE_URL, uuid5

import httpx

from graphiti_identity import graphiti_project_group_id
from runtime_config import load_runtime_environment

load_runtime_environment()

GRAPHITI_EPISODE_NAMESPACE = "liquidaity:knowgraph:episode"
DEFAULT_NEO4J_DATABASE = "neo4j"
DEFAULT_OPENROUTER_KG_MODEL = "z-ai/glm-5.2"
KNOWGRAPH_JEV_MODEL = "typesafe/jev-1.13"
KNOWGRAPH_JEV_QUESTION_SCHEMA_VERSION = "knowgraph.relationship-choice.v3"
KNOWGRAPH_JEV_CONTROL_OUTCOMES = {"INSUFFICIENT_CONTEXT"}
MAX_JEV_RECONCILIATION_FACTS = 64


def graphiti_runtime_versions() -> dict[str, str | None]:
    """Report the packages actually loaded by this KnowGraph process."""

    def resolved(distribution: str) -> str | None:
        try:
            return importlib_metadata.version(distribution)
        except importlib_metadata.PackageNotFoundError:
            return None

    return {
        "graphiti_core": resolved("graphiti-core"),
        "graphiti_mcp": resolved("mcp-server"),
    }


def _graphiti_core_version() -> str:
    version = graphiti_runtime_versions()["graphiti_core"]
    if not version:
        raise RuntimeError("graphiti-core is required for KnowGraph ingestion")
    return version


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
    normalized = (provider or "").strip().lower() or "openrouter"
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
    resolved_model_id = (model_id or "").strip()
    if not resolved_model_id:
        if normalized_provider == "openrouter":
            resolved_model_id = (
                _optional_env("OPENROUTER_DEFAULT_KG_MODEL_KEY")
                or _optional_env("OPENROUTER_DEFAULT_MODEL")
                or DEFAULT_OPENROUTER_KG_MODEL
            )
        else:
            raise RuntimeError("OpenAI model is required")
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
        raise RuntimeError("graphiti-core is required for KnowGraph ingestion") from exc

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


def _edge_value(edge: Any, name: str) -> Any:
    if isinstance(edge, dict):
        return edge.get(name)
    return getattr(edge, name, None)


def _json_safe(value: Any) -> Any:
    return json.loads(json.dumps(value, default=str))


def _native_fact_signature(fact: dict[str, Any]) -> str:
    semantic_identity = {
        "source": fact["sourceEntity"]["uuid"],
        "target": fact["targetEntity"]["uuid"],
        "native_relation": fact["nativeRelation"],
        "fact": fact["fact"],
    }
    return _sha256_hex(json.dumps(semantic_identity, sort_keys=True, separators=(",", ":")))


async def _read_project_relationship_vocabulary(
    project_id: str,
) -> dict[str, Any]:
    base_url = os.getenv("PYTHON_RAILS_URL", "http://127.0.0.1:8003").strip().rstrip("/")
    if not base_url:
        raise RuntimeError("knowgraph_jev_python_rails_unavailable")
    async with httpx.AsyncClient(timeout=30.0, follow_redirects=False) as client:
        response = await client.post(
            f"{base_url}/graph/relationship-vocabulary/read",
            json={"projectId": project_id},
        )
        response.raise_for_status()
        payload = response.json()
    labels = payload.get("labels") if isinstance(payload, dict) else None
    if (
        not isinstance(labels, list)
        or not 20 <= len(labels) <= 255
        or any(not isinstance(label, str) or not label for label in labels)
    ):
        raise RuntimeError("knowgraph_relationship_vocabulary_invalid")
    return payload


def _graphiti_relationship_vocabulary_guidance(
    guidance: str | None,
    vocabulary: dict[str, Any],
) -> str:
    labels = [str(label) for label in vocabulary["labels"]]
    existing = str(guidance or "").strip()
    instruction = (
        "For each native Graphiti relationship name, first prefer an exact predicate "
        "from CURRENT_SHARED_PROJECT_RELATIONSHIP_VOCABULARY when it accurately fits. "
        "If none fits, propose one concise UPPER_SNAKE_CASE predicate: prefer one word, "
        "use two only when necessary, and never exceed three words. Do not invent a "
        "synonym for an existing predicate. Keep the natural-language fact fully "
        "expressive and continue normal entity and factual relationship extraction.\n"
        "CURRENT_SHARED_PROJECT_RELATIONSHIP_VOCABULARY:\n"
        + json.dumps(labels, ensure_ascii=False, separators=(",", ":"))
    )
    return f"{existing}\n\n{instruction}" if existing else instruction


async def _call_knowgraph_jev(
    project_id: str,
    facts: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    base_url = os.getenv("PYTHON_RAILS_URL", "http://127.0.0.1:8003").strip().rstrip("/")
    if not base_url:
        raise RuntimeError("knowgraph_jev_python_rails_unavailable")
    async with httpx.AsyncClient(timeout=180.0, follow_redirects=False) as client:
        response = await client.post(
            f"{base_url}/knowgraph/jev/classify",
            json={"projectId": project_id, "facts": facts},
        )
        response.raise_for_status()
        payload = response.json()
    results = payload.get("results") if isinstance(payload, dict) else None
    if not isinstance(results, list) or len(results) != len(facts):
        raise RuntimeError("knowgraph_jev_response_invalid")
    if any(not isinstance(item, dict) for item in results):
        raise RuntimeError("knowgraph_jev_response_invalid")
    requested_ids = [str(fact.get("nativeFactUuid") or "") for fact in facts]
    returned_ids = [str(item.get("nativeFactUuid") or "") for item in results]
    if returned_ids != requested_ids or len(set(returned_ids)) != len(returned_ids):
        raise RuntimeError("knowgraph_jev_response_invalid")
    return results


async def _existing_jev_metadata(
    graphiti: Any,
    fact_ids: list[str],
) -> dict[str, dict[str, Any]]:
    if not fact_ids:
        return {}
    result = await graphiti.driver.execute_query(
        """
        MATCH ()-[fact]->()
        WHERE toString(fact.uuid) IN $fact_ids
        RETURN toString(fact.uuid) AS uuid,
               fact.jev_native_signature AS native_signature,
               fact.jev_relation_winner AS winner,
               fact.jev_relation_distribution_json AS distribution_json,
               fact.jev_label_confidence AS label_confidence,
               fact.jev_provider_confidence AS provider_confidence,
               fact.jev_requested_model AS requested_model,
               fact.jev_resolved_model AS resolved_model,
               fact.jev_question_schema_version AS question_schema_version,
               fact.jev_ontology_version AS ontology_version,
               fact.jev_ontology_hash AS ontology_hash,
               fact.jev_vocabulary_count AS vocabulary_count,
               fact.jev_choice_options_json AS choice_options_json
        """,
        fact_ids=fact_ids,
        routing_="r",
    )
    return {
        str(record.get("uuid") or ""): dict(record)
        for record in _records(result)
        if str(record.get("uuid") or "")
    }


def _rounded_distribution(
    value: Any,
    choices: list[str],
) -> dict[str, float]:
    if not isinstance(value, dict) or set(value) != set(choices):
        raise ValueError("knowgraph_jev_distribution_invalid")
    distribution: dict[str, float] = {}
    for choice in choices:
        raw = value[choice]
        if isinstance(raw, bool):
            raise ValueError("knowgraph_jev_distribution_invalid")
        probability = float(raw)
        if not math.isfinite(probability) or not 0.0 <= probability <= 1.0:
            raise ValueError("knowgraph_jev_distribution_invalid")
        distribution[choice] = probability
    if not distribution or all(value == 0.0 for value in distribution.values()):
        raise ValueError("knowgraph_jev_distribution_invalid")
    lower = sum(max(0.0, value - 0.005) for value in distribution.values())
    upper = sum(min(1.0, value + 0.005) for value in distribution.values())
    if lower > 1.0 + 1e-12 or upper < 1.0 - 1e-12:
        raise ValueError("knowgraph_jev_distribution_invalid")
    return distribution


def _validated_decision_metadata(decision: dict[str, Any]) -> dict[str, Any]:
    winner = str(decision.get("winner") or "").strip()
    choices = decision.get("choice_options")
    if (
        not winner
        or winner in KNOWGRAPH_JEV_CONTROL_OUTCOMES
        or not isinstance(choices, list)
        or not choices
        or any(not isinstance(choice, str) or not choice for choice in choices)
        or len(set(choices)) != len(choices)
    ):
        raise ValueError("knowgraph_jev_decision_invalid")
    distribution = _rounded_distribution(decision.get("distribution"), choices)
    if winner not in distribution:
        raise ValueError("knowgraph_jev_decision_invalid")
    winner_upper = min(1.0, distribution[winner] + 0.005)
    if any(
        max(0.0, probability - 0.005) > winner_upper + 1e-12
        for choice, probability in distribution.items()
        if choice != winner
    ):
        raise ValueError("knowgraph_jev_decision_invalid")
    provider_confidence = decision.get("provider_confidence")
    if isinstance(provider_confidence, bool):
        raise ValueError("knowgraph_jev_provider_confidence_invalid")
    provider_confidence = float(provider_confidence)
    if not math.isfinite(provider_confidence) or not 0.0 <= provider_confidence <= 1.0:
        raise ValueError("knowgraph_jev_provider_confidence_invalid")
    label_confidence = decision.get("label_confidence")
    if isinstance(label_confidence, bool):
        raise ValueError("knowgraph_jev_label_confidence_invalid")
    label_confidence = float(label_confidence)
    if (
        not math.isfinite(label_confidence)
        or label_confidence != distribution[winner]
    ):
        raise ValueError("knowgraph_jev_label_confidence_invalid")
    return {
        "winner": winner,
        "distribution": distribution,
        "provider_confidence": provider_confidence,
        "label_confidence": label_confidence,
        "choice_options": choices,
    }


def _jev_annotation_is_current(
    metadata: dict[str, Any],
    *,
    native_signature: str,
    vocabulary: dict[str, Any],
) -> bool:
    try:
        serialized = metadata.get("distribution_json")
        distribution = (
            json.loads(serialized) if isinstance(serialized, str) else dict(serialized)
        )
        serialized_choices = metadata.get("choice_options_json")
        choices = (
            json.loads(serialized_choices)
            if isinstance(serialized_choices, str)
            else list(serialized_choices)
        )
        validated = _validated_decision_metadata({
            "winner": metadata.get("winner"),
            "distribution": distribution,
            "provider_confidence": metadata.get("provider_confidence"),
            "label_confidence": metadata.get("label_confidence"),
            "choice_options": choices,
        })
        current_choices = set(str(label) for label in vocabulary["labels"])
        current_choices.update(KNOWGRAPH_JEV_CONTROL_OUTCOMES)
        stored_choices = set(validated["choice_options"])
        extra_choices = stored_choices - current_choices
        return (
            metadata.get("native_signature") == native_signature
            and metadata.get("question_schema_version")
            == KNOWGRAPH_JEV_QUESTION_SCHEMA_VERSION
            and metadata.get("requested_model") == KNOWGRAPH_JEV_MODEL
            and bool(str(metadata.get("resolved_model") or "").strip())
            and metadata.get("ontology_version") == vocabulary.get("version")
            and metadata.get("ontology_hash") == vocabulary.get("hash")
            and int(metadata.get("vocabulary_count")) == int(vocabulary.get("count"))
            and current_choices.issubset(stored_choices)
            and len(extra_choices) <= 1
        )
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        return False


async def _persist_jev_metadata(
    graphiti: Any,
    native_fact_uuid: str,
    native_signature: str,
    decision: dict[str, Any],
) -> dict[str, Any]:
    validated = _validated_decision_metadata(decision)
    winner = validated["winner"]
    distribution = validated["distribution"]
    result = await graphiti.driver.execute_query(
        """
        MATCH ()-[fact]->()
        WHERE toString(fact.uuid) = $native_fact_uuid
        SET fact.jev_relation_winner = $winner,
              fact.jev_relation_distribution_json = $distribution_json,
              fact.jev_label_confidence = $label_confidence,
              fact.jev_provider_confidence = $provider_confidence,
            fact.jev_requested_model = $requested_model,
            fact.jev_resolved_model = $resolved_model,
            fact.jev_evaluated_at = $evaluated_at,
            fact.jev_question_schema_version = $question_schema_version,
            fact.jev_ontology_version = $ontology_version,
            fact.jev_ontology_hash = $ontology_hash,
            fact.jev_vocabulary_count = $vocabulary_count,
            fact.jev_relationship_candidate = $relationship_candidate,
            fact.jev_relationship_proposal_status = $relationship_proposal_status,
            fact.jev_vocabulary_promotion = $vocabulary_promotion,
            fact.jev_vocabulary_after_hash = $vocabulary_after_hash,
              fact.jev_vocabulary_after_count = $vocabulary_after_count,
              fact.jev_choice_options_json = $choice_options_json,
              fact.jev_native_signature = $native_signature
        RETURN toString(fact.uuid) AS uuid,
               fact.jev_native_signature AS native_signature,
               fact.jev_relation_winner AS winner,
               fact.jev_relation_distribution_json AS distribution_json,
               fact.jev_label_confidence AS label_confidence,
               fact.jev_provider_confidence AS provider_confidence,
               fact.jev_requested_model AS requested_model,
               fact.jev_resolved_model AS resolved_model,
               fact.jev_question_schema_version AS question_schema_version,
               fact.jev_ontology_version AS ontology_version,
               fact.jev_ontology_hash AS ontology_hash,
               fact.jev_vocabulary_count AS vocabulary_count,
               fact.jev_choice_options_json AS choice_options_json
        """,
        native_fact_uuid=native_fact_uuid,
        winner=winner,
        distribution_json=json.dumps(distribution, sort_keys=True, separators=(",", ":")),
        label_confidence=validated["label_confidence"],
        provider_confidence=validated["provider_confidence"],
        requested_model=str(decision.get("requested_model") or ""),
        resolved_model=str(decision.get("resolved_model") or ""),
        evaluated_at=str(decision.get("evaluated_at") or ""),
        question_schema_version=str(decision.get("question_schema_version") or ""),
        ontology_version=str(decision.get("vocabulary_version") or ""),
        ontology_hash=str(
            decision.get("vocabulary_after_hash")
            or decision.get("vocabulary_hash")
            or ""
        ),
        vocabulary_count=int(
            decision.get("vocabulary_after_count")
            or decision.get("vocabulary_count")
            or 0
        ),
        relationship_candidate=str(
            decision.get("novel_relationship_candidate") or ""
        ),
        relationship_proposal_status=str(
            decision.get("relationship_proposal_status") or ""
        ),
        vocabulary_promotion=str(decision.get("vocabulary_promotion") or ""),
        vocabulary_after_hash=str(decision.get("vocabulary_after_hash") or ""),
        vocabulary_after_count=int(
            decision.get("vocabulary_after_count")
            or decision.get("vocabulary_count")
            or 0
        ),
        choice_options_json=json.dumps(
            validated["choice_options"], separators=(",", ":")
        ),
        native_signature=native_signature,
    )
    records = _records(result)
    if len(records) != 1 or str(records[0].get("uuid") or "") != native_fact_uuid:
        raise RuntimeError("knowgraph_jev_persist_readback_missing")
    return dict(records[0])


async def _reconcile_jev_facts(
    graphiti: Any,
    *,
    project_id: str,
    facts: list[dict[str, Any]],
    relationship_vocabulary: dict[str, Any],
) -> dict[str, Any]:
    """Idempotently repair bounded Jev annotations on existing native facts."""
    deduplicated: list[dict[str, Any]] = []
    seen: set[str] = set()
    for fact in facts:
        native_id = str(fact.get("nativeFactUuid") or "").strip()
        if not native_id or native_id in seen:
            continue
        seen.add(native_id)
        deduplicated.append(fact)

    existing = await _existing_jev_metadata(
        graphiti,
        [str(fact["nativeFactUuid"]) for fact in deduplicated],
    )
    changed: list[dict[str, Any]] = []
    skipped: list[str] = []
    for fact in deduplicated:
        native_id = str(fact["nativeFactUuid"])
        signature = _native_fact_signature(fact)
        fact["_nativeSignature"] = signature
        if _jev_annotation_is_current(
            existing.get(native_id) or {},
            native_signature=signature,
            vocabulary=relationship_vocabulary,
        ):
            skipped.append(native_id)
        else:
            changed.append(fact)

    admitted = changed[:MAX_JEV_RECONCILIATION_FACTS]
    unfinished = [
        str(fact["nativeFactUuid"])
        for fact in changed[MAX_JEV_RECONCILIATION_FACTS:]
    ]
    decisions: list[dict[str, Any]] = []
    call_failure_reason = ""
    if admitted:
        try:
            decisions = await _call_knowgraph_jev(project_id, [
                {
                    key: value
                    for key, value in fact.items()
                    if key != "_nativeSignature"
                }
                for fact in admitted
            ])
        except Exception as error:
            call_failure_reason = str(error).strip() or type(error).__name__

    by_id = {
        str(decision.get("nativeFactUuid") or ""): decision
        for decision in decisions
    }
    attempted: list[str] = []
    succeeded: list[str] = []
    failed: list[str] = []
    failure_reasons: dict[str, str] = {}
    for fact in admitted:
        native_id = str(fact["nativeFactUuid"])
        if call_failure_reason:
            attempted.append(native_id)
            failed.append(native_id)
            failure_reasons[native_id] = call_failure_reason
            continue
        decision = by_id.get(native_id) or {}
        if decision.get("status") == "unfinished":
            unfinished.append(native_id)
            failure_reasons[native_id] = str(
                decision.get("failure_reason")
                or "knowgraph_jev_deadline_exceeded"
            )
            continue
        attempted.append(native_id)
        if decision.get("status") != "success":
            failed.append(native_id)
            failure_reasons[native_id] = str(
                decision.get("failure_reason")
                or "knowgraph_jev_result_invalid"
            )
            continue
        try:
            persisted = await _persist_jev_metadata(
                graphiti,
                native_id,
                str(fact["_nativeSignature"]),
                decision,
            )
            if not _jev_annotation_is_current(
                persisted,
                native_signature=str(fact["_nativeSignature"]),
                vocabulary=relationship_vocabulary,
            ):
                raise RuntimeError("knowgraph_jev_persist_readback_invalid")
        except Exception as error:
            failed.append(native_id)
            failure_reasons[native_id] = (
                str(error).strip() or type(error).__name__
            )
            continue
        succeeded.append(native_id)

    still_unsettled = list(dict.fromkeys([*failed, *unfinished]))
    if still_unsettled:
        status = "partial" if succeeded or skipped else "unavailable"
    else:
        status = "success" if succeeded else "current"
    return {
        "status": status,
        "touched_fact_count": len(deduplicated),
        "classified_fact_count": len(succeeded),
        "reused_fact_count": len(skipped),
        "attempted_fact_uuids": attempted,
        "succeeded_fact_uuids": succeeded,
        "failed_fact_uuids": failed,
        "skipped_fact_uuids": skipped,
        "unfinished_fact_uuids": unfinished,
        "still_unsettled_fact_uuids": still_unsettled,
        **({"failure_reasons": failure_reasons} if failure_reasons else {}),
    }


async def _settle_jev_smart_edges(
    graphiti: Any,
    *,
    project_id: str,
    edges: list[Any],
    nodes: list[Any],
    episode_id: str,
    source_name: str,
    source_url: str | None,
    source_path: str,
    source_type: str,
    text: str,
    reference_time: datetime,
    relationship_vocabulary: dict[str, Any],
) -> dict[str, Any]:
    """Classify only new or materially changed facts returned by this episode."""
    names = {
        str(_edge_value(node, "uuid") or ""): str(_edge_value(node, "name") or "")
        for node in nodes
        if str(_edge_value(node, "uuid") or "")
    }
    facts: list[dict[str, Any]] = []
    for edge in edges:
        native_id = str(_edge_value(edge, "uuid") or "").strip()
        source_id = str(_edge_value(edge, "source_node_uuid") or "").strip()
        target_id = str(_edge_value(edge, "target_node_uuid") or "").strip()
        statement = str(_edge_value(edge, "fact") or "").strip()
        if (
            not native_id or not source_id or not target_id or not statement
            or _edge_value(edge, "invalid_at") is not None
            or _edge_value(edge, "expired_at") is not None
        ):
            continue
        facts.append({
            "nativeFactUuid": native_id,
            "sourceEntity": {"uuid": source_id, "name": names.get(source_id, "")},
            "targetEntity": {"uuid": target_id, "name": names.get(target_id, "")},
            "nativeRelation": str(_edge_value(edge, "name") or ""),
            "fact": statement,
            "supportingEpisodeUuids": [
                str(value) for value in (_edge_value(edge, "episodes") or []) if str(value)
            ],
            "supportingEpisodes": [{
                "uuid": episode_id,
                "name": source_name,
                "source_name": source_name,
                "source_url": source_url,
                "source_path": source_path,
                "source_type": source_type,
                "reference_time": reference_time.isoformat(),
                "content": text,
            }],
            "createdAt": _json_safe(_edge_value(edge, "created_at")),
            "referenceTime": reference_time.isoformat(),
            "validAt": _json_safe(_edge_value(edge, "valid_at")),
            "invalidAt": _json_safe(_edge_value(edge, "invalid_at")),
            "expiredAt": _json_safe(_edge_value(edge, "expired_at")),
        })

    for fact in facts:
        endpoints = {
            str(fact["sourceEntity"]["uuid"]), str(fact["targetEntity"]["uuid"]),
        }
        fact["nearbyFacts"] = [{
            key: other[key]
            for key in (
                "nativeFactUuid", "sourceEntity", "targetEntity", "nativeRelation", "fact",
            )
        } for other in facts if other is not fact and (
            str(other["sourceEntity"]["uuid"]) in endpoints
            or str(other["targetEntity"]["uuid"]) in endpoints
        )][:8]

    return await _reconcile_jev_facts(
        graphiti,
        project_id=project_id,
        facts=facts,
        relationship_vocabulary=relationship_vocabulary,
    )


async def _read_jev_reconciliation_facts(
    graphiti: Any,
    *,
    project_id: str,
    native_fact_uuids: list[str] | None = None,
) -> list[dict[str, Any]]:
    requested = list(dict.fromkeys(
        str(value or "").strip()
        for value in (native_fact_uuids or [])
        if str(value or "").strip()
    ))
    if len(requested) > MAX_JEV_RECONCILIATION_FACTS:
        raise ValueError("knowgraph_jev_reconciliation_limit")
    scope_ids = [project_id, graphiti_project_group_id(project_id)]
    result = await graphiti.driver.execute_query(
        """
        MATCH (source)-[fact]->(target)
        WHERE toString(source.group_id) IN $scope_ids
          AND toString(target.group_id) IN $scope_ids
          AND toString(fact.group_id) IN $scope_ids
          AND fact.invalid_at IS NULL
          AND fact.expired_at IS NULL
          AND (size($fact_ids) = 0 OR toString(fact.uuid) IN $fact_ids)
        RETURN toString(fact.uuid) AS uuid,
               coalesce(toString(source.uuid), elementId(source)) AS source_uuid,
               coalesce(toString(source.name), '') AS source_name,
               coalesce(toString(target.uuid), elementId(target)) AS target_uuid,
               coalesce(toString(target.name), '') AS target_name,
               properties(fact) AS properties
        ORDER BY
          CASE
            WHEN fact.jev_relation_winner IS NULL
              OR fact.jev_relation_distribution_json IS NULL
              OR fact.jev_native_signature IS NULL
              OR fact.jev_question_schema_version <> $question_schema_version
              OR fact.jev_requested_model <> $requested_model
            THEN 0 ELSE 1
          END,
          uuid
        LIMIT $limit
        """,
        scope_ids=scope_ids,
        fact_ids=requested,
        question_schema_version=KNOWGRAPH_JEV_QUESTION_SCHEMA_VERSION,
        requested_model=KNOWGRAPH_JEV_MODEL,
        limit=MAX_JEV_RECONCILIATION_FACTS,
        routing_="r",
    )
    facts: list[dict[str, Any]] = []
    for record in _records(result):
        properties = (
            dict(record.get("properties"))
            if isinstance(record.get("properties"), dict)
            else {}
        )
        native_id = str(record.get("uuid") or "").strip()
        source_id = str(record.get("source_uuid") or "").strip()
        target_id = str(record.get("target_uuid") or "").strip()
        statement = str(properties.get("fact") or "").strip()
        if not native_id or not source_id or not target_id or not statement:
            continue
        facts.append({
            "nativeFactUuid": native_id,
            "sourceEntity": {
                "uuid": source_id,
                "name": str(record.get("source_name") or ""),
            },
            "targetEntity": {
                "uuid": target_id,
                "name": str(record.get("target_name") or ""),
            },
            "nativeRelation": str(
                properties.get("name") or properties.get("edge_type") or ""
            ),
            "fact": statement,
            "supportingEpisodeUuids": [
                str(value)
                for value in (properties.get("episodes") or [])
                if str(value)
            ],
            "supportingEpisodes": [],
            "createdAt": _json_safe(properties.get("created_at")),
            "referenceTime": _json_safe(properties.get("reference_time")),
            "validAt": _json_safe(properties.get("valid_at")),
            "invalidAt": _json_safe(properties.get("invalid_at")),
            "expiredAt": _json_safe(properties.get("expired_at")),
        })
    return facts


async def reconcile_jev_annotations(
    project_id: str,
    *,
    native_fact_uuids: list[str] | None = None,
) -> dict[str, Any]:
    """Repair existing annotations without re-running Graphiti ingestion."""
    project_id = str(project_id or "").strip()
    if not project_id:
        raise ValueError("project_id is required")
    requested = native_fact_uuids or []
    if (
        not isinstance(requested, list)
        or any(not isinstance(value, str) or not value.strip() for value in requested)
        or len(requested) > MAX_JEV_RECONCILIATION_FACTS
    ):
        raise ValueError("knowgraph_jev_reconciliation_fact_ids_invalid")
    _runtime, graphiti, _database = _create_graphiti_runtime(
        provider=None,
        model_key=None,
        model_id=None,
    )
    try:
        vocabulary = await _read_project_relationship_vocabulary(project_id)
        facts = await _read_jev_reconciliation_facts(
            graphiti,
            project_id=project_id,
            native_fact_uuids=requested,
        )
        reconciliation = await _reconcile_jev_facts(
            graphiti,
            project_id=project_id,
            facts=facts,
            relationship_vocabulary=vocabulary,
        )
        return {
            "project_id": project_id,
            "requested_fact_uuids": list(dict.fromkeys(requested)),
            "reingested": False,
            **reconciliation,
        }
    finally:
        await graphiti.driver.close()


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
        graphiti_version=_graphiti_core_version(),
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
                "graphiti_version": _graphiti_core_version(),
            }

        relationship_vocabulary: dict[str, Any] | None = None
        try:
            relationship_vocabulary = await _read_project_relationship_vocabulary(
                project_id
            )
            extraction_guidance = _graphiti_relationship_vocabulary_guidance(
                guidance,
                relationship_vocabulary,
            )
            vocabulary_guidance = {
                "status": "available",
                "version": relationship_vocabulary.get("version"),
                "hash": relationship_vocabulary.get("hash"),
                "count": relationship_vocabulary.get("count"),
            }
        except Exception as error:
            # Graphiti evidence remains useful even when optional vocabulary
            # guidance is unavailable. The later Jev call fails independently
            # and visibly if Python rails itself is unavailable.
            extraction_guidance = guidance
            vocabulary_guidance = {
                "status": "unavailable",
                "failure_reason": str(error).strip() or type(error).__name__,
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
            custom_extraction_instructions=extraction_guidance,
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
        try:
            if relationship_vocabulary is None:
                relationship_vocabulary = (
                    await _read_project_relationship_vocabulary(project_id)
                )
            jev_classification = await _settle_jev_smart_edges(
                graphiti,
                project_id=project_id,
                edges=list(result.edges),
                nodes=list(result.nodes),
                episode_id=episode_id,
                source_name=source_name,
                source_url=source_url,
                source_path=source_path,
                source_type=source_type,
                text=text,
                reference_time=reference_time,
                relationship_vocabulary=relationship_vocabulary,
            )
        except Exception as error:
            jev_classification = {
                "status": "unavailable",
                "touched_fact_count": len(result.edges),
                "classified_fact_count": 0,
                "reused_fact_count": 0,
                "failed_fact_uuids": [],
                "attempted_fact_uuids": [],
                "succeeded_fact_uuids": [],
                "skipped_fact_uuids": [],
                "unfinished_fact_uuids": [
                    str(_edge_value(edge, "uuid") or "")
                    for edge in result.edges
                    if str(_edge_value(edge, "uuid") or "")
                ],
                "still_unsettled_fact_uuids": [
                    str(_edge_value(edge, "uuid") or "")
                    for edge in result.edges
                    if str(_edge_value(edge, "uuid") or "")
                ],
                "failure_reason": str(error).strip() or type(error).__name__,
            }
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
            "graphiti_version": _graphiti_core_version(),
            "entity_count": len(result.nodes),
            "fact_count": len(result.edges),
            "relationship_vocabulary_guidance": vocabulary_guidance,
            "jev_classification": jev_classification,
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
                provider=None,
                model_key=None,
                model_id=None,
                agent_id=None,
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
        "agent_id": None,
        "source_url": None,
        "source_name": base_source_name,
        "content_fingerprint": document_fingerprint,
        "idempotent": not newly_ingested,
        "graphiti_version": _graphiti_core_version(),
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
