# @graph entity: Research Memory Delta
# @graph role: research-result-delta-write-and-local-index
# @graph relates_to: KnowGraph Source Judgment, KnowGraph Assertion Vectors, Local Gemma Chunker
# @graph depends_on: Neo4j, KnowGraph EmbeddingGemma Client, Local Gemma Chunker
# @graph feeds_to: KnowGraph
"""First compounding research-memory loop (Python rails).

A completed frontier Research Agent result is turned into a validated
``ResearchMemoryDelta`` and persisted so a later run can revisit the reasoning
instead of re-reading chat history:

  * KnowGraph (Neo4j) receives ONLY the external reusable part — Source records,
    SourceBackedAssertions (ASSERTED_BY_SOURCE -> Source), evidence anchors,
    observed entities, relations, and a ResearchRun provenance anchor.
  * Local Gemma (``gemma_chunker.py``) chunks ONLY the explicitly retained
    material; EmbeddingGemma embeds those chunks locally into a separate
    ``:RetainedChunk`` vector index with an honest indexing state.

Truth/provenance rules are enforced before any write: an externally grounded
assertion with no source/evidence reference is rejected; a model hypothesis /
interpretation is stored explicitly as interpretation, never silently as fact;
original evidence text is kept separate from the model's concise interpretation.

This module never crawls, archives whole pages, copies chat history, merges the
two graphs, calls a second frontier model, or writes from a retrieval-only call.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Sequence

import embeddinggemma

# Outcome vocabulary (existing source-judgment naming + explicit interpretation states).
EXTERNAL_OUTCOMES = {"directly_stated", "supported", "contradicted", "qualified"}
INTERPRETATION_OUTCOMES = {"uncertain", "unresolved", "hypothesis"}
ALL_OUTCOMES = EXTERNAL_OUTCOMES | INTERPRETATION_OUTCOMES

RETAINED_CHUNK_INDEX_NAME = "kg_retained_chunk_idx"
RETAINED_CHUNK_LABEL = "RetainedChunk"
MAX_CHUNK_CHARS = 1200


class ResearchMemoryDeltaError(RuntimeError):
    """Capability-level failure (validation/connection), not a driver error."""


# --------------------------------------------------------------------------- #
# envelope
# --------------------------------------------------------------------------- #
@dataclass
class SourceRef:
    ref: str
    url: str = ""
    title: str = ""


@dataclass
class DeltaAssertion:
    subject: str
    predicate: str
    object: str
    outcome: str
    evidence_text: str = ""          # original supporting text (kept separate)
    interpretation: str = ""         # model's concise interpretation (kept separate)
    source_ref: str = ""
    source_url: str = ""
    source_title: str = ""

    @property
    def kind(self) -> str:
        return "interpretation" if self.outcome in INTERPRETATION_OUTCOMES else "evidence"


@dataclass
class Observation:
    text: str
    source_ref: str = ""
    entity: str = ""


@dataclass
class RetainedChunkInput:
    text: str
    kind: str                        # source_evidence | research_note | project_consequence | document_excerpt
    store: str = "knowgraph"
    source_ref: str = ""
    parent_id: str = ""


@dataclass
class ResearchMemoryDelta:
    project_id: str
    run_id: str
    research_summary: str
    project_consequence: str
    occurred_at: str = ""
    source_refs: list[SourceRef] = field(default_factory=list)
    assertions: list[DeltaAssertion] = field(default_factory=list)
    observations: list[Observation] = field(default_factory=list)
    uncertainty: list[str] = field(default_factory=list)
    retained_material: list[RetainedChunkInput] = field(default_factory=list)
    prior_reasoning_refs: list[str] = field(default_factory=list)


def _clean(value: object) -> str:
    return "" if value is None else str(value).strip()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# --------------------------------------------------------------------------- #
# truth / provenance validation
# --------------------------------------------------------------------------- #
@dataclass
class ValidationResult:
    ok: bool
    errors: list[str]
    evidence_assertions: list[DeltaAssertion]
    interpretation_assertions: list[DeltaAssertion]


def validate_delta(delta: ResearchMemoryDelta) -> ValidationResult:
    """Enforce truth/provenance before any write.

    * project_id, run_id, research_summary required.
    * every externally grounded assertion (directly_stated/supported/contradicted/
      qualified) MUST carry a source_ref or source_url — else rejected.
    * a hypothesis/interpretation (uncertain/unresolved/hypothesis) is kept as
      interpretation, never promoted to fact.
    * an unknown outcome is rejected (no silent coercion).
    """
    errors: list[str] = []
    if not _clean(delta.project_id):
        errors.append("project_id_required")
    if not _clean(delta.run_id):
        errors.append("run_id_required")
    if not _clean(delta.research_summary):
        errors.append("research_summary_required")

    evidence: list[DeltaAssertion] = []
    interpretation: list[DeltaAssertion] = []
    for i, a in enumerate(delta.assertions):
        outcome = _clean(a.outcome).lower()
        if outcome not in ALL_OUTCOMES:
            errors.append(f"assertion[{i}]_unknown_outcome:{outcome or 'empty'}")
            continue
        if outcome in EXTERNAL_OUTCOMES and not (_clean(a.source_ref) or _clean(a.source_url)):
            errors.append(f"assertion[{i}]_external_without_source:{a.subject} {a.predicate} {a.object}")
            continue
        (interpretation if outcome in INTERPRETATION_OUTCOMES else evidence).append(a)

    return ValidationResult(ok=not errors, errors=errors,
                            evidence_assertions=evidence,
                            interpretation_assertions=interpretation)


# --------------------------------------------------------------------------- #
# small driver helpers (shared convention with assertion_vectors)
# --------------------------------------------------------------------------- #
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


def _content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------- #
# KnowGraph external write (Neo4j) — external reusable part only
# --------------------------------------------------------------------------- #
# A ResearchRun provenance anchor + SourceBackedAssertion/Source/ObservedEntity/
# Observation, matching the existing source-judgment schema so retrieval and
# vectors keep working. SETs only primitive props (Neo4j-safe). Never writes
# project-meaning / chat history here.
_WRITE_RUN_CYPHER = """
MERGE (run:ResearchRun { id: $runNodeId })
SET run.project_id = $projectId, run.run_id = $runId, run.occurred_at = $occurredAt,
    run.research_summary = $summary
RETURN run.id AS id
"""

_WRITE_ASSERTION_CYPHER = """
MERGE (a:SourceBackedAssertion { id: $id })
SET a.project_id = $projectId, a.run_id = $runId, a.subject = $subject,
    a.predicate = $predicate, a.object = $object, a.outcome = $outcome,
    a.evidence_text = $evidenceText, a.interpretation = $interpretation,
    a.source_ref = $sourceRef, a.source_url = $sourceUrl, a.source_title = $sourceTitle,
    a.extraction_method = 'research_memory_delta', a.created_at = $createdAt
WITH a
MATCH (run:ResearchRun { id: $runNodeId })
MERGE (a)-[:ASSERTED_IN_RUN { id: $runRelId }]->(run)
WITH a
FOREACH (_ IN CASE WHEN $sourceUrl <> '' OR $sourceRef <> '' THEN [1] ELSE [] END |
  MERGE (s:Source { id: $sourceNodeId })
  SET s.project_id = $projectId, s.url = $sourceUrl, s.title = $sourceTitle, s.ref = $sourceRef
  MERGE (a)-[:ASSERTED_BY_SOURCE { id: $sourceRelId }]->(s)
)
RETURN a.id AS id
"""

_WRITE_OBSERVATION_CYPHER = """
MATCH (run:ResearchRun { id: $runNodeId })
MERGE (o:Observation { id: $id })
SET o.project_id = $projectId, o.run_id = $runId, o.text = $text, o.source_ref = $sourceRef,
    o.created_at = $createdAt
MERGE (o)-[:OBSERVED_IN_RUN { id: $relId }]->(run)
FOREACH (_ IN CASE WHEN $entity <> '' THEN [1] ELSE [] END |
  MERGE (e:ObservedEntity { id: $entityId })
  SET e.project_id = $projectId, e.label = $entity
  MERGE (o)-[:RELATES_TO_ENTITY { id: $entityRelId }]->(e)
)
RETURN o.id AS id
"""


def _run_node_id(delta: ResearchMemoryDelta) -> str:
    return f"{delta.project_id}::research_run::{delta.run_id}"


def write_knowgraph_external(driver: Any, delta: ResearchMemoryDelta, *,
                             validation: ValidationResult, database: str | None = None) -> dict[str, Any]:
    """Write the external reusable part (evidence + interpretation assertions,
    sources, observations, relations, run anchor). Returns written IDs."""
    run_node_id = _run_node_id(delta)
    occurred_at = _clean(delta.occurred_at) or _now()
    driver.execute_query(
        _WRITE_RUN_CYPHER,
        parameters_={"runNodeId": run_node_id, "projectId": delta.project_id,
                     "runId": delta.run_id, "occurredAt": occurred_at,
                     "summary": _clean(delta.research_summary)[:2000]},
        database_=database,
    )
    assertion_ids: list[str] = []
    written_source_refs: list[str] = []
    # Evidence + interpretation both persist, but with distinct outcomes/kind so a
    # hypothesis is never stored as a fact.
    for idx, a in enumerate(validation.evidence_assertions + validation.interpretation_assertions):
        aid = f"{delta.project_id}::rmd::{delta.run_id}::a{idx}"
        source_url = _clean(a.source_url)
        source_ref = _clean(a.source_ref)
        source_node_id = f"{delta.project_id}::source::{source_url or source_ref}" if (source_url or source_ref) else ""
        driver.execute_query(
            _WRITE_ASSERTION_CYPHER,
            parameters_={
                "id": aid, "projectId": delta.project_id, "runId": delta.run_id,
                "subject": _clean(a.subject), "predicate": _clean(a.predicate), "object": _clean(a.object),
                "outcome": _clean(a.outcome).lower(), "evidenceText": _clean(a.evidence_text)[:2000],
                "interpretation": _clean(a.interpretation)[:2000], "sourceRef": source_ref,
                "sourceUrl": source_url, "sourceTitle": _clean(a.source_title),
                "createdAt": occurred_at, "runNodeId": run_node_id,
                "runRelId": f"{aid}->run", "sourceNodeId": source_node_id,
                "sourceRelId": f"{aid}->source",
            },
            database_=database,
        )
        assertion_ids.append(aid)
        if source_ref:
            written_source_refs.append(source_ref)

    observation_ids: list[str] = []
    for idx, o in enumerate(delta.observations):
        oid = f"{delta.project_id}::rmd::{delta.run_id}::o{idx}"
        entity = _clean(o.entity)
        driver.execute_query(
            _WRITE_OBSERVATION_CYPHER,
            parameters_={
                "id": oid, "projectId": delta.project_id, "runId": delta.run_id,
                "text": _clean(o.text)[:2000], "sourceRef": _clean(o.source_ref),
                "createdAt": occurred_at, "runNodeId": run_node_id, "relId": f"{oid}->run",
                "entity": entity, "entityId": f"{delta.project_id}::entity::{entity}" if entity else "",
                "entityRelId": f"{oid}->entity",
            },
            database_=database,
        )
        observation_ids.append(oid)

    return {"run_node_id": run_node_id, "assertion_ids": assertion_ids,
            "observation_ids": observation_ids, "source_refs": sorted(set(written_source_refs))}


_READ_BACK_CYPHER = """
MATCH (a:SourceBackedAssertion { run_id: $runId, project_id: $projectId })
OPTIONAL MATCH (a)-[:ASSERTED_BY_SOURCE]->(s:Source)
RETURN a.id AS id, a.subject AS subject, a.predicate AS predicate, a.object AS object,
       a.outcome AS outcome, a.evidence_text AS evidence_text, a.interpretation AS interpretation,
       a.source_ref AS source_ref, coalesce(s.title, a.source_title) AS source_title,
       coalesce(s.url, a.source_url) AS source_url
ORDER BY a.id
"""


def read_knowgraph_external(driver: Any, project_id: str, run_id: str,
                            *, database: str | None = None) -> list[dict[str, Any]]:
    result = driver.execute_query(
        _READ_BACK_CYPHER, parameters_={"runId": run_id, "projectId": project_id}, database_=database)
    out = []
    for r in _records(result):
        out.append({k: _row_get(r, k) for k in
                    ("id", "subject", "predicate", "object", "outcome", "evidence_text",
                     "interpretation", "source_ref", "source_title", "source_url")})
    return out


# --------------------------------------------------------------------------- #
# retained-material chunk + local embedding index (Neo4j vector)
# --------------------------------------------------------------------------- #
def _ensure_chunk_vector_index(driver: Any, dimensions: int, database: str | None) -> None:
    safe = max(1, int(dimensions))
    existing = driver.execute_query(
        "SHOW VECTOR INDEXES YIELD name, options WHERE name = $name RETURN options",
        parameters_={"name": RETAINED_CHUNK_INDEX_NAME}, database_=database)
    if not _records(existing):
        driver.execute_query(
            f"CREATE VECTOR INDEX {RETAINED_CHUNK_INDEX_NAME} IF NOT EXISTS "
            f"FOR (c:{RETAINED_CHUNK_LABEL}) ON (c.embedding) "
            "OPTIONS {indexConfig: {`vector.dimensions`: " + str(safe) +
            ", `vector.similarity_function`: 'cosine'}}",
            database_=database)


_WRITE_CHUNK_CYPHER = f"""
MERGE (c:{RETAINED_CHUNK_LABEL} {{ id: $id }})
SET c.project_id = $projectId, c.run_id = $runId, c.parent_id = $parentId, c.store = $store,
    c.source_ref = $sourceRef, c.position = $position, c.text = $text, c.content_hash = $hash,
    c.embedding = $embedding, c.embedding_model = $model, c.embedding_dim = $dim,
    c.indexing_state = $indexingState, c.indexed_at = $indexedAt
RETURN c.id AS id
"""


def index_retained_material(
    driver: Any, delta: ResearchMemoryDelta, *,
    chunk_fn: Callable[[str], list[str]],
    embed_fn: Callable[[Sequence[str]], list[list[float]]] | None = None,
    expected_dim: int | None = None, database: str | None = None,
) -> dict[str, Any]:
    """Chunk ONLY the delta's retained material via local Gemma, embed each chunk
    locally, and write deduped ``:RetainedChunk`` vector nodes with an honest
    indexing state. A retained text unit is chunked once; the same content hash is
    never written twice."""
    if embed_fn is None:
        def embed_fn(texts: Sequence[str]) -> list[list[float]]:
            return embeddinggemma.embed_texts(texts, expected_dim=expected_dim)

    occurred_at = _clean(delta.occurred_at) or _now()
    counts = {"retained_units": len(delta.retained_material), "chunks": 0,
              "indexed": 0, "deduped": 0, "failed": 0}
    seen_hashes: set[str] = set()
    chunk_records: list[dict[str, Any]] = []

    for unit in delta.retained_material:
        text = _clean(unit.text)
        if not text:
            continue
        pieces = [p for p in (chunk_fn(text) or []) if _clean(p)]
        for position, piece in enumerate(pieces):
            piece = _clean(piece)[:MAX_CHUNK_CHARS]
            h = _content_hash(piece)
            counts["chunks"] += 1
            if h in seen_hashes:
                counts["deduped"] += 1
                continue
            seen_hashes.add(h)
            chunk_records.append({"unit": unit, "text": piece, "position": position, "hash": h})

    if not chunk_records:
        return {"counts": counts, "chunk_ids": [], "dim": expected_dim}

    try:
        vectors = embed_fn([c["text"] for c in chunk_records])
    except embeddinggemma.EmbeddingGemmaError as exc:
        # Honest: embeddings unavailable -> write the chunks as 'pending' (never 'indexed').
        vectors = None
        pending_reason = str(exc)

    observed_dim = expected_dim
    chunk_ids: list[str] = []
    if vectors is not None:
        observed_dim = len(vectors[0]) if vectors else observed_dim
        _ensure_chunk_vector_index(driver, observed_dim or embeddinggemma.PROVEN_DIM, database)

    for i, rec in enumerate(chunk_records):
        unit: RetainedChunkInput = rec["unit"]
        cid = f"{delta.project_id}::chunk::{rec['hash'][:16]}"
        if vectors is not None:
            embedding = vectors[i]
            indexing_state = "indexed"
        else:
            embedding = None
            indexing_state = "pending"
        try:
            driver.execute_query(
                _WRITE_CHUNK_CYPHER,
                parameters_={
                    "id": cid, "projectId": delta.project_id, "runId": delta.run_id,
                    "parentId": _clean(unit.parent_id) or _run_node_id(delta),
                    "store": _clean(unit.store) or "knowgraph", "sourceRef": _clean(unit.source_ref),
                    "position": rec["position"], "text": rec["text"], "hash": rec["hash"],
                    "embedding": embedding, "model": embeddinggemma.DEFAULT_MODEL,
                    "dim": observed_dim, "indexingState": indexing_state, "indexedAt": occurred_at,
                },
                database_=database,
            )
            chunk_ids.append(cid)
            if indexing_state == "indexed":
                counts["indexed"] += 1
        except Exception:
            counts["failed"] += 1

    return {"counts": counts, "chunk_ids": chunk_ids, "dim": observed_dim}


def read_retained_chunks(driver: Any, project_id: str, run_id: str,
                         *, database: str | None = None) -> list[dict[str, Any]]:
    result = driver.execute_query(
        f"MATCH (c:{RETAINED_CHUNK_LABEL} {{ project_id: $projectId, run_id: $runId }}) "
        "RETURN c.id AS id, c.parent_id AS parent_id, c.store AS store, c.source_ref AS source_ref, "
        "c.position AS position, c.indexing_state AS indexing_state, c.embedding_dim AS dim, "
        "size(c.embedding) AS vector_size ORDER BY c.id",
        parameters_={"projectId": project_id, "runId": run_id}, database_=database)
    return [{k: _row_get(r, k) for k in
             ("id", "parent_id", "store", "source_ref", "position", "indexing_state", "dim", "vector_size")}
            for r in _records(result)]


# --------------------------------------------------------------------------- #
# orchestration: validate -> KnowGraph external + local index
# --------------------------------------------------------------------------- #
def _connect_neo4j():
    import assertion_vectors as av
    return av._connect_live()


def write_research_memory_delta(
    delta: ResearchMemoryDelta,
    *,
    neo4j_driver: Any = None,
    neo4j_database: str | None = None,
    chunk_fn: Callable[[str], list[str]] | None = None,
    embed_fn: Callable[[Sequence[str]], list[list[float]]] | None = None,
    expected_dim: int | None = None,
) -> dict[str, Any]:
    """Persist one validated research result to KnowGraph + the local index.

    KnowGraph gets the external reusable part; local Gemma chunks the retained
    material and EmbeddingGemma indexes it. Fails closed on validation errors
    before any write. Read-only paths are never invoked. (ThinkGraph is written
    ONLY by the canonical completed-pair chat ingestion path — never from here.)
    """
    validation = validate_delta(delta)
    if not validation.ok:
        raise ResearchMemoryDeltaError(f"invalid_research_memory_delta: {validation.errors}")

    if chunk_fn is None:
        import gemma_chunker
        chunk_fn = gemma_chunker.chunk_text

    owns_neo4j = neo4j_driver is None
    if owns_neo4j:
        neo4j_driver, config = _connect_neo4j()
        neo4j_database = config["database"]

    try:
        # 1. KnowGraph external reusable part.
        kg = write_knowgraph_external(neo4j_driver, delta, validation=validation, database=neo4j_database)

        # 2. Local Gemma chunk + EmbeddingGemma index of the retained material only.
        index = index_retained_material(
            neo4j_driver, delta, chunk_fn=chunk_fn, embed_fn=embed_fn,
            expected_dim=expected_dim, database=neo4j_database)
    finally:
        if owns_neo4j and neo4j_driver is not None:
            neo4j_driver.close()

    return {
        "ok": True,
        "validation": {"evidence": len(validation.evidence_assertions),
                       "interpretation": len(validation.interpretation_assertions)},
        "knowgraph": kg,
        "index": index,
    }
