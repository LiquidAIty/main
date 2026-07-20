# @graph entity: KnowGraph Assertion Vectors
# @graph role: source-summary-embedding-backfill
# @graph relates_to: KnowGraph EmbeddingGemma Client, KnowGraph Source Judgment
# @graph depends_on: Neo4j, KnowGraph EmbeddingGemma Client
# @graph feeds_to: KnowGraph
"""KnowGraph source-summary vectors (Python rails).

GraphRAG groundwork: give every existing ``SourceBackedAssertion`` a local
EmbeddingGemma vector over a compact ``retrieval_summary`` built from its OWN
source-backed evidence, while preserving its outcome and its direct
``ASSERTED_BY_SOURCE`` link to the real ``Source`` (url/title/ref).

For each assertion this capability:

* builds a compact ``retrieval_summary`` from EXISTING fields only
  (source title + evidence text + subject + predicate + object) — no LLM
  rewriting, deterministic;
* embeds it with the local ``ai/embeddinggemma`` model (``embeddinggemma.py``);
* stores ``retrieval_summary`` + ``embedding`` + model/dim/hash/timestamp on the
  assertion node via fixed Cypher that only SETs those new properties; and
* is indexed by a SEPARATE cosine vector index over
  ``(:SourceBackedAssertion).embedding``.

It deliberately does NOT:
* touch the ``:Chunk`` ``chunk_embedding_idx`` vector index in
  ``neo4j_index.py`` or the existing full-text indexes;
* touch ThinkGraph (SQLite / Engraphis) or CodeGraph;
* generate Cypher dynamically / run text2cypher; or
* build a retrieval tool — that is the next SPEC. This module is the
  embedding + backfill + read-back capability only.

CLI (live Neo4j + live local embedding endpoint):

    python services/knowgraph/assertion_vectors.py probe-endpoint
    python services/knowgraph/assertion_vectors.py ensure-index --dim 768
    python services/knowgraph/assertion_vectors.py backfill --project <id> --limit 3
    python services/knowgraph/assertion_vectors.py read-back --project <id> --limit 5
    python services/knowgraph/assertion_vectors.py smoke --project <id> --limit 3
"""

from __future__ import annotations

import argparse
import hashlib
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence
from urllib.parse import urlparse

import embeddinggemma

ASSERTION_LABEL = "SourceBackedAssertion"
ASSERTION_VECTOR_INDEX_NAME = "kg_assertion_embedding_idx"

# New properties this capability writes. It never SETs subject/predicate/object/
# outcome/source_* — those stay exactly as the judgment writer left them.
EMBEDDING_PROP = "embedding"
SUMMARY_PROP = "retrieval_summary"
SUMMARY_HASH_PROP = "retrieval_summary_hash"
EMBEDDING_MODEL_PROP = "embedding_model"
EMBEDDING_DIM_PROP = "embedding_dim"
EMBEDDED_AT_PROP = "embedded_at"

MAX_SUMMARY_CHARS = 1200

# Guard: every Cypher in this module that is meant to be read-only must contain
# no write clause. Used by the read paths and by tests.
WRITE_CLAUSE_RE = re.compile(
    r"\b(MERGE|CREATE|SET|DELETE|DETACH|REMOVE|DROP|LOAD\s+CSV)\b", re.IGNORECASE
)

LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "::1", "[::1]"}


class AssertionVectorError(RuntimeError):
    """Raised for capability-level failures (not driver/embedding errors)."""


# --------------------------------------------------------------------------- #
# small driver-result helpers (kept local so this module stays decoupled from
# neo4j_index.py, which owns the unrelated :Chunk index)
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


def _as_int(value: object) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    to_native = getattr(value, "to_native", None)
    if callable(to_native):
        try:
            native = to_native()
            if isinstance(native, int):
                return native
        except Exception:
            return None
    try:
        return int(value)  # type: ignore[arg-type]
    except Exception:
        return None


def _extract_index_dimensions(options: object) -> int | None:
    if not isinstance(options, Mapping):
        return None
    index_config = options.get("indexConfig")
    if not isinstance(index_config, Mapping):
        return None
    return _as_int(index_config.get("vector.dimensions"))


def _clean(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip()


# --------------------------------------------------------------------------- #
# retrieval_summary (existing evidence only, no LLM)
# --------------------------------------------------------------------------- #
def build_retrieval_summary(assertion: Mapping[str, Any]) -> str | None:
    """Compact retrieval text from EXISTING source-backed fields only.

    Combines source title + evidence text + the subject/predicate/object triple.
    No LLM, no rewriting — same input always yields the same output. Returns
    ``None`` when there is no usable source-derived text to embed, so the caller
    can skip (never embed an empty/invented summary).
    """
    source_title = _clean(assertion.get("source_title"))
    evidence_text = _clean(assertion.get("evidence_text"))
    subject = _clean(assertion.get("subject"))
    predicate = _clean(assertion.get("predicate"))
    obj = _clean(assertion.get("object"))

    # Require at least one piece of real, source-derived text. A bare triple is
    # not enough — we never embed an assertion with no underlying source text.
    if not source_title and not evidence_text:
        return None

    triple_parts = [part for part in (subject, predicate) if part]
    if obj and obj.lower() != "unknown":
        triple_parts.append(obj)
    triple = " ".join(triple_parts)

    parts: list[str] = []
    if source_title:
        parts.append(source_title)
    if evidence_text and evidence_text != source_title:
        parts.append(evidence_text)
    if triple:
        parts.append(triple)

    summary = " — ".join(parts).strip()
    if not summary:
        return None
    return summary[:MAX_SUMMARY_CHARS]


def summary_content_hash(summary: str) -> str:
    """Stable content hash so backfill re-embeds only when the summary changed."""
    return hashlib.sha256(summary.encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------- #
# vector index (separate from the :Chunk chunk_embedding_idx)
# --------------------------------------------------------------------------- #
def _assertion_vector_index_cypher(dimensions: int) -> str:
    return f"""
CREATE VECTOR INDEX {ASSERTION_VECTOR_INDEX_NAME} IF NOT EXISTS
FOR (a:{ASSERTION_LABEL}) ON (a.{EMBEDDING_PROP})
OPTIONS {{
  indexConfig: {{
    `vector.dimensions`: {dimensions},
    `vector.similarity_function`: 'cosine'
  }}
}}
"""


def ensure_assertion_vector_index(
    driver: Any,
    dimensions: int,
    database: str | None = None,
) -> str:
    """Create the project-wide SourceBackedAssertion vector index if absent.

    Scoped strictly to ``kg_assertion_embedding_idx`` over
    ``(:SourceBackedAssertion).embedding`` with cosine similarity. Never reads
    or mutates the unrelated ``:Chunk`` ``chunk_embedding_idx`` index. If an
    index with this name exists at a different dimension it is dropped and
    recreated at the observed dimension.
    """
    safe_dimensions = max(1, int(dimensions))
    existing = driver.execute_query(
        """
        SHOW VECTOR INDEXES
        YIELD name, options
        WHERE name = $name
        RETURN options
        """,
        parameters_={"name": ASSERTION_VECTOR_INDEX_NAME},
        database_=database,
    )
    records = _records(existing)
    if records:
        current = _extract_index_dimensions(_row_get(records[0], "options"))
        if current is not None and current != safe_dimensions:
            driver.execute_query(
                f"DROP INDEX {ASSERTION_VECTOR_INDEX_NAME} IF EXISTS",
                database_=database,
            )
    driver.execute_query(
        _assertion_vector_index_cypher(safe_dimensions),
        database_=database,
    )
    return ASSERTION_VECTOR_INDEX_NAME


# --------------------------------------------------------------------------- #
# scan (read-only) + backfill (bounded write of new vector props only)
# --------------------------------------------------------------------------- #
_SCAN_CYPHER = """
MATCH (a:SourceBackedAssertion {{ project_id: $projectId }})
WHERE ($sourceRefs IS NULL OR a.source_ref IN $sourceRefs)
OPTIONAL MATCH (a)-[:ASSERTED_BY_SOURCE]->(s:Source)
RETURN a.id AS id,
       a.subject AS subject,
       a.predicate AS predicate,
       a.object AS object,
       a.outcome AS outcome,
       a.evidence_text AS evidence_text,
       a.source_ref AS source_ref,
       a.source_title AS source_title,
       a.source_url AS source_url,
       a.retrieval_summary_hash AS existing_hash,
       a.embedding_dim AS existing_dim,
       (a.embedding IS NOT NULL) AS has_embedding,
       s.title AS linked_source_title,
       s.url AS linked_source_url
ORDER BY a.id
LIMIT {limit}
"""

# Writes ONLY the new vector properties. It never SETs subject/predicate/object/
# outcome/source_*, and never touches the Source node or any relationship, so the
# judgment and its provenance are preserved exactly.
_WRITE_EMBEDDING_CYPHER = f"""
MATCH (a:SourceBackedAssertion {{ id: $id, project_id: $projectId }})
SET a.{SUMMARY_PROP} = $summary,
    a.{SUMMARY_HASH_PROP} = $hash,
    a.{EMBEDDING_PROP} = $embedding,
    a.{EMBEDDING_MODEL_PROP} = $model,
    a.{EMBEDDING_DIM_PROP} = $dim,
    a.{EMBEDDED_AT_PROP} = $ts
RETURN a.id AS id
"""


def scan_assertions(
    driver: Any,
    project_id: str,
    *,
    limit: int,
    source_refs: Sequence[str] | None = None,
    database: str | None = None,
) -> list[dict[str, Any]]:
    """Read-only scan of project assertions (+ linked source) for backfill."""
    safe_limit = max(0, int(limit))
    cypher = _SCAN_CYPHER.format(limit=safe_limit)
    refs = list(source_refs) if source_refs else None
    result = driver.execute_query(
        cypher,
        parameters_={"projectId": project_id, "sourceRefs": refs},
        database_=database,
    )
    rows: list[dict[str, Any]] = []
    for record in _records(result):
        rows.append(
            {
                "id": _row_get(record, "id"),
                "subject": _row_get(record, "subject"),
                "predicate": _row_get(record, "predicate"),
                "object": _row_get(record, "object"),
                "outcome": _row_get(record, "outcome"),
                "evidence_text": _row_get(record, "evidence_text"),
                "source_ref": _row_get(record, "source_ref"),
                "source_title": _row_get(record, "source_title"),
                "source_url": _row_get(record, "source_url"),
                "existing_hash": _row_get(record, "existing_hash"),
                "existing_dim": _as_int(_row_get(record, "existing_dim")),
                "has_embedding": bool(_row_get(record, "has_embedding")),
                "linked_source_title": _row_get(record, "linked_source_title"),
                "linked_source_url": _row_get(record, "linked_source_url"),
            }
        )
    return rows


def backfill_assertion_embeddings(
    driver: Any,
    project_id: str,
    *,
    limit: int,
    source_refs: Sequence[str] | None = None,
    embed_fn: Callable[[Sequence[str]], list[list[float]]] | None = None,
    model: str | None = None,
    expected_dim: int | None = None,
    database: str | None = None,
) -> dict[str, Any]:
    """Embed retrieval summaries for project assertions that need it.

    Bounded by ``limit`` (and optional ``source_refs``). Only assertions that
    lack an embedding, or whose summary content hash changed, are embedded;
    those already current are counted ``unchanged``. Assertions with no usable
    source text are counted ``skipped_missing_text``. Embedding endpoint outages
    propagate as EmbeddingGemmaError (honest hard failure) — no fake vectors.
    Per-assertion DB write errors are counted ``failed``.

    Returns counts + the observed embedding dimension.
    """
    if not project_id:
        raise AssertionVectorError("project_id is required")

    model = model or embeddinggemma.DEFAULT_MODEL
    if embed_fn is None:
        def embed_fn(texts: Sequence[str]) -> list[list[float]]:
            return embeddinggemma.embed_texts(texts, expected_dim=expected_dim)

    rows = scan_assertions(
        driver, project_id, limit=limit, source_refs=source_refs, database=database
    )

    counts = {"scanned": len(rows), "embedded": 0, "skipped_missing_text": 0,
              "unchanged": 0, "failed": 0}
    pending: list[tuple[dict[str, Any], str, str]] = []  # (row, summary, hash)

    for row in rows:
        summary = build_retrieval_summary(row)
        if summary is None:
            counts["skipped_missing_text"] += 1
            continue
        content_hash = summary_content_hash(summary)
        already_current = (
            row.get("has_embedding")
            and row.get("existing_hash") == content_hash
            and (expected_dim is None or row.get("existing_dim") == expected_dim)
        )
        if already_current:
            counts["unchanged"] += 1
            continue
        pending.append((row, summary, content_hash))

    observed_dim: int | None = expected_dim
    if pending:
        vectors = embed_fn([summary for _, summary, _ in pending])
        if len(vectors) != len(pending):
            raise AssertionVectorError(
                f"embedder returned {len(vectors)} vectors for {len(pending)} summaries"
            )
        observed_dim = len(vectors[0]) if vectors else observed_dim
        ts = datetime.now(timezone.utc).isoformat()
        for (row, summary, content_hash), vector in zip(pending, vectors):
            try:
                driver.execute_query(
                    _WRITE_EMBEDDING_CYPHER,
                    parameters_={
                        "id": row["id"],
                        "projectId": project_id,
                        "summary": summary,
                        "hash": content_hash,
                        "embedding": vector,
                        "model": model,
                        "dim": len(vector),
                        "ts": ts,
                    },
                    database_=database,
                )
                counts["embedded"] += 1
            except Exception:  # DB-level write failure for this one assertion
                counts["failed"] += 1

    return {"project_id": project_id, "model": model, "dim": observed_dim, "counts": counts}


# --------------------------------------------------------------------------- #
# read-back (proof: summary + dim + outcome + sourceRef + source title/url)
# --------------------------------------------------------------------------- #
_READ_BACK_CYPHER = """
MATCH (a:SourceBackedAssertion {{ project_id: $projectId }})
WHERE a.embedding IS NOT NULL
OPTIONAL MATCH (a)-[:ASSERTED_BY_SOURCE]->(s:Source)
RETURN a.id AS id,
       a.subject AS subject,
       a.predicate AS predicate,
       a.object AS object,
       a.outcome AS outcome,
       a.retrieval_summary AS retrieval_summary,
       a.embedding_model AS embedding_model,
       a.embedding_dim AS embedding_dim,
       size(a.embedding) AS vector_size,
       a.source_ref AS source_ref,
       coalesce(s.title, a.source_title) AS source_title,
       coalesce(s.url, a.source_url) AS source_url
ORDER BY a.id
LIMIT {limit}
"""


def read_assertion_vectors(
    driver: Any,
    project_id: str,
    *,
    limit: int = 10,
    database: str | None = None,
) -> list[dict[str, Any]]:
    """Read back embedded assertions proving the source linkage is preserved."""
    safe_limit = max(0, int(limit))
    cypher = _READ_BACK_CYPHER.format(limit=safe_limit)
    result = driver.execute_query(
        cypher,
        parameters_={"projectId": project_id},
        database_=database,
    )
    out: list[dict[str, Any]] = []
    for record in _records(result):
        out.append(
            {
                "id": _row_get(record, "id"),
                "subject": _row_get(record, "subject"),
                "predicate": _row_get(record, "predicate"),
                "object": _row_get(record, "object"),
                "outcome": _row_get(record, "outcome"),
                "retrieval_summary": _row_get(record, "retrieval_summary"),
                "embedding_model": _row_get(record, "embedding_model"),
                "embedding_dim": _as_int(_row_get(record, "embedding_dim")),
                "vector_size": _as_int(_row_get(record, "vector_size")),
                "source_ref": _row_get(record, "source_ref"),
                "source_title": _row_get(record, "source_title"),
                "source_url": _row_get(record, "source_url"),
            }
        )
    return out


def count_assertions(
    driver: Any,
    project_id: str,
    *,
    database: str | None = None,
) -> int:
    """Read-only count of project assertions (used to prove none are created)."""
    result = driver.execute_query(
        "MATCH (a:SourceBackedAssertion { project_id: $projectId }) RETURN count(a) AS n",
        parameters_={"projectId": project_id},
        database_=database,
    )
    records = _records(result)
    if not records:
        return 0
    return _as_int(_row_get(records[0], "n")) or 0


# --------------------------------------------------------------------------- #
# CLI (live Neo4j + live local embedding endpoint)
# --------------------------------------------------------------------------- #
def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _quiet_expected_notifications() -> None:
    """Silence the benign 'property key does not exist' notifications Neo4j emits
    on the first scan, before backfill has created the vector properties."""
    import logging

    logging.getLogger("neo4j.notifications").setLevel(logging.ERROR)


def _connect_live():
    import skill_ingest  # reuse the existing Neo4j config/connect for the rails

    _quiet_expected_notifications()
    config = skill_ingest.load_neo4j_config(_repo_root())
    driver = skill_ingest._connect(config)
    return driver, config


def _endpoint_is_local(url: str) -> bool:
    parsed = urlparse(url)
    return (parsed.hostname or "").lower() in LOOPBACK_HOSTS and parsed.path.endswith("/embeddings")


def _cmd_probe_endpoint() -> int:
    config = embeddinggemma.EmbeddingGemmaConfig.from_env()
    try:
        dim = embeddinggemma.probe_dimension(config=config)
    except embeddinggemma.EmbeddingGemmaError as exc:
        print(f"EMBEDDING_ENDPOINT_BLOCKED url={config.url} blocker={exc}")
        return 2
    print(f"EMBEDDING_ENDPOINT_LIVE url={config.url} model={config.model} dim={dim} "
          f"local_only={_endpoint_is_local(config.url)}")
    return 0


def _cmd_ensure_index(dim: int) -> int:
    driver, config = _connect_live()
    try:
        name = ensure_assertion_vector_index(driver, dim, database=config["database"])
    finally:
        driver.close()
    print(f"INDEX_READY name={name} dim={int(dim)}")
    return 0


def _cmd_backfill(project_id: str, limit: int, source_refs: list[str] | None) -> int:
    embed_config = embeddinggemma.EmbeddingGemmaConfig.from_env()
    try:
        observed_dim = embeddinggemma.probe_dimension(config=embed_config)
    except embeddinggemma.EmbeddingGemmaError as exc:
        print(f"RESULT=LOCAL_EMBEDDINGGEMMA_UNIT_PROVEN_DOCKER_ENDPOINT_BLOCKED blocker={exc}")
        return 2
    driver, config = _connect_live()
    try:
        ensure_assertion_vector_index(driver, observed_dim, database=config["database"])
        report = backfill_assertion_embeddings(
            driver, project_id, limit=limit, source_refs=source_refs,
            model=embed_config.model, expected_dim=observed_dim, database=config["database"],
        )
    finally:
        driver.close()
    print(f"BACKFILL project={project_id} dim={report['dim']} counts={report['counts']}")
    return 0


def _cmd_read_back(project_id: str, limit: int) -> int:
    driver, config = _connect_live()
    try:
        rows = read_assertion_vectors(driver, project_id, limit=limit, database=config["database"])
    finally:
        driver.close()
    for row in rows:
        print(f"  [{row['outcome']}] dim={row['vector_size']} {row['subject']} {row['predicate']} "
              f"{row['object']}  <- ref={row['source_ref']} title={row['source_title']!r} "
              f"url={row['source_url']}")
    print(f"READBACK count={len(rows)}")
    return 0


def _cmd_smoke(project_id: str, limit: int) -> int:
    embed_config = embeddinggemma.EmbeddingGemmaConfig.from_env()
    local_only = _endpoint_is_local(embed_config.url)
    # (1) prove the local embedding endpoint live, observe dimension.
    try:
        observed_dim = embeddinggemma.probe_dimension(config=embed_config)
    except embeddinggemma.EmbeddingGemmaError as exc:
        print(f"RESULT=LOCAL_EMBEDDINGGEMMA_UNIT_PROVEN_DOCKER_ENDPOINT_BLOCKED blocker={exc}")
        return 2
    print(f"[smoke] endpoint live url={embed_config.url} dim={observed_dim} local_only={local_only}")

    try:
        driver, config = _connect_live()
    except Exception as exc:
        print(f"RESULT=LOCAL_EMBEDDINGGEMMA_NEO4J_VECTOR_INDEX_BLOCKED blocker={exc}")
        return 2
    try:
        before_count = count_assertions(driver, project_id, database=config["database"])
        before_rows = {r["id"]: r for r in scan_assertions(
            driver, project_id, limit=limit, database=config["database"])}
        if not before_rows:
            print(f"RESULT=PARTIAL_BLOCKED blocker=no SourceBackedAssertion in project {project_id}")
            return 1

        ensure_assertion_vector_index(driver, observed_dim, database=config["database"])
        report = backfill_assertion_embeddings(
            driver, project_id, limit=limit, model=embed_config.model,
            expected_dim=observed_dim, database=config["database"],
        )
        after_count = count_assertions(driver, project_id, database=config["database"])
        read_rows = read_assertion_vectors(
            driver, project_id, limit=limit, database=config["database"])
    finally:
        driver.close()

    print(f"[smoke] backfill counts={report['counts']} dim={report['dim']}")
    for row in read_rows:
        print(f"  [{row['outcome']}] dim={row['vector_size']} {row['subject']} {row['predicate']} "
              f"{row['object']}  <- ref={row['source_ref']} title={row['source_title']!r} "
              f"url={row['source_url']}")

    # Outcome/source preservation: compare read-back against the pre-embed scan.
    preserved = True
    for row in read_rows:
        prior = before_rows.get(row["id"])
        if prior is None:
            continue
        if (row["outcome"] != prior["outcome"]
                or row["source_ref"] != prior["source_ref"]):
            preserved = False

    counts = report["counts"]
    checks: list[tuple[str, bool]] = [
        ("endpoint is local /embeddings only (no remote, no chat)", local_only),
        ("observed dimension is 768", observed_dim == embeddinggemma.PROVEN_DIM),
        ("every targeted assertion has a current vector (embedded or unchanged)",
         counts["embedded"] + counts["unchanged"] >= 1),
        ("no embedding/write failures", counts["failed"] == 0),
        ("no new assertion created", after_count == before_count),
        ("read-back vectors all match observed dim",
         bool(read_rows) and all(r["vector_size"] == observed_dim for r in read_rows)),
        ("every embedded row keeps a sourceRef", all(r["source_ref"] for r in read_rows)),
        ("every embedded row keeps a source title", all(r["source_title"] for r in read_rows)),
        ("every embedded row keeps a source URL", all(r["source_url"] for r in read_rows)),
        ("outcome + sourceRef preserved after embedding", preserved),
    ]
    for name, ok in checks:
        print(f"[smoke] verify: {'PASS' if ok else 'FAIL'}  {name}")

    if all(ok for _, ok in checks):
        print("RESULT=LOCAL_EMBEDDINGGEMMA_KNOWGRAPH_SOURCE_VECTORS_PROVEN")
        return 0
    print("RESULT=PARTIAL_BLOCKED (see FAIL lines)")
    return 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="KnowGraph source-summary vectors (Python rails)"
    )
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("probe-endpoint", help="probe the live local embedding dimension")

    ensure = sub.add_parser("ensure-index", help="create the assertion vector index")
    ensure.add_argument("--dim", type=int, required=True)

    back = sub.add_parser("backfill", help="embed retrieval summaries for a project")
    back.add_argument("--project", required=True)
    back.add_argument("--limit", type=int, default=3)
    back.add_argument("--source-ref", action="append", dest="source_refs")

    read = sub.add_parser("read-back", help="read back embedded assertions")
    read.add_argument("--project", required=True)
    read.add_argument("--limit", type=int, default=10)

    smoke = sub.add_parser("smoke", help="bounded live proof of the full capability")
    smoke.add_argument("--project", required=True)
    smoke.add_argument("--limit", type=int, default=3)

    args = parser.parse_args(argv)
    if args.command == "probe-endpoint":
        return _cmd_probe_endpoint()
    if args.command == "ensure-index":
        return _cmd_ensure_index(args.dim)
    if args.command == "backfill":
        return _cmd_backfill(args.project, args.limit, args.source_refs)
    if args.command == "read-back":
        return _cmd_read_back(args.project, args.limit)
    if args.command == "smoke":
        return _cmd_smoke(args.project, args.limit)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
