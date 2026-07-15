"""Canonical, read-only KnowGraph retrieval over grounded assertions.

The semantic substrate is ``:Chunk.embedding``. Retrieval combines the 3072
dimension OpenRouter chunk-vector channel with direct full-text and anchored
matches over ``:KnowledgeAssertion.text``. Every channel applies the same trust,
status, project, and test-data filters before reciprocal-rank fusion.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Sequence
from urllib.parse import urlparse

CHUNK_VECTOR_INDEX = "chunk_embedding_idx"
ASSERTION_FULLTEXT_INDEX = "knowledge_assertion_fulltext_idx"
EMBEDDING_MODEL = "openai/text-embedding-3-large"
EMBEDDING_DIMENSIONS = 3072
EMBEDDING_BATCH_SIZE = 32
DEFAULT_OUTCOMES = ("supported", "contradicted", "uncertain")
MAX_RESULTS_CEILING = 50
RRF_K = 60

WRITE_CLAUSE_RE = re.compile(
    r"\b(MERGE|CREATE|SET|DELETE|DETACH|REMOVE|DROP|LOAD\s+CSV)\b", re.IGNORECASE
)
_LUCENE_SPECIAL = re.compile(r'([+\-!(){}\[\]^"~*?:\\/]|&&|\|\|)')


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
    include_outcomes: list[str] = field(default_factory=lambda: list(DEFAULT_OUTCOMES))
    prior_assertion_ids: list[str] | None = None
    prior_source_refs: list[str] | None = None


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

    def to_dict(self) -> dict[str, Any]:
        return {
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
        }


def _clean(value: object) -> str:
    return "" if value is None else str(value).strip()


def _safe_int(value: int, low: int, high: int) -> int:
    try:
        parsed = int(value)
    except Exception:
        parsed = low
    return max(low, min(parsed, high))


def _records(result: object) -> list:
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


def _domain(url: str) -> str:
    try:
        return (urlparse(url).hostname or "").lower()
    except Exception:
        return ""


def lucene_escape(text: str) -> str:
    return _LUCENE_SPECIAL.sub(r"\\\1", text)


def build_lucene_query(anchors: Sequence[str], query: str) -> str:
    clauses: list[str] = []
    for anchor in anchors:
        cleaned = _clean(anchor)
        if cleaned:
            clauses.append(f'"{lucene_escape(cleaned)}"')
    for word in _clean(query).split():
        escaped = lucene_escape(word)
        if escaped:
            clauses.append(escaped)
    return " OR ".join(dict.fromkeys(clauses))


def _openrouter_base_url() -> str:
    configured = _clean(os.getenv("OPENROUTER_OPENAI_BASE_URL") or os.getenv("OPENROUTER_BASE_URL"))
    if not configured:
        return "https://openrouter.ai/api/v1"
    base = configured.rstrip("/")
    if base.endswith("/v1"):
        return base
    if base.endswith("/api"):
        return f"{base}/v1"
    return f"{base}/api/v1"


def openrouter_embed(texts: Sequence[str]) -> list[list[float]]:
    """Embed bounded batches through OpenRouter with no provider fallback."""
    cleaned = [_clean(text) for text in texts]
    if not cleaned or any(not text for text in cleaned):
        raise HybridRetrievalError("query embedding requires non-empty text")
    api_key = _clean(os.getenv("OPENROUTER_API_KEY"))
    if not api_key:
        raise HybridRetrievalError("OPENROUTER_API_KEY is required for KnowGraph retrieval")
    model = _clean(os.getenv("KNOWGRAPH_OPENROUTER_EMBEDDING_MODEL")) or EMBEDDING_MODEL
    expected_dim = int(_clean(os.getenv("KNOWGRAPH_OPENROUTER_EMBEDDING_DIM")) or EMBEDDING_DIMENSIONS)
    if model != EMBEDDING_MODEL or expected_dim != EMBEDDING_DIMENSIONS:
        raise HybridRetrievalError(
            f"KnowGraph embedding contract requires {EMBEDDING_MODEL} at {EMBEDDING_DIMENSIONS} dimensions"
        )
    try:
        from openai import OpenAI

        client = OpenAI(
            api_key=api_key,
            base_url=_openrouter_base_url(),
            max_retries=2,
            timeout=30.0,
        )
        vectors: list[list[float]] = []
        for start in range(0, len(cleaned), EMBEDDING_BATCH_SIZE):
            response = client.embeddings.create(
                model=model,
                input=cleaned[start : start + EMBEDDING_BATCH_SIZE],
                encoding_format="float",
            )
            ordered = sorted(response.data, key=lambda item: item.index)
            vectors.extend([list(item.embedding) for item in ordered])
    except HybridRetrievalError:
        raise
    except Exception as exc:
        raise HybridRetrievalError(f"OpenRouter query embedding failed: {exc}") from exc
    if len(vectors) != len(cleaned) or any(len(vector) != expected_dim for vector in vectors):
        observed = [len(vector) for vector in vectors]
        raise HybridRetrievalError(
            f"OpenRouter embedding dimension mismatch: expected {expected_dim}, observed {observed}"
        )
    return vectors


_TRUST_FILTER = """
ka.project_id = $projectId
AND ka.trusted = true
AND coalesce(ka.status, 'active') <> 'superseded'
AND coalesce(ka.extraction_mode, '') <> 'anchor'
AND coalesce(ka.extraction_mode, '') <> 'test'
AND NOT ka.assertion_id IN $priorIds
AND (ka.document_id IS NULL OR NOT ka.document_id IN $priorRefs)
"""

_RETURN = """
ka.assertion_id AS assertion_id,
ka.text AS text,
ka.assertion_kind AS assertion_kind,
ka.document_id AS document_id,
ka.chapter AS chapter,
ka.section AS section,
ka.pages AS pages,
ka.chunk_refs AS chunk_refs,
ka.trusted AS trusted,
ka.status AS status,
ka.created_at AS created_at,
ka.extraction_run AS extraction_run,
coalesce(doc.source_name, chunk.source_name) AS source_title,
coalesce(doc.source_url, chunk.source_url) AS source_url,
collect(DISTINCT {name: coalesce(related.name, related.label), labels: labels(related)}) AS related_entities
"""

VECTOR_CYPHER = f"""
CALL db.index.vector.queryNodes('{CHUNK_VECTOR_INDEX}', $topK, $queryVector)
YIELD node AS chunk, score
WHERE chunk:Chunk AND chunk.project_id = $projectId
MATCH (chunk)-[:MENTIONS]->(ka:KnowledgeAssertion)
WHERE {_TRUST_FILTER}
OPTIONAL MATCH (doc:Document {{project_id: $projectId, document_id: ka.document_id}})
OPTIONAL MATCH (ka)-[semanticRel]-(related)
WHERE related:Concept OR related:Entity OR related:Person OR related:Organization
WITH ka, chunk, doc, related, max(score) AS channel_score
RETURN {_RETURN}, channel_score
ORDER BY channel_score DESC, assertion_id
LIMIT $cap
"""

FULLTEXT_CYPHER = f"""
CALL db.index.fulltext.queryNodes('{ASSERTION_FULLTEXT_INDEX}', $lucene)
YIELD node AS ka, score
WHERE ka:KnowledgeAssertion AND {_TRUST_FILTER}
OPTIONAL MATCH (chunk:Chunk)-[:MENTIONS]->(ka)
WHERE chunk.project_id = $projectId
OPTIONAL MATCH (doc:Document {{project_id: $projectId, document_id: ka.document_id}})
OPTIONAL MATCH (ka)-[semanticRel]-(related)
WHERE related:Concept OR related:Entity OR related:Person OR related:Organization
WITH ka, chunk, doc, related, max(score) AS channel_score
RETURN {_RETURN}, channel_score
ORDER BY channel_score DESC, assertion_id
LIMIT $cap
"""

EXACT_CYPHER = f"""
MATCH (ka:KnowledgeAssertion)
WHERE {_TRUST_FILTER}
  AND any(anchor IN $anchorsLower WHERE toLower(ka.text) CONTAINS anchor)
OPTIONAL MATCH (chunk:Chunk)-[:MENTIONS]->(ka)
WHERE chunk.project_id = $projectId
OPTIONAL MATCH (doc:Document {{project_id: $projectId, document_id: ka.document_id}})
OPTIONAL MATCH (ka)-[semanticRel]-(related)
WHERE related:Concept OR related:Entity OR related:Person OR related:Organization
WITH ka, chunk, doc, related
RETURN {_RETURN}, 1.0 AS channel_score
ORDER BY assertion_id
LIMIT $cap
"""


def all_cyphers() -> list[str]:
    return [VECTOR_CYPHER, FULLTEXT_CYPHER, EXACT_CYPHER]


def assert_all_read_only() -> None:
    for cypher in all_cyphers():
        if WRITE_CLAUSE_RE.search(cypher):
            raise HybridRetrievalError("canonical retrieval contains a write clause")


def _channel_params(request: KnowGraphRetrievalRequest, cap: int) -> dict[str, Any]:
    return {
        "projectId": request.project_id,
        "priorIds": list(request.prior_assertion_ids or []),
        "priorRefs": list(request.prior_source_refs or []),
        "cap": cap,
    }


def _record_to_assertion(record: object) -> dict[str, Any]:
    return {
        key: _row_get(record, key)
        for key in (
            "assertion_id", "text", "assertion_kind", "document_id", "chapter",
            "section", "pages", "chunk_refs", "trusted", "status", "created_at",
            "extraction_run", "source_title", "source_url", "related_entities",
        )
    }


def _run_channel(driver: Any, cypher: str, params: dict[str, Any], database: str | None) -> list[dict[str, Any]]:
    try:
        result = driver.execute_query(cypher, parameters_=params, database_=database)
    except Exception as exc:
        raise HybridRetrievalError(f"KnowGraph retrieval query failed: {exc}") from exc
    return [_record_to_assertion(row) for row in _records(result)]


@dataclass
class _Candidate:
    record: dict[str, Any]
    ranks: dict[str, int] = field(default_factory=dict)
    reasons: list[str] = field(default_factory=list)
    score: float = 0.0


def _fuse(channels: dict[str, list[dict[str, Any]]]) -> list[_Candidate]:
    candidates: dict[str, _Candidate] = {}
    reasons = {"vector": "semantic_chunk_match", "fulltext": "fulltext_match", "exact": "exact_anchor_match"}
    for channel, rows in channels.items():
        for rank, record in enumerate(rows, start=1):
            assertion_id = _clean(record.get("assertion_id"))
            if not assertion_id:
                continue
            candidate = candidates.setdefault(assertion_id, _Candidate(record=dict(record)))
            if channel not in candidate.ranks:
                candidate.ranks[channel] = rank
                candidate.score += 1.0 / (RRF_K + rank)
                candidate.reasons.append(reasons[channel])
    return sorted(candidates.values(), key=lambda item: (-item.score, _clean(item.record.get("assertion_id"))))


def _select_diverse(candidates: list[_Candidate], cap: int) -> list[_Candidate]:
    selected: list[_Candidate] = []
    deferred: list[_Candidate] = []
    used_documents: set[str] = set()
    used_domains: set[str] = set()
    for candidate in candidates:
        document = _clean(candidate.record.get("document_id"))
        domain = _domain(_clean(candidate.record.get("source_url")))
        if (document and document in used_documents) or (domain and domain in used_domains):
            deferred.append(candidate)
            continue
        selected.append(candidate)
        if document:
            used_documents.add(document)
        if domain:
            used_domains.add(domain)
        if len(selected) == cap:
            return selected
    return (selected + deferred)[:cap]


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _connect_live():
    import skill_ingest

    config = skill_ingest.load_neo4j_config(_repo_root())
    return skill_ingest._connect(config), config


def retrieve_knowgraph_context(
    request: KnowGraphRetrievalRequest,
    *,
    driver: Any = None,
    embed_fn: Callable[[Sequence[str]], list[list[float]]] | None = None,
    database: str | None = None,
) -> KnowGraphRetrievalResult:
    if not _clean(request.project_id):
        raise HybridRetrievalError("project_id is required")
    query_text = _clean(request.query) or " ".join(_clean(anchor) for anchor in request.anchors if _clean(anchor))
    if not query_text:
        raise HybridRetrievalError("query or anchor is required")
    assert_all_read_only()

    max_results = _safe_int(request.max_results, 1, MAX_RESULTS_CEILING)
    over_fetch = min(MAX_RESULTS_CEILING, max(max_results * 3, max_results + 6))
    embed = embed_fn or openrouter_embed
    try:
        vectors = embed([query_text])
    except HybridRetrievalError:
        raise
    except Exception as exc:
        raise HybridRetrievalError(f"OpenRouter query embedding failed: {exc}") from exc
    if not vectors or len(vectors[0]) != EMBEDDING_DIMENSIONS:
        observed = len(vectors[0]) if vectors and vectors[0] else 0
        raise HybridRetrievalError(
            f"query embedding dimension mismatch: expected {EMBEDDING_DIMENSIONS}, observed {observed}"
        )

    owns_driver = driver is None
    if owns_driver:
        driver, config = _connect_live()
        database = config["database"]

    params = _channel_params(request, over_fetch)
    try:
        vector_params = dict(params, topK=over_fetch, queryVector=vectors[0])
        vector_rows = _run_channel(driver, VECTOR_CYPHER, vector_params, database)
        lucene = build_lucene_query(request.anchors, request.query)
        fulltext_rows = _run_channel(driver, FULLTEXT_CYPHER, dict(params, lucene=lucene), database)
        anchors_lower = [_clean(anchor).lower() for anchor in request.anchors if _clean(anchor)]
        exact_rows = (
            _run_channel(driver, EXACT_CYPHER, dict(params, anchorsLower=anchors_lower), database)
            if anchors_lower else []
        )
    finally:
        if owns_driver and driver is not None:
            driver.close()

    fused = _fuse({"vector": vector_rows, "fulltext": fulltext_rows, "exact": exact_rows})
    selected = _select_diverse(fused, max_results)
    assertions: list[dict[str, Any]] = []
    evidence: list[dict[str, Any]] = []
    relations: list[dict[str, Any]] = []
    next_anchors: list[str] = []
    for candidate in selected:
        record = dict(candidate.record)
        record["id"] = record.get("assertion_id")
        record["retrieval_reasons"] = candidate.reasons
        record["retrieval_rank_channels"] = candidate.ranks
        record["fused_score"] = round(candidate.score, 6)
        assertions.append(record)
        evidence.append({
            "assertion_id": record.get("assertion_id"),
            "text": record.get("text"),
            "document_id": record.get("document_id"),
            "chapter": record.get("chapter"),
            "section": record.get("section"),
            "pages": record.get("pages"),
            "chunk_refs": record.get("chunk_refs"),
            "source_title": record.get("source_title"),
            "source_url": record.get("source_url"),
        })
        for related in record.get("related_entities") or []:
            if not isinstance(related, dict) or not _clean(related.get("name")):
                continue
            name = _clean(related["name"])
            relations.append({
                "assertion_id": record.get("assertion_id"),
                "target": name,
                "labels": related.get("labels") or [],
            })
            if name not in next_anchors:
                next_anchors.append(name)

    state = "evidence" if assertions else "empty"
    notes = [
        f"channels: vector={len(vector_rows)} fulltext={len(fulltext_rows)} exact={len(exact_rows)}",
        "no evidence found" if state == "empty" else f"selected={len(assertions)} of fused={len(fused)}",
        f"vector model={EMBEDDING_MODEL} dimensions={EMBEDDING_DIMENSIONS}",
    ]
    return KnowGraphRetrievalResult(
        project_id=request.project_id,
        anchors=list(request.anchors),
        retrieval_state=state,
        retrieval_modes={"vector": True, "fulltext": True, "exact": bool(anchors_lower)},
        assertions=assertions,
        evidence=evidence,
        relations=relations,
        contradictions=[],
        uncertainties=[],
        next_anchor_suggestions=next_anchors[:8],
        excluded_as_seen=list(request.prior_assertion_ids or []) + list(request.prior_source_refs or []),
        retrieval_notes=notes,
    )
