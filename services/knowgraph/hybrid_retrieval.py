"""Canonical, read-only KnowGraph retrieval over grounded assertions.

The semantic substrate is ``:Chunk.embedding``. Retrieval combines the 3072
dimension OpenRouter chunk-vector channel with direct full-text and anchored
matches over ``:KnowledgeAssertion.text``. Every channel applies the same trust,
status, project, and test-data filters before reciprocal-rank fusion.
"""

from __future__ import annotations

import os
import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import date, datetime, time
from pathlib import Path
from typing import Any, Callable, Sequence
from urllib.parse import urlparse

from neo4j.time import Date as Neo4jDate
from neo4j.time import DateTime as Neo4jDateTime
from neo4j.time import Duration as Neo4jDuration
from neo4j.time import Time as Neo4jTime

CHUNK_VECTOR_INDEX = "chunk_embedding_idx"
CHUNK_FULLTEXT_INDEX = "chunk_text_fulltext_idx"
# PATH B: the retrievable evidence unit is the :Chunk — real ingested source text
# with a document + character-offset locator, already embedded. The previous
# reader matched :KnowledgeAssertion, an enrichment label with zero live nodes,
# so it returned empty over a graph full of evidence. Every channel now matches
# this label. A scope holding zero of them cannot answer ANY query, so an empty
# result there would be a lie — it reads as "no evidence found" when the truth is
# "this scope has no ingested corpus". That distinction is the difference between
# an agent concluding something and an agent retrying a query that cannot succeed.
ASSERTION_LABEL = "Chunk"
CORPUS_UNPREPARED_STATE = "corpus_unprepared"
CORPUS_UNPREPARED_ERROR = "knowgraph_corpus_unprepared"
EMBEDDING_MODEL = "openai/text-embedding-3-large"
EMBEDDING_DIMENSIONS = 3072
EMBEDDING_BATCH_SIZE = 32
DEFAULT_OUTCOMES = ("supported", "contradicted", "uncertain")
MAX_RESULTS_CEILING = 50
RRF_K = 60
# Vector and full-text ranks measure query relevance. Exact rank measures anchor
# context, so it remains useful without acting as a third equal relevance vote.
RRF_CHANNEL_WEIGHTS = {"vector": 1.0, "fulltext": 1.0, "exact": 0.1}
# Cosine floor for the vector channel. An ANN index ALWAYS returns its nearest
# neighbours, so without a floor a totally unrelated query still "matches" the
# nearest chunks and `empty` becomes unreachable. Measured on this corpus with
# text-embedding-3-large: on-topic queries score 0.76-0.85, off-topic 0.54-0.59.
# 0.65 sits in the gap with margin on both sides. This is a tuning knob the real
# embedding distribution requires — adjust if a different embedding model is used.
VECTOR_SCORE_FLOOR = 0.65
# BM25 floor for the fulltext channel, same reasoning: even after stopword
# stripping a single common term ("maintenance", "schedule") yields a weak match,
# so without a floor `empty` is unreachable on the lexical channel too. Measured
# on this corpus: on-topic 6.8-7.4, off-topic 1.3-2.6. 4.0 sits in the gap. BM25
# is corpus/term-count dependent, so treat this as a tuning knob, not a constant.
FULLTEXT_SCORE_FLOOR = 4.0

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
    # The Neo4j chunk scopes to query. Empty => resolve from the app project's
    # knowgraph_scope_attachment rows (the same Postgres authority the UI read
    # path uses). An app project stores no chunks under its own UUID; its book /
    # research evidence lives under attached canonical scope strings.
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
    # A successful evidence result is terminal for this bounded request and is
    # not retryable. A genuine empty result stays retryable because new anchors
    # or a materially different query against a populated corpus may find evidence.
    # An unprepared corpus is also not retryable until its external state changes.
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


def _domain(url: str) -> str:
    try:
        return (urlparse(url).hostname or "").lower()
    except Exception:
        return ""


def lucene_escape(text: str) -> str:
    return _LUCENE_SPECIAL.sub(r"\\\1", text)


# High-frequency words carry no evidence signal, but an OR-of-every-word lucene
# query lets them match anything: "submarine cable OFF THE coast" hits book chunks
# on "off"/"the"/"a", so a totally unrelated query looks like a fulltext match and
# `empty` becomes unreachable. Dropping them (and 1-2 char tokens) leaves only the
# terms that actually distinguish a topic. Anchors are always kept — they are the
# caller's deliberate, meaningful phrases.
_LUCENE_STOPWORDS = frozenset(
    "a an and are as at be but by for from has have how in into is it its of on or "
    "that the their this to was were what when where which who will with your you "
    "should so than then these those over under about across off out up down".split()
)


def build_lucene_query(anchors: Sequence[str], query: str) -> str:
    clauses: list[str] = []
    for anchor in anchors:
        cleaned = _clean(anchor)
        if cleaned:
            clauses.append(f'"{lucene_escape(cleaned)}"')
    for word in _clean(query).split():
        if len(word) <= 2 or word.lower() in _LUCENE_STOPWORDS:
            continue
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


# Trust is derived ONLY from provenance that genuinely exists on an ingested
# chunk: it is scoped to a queried project, it carries source text, and it is
# keyed to a real document. There is no `trusted`/`status`/`extraction_mode`
# flag in this graph, and inventing one would make every chunk equally
# authoritative by fiat — the exact fabrication (proj-001, phantom Documents)
# the ingest audit caught twice. `prior*` let a follow-up turn exclude what it
# already has, so retrieval extends rather than repeats.
_TRUST_FILTER = """
chunk.project_id IN $projectScopes
AND chunk.text IS NOT NULL
AND chunk.chunk_id IS NOT NULL
AND NOT chunk.chunk_id IN $priorIds
AND (chunk.document_id IS NULL OR NOT chunk.document_id IN $priorRefs)
"""

# Provenance hop: the source document only. Chapters/Sections exist in this graph
# but are NOT edge-linked to chunks (no Chunk->Chapter relationship), so
# attributing a chunk to a chapter would be invention — and matching every
# chapter of a document to every chunk would cartesian-explode. The honest
# locator is document_id + character offsets, returned as `pages`.
_PROVENANCE_HOP = """
OPTIONAL MATCH (doc:Document {document_id: chunk.document_id})
"""

# `related_entities` is bound per channel by a WITH ... collect BEFORE this RETURN
# (so max/collect group by the chunk, never by the related node).
_RETURN = """
chunk.chunk_id AS assertion_id,
chunk.text AS text,
'source_chunk' AS assertion_kind,
chunk.document_id AS document_id,
null AS chapter,
null AS section,
('chars ' + toString(coalesce(chunk.start_char, 0)) + '-' + toString(coalesce(chunk.end_char, 0))) AS pages,
[chunk.chunk_id] AS chunk_refs,
'source_text' AS epistemic_level,
doc.ingested_at AS created_at,
coalesce(doc.source_name, chunk.source_name) AS source_title,
coalesce(doc.source_url, doc.source_path, doc.path) AS source_url,
related_entities
"""

# The entities a chunk MENTIONS — the extractor's real semantic labels. `:Entity`
# is intentionally absent (that label does not exist here; `__Entity__` is an
# internal builder marker). Collected, never joined into the row grain.
_MENTION_HOP = """
OPTIONAL MATCH (chunk)-[:MENTIONS]->(related)
WHERE related:Concept OR related:Person OR related:Organization
   OR related:Process OR related:Technology OR related:Material
"""

VECTOR_CYPHER = f"""
CALL db.index.vector.queryNodes('{CHUNK_VECTOR_INDEX}', $topK, $queryVector)
YIELD node AS chunk, score
WHERE chunk:Chunk AND score >= $scoreFloor AND {_TRUST_FILTER}
{_PROVENANCE_HOP}
{_MENTION_HOP}
WITH chunk, doc, score AS channel_score,
     collect(DISTINCT {{name: related.name, labels: labels(related)}}) AS related_entities
RETURN {_RETURN}, channel_score
ORDER BY channel_score DESC, assertion_id
LIMIT $cap
"""

FULLTEXT_CYPHER = f"""
CALL db.index.fulltext.queryNodes('{CHUNK_FULLTEXT_INDEX}', $lucene)
YIELD node AS chunk, score
WHERE chunk:Chunk AND score >= $ftFloor AND {_TRUST_FILTER}
{_PROVENANCE_HOP}
{_MENTION_HOP}
WITH chunk, doc, score AS channel_score,
     collect(DISTINCT {{name: related.name, labels: labels(related)}}) AS related_entities
RETURN {_RETURN}, channel_score
ORDER BY channel_score DESC, assertion_id
LIMIT $cap
"""

EXACT_CYPHER = f"""
MATCH (chunk:Chunk)
WHERE {_TRUST_FILTER}
  AND any(anchor IN $anchorsLower WHERE toLower(chunk.text) CONTAINS anchor)
{_PROVENANCE_HOP}
{_MENTION_HOP}
WITH chunk, doc,
     collect(DISTINCT {{name: related.name, labels: labels(related)}}) AS related_entities
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


def _channel_params(scopes: list[str], request: KnowGraphRetrievalRequest, cap: int) -> dict[str, Any]:
    return {
        "projectScopes": list(scopes),
        "priorIds": list(request.prior_assertion_ids or []),
        "priorRefs": list(request.prior_source_refs or []),
        "cap": cap,
    }


def _record_to_assertion(record: object) -> dict[str, Any]:
    return {
        key: _json_contract_value(_row_get(record, key))
        for key in (
            "assertion_id", "text", "assertion_kind", "document_id", "chapter",
            "section", "pages", "chunk_refs", "epistemic_level", "created_at",
            "source_title", "source_url", "related_entities",
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
        channel_weight = RRF_CHANNEL_WEIGHTS[channel]
        for rank, record in enumerate(rows, start=1):
            assertion_id = _clean(record.get("assertion_id"))
            if not assertion_id:
                continue
            candidate = candidates.setdefault(assertion_id, _Candidate(record=dict(record)))
            if channel not in candidate.ranks:
                candidate.ranks[channel] = rank
                candidate.score += channel_weight / (RRF_K + rank)
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


def _postgres_dsn() -> str | None:
    """The Postgres DSN, with non-libpq query params (e.g. ?schema=public) stripped."""
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
    """Resolve the Neo4j chunk scopes for an app project.

    An app project stores no chunks under its own UUID; its evidence lives under
    canonical scope strings recorded in liq_core.knowgraph_scope_attachment (the
    SAME Postgres authority the UI KnowGraph read path uses). Returns the project
    id itself plus every attached scope. The attachment is ADDITIVE — a lookup
    failure must never strip the base scope, mirroring the TS reader's try/catch.
    """
    seed = _clean(project_id)
    if not seed:
        return []
    scopes = [seed]
    dsn = _postgres_dsn()
    if not dsn:
        return scopes
    try:
        import psycopg

        with psycopg.connect(dsn, connect_timeout=8) as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT scope FROM liq_core.knowgraph_scope_attachment WHERE project_id = %s",
                (seed,),
            )
            for (scope,) in cur.fetchall():
                value = _clean(scope)
                if value and value not in scopes:
                    scopes.append(value)
    except Exception as exc:  # noqa: BLE001 — attachment is enrichment, not the base scope
        print(f"[knowgraph] scope attachment lookup failed (using base scope only): {exc}")
    return scopes


_CORPUS_READINESS_CYPHER = f"""
MATCH (chunk:{ASSERTION_LABEL})
WHERE chunk.project_id IN $projectScopes
RETURN count(chunk) AS corpus_size
"""


def _assertion_corpus_size(driver: Any, scopes: list[str], database: str | None) -> int:
    """Scope-level readiness probe: how many chunk nodes exist in these scopes.

    A corpus of zero across every resolved scope is an unprepared retrieval path
    that no query can satisfy — distinct from a populated corpus that simply did
    not match, which is a real `empty`.
    """
    try:
        result = driver.execute_query(
            _CORPUS_READINESS_CYPHER,
            parameters_={"projectScopes": list(scopes)},
            database_=database,
        )
    except Exception as exc:
        raise HybridRetrievalError(f"KnowGraph corpus readiness check failed: {exc}") from exc
    rows = _records(result)
    if not rows:
        return 0
    return int(_row_get(rows[0], "corpus_size") or 0)


def _corpus_unprepared_result(request: KnowGraphRetrievalRequest, scopes: list[str]) -> KnowGraphRetrievalResult:
    """Typed unavailable result — bounded, and explicitly not retryable."""
    return KnowGraphRetrievalResult(
        project_id=request.project_id,
        anchors=list(request.anchors),
        retrieval_state=CORPUS_UNPREPARED_STATE,
        retrieval_modes={"vector": False, "fulltext": False, "exact": False},
        assertions=[],
        evidence=[],
        relations=[],
        contradictions=[],
        uncertainties=[],
        next_anchor_suggestions=[],
        excluded_as_seen=[],
        retrieval_notes=[
            f"{CORPUS_UNPREPARED_ERROR}: no ingested chunk corpus exists for this scope. "
            "Do not retry this query.",
            f"expected_corpus=:{ASSERTION_LABEL} matching_nodes=0 scopes={scopes}",
            "remediation: ingest source documents into one of these scopes, or attach a "
            "populated scope via knowgraph_scope_attachment",
        ],
        retryable=False,
    )


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
    # Resolve the queryable scopes ONCE. Explicit scopes on the request win;
    # otherwise map the app project through its attachment rows so Main reaches
    # the same evidence the UI renders.
    scopes = [s for s in (request.project_scopes or resolve_project_scopes(request.project_id)) if _clean(s)]
    owns_driver = driver is None
    if owns_driver:
        driver, config = _connect_live()
        database = config["database"]

    fulltext_available = True
    try:
        # Readiness BEFORE the embedding. The corpus check is one cheap COUNT
        # against the graph we are already connected to, so an unprepared scope
        # costs zero provider tokens instead of paying to embed a query that
        # cannot match anything.
        if _assertion_corpus_size(driver, scopes, database) == 0:
            return _corpus_unprepared_result(request, scopes)

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

        params = _channel_params(scopes, request, over_fetch)
        vector_params = dict(params, topK=over_fetch, queryVector=vectors[0], scoreFloor=VECTOR_SCORE_FLOOR)
        vector_rows = _run_channel(driver, VECTOR_CYPHER, vector_params, database)
        # Fulltext is an OPTIONAL channel: a missing text index must not erase the
        # evidence the vector channel already found. The vector channel is primary
        # and still raises on real failure.
        lucene = build_lucene_query(request.anchors, request.query)
        try:
            fulltext_rows = _run_channel(
                driver, FULLTEXT_CYPHER, dict(params, lucene=lucene, ftFloor=FULLTEXT_SCORE_FLOOR), database
            )
        except HybridRetrievalError as exc:
            if "NoSuchIndex" in str(exc) or "no such fulltext" in str(exc).lower() or CHUNK_FULLTEXT_INDEX in str(exc):
                fulltext_rows = []
                fulltext_available = False
            else:
                raise
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
        f"scopes={scopes}",
    ]
    if not fulltext_available:
        notes.append(f"fulltext channel unavailable (index '{CHUNK_FULLTEXT_INDEX}' missing) — vector+exact only")
    return KnowGraphRetrievalResult(
        project_id=request.project_id,
        anchors=list(request.anchors),
        retrieval_state=state,
        retrieval_modes={"vector": True, "fulltext": fulltext_available, "exact": bool(anchors_lower)},
        assertions=assertions,
        evidence=evidence,
        relations=relations,
        contradictions=[],
        uncertainties=[],
        next_anchor_suggestions=next_anchors[:8],
        excluded_as_seen=list(request.prior_assertion_ids or []) + list(request.prior_source_refs or []),
        retrieval_notes=notes,
        omitted_neighbor_count=max(0, len(fused) - len(assertions)),
        retryable=state == "empty",
    )
