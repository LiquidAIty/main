"""Process-scoped Graphiti provider, model, embedding, and driver construction."""

from __future__ import annotations

from dataclasses import dataclass
from importlib import metadata as importlib_metadata
import os
from typing import Any

from runtime_config import load_runtime_environment

load_runtime_environment()

DEFAULT_NEO4J_DATABASE = "neo4j"
DEFAULT_OPENROUTER_KG_MODEL = "z-ai/glm-5.2"


def graphiti_runtime_versions() -> dict[str, str | None]:
    """Report installed Graphiti distributions visible to this process."""

    def resolved(distribution: str) -> str | None:
        try:
            return importlib_metadata.version(distribution)
        except importlib_metadata.PackageNotFoundError:
            return None

    return {
        "graphiti_core": resolved("graphiti-core"),
        "graphiti_mcp": resolved("mcp-server"),
    }


def graphiti_core_version() -> str:
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
    except (TypeError, ValueError):
        return None
    return value if value > 0 else None


def _normalize_provider(value: str | None) -> str:
    normalized = (value or "").strip().lower() or "openrouter"
    if normalized in {"openai", "openrouter"}:
        return normalized
    raise RuntimeError(f"Unsupported provider: {value}")


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
    if normalized in {"openai", "openai_compatible", "openai-compatible"}:
        return "openai_compatible"
    raise RuntimeError(f"Unsupported embedding backend: {value}")


def resolve_runtime_model_config() -> RuntimeModelConfig:
    """Resolve one service-level provider/model configuration."""

    provider = _normalize_provider(_optional_env("KNOWGRAPH_PROVIDER"))
    configured_model = _optional_env("KNOWGRAPH_MODEL")
    global_backend = _normalize_embedding_backend(
        _optional_env("KNOWGRAPH_EMBEDDING_BACKEND"),
        default="openai_compatible",
    )
    global_model = _optional_env("KNOWGRAPH_EMBEDDING_MODEL") or "text-embedding-3-large"
    global_dimensions = _optional_int_env("KNOWGRAPH_EMBEDDING_DIM") or 3072

    if provider == "openai":
        model_id = configured_model or _optional_env("OPENAI_DEFAULT_MODEL")
        if not model_id:
            raise RuntimeError("KNOWGRAPH_MODEL is required for the OpenAI provider")
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
            provider=provider,
            model_key=configured_model,
            model_id=model_id,
            llm_client_kwargs=llm_kwargs,
            embedding_backend=global_backend,
            embedding_model=_optional_env("KNOWGRAPH_OPENAI_EMBEDDING_MODEL") or global_model,
            embedding_dimensions=(
                _optional_int_env("KNOWGRAPH_OPENAI_EMBEDDING_DIM") or global_dimensions
            ),
            embedding_client_kwargs=embedding_kwargs,
        )

    model_id = (
        configured_model
        or _optional_env("OPENROUTER_DEFAULT_KG_MODEL_KEY")
        or _optional_env("OPENROUTER_DEFAULT_MODEL")
        or DEFAULT_OPENROUTER_KG_MODEL
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
        provider=provider,
        model_key=configured_model,
        model_id=model_id,
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


def create_graphiti_driver() -> tuple[Any, str]:
    """Create the configured Graphiti Neo4j driver without LLM clients."""

    try:
        from graphiti_core.driver.neo4j_driver import Neo4jDriver
    except ImportError as error:
        raise RuntimeError("graphiti-core is required for KnowGraph") from error
    database = _optional_env("NEO4J_DATABASE") or DEFAULT_NEO4J_DATABASE
    return (
        Neo4jDriver(
            _required_env("NEO4J_URI"),
            _required_env("NEO4J_USER"),
            _required_env("NEO4J_PASSWORD"),
            database=database,
        ),
        database,
    )


def create_graphiti_runtime() -> tuple[RuntimeModelConfig, Any, str]:
    """Create one configured Graphiti ingest runtime."""

    os.environ.setdefault("GRAPHITI_TELEMETRY_ENABLED", "false")
    try:
        from graphiti_core import Graphiti
        from graphiti_core.cross_encoder.openai_reranker_client import OpenAIRerankerClient
        from graphiti_core.embedder.openai import OpenAIEmbedder, OpenAIEmbedderConfig
        from graphiti_core.llm_client.config import LLMConfig
        from graphiti_core.llm_client.openai_client import OpenAIClient
        from graphiti_core.llm_client.openai_generic_client import OpenAIGenericClient
        from openai import AsyncOpenAI
    except ImportError as error:
        raise RuntimeError("graphiti-core is required for KnowGraph ingestion") from error

    runtime = resolve_runtime_model_config()
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
    graph_driver, database = create_graphiti_driver()
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


def graphiti_records(result: Any) -> list[Any]:
    records = getattr(result, "records", None)
    if records is not None:
        return list(records)
    if isinstance(result, tuple) and result and isinstance(result[0], list):
        return result[0]
    return []
