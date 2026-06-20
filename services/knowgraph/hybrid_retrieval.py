# @graph entity: KnowGraph Hybrid Retrieval
# @graph role: hybrid-retrieval-over-one-neo4j-graph
# @graph relates_to: KnowGraph EmbeddingGemma Client, KnowGraph Assertion Vectors, KnowGraph Source Judgment
# @graph depends_on: Neo4j, KnowGraph EmbeddingGemma Client
# @graph feeds_to: Mag One retrieve_knowgraph_context tool
"""Hybrid retrieval over ONE Neo4j knowledge graph (KnowGraph), Python rails.

This is the callable capability behind the Mag One ``retrieve_knowgraph_context``
tool. Mag One decides WHEN to call it and supplies the bounded request; this
module never decides on its own when retrieval is needed and never runs from
TypeScript.

"Hybrid" here means combining retrieval METHODS over the single KnowGraph:

    A. exact anchored graph traversal     (parameterized Cypher over anchors)
    B. Neo4j full-text retrieval          (kg_assertion_fulltext / kg_source_fulltext)
    C. Neo4j vector retrieval             (kg_assertion_embedding_idx via local EmbeddingGemma)
    D. bounded one-hop graph expansion    (CONTRADICTS / RELATES_TO_ENTITY from selected)
    E. rank fusion (RRF), dedupe, diversity selection

It is NOT a hybrid database. It does not merge KnowGraph (Neo4j) with ThinkGraph
(Apache AGE / Postgres) and never reads ThinkGraph. It never generates Cypher
from model text (no text2cypher), never executes model-written Cypher, and makes
no Neo4j writes. The only model call is the local EmbeddingGemma embedding of the
request query (embeddinggemma.py → local /embeddings); there is no chat, no
Tavily, no web fetch, no remote provider.

Every selected assertion preserves its source-backed identity: id, subject,
predicate, object, outcome, evidence text / retrieval summary, sourceRef, source
title, source URL, plus the retrieval reasons that surfaced it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Sequence
from urllib.parse import urlparse

import embeddinggemma

ASSERTION_FULLTEXT_INDEX = "kg_assertion_fulltext"
SOURCE_FULLTEXT_INDEX = "kg_source_fulltext"
ASSERTION_VECTOR_INDEX = "kg_assertion_embedding_idx"

DEFAULT_OUTCOMES = ("supported", "contradicted", "uncertain")
RRF_K = 60  # standard reciprocal-rank-fusion constant
MAX_RESULTS_CEILING = 50  # hard upper bound regardless of request

# Read-only guard: every Cypher shape this module runs must contain no write
# clause. Proven by assert_all_read_only() and the unit tests.
WRITE_CLAUSE_RE = re.compile(
    r"\b(MERGE|CREATE|SET|DELETE|DETACH|REMOVE|DROP|LOAD\s+CSV)\b", re.IGNORECASE
)

# Lucene reserved characters that must be escaped for full-text queries.
_LUCENE_SPECIAL = re.compile(r'([+\-!(){}\[\]^"~*?:\\/]|&&|\|\|)')


class HybridRetrievalError(RuntimeError):
    """Capability-level failure (bad request / connection), not a per-channel one."""


# --------------------------------------------------------------------------- #
# request / result contract
# --------------------------------------------------------------------------- #
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


# --------------------------------------------------------------------------- #
# small helpers
# --------------------------------------------------------------------------- #
def _clean(value: object) -> str:
    return "" if value is None else str(value).strip()


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
    """Escape Lucene reserved characters so a raw anchor/query cannot break the
    full-text parser or inject operators."""
    return _LUCENE_SPECIAL.sub(r"\\\1", text)


def build_lucene_query(anchors: Sequence[str], query: str) -> str:
    """Build a Lucene-safe OR query from anchors + query terms.

    Each anchor is escaped and quoted as a phrase; query words are escaped as
    individual terms. Returns ``*`` (match-any) only if nothing usable is given.
    """
    clauses: list[str] = []
    for anchor in anchors:
        cleaned = _clean(anchor)
        if cleaned:
            clauses.append(f'"{lucene_escape(cleaned)}"')
    for word in _clean(query).split():
        escaped = lucene_escape(word)
        if escaped:
            clauses.append(escaped)
    if not clauses:
        return "*"
    return " OR ".join(dict.fromkeys(clauses))  # dedupe, preserve order


def _record_to_assertion(record: object) -> dict[str, Any]:
    return {
        "id": _row_get(record, "id"),
        "subject": _row_get(record, "subject"),
        "predicate": _row_get(record, "predicate"),
        "object": _row_get(record, "object"),
        "outcome": _row_get(record, "outcome"),
        "evidence_text": _row_get(record, "evidence_text"),
        "retrieval_summary": _row_get(record, "retrieval_summary"),
        "source_ref": _row_get(record, "source_ref"),
        "source_title": _row_get(record, "source_title"),
        "source_url": _row_get(record, "source_url"),
    }


# Shared RETURN projection so every channel yields the same source-backed shape.
_ASSERTION_RETURN = """
       a.id AS id, a.subject AS subject, a.predicate AS predicate, a.object AS object,
       a.outcome AS outcome, a.evidence_text AS evidence_text,
       a.retrieval_summary AS retrieval_summary, a.source_ref AS source_ref,
       coalesce(s.title, a.source_title) AS source_title,
       coalesce(s.url, a.source_url) AS source_url
"""

# A. exact anchored traversal -------------------------------------------------
EXACT_CYPHER = """
MATCH (a:SourceBackedAssertion {{ project_id: $projectId }})
WHERE a.outcome IN $includeOutcomes
  AND NOT a.id IN $priorIds
  AND (a.source_ref IS NULL OR NOT a.source_ref IN $priorRefs)
  AND (
        any(anchor IN $anchorsLower WHERE
              toLower(coalesce(a.subject, '')) CONTAINS anchor
           OR toLower(coalesce(a.object, '')) CONTAINS anchor
           OR toLower(coalesce(a.source_title, '')) CONTAINS anchor
           OR toLower(coalesce(a.evidence_text, '')) CONTAINS anchor)
        OR EXISTS {{
              MATCH (a)-[:RELATES_TO_ENTITY]->(e:ObservedEntity)
              WHERE any(anchor IN $anchorsLower
                        WHERE toLower(coalesce(e.label, '')) CONTAINS anchor)
        }}
  )
OPTIONAL MATCH (a)-[:ASSERTED_BY_SOURCE]->(s:Source)
RETURN {projection}
ORDER BY a.id
LIMIT {cap}
"""

# B. full-text (assertion index) ---------------------------------------------
FULLTEXT_ASSERTION_CYPHER = """
CALL db.index.fulltext.queryNodes('{index}', $lucene) YIELD node AS a, score
WHERE a:SourceBackedAssertion AND a.project_id = $projectId
  AND a.outcome IN $includeOutcomes
  AND NOT a.id IN $priorIds
  AND (a.source_ref IS NULL OR NOT a.source_ref IN $priorRefs)
OPTIONAL MATCH (a)-[:ASSERTED_BY_SOURCE]->(s:Source)
RETURN {projection}
ORDER BY score DESC
LIMIT {cap}
"""

# B. full-text (source index → back to assertions) ---------------------------
FULLTEXT_SOURCE_CYPHER = """
CALL db.index.fulltext.queryNodes('{index}', $lucene) YIELD node AS s, score
WHERE s:Source AND s.project_id = $projectId
MATCH (a:SourceBackedAssertion {{ project_id: $projectId }})-[:ASSERTED_BY_SOURCE]->(s)
WHERE a.outcome IN $includeOutcomes
  AND NOT a.id IN $priorIds
  AND (a.source_ref IS NULL OR NOT a.source_ref IN $priorRefs)
RETURN {projection}
ORDER BY score DESC
LIMIT {cap}
"""

# C. vector retrieval ---------------------------------------------------------
VECTOR_CYPHER = """
CALL db.index.vector.queryNodes('{index}', {k}, $queryVector) YIELD node AS a, score
WHERE a:SourceBackedAssertion AND a.project_id = $projectId
  AND a.outcome IN $includeOutcomes
  AND NOT a.id IN $priorIds
  AND (a.source_ref IS NULL OR NOT a.source_ref IN $priorRefs)
OPTIONAL MATCH (a)-[:ASSERTED_BY_SOURCE]->(s:Source)
RETURN {projection}
ORDER BY score DESC
LIMIT {cap}
"""

# D. bounded one-hop expansion ------------------------------------------------
EXPANSION_CYPHER = """
MATCH (a:SourceBackedAssertion {{ project_id: $projectId }})
WHERE a.id IN $seedIds
OPTIONAL MATCH (a)-[:CONTRADICTS]-(c:SourceBackedAssertion {{ project_id: $projectId }})
OPTIONAL MATCH (a)-[:RELATES_TO_ENTITY]->(e:ObservedEntity)
RETURN a.id AS source_id,
       collect(DISTINCT {{ id: c.id, subject: c.subject, predicate: c.predicate,
                           object: c.object, outcome: c.outcome,
                           source_ref: c.source_ref }})[..{hop_cap}] AS contradicts,
       collect(DISTINCT {{ label: e.label, id: e.id }})[..{hop_cap}] AS entities
"""


def all_cyphers() -> list[str]:
    """Every Cypher shape this module can run (read-only proof surface)."""
    projection = _ASSERTION_RETURN
    return [
        EXACT_CYPHER.format(projection=projection, cap=10),
        FULLTEXT_ASSERTION_CYPHER.format(index=ASSERTION_FULLTEXT_INDEX, projection=projection, cap=10),
        FULLTEXT_SOURCE_CYPHER.format(index=SOURCE_FULLTEXT_INDEX, projection=projection, cap=10),
        VECTOR_CYPHER.format(index=ASSERTION_VECTOR_INDEX, k=10, projection=projection, cap=10),
        EXPANSION_CYPHER.format(hop_cap=10),
    ]


def assert_all_read_only() -> None:
    """Fail loudly if any query shape contains a write clause."""
    for cypher in all_cyphers():
        if WRITE_CLAUSE_RE.search(cypher):
            raise HybridRetrievalError(f"non-read-only cypher detected: {cypher.strip()[:80]!r}")


# --------------------------------------------------------------------------- #
# per-channel retrieval
# --------------------------------------------------------------------------- #
def _safe_int(value: int, low: int, high: int) -> int:
    try:
        coerced = int(value)
    except Exception:
        coerced = low
    return max(low, min(coerced, high))


def _channel_params(req: KnowGraphRetrievalRequest) -> dict[str, Any]:
    return {
        "projectId": req.project_id,
        "includeOutcomes": list(req.include_outcomes or DEFAULT_OUTCOMES),
        "priorIds": list(req.prior_assertion_ids or []),
        "priorRefs": list(req.prior_source_refs or []),
    }


def exact_retrieval(driver: Any, req: KnowGraphRetrievalRequest, *, cap: int,
                    database: str | None) -> list[dict[str, Any]]:
    anchors_lower = [a.lower() for a in (req.anchors or []) if _clean(a)]
    if not anchors_lower:
        return []
    cypher = EXACT_CYPHER.format(projection=_ASSERTION_RETURN, cap=_safe_int(cap, 1, 200))
    params = _channel_params(req)
    params["anchorsLower"] = anchors_lower
    result = driver.execute_query(cypher, parameters_=params, database_=database)
    return [_record_to_assertion(r) for r in _records(result)]


def _fulltext_channel(driver: Any, req: KnowGraphRetrievalRequest, *, cap: int,
                      database: str | None) -> tuple[list[dict[str, Any]], str | None]:
    lucene = build_lucene_query(req.anchors, req.query)
    params = _channel_params(req)
    params["lucene"] = lucene
    safe_cap = _safe_int(cap, 1, 200)
    ordered: list[dict[str, Any]] = []
    try:
        for index, cypher_tpl in (
            (ASSERTION_FULLTEXT_INDEX, FULLTEXT_ASSERTION_CYPHER),
            (SOURCE_FULLTEXT_INDEX, FULLTEXT_SOURCE_CYPHER),
        ):
            cypher = cypher_tpl.format(index=index, projection=_ASSERTION_RETURN, cap=safe_cap)
            result = driver.execute_query(cypher, parameters_=params, database_=database)
            ordered.extend(_record_to_assertion(r) for r in _records(result))
    except Exception as exc:  # missing index / unavailable full-text service
        return [], f"fulltext_unavailable: {exc}"
    # dedupe by id keeping best (earliest) rank across both sub-queries
    seen: set[str] = set()
    deduped: list[dict[str, Any]] = []
    for rec in ordered:
        rid = rec.get("id")
        if rid in seen:
            continue
        seen.add(rid)
        deduped.append(rec)
    return deduped, None


def vector_retrieval(driver: Any, req: KnowGraphRetrievalRequest, *, cap: int,
                     embed_fn: Callable[[Sequence[str]], list[list[float]]],
                     database: str | None) -> tuple[list[dict[str, Any]], str]:
    """Returns (rows, availability) where availability is 'available' or
    'unavailable: <why>'. Exact/full-text still work when this is unavailable."""
    query_text = _clean(req.query)
    if not query_text:
        return [], "unavailable: empty_query"
    try:
        vectors = embed_fn([query_text])
    except embeddinggemma.EmbeddingGemmaError as exc:
        return [], f"unavailable: embedding_endpoint {exc}"
    except Exception as exc:  # pragma: no cover - defensive
        return [], f"unavailable: embedding_error {exc}"
    if not vectors or not vectors[0]:
        return [], "unavailable: empty_embedding"
    query_vector = vectors[0]
    k = _safe_int(cap, 1, 500)
    cypher = VECTOR_CYPHER.format(
        index=ASSERTION_VECTOR_INDEX, k=k, projection=_ASSERTION_RETURN, cap=_safe_int(cap, 1, 200)
    )
    params = _channel_params(req)
    params["queryVector"] = query_vector
    try:
        result = driver.execute_query(cypher, parameters_=params, database_=database)
    except Exception as exc:  # missing/dim-mismatched vector index
        return [], f"unavailable: vector_index {exc}"
    return [_record_to_assertion(r) for r in _records(result)], "available"


def one_hop_expansion(driver: Any, req: KnowGraphRetrievalRequest, seed_ids: list[str],
                      *, hop_cap: int, database: str | None
                      ) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    """Bounded one-hop CONTRADICTS / RELATES_TO_ENTITY expansion from seeds.

    Returns (contradictions, relations, discovered_entity_labels)."""
    if not seed_ids or req.max_hops < 1:
        return [], [], []
    cypher = EXPANSION_CYPHER.format(hop_cap=_safe_int(hop_cap, 1, 50))
    result = driver.execute_query(
        cypher,
        parameters_={"projectId": req.project_id, "seedIds": seed_ids},
        database_=database,
    )
    contradictions: list[dict[str, Any]] = []
    relations: list[dict[str, Any]] = []
    discovered: list[str] = []
    for record in _records(result):
        source_id = _row_get(record, "source_id")
        for c in _row_get(record, "contradicts") or []:
            cid = c.get("id") if isinstance(c, dict) else None
            if not cid:
                continue
            contradictions.append({"assertion_id": source_id, "contradicts_id": cid,
                                    "subject": c.get("subject"), "predicate": c.get("predicate"),
                                    "object": c.get("object"), "outcome": c.get("outcome"),
                                    "source_ref": c.get("source_ref")})
            relations.append({"assertion_id": source_id, "rel_type": "CONTRADICTS",
                              "target_id": cid, "target_label": "SourceBackedAssertion"})
        for e in _row_get(record, "entities") or []:
            label = e.get("label") if isinstance(e, dict) else None
            if not label:
                continue
            relations.append({"assertion_id": source_id, "rel_type": "RELATES_TO_ENTITY",
                              "target_id": e.get("id"), "target_label": label})
            discovered.append(label)
    return contradictions, relations, discovered


# --------------------------------------------------------------------------- #
# fusion, dedupe, diversity
# --------------------------------------------------------------------------- #
@dataclass
class _Candidate:
    record: dict[str, Any]
    ranks: dict[str, int] = field(default_factory=dict)
    reasons: list[str] = field(default_factory=list)
    rrf: float = 0.0
    score: float = 0.0


def _fuse(channels: dict[str, list[dict[str, Any]]]) -> dict[str, _Candidate]:
    """Reciprocal-rank fusion over per-channel RANK (never raw channel scores)."""
    candidates: dict[str, _Candidate] = {}
    reason_for = {"exact": "exact_anchor_match", "fulltext": "fulltext_match",
                  "vector": "semantic_match"}
    for channel, rows in channels.items():
        for position, record in enumerate(rows):
            rid = record.get("id")
            if not rid:
                continue
            cand = candidates.get(rid)
            if cand is None:
                cand = _Candidate(record=dict(record))
                candidates[rid] = cand
            rank = position + 1  # 1-based rank, NOT the raw fulltext/cosine score
            if channel not in cand.ranks:
                cand.ranks[channel] = rank
                cand.rrf += 1.0 / (RRF_K + rank)
                cand.reasons.append(reason_for[channel])
    return candidates


def _apply_structure_and_dedupe(candidates: dict[str, _Candidate]) -> list[_Candidate]:
    """Small explainable structural adjustments + duplicate down-ranking."""
    ordered = sorted(candidates.values(), key=lambda c: (-c.rrf, str(c.record.get("id"))))
    seen_refs: set[str] = set()
    seen_titles: set[str] = set()
    seen_domains: set[str] = set()
    for cand in ordered:
        rec = cand.record
        score = cand.rrf
        outcome = _clean(rec.get("outcome")).lower()
        # rank up: multi-channel, source-backed, contradiction, uncertainty, anchor-connected
        if len(cand.ranks) > 1:
            score += 0.05
            cand.reasons.append("multi_channel")
        if "exact" in cand.ranks:
            score += 0.02
            cand.reasons.append("anchor_connected")
        if _clean(rec.get("source_ref")):
            score += 0.01
            cand.reasons.append("source_backed")
        if outcome == "contradicted":
            score += 0.02
            cand.reasons.append("contradiction")
        if outcome == "uncertain":
            score += 0.015
            cand.reasons.append("uncertainty")
        # rank down: duplicate sourceRef / title / domain (second+ occurrence)
        ref = _clean(rec.get("source_ref"))
        title = _clean(rec.get("source_title")).lower()
        domain = _domain(_clean(rec.get("source_url")))
        if ref and ref in seen_refs:
            score -= 0.04
            cand.reasons.append("duplicate_source_ref")
        if title and title in seen_titles:
            score -= 0.02
            cand.reasons.append("duplicate_source_title")
        if domain and domain in seen_domains:
            score -= 0.01
            cand.reasons.append("duplicate_domain")
        if ref:
            seen_refs.add(ref)
        if title:
            seen_titles.add(title)
        if domain:
            seen_domains.add(domain)
        cand.score = score
    # final order by adjusted score; stable tie-break on id
    ordered.sort(key=lambda c: (-c.score, str(c.record.get("id"))))
    return ordered


def _select_diverse(ordered: list[_Candidate], max_results: int) -> list[_Candidate]:
    """Greedy diversity selection: avoid repeating one source/title/predicate while
    keeping high-scoring items; backfill from deferred if under cap."""
    selected: list[_Candidate] = []
    deferred: list[_Candidate] = []
    used_refs: set[str] = set()
    used_combo: set[tuple[str, str]] = set()  # (domain, predicate)
    seen_ids: set[str] = set()
    for cand in ordered:
        rid = str(cand.record.get("id"))
        if rid in seen_ids:  # hard dedupe by assertion identity
            continue
        seen_ids.add(rid)
        ref = _clean(cand.record.get("source_ref"))
        domain = _domain(_clean(cand.record.get("source_url")))
        predicate = _clean(cand.record.get("predicate")).lower()
        combo = (domain, predicate)
        if (ref and ref in used_refs) or (domain and predicate and combo in used_combo):
            deferred.append(cand)
            continue
        selected.append(cand)
        if ref:
            used_refs.add(ref)
        if domain and predicate:
            used_combo.add(combo)
        if len(selected) >= max_results:
            return selected
    for cand in deferred:  # backfill to honor max_results when diversity over-pruned
        if len(selected) >= max_results:
            break
        selected.append(cand)
    return selected[:max_results]


# --------------------------------------------------------------------------- #
# orchestration
# --------------------------------------------------------------------------- #
def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _connect_live():
    import skill_ingest  # reuse the rails Neo4j config/connect

    import logging
    logging.getLogger("neo4j.notifications").setLevel(logging.ERROR)
    config = skill_ingest.load_neo4j_config(_repo_root())
    driver = skill_ingest._connect(config)
    return driver, config


def retrieve_knowgraph_context(
    request: KnowGraphRetrievalRequest,
    *,
    driver: Any = None,
    embed_fn: Callable[[Sequence[str]], list[list[float]]] | None = None,
    database: str | None = None,
) -> KnowGraphRetrievalResult:
    """Run hybrid retrieval over KnowGraph and return a compact evidence slice.

    Read-only. When ``driver`` is None a live Neo4j connection is opened (and
    closed) here. ``embed_fn`` defaults to local EmbeddingGemma; inject a fake in
    tests so no DMR call is needed.
    """
    if not _clean(request.project_id):
        raise HybridRetrievalError("project_id is required")
    assert_all_read_only()

    max_results = _safe_int(request.max_results, 1, MAX_RESULTS_CEILING)
    over_fetch = min(MAX_RESULTS_CEILING, max(max_results * 3, max_results + 6))
    if embed_fn is None:
        def embed_fn(texts: Sequence[str]) -> list[list[float]]:
            return embeddinggemma.embed_texts(texts, expected_dim=embeddinggemma.PROVEN_DIM)

    owns_driver = driver is None
    config: dict[str, Any] | None = None
    if owns_driver:
        driver, config = _connect_live()
        database = config["database"]

    notes: list[str] = []
    try:
        exact_rows = exact_retrieval(driver, request, cap=over_fetch, database=database)
        fulltext_rows, fulltext_err = _fulltext_channel(
            driver, request, cap=over_fetch, database=database)
        vector_rows, vector_state = vector_retrieval(
            driver, request, cap=over_fetch, embed_fn=embed_fn, database=database)

        channels: dict[str, list[dict[str, Any]]] = {}
        if exact_rows:
            channels["exact"] = exact_rows
        if fulltext_rows:
            channels["fulltext"] = fulltext_rows
        if vector_rows:
            channels["vector"] = vector_rows

        fused = _fuse(channels)
        ordered = _apply_structure_and_dedupe(fused)
        selected = _select_diverse(ordered, max_results)
        seed_ids = [str(c.record.get("id")) for c in selected if c.record.get("id")]

        contradictions, relations, discovered = one_hop_expansion(
            driver, request, seed_ids, hop_cap=max(4, max_results), database=database)
    finally:
        if owns_driver and driver is not None:
            driver.close()

    # assemble selected assertions (with reasons)
    assertions: list[dict[str, Any]] = []
    evidence: list[dict[str, Any]] = []
    uncertainties: list[dict[str, Any]] = []
    for cand in selected:
        rec = dict(cand.record)
        rec["retrieval_reasons"] = list(dict.fromkeys(cand.reasons))
        rec["retrieval_rank_channels"] = dict(cand.ranks)
        rec["fused_score"] = round(cand.score, 6)
        assertions.append(rec)
        evidence.append({
            "assertion_id": rec.get("id"),
            "source_ref": rec.get("source_ref"),
            "source_title": rec.get("source_title"),
            "source_url": rec.get("source_url"),
            "evidence_text": rec.get("evidence_text") or rec.get("retrieval_summary"),
            "outcome": rec.get("outcome"),
        })
        if _clean(rec.get("outcome")).lower() == "uncertain":
            uncertainties.append(rec)

    anchors_lower = {a.lower() for a in (request.anchors or [])}
    next_anchor_suggestions = [
        label for label in dict.fromkeys(_clean(d) for d in discovered if _clean(d))
        if label.lower() not in anchors_lower
    ][:8]

    excluded_as_seen = list(request.prior_assertion_ids or []) + list(request.prior_source_refs or [])

    vector_available = vector_state == "available"
    notes.append(f"channels: exact={len(exact_rows)} fulltext={len(fulltext_rows)} "
                 f"vector={len(vector_rows)}")
    notes.append(f"selected={len(assertions)} of fused={len(fused)} (max_results={max_results})")
    if fulltext_err:
        notes.append(fulltext_err)
    if not vector_available:
        notes.append(f"vector {vector_state}")
    if vector_available:
        notes.append("vector mode used local EmbeddingGemma + kg_assertion_embedding_idx")

    return KnowGraphRetrievalResult(
        project_id=request.project_id,
        anchors=list(request.anchors or []),
        retrieval_modes={
            "exact": bool(exact_rows) or bool(request.anchors),
            "fulltext": fulltext_err is None,
            "vector": "available" if vector_available else "unavailable",
        },
        assertions=assertions,
        evidence=evidence,
        relations=relations,
        contradictions=contradictions,
        uncertainties=uncertainties,
        next_anchor_suggestions=next_anchor_suggestions,
        excluded_as_seen=excluded_as_seen,
        retrieval_notes=notes,
    )
