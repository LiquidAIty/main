"""Canonical read-only KnowGraph retrieval over Graphiti temporal facts."""

from __future__ import annotations

import asyncio
import os
import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import date, datetime, time
from pathlib import Path
from typing import Any, Callable

from neo4j.time import Date as Neo4jDate
from neo4j.time import DateTime as Neo4jDateTime
from neo4j.time import Duration as Neo4jDuration
from neo4j.time import Time as Neo4jTime

GRAPHITI_ASSERTION_LABEL = "RELATES_TO"
CORPUS_UNPREPARED_STATE = "corpus_unprepared"
CORPUS_UNPREPARED_ERROR = "knowgraph_corpus_unprepared"
DEFAULT_OUTCOMES = ("supported", "contradicted", "uncertain")
MAX_RESULTS_CEILING = 50

WRITE_CLAUSE_RE = re.compile(
    r"\b(MERGE|CREATE|SET|DELETE|DETACH|REMOVE|DROP|LOAD\s+CSV)\b",
    re.IGNORECASE,
)


class HybridRetrievalError(RuntimeError):
    """The canonical retrieval operation failed; this is never an empty result."""


@dataclass
class KnowGraphRetrievalRequest:
    project_id: str
    query: str
    anchors: list[str] = field(default_factory=list)
    task_id: str | None = None
    max_results: int = 12
    max_hops: int = 1
    include_outcomes: list[str] = field(
        default_factory=lambda: list(DEFAULT_OUTCOMES)
    )
    prior_assertion_ids: list[str] | None = None
    prior_source_refs: list[str] | None = None
    project_scopes: list[str] = field(default_factory=list)


@dataclass
class KnowGraphRetrievalResult:
    project_id: str
    anchors: list[str]
    retrieval_state: str
    retrieval_modes: dict[str, Any]
    assertions: list[dict[str, Any]]
    evidence: list[dict[str, Any]]
    relations: list[dict[str, Any]]
    contradictions: list[dict[str, Any]]
    uncertainties: list[dict[str, Any]]
    next_anchor_suggestions: list[str]
    excluded_as_seen: list[str]
    retrieval_notes: list[str]
    omitted_neighbor_count: int = 0
    retryable: bool = True

    def to_dict(self) -> dict[str, Any]:
        return {
            "retryable": self.retryable,
            "project_id": self.project_id,
            "anchors": self.anchors,
            "retrieval_state": self.retrieval_state,
            "retrieval_modes": self.retrieval_modes,
            "assertions": self.assertions,
            "evidence": self.evidence,
            "relations": self.relations,
            "contradictions": self.contradictions,
            "uncertainties": self.uncertainties,
            "next_anchor_suggestions": self.next_anchor_suggestions,
            "excluded_as_seen": self.excluded_as_seen,
            "retrieval_notes": self.retrieval_notes,
            "omitted_neighbor_count": self.omitted_neighbor_count,
        }


def _clean(value: object) -> str:
    return "" if value is None else str(value).strip()


def _safe_int(value: int, low: int, high: int) -> int:
    try:
        parsed = int(value)
    except Exception:
        parsed = low
    return max(low, min(parsed, high))


def _records(result: object) -> list[Any]:
    records = getattr(result, "records", None)
    if records is not None:
        return list(records)
    if isinstance(result, tuple) and result and isinstance(result[0], list):
        return result[0]
    return []


def _row_get(row: object, key: str) -> Any:
    getter = getattr(row, "get", None)
    if callable(getter):
        return getter(key)
    try:
        return row[key]  # type: ignore[index]
    except Exception:
        return None


def _json_contract_value(value: Any) -> Any:
    """Convert supported Neo4j values at the retrieval contract boundary."""
    if isinstance(value, (Neo4jDate, Neo4jDateTime, Neo4jTime, Neo4jDuration)):
        return value.iso_format()
    if isinstance(value, (date, datetime, time)):
        return value.isoformat()
    if isinstance(value, Mapping):
        return {key: _json_contract_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_contract_value(item) for item in value]
    return value


GRAPHITI_CORPUS_COUNT_CYPHER = """
MATCH (episode:Episodic)
WHERE episode.project_id IN $projectScopes
MATCH ()-[fact:RELATES_TO]->()
WHERE episode.uuid IN coalesce(fact.episodes, [])
RETURN count(DISTINCT fact) AS corpus_size
"""

GRAPHITI_FACT_HYDRATION_CYPHER = """
UNWIND range(0, size($edgeIds) - 1) AS result_index
WITH result_index, $edgeIds[result_index] AS edge_id
MATCH (source:Entity)-[fact:RELATES_TO {uuid: edge_id}]->(target:Entity)
MATCH (episode:Episodic)
WHERE episode.uuid IN coalesce(fact.episodes, [])
  AND episode.project_id IN $projectScopes
  AND NOT fact.uuid IN $priorIds
  AND NOT episode.document_id IN $priorRefs
WITH result_index, fact, source, target, episode
ORDER BY episode.valid_at DESC, episode.created_at DESC
WITH result_index, fact, source, target, head(collect(episode)) AS episode
RETURN
fact.uuid AS assertion_id,
fact.fact AS text,
'temporal_fact' AS assertion_kind,
episode.document_id AS document_id,
null AS chapter,
null AS section,
null AS pages,
coalesce(fact.episodes, []) AS chunk_refs,
'graphiti_temporal_fact' AS epistemic_level,
fact.created_at AS created_at,
episode.source_name AS source_title,
coalesce(
  episode.source_url,
  episode.source_path,
  episode.source_description
) AS source_url,
[
  {name: source.name, labels: labels(source)},
  {name: target.name, labels: labels(target)}
] AS related_entities,
fact.valid_at AS valid_at,
fact.invalid_at AS invalid_at,
fact.expired_at AS expired_at,
CASE
  WHEN fact.invalid_at IS NOT NULL THEN 'superseded'
  WHEN fact.expired_at IS NOT NULL THEN 'expired'
  ELSE 'current'
END AS temporal_status,
result_index
ORDER BY result_index
"""


def all_cyphers() -> list[str]:
    return [GRAPHITI_CORPUS_COUNT_CYPHER, GRAPHITI_FACT_HYDRATION_CYPHER]


def assert_all_read_only() -> None:
    for cypher in all_cyphers():
        if WRITE_CLAUSE_RE.search(cypher):
            raise HybridRetrievalError(
                "canonical retrieval contains a write clause"
            )


def _record_to_assertion(record: object) -> dict[str, Any]:
    return {
        key: _json_contract_value(_row_get(record, key))
        for key in (
            "assertion_id",
            "text",
            "assertion_kind",
            "document_id",
            "chapter",
            "section",
            "pages",
            "chunk_refs",
            "epistemic_level",
            "created_at",
            "source_title",
            "source_url",
            "related_entities",
            "valid_at",
            "invalid_at",
            "expired_at",
            "temporal_status",
            "retrieval_score",
        )
    }


async def _search_graphiti_records(
    *,
    query: str,
    scopes: list[str],
    prior_ids: list[str],
    prior_refs: list[str],
    limit: int,
) -> tuple[int, list[dict[str, Any]]]:
    """Use Graphiti's native hybrid search and native Neo4j driver."""
    try:
        from graphiti_core.search.search_config_recipes import (
            EDGE_HYBRID_SEARCH_RRF,
        )
        from ingest import _create_graphiti_runtime
    except ImportError as exc:
        raise HybridRetrievalError(
            "graphiti-core is required for KnowGraph retrieval"
        ) from exc

    _runtime, graphiti, _database = _create_graphiti_runtime(
        provider=None,
        model_key=None,
        model_id=None,
    )
    try:
        count_result = await graphiti.driver.execute_query(
            GRAPHITI_CORPUS_COUNT_CYPHER,
            projectScopes=scopes,
            routing_="r",
        )
        count_rows = _records(count_result)
        corpus_size = (
            int(_row_get(count_rows[0], "corpus_size") or 0)
            if count_rows
            else 0
        )
        if corpus_size == 0:
            return 0, []

        config = EDGE_HYBRID_SEARCH_RRF.model_copy(deep=True)
        config.limit = limit
        search_results = await graphiti.search_(
            query,
            config=config,
            group_ids=scopes,
        )
        edge_ids = [edge.uuid for edge in search_results.edges]
        if not edge_ids:
            return corpus_size, []
        result = await graphiti.driver.execute_query(
            GRAPHITI_FACT_HYDRATION_CYPHER,
            edgeIds=edge_ids,
            projectScopes=scopes,
            priorIds=prior_ids,
            priorRefs=prior_refs,
            routing_="r",
        )
        rows = [_record_to_assertion(row) for row in _records(result)]
        scores = {
            edge.uuid: score
            for edge, score in zip(
                search_results.edges,
                search_results.edge_reranker_scores,
                strict=False,
            )
        }
        for row in rows:
            row["retrieval_score"] = scores.get(
                _clean(row.get("assertion_id"))
            )
        return corpus_size, rows
    except HybridRetrievalError:
        raise
    except Exception as exc:
        raise HybridRetrievalError(
            f"Graphiti fact search failed: {exc}"
        ) from exc
    finally:
        await graphiti.driver.close()


def _postgres_dsn() -> str | None:
    """Return a libpq-compatible DSN from the existing backend authority."""
    url = os.getenv("DATABASE_URL", "").strip()
    if not url:
        try:
            from dotenv import load_dotenv

            for base in [Path.cwd(), *Path(__file__).resolve().parents]:
                env_path = base / "apps" / "backend" / ".env"
                if env_path.exists():
                    load_dotenv(env_path, override=False)
                    break
            url = os.getenv("DATABASE_URL", "").strip()
        except Exception:
            return None
    return url.split("?", 1)[0] if url else None


def resolve_project_scopes(project_id: str) -> list[str]:
    """Resolve the project plus explicitly attached KnowGraph scopes."""
    seed = _clean(project_id)
    if not seed:
        return []
    scopes = [seed]
    dsn = _postgres_dsn()
    if not dsn:
        return scopes
    try:
        import psycopg

        with psycopg.connect(
            dsn, connect_timeout=8
        ) as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT scope FROM liq_core.knowgraph_scope_attachment "
                "WHERE project_id = %s",
                (seed,),
            )
            for (scope,) in cur.fetchall():
                value = _clean(scope)
                if value and value not in scopes:
                    scopes.append(value)
    except Exception as exc:
        print(
            "[knowgraph] scope attachment lookup failed "
            f"(using base scope only): {exc}"
        )
    return scopes


def _corpus_unprepared_result(
    request: KnowGraphRetrievalRequest,
    scopes: list[str],
) -> KnowGraphRetrievalResult:
    return KnowGraphRetrievalResult(
        project_id=request.project_id,
        anchors=list(request.anchors),
        retrieval_state=CORPUS_UNPREPARED_STATE,
        retrieval_modes={
            "backend": "graphiti",
            "hybrid_fact_search": False,
            "temporal": True,
        },
        assertions=[],
        evidence=[],
        relations=[],
        contradictions=[],
        uncertainties=[],
        next_anchor_suggestions=[],
        excluded_as_seen=[],
        retrieval_notes=[
            f"{CORPUS_UNPREPARED_ERROR}: no Graphiti temporal facts exist "
            f"for scopes={scopes}. Do not retry until source ingestion occurs."
        ],
        retryable=False,
    )


def _graphiti_result(
    request: KnowGraphRetrievalRequest,
    scopes: list[str],
    rows: list[dict[str, Any]],
    max_results: int,
) -> KnowGraphRetrievalResult:
    assertions: list[dict[str, Any]] = []
    evidence: list[dict[str, Any]] = []
    relations: list[dict[str, Any]] = []
    contradictions: list[dict[str, Any]] = []
    next_anchors: list[str] = []
    for rank, raw_record in enumerate(rows[:max_results], start=1):
        record = dict(raw_record)
        record["id"] = record.get("assertion_id")
        record["retrieval_reasons"] = ["graphiti_hybrid_fact_search"]
        record["retrieval_rank"] = rank
        assertions.append(record)
        evidence.append(
            {
                "assertion_id": record.get("assertion_id"),
                "text": record.get("text"),
                "document_id": record.get("document_id"),
                "source_title": record.get("source_title"),
                "source_url": record.get("source_url"),
                "episode_refs": record.get("chunk_refs"),
                "valid_at": record.get("valid_at"),
                "invalid_at": record.get("invalid_at"),
                "expired_at": record.get("expired_at"),
                "temporal_status": record.get("temporal_status"),
            }
        )
        if record.get("temporal_status") != "current":
            contradictions.append(
                {
                    "assertion_id": record.get("assertion_id"),
                    "text": record.get("text"),
                    "status": record.get("temporal_status"),
                    "invalid_at": record.get("invalid_at"),
                    "expired_at": record.get("expired_at"),
                    "source_url": record.get("source_url"),
                }
            )
        for related in record.get("related_entities") or []:
            if not isinstance(related, dict):
                continue
            name = _clean(related.get("name"))
            if not name:
                continue
            relations.append(
                {
                    "assertion_id": record.get("assertion_id"),
                    "target": name,
                    "labels": related.get("labels") or [],
                }
            )
            if name not in next_anchors:
                next_anchors.append(name)

    state = "evidence" if assertions else "empty"
    return KnowGraphRetrievalResult(
        project_id=request.project_id,
        anchors=list(request.anchors),
        retrieval_state=state,
        retrieval_modes={
            "backend": "graphiti",
            "hybrid_fact_search": True,
            "temporal": True,
        },
        assertions=assertions,
        evidence=evidence,
        relations=relations,
        contradictions=contradictions,
        uncertainties=[],
        next_anchor_suggestions=next_anchors[:8],
        excluded_as_seen=list(request.prior_assertion_ids or [])
        + list(request.prior_source_refs or []),
        retrieval_notes=[
            f"Graphiti temporal facts returned={len(rows)} "
            f"selected={len(assertions)}",
            f"scopes={scopes}",
        ],
        omitted_neighbor_count=max(0, len(rows) - len(assertions)),
        retryable=state == "empty",
    )


def retrieve_knowgraph_context(
    request: KnowGraphRetrievalRequest,
    *,
    graphiti_search_fn: Callable[
        ..., tuple[int, list[dict[str, Any]]]
    ]
    | None = None,
) -> KnowGraphRetrievalResult:
    """Retrieve bounded sourced facts through Graphiti's native search."""
    if not _clean(request.project_id):
        raise HybridRetrievalError("project_id is required")
    query_text = _clean(request.query) or " ".join(
        _clean(anchor) for anchor in request.anchors if _clean(anchor)
    )
    if not query_text:
        raise HybridRetrievalError("query or anchor is required")
    assert_all_read_only()

    max_results = _safe_int(request.max_results, 1, MAX_RESULTS_CEILING)
    over_fetch = min(
        MAX_RESULTS_CEILING,
        max(max_results * 3, max_results + 6),
    )
    scopes = [
        scope
        for scope in (
            request.project_scopes
            or resolve_project_scopes(request.project_id)
        )
        if _clean(scope)
    ]
    search_args = {
        "query": query_text,
        "scopes": scopes,
        "prior_ids": list(request.prior_assertion_ids or []),
        "prior_refs": list(request.prior_source_refs or []),
        "limit": over_fetch,
    }
    try:
        corpus_size, rows = (
            graphiti_search_fn(**search_args)
            if graphiti_search_fn is not None
            else asyncio.run(_search_graphiti_records(**search_args))
        )
    except HybridRetrievalError:
        raise
    except Exception as exc:
        raise HybridRetrievalError(
            f"Graphiti fact search failed: {exc}"
        ) from exc
    if corpus_size == 0:
        return _corpus_unprepared_result(request, scopes)
    return _graphiti_result(request, scopes, rows, max_results)
