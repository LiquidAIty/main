"""LiquidAIty's canonical ThinkGraph adapter over Engraphis v2.

The adapter preserves LiquidAIty record IDs and authority while using Engraphis
for scoped, bi-temporal memory, local embeddings, hybrid recall, and directed
graph relationships. The retired AGE store is neither read nor written.
"""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
from threading import RLock
import time
from typing import Any

import numpy as np
from engraphis.backends.embedder_st import SentenceTransformerEmbedder
from engraphis.backends.reranker import IdentityReranker
from engraphis.backends.vector_numpy import NumpyVectorIndex
from engraphis.core.engine import MemoryEngine
from engraphis.core.interfaces import MemoryRecord, MemoryType, Scope, SearchFilter
from engraphis.core.store import Store


EMBED_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
_REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_DB_PATH = _REPO_ROOT / "db" / "thinkgraph-engraphis-v2.sqlite"

_WORKING_KINDS = {"Goal", "Question", "ResearchNeed", "CodeInspectionNeed", "RequiredProof", "Job"}
_EPISODIC_KINDS = {
    "Comparison", "ResearchResult", "CodeFinding", "PositionOutput", "DoubleAgentReport",
    "ProcessLeak", "WorkerResult", "TestResult", "HermesReview", "MainResponse",
    "UserJudgment", "MigrationEvent",
}
_PROCEDURAL_KINDS = {"SkillFinding", "PromptFinding"}


def _iso(value: float | None) -> str | None:
    if value is None:
        return None
    return datetime.fromtimestamp(value, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def _timestamp(value: Any, default: float | None = None) -> float | None:
    if isinstance(value, (int, float)) and np.isfinite(value):
        return float(value)
    text = str(value or "").strip()
    if not text:
        return default
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return default


def _text(value: Any) -> str:
    return str(value or "").strip()


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _mtype(kind: str, properties: dict[str, Any]) -> MemoryType:
    explicit = _text(properties.get("memory_type") or properties.get("memoryType")).lower()
    if explicit in {item.value for item in MemoryType}:
        return MemoryType(explicit)
    if kind in _WORKING_KINDS:
        return MemoryType.WORKING
    if kind in _EPISODIC_KINDS:
        return MemoryType.EPISODIC
    if kind in _PROCEDURAL_KINDS:
        return MemoryType.PROCEDURAL
    return MemoryType.SEMANTIC


def _scalar_properties(value: Any) -> dict[str, str | int | float | bool]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValueError("patch_properties_must_be_flat_object")
    if len(value) > 20:
        raise ValueError("patch_properties_too_many_keys")
    result: dict[str, str | int | float | bool] = {}
    for raw_key, item in value.items():
        key = str(raw_key)
        if not key.strip() or len(key) > 60 or "\n" in key:
            raise ValueError(f"patch_property_key_not_compact: {key}")
        if (
            not isinstance(item, (str, int, float, bool))
            or isinstance(item, complex)
        ):
            raise ValueError(f"patch_property_value_must_be_scalar: {key}")
        if isinstance(item, str) and (len(item) > 200 or "\n" in item):
            raise ValueError(f"patch_property_value_not_compact: {key}")
        result[key] = item
    return result


class ThinkGraphEngraphis:
    def __init__(self, db_path: str | Path, *, embedder: Any | None = None) -> None:
        self.db_path = str(db_path)
        self.store = Store(self.db_path)
        self._embedder = embedder
        if self._embedder is not None and int(self._embedder.dim) != 384:
            raise RuntimeError(
                f"thinkgraph_embedding_dimension_mismatch: {self._embedder.dim}"
            )
        self._index: NumpyVectorIndex | None = None
        self._engine: MemoryEngine | None = None
        self._embedding_lock = RLock()
        self._embedding_state = "idle"
        self._embedding_initializations = 0
        self._embedding_waiters = 0
        self._embedding_duration_ms: int | None = None
        self._embedding_error: str | None = None
        self.lock = RLock()
        self.store.conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS thinkgraph_patch_receipts (
                project_id TEXT NOT NULL,
                correlation_id TEXT NOT NULL,
                applied_at REAL NOT NULL,
                payload_hash TEXT,
                PRIMARY KEY(project_id, correlation_id)
            );
            CREATE INDEX IF NOT EXISTS idx_tg_entity_canonical
                ON entities(workspace_id, repo_id, canonical_id);
            """
        )
        receipt_columns = {
            str(row[1])
            for row in self.store.conn.execute(
                "PRAGMA table_info(thinkgraph_patch_receipts)"
            ).fetchall()
        }
        if "payload_hash" not in receipt_columns:
            self.store.conn.execute(
                "ALTER TABLE thinkgraph_patch_receipts ADD COLUMN payload_hash TEXT"
            )
        self.store.conn.commit()

    def _ensure_embedding_runtime(self) -> None:
        if self._engine is not None:
            return
        if self._embedding_state == "initializing":
            self._embedding_waiters += 1
        with self._embedding_lock:
            if self._engine is not None:
                return
            started = time.perf_counter()
            self._embedding_state = "initializing"
            self._embedding_initializations += 1
            self._embedding_error = None
            try:
                if self._embedder is None:
                    self._embedder = SentenceTransformerEmbedder(EMBED_MODEL)
                if int(self._embedder.dim) != 384:
                    raise RuntimeError(
                        f"thinkgraph_embedding_dimension_mismatch: {self._embedder.dim}"
                    )
                self._index = NumpyVectorIndex(self.store)
                self._engine = MemoryEngine(
                    self.store,
                    self._embedder,
                    self._index,
                    IdentityReranker(),
                    auto_evolve=False,
                )
                self._embedding_state = "ready"
            except Exception as error:
                self._embedding_state = "failed"
                self._embedding_error = str(error)
                raise
            finally:
                self._embedding_duration_ms = round((time.perf_counter() - started) * 1000)

    @property
    def embedder(self) -> Any:
        self._ensure_embedding_runtime()
        return self._embedder

    @property
    def engine(self) -> MemoryEngine:
        self._ensure_embedding_runtime()
        if self._engine is None:  # pragma: no cover - guarded above
            raise RuntimeError("thinkgraph_embedding_runtime_unavailable")
        return self._engine

    @property
    def model_info(self) -> dict[str, Any]:
        return {
            "engine": "engraphis-v2",
            "engraphisSchemaVersion": self.store.schema_version,
            "embeddingModel": EMBED_MODEL,
            "embeddingDimension": 384,
            "normalized": True,
            "storage": self.db_path,
            "remoteEmbeddingFallback": False,
            "embeddingRuntime": {
                "state": self._embedding_state,
                "loaded": self._engine is not None,
                "initializations": self._embedding_initializations,
                "waiters": self._embedding_waiters,
                "durationMs": self._embedding_duration_ms,
                "error": self._embedding_error,
                # Engine construction reads persisted vectors through the index;
                # it does not regenerate or rewrite them.
                "generatedOnInitialization": 0,
                "persistedReembeddedOnInitialization": 0,
            },
        }

    def _scope(self, project_id: str) -> tuple[str, str]:
        workspace_id = self.store.get_or_create_workspace(project_id)
        repo_id = self.store.get_or_create_repo(workspace_id, "thinkgraph")
        return workspace_id, repo_id

    def _records_for_canonical(
        self,
        workspace_id: str,
        repo_id: str,
        canonical_id: str,
    ) -> list[MemoryRecord]:
        records = self.store.list_memories(
            SearchFilter(workspace_id=workspace_id, repo_id=repo_id),
            include_invalid=True,
            limit=10000,
        )
        return sorted(
            (
                record
                for record in records
                if _text((record.metadata or {}).get("canonicalId") or record.id) == canonical_id
            ),
            key=lambda record: (record.valid_from or 0, record.ingested_at or 0),
            reverse=True,
        )

    def _active_record(
        self,
        workspace_id: str,
        repo_id: str,
        canonical_id: str,
    ) -> MemoryRecord | None:
        return next(
            (
                record
                for record in self._records_for_canonical(workspace_id, repo_id, canonical_id)
                if record.valid_to is None
            ),
            None,
        )

    def _write_memory(
        self,
        *,
        canonical_id: str,
        label: str,
        kind: str,
        properties: dict[str, Any],
        authority: dict[str, Any],
        workspace_id: str,
        repo_id: str,
        now: float,
        created_at: float | None = None,
        valid_from: float | None = None,
        valid_to: float | None = None,
        ingested_at: float | None = None,
        embedding: Any | None = None,
    ) -> tuple[str, bool]:
        existing = self._active_record(workspace_id, repo_id, canonical_id)
        existing_meta = dict(existing.metadata or {}) if existing else {}
        if existing:
            existing_props = dict(existing_meta.get("properties") or {})
            existing_kind = _text(existing_meta.get("recordKind") or existing.title)
            if existing.content == label and existing_kind == kind and existing_props == properties:
                return existing.id, False

        prior_versions = self._records_for_canonical(workspace_id, repo_id, canonical_id)
        version_ordinal = max(
            (int((record.metadata or {}).get("versionOrdinal") or 1) for record in prior_versions),
            default=0,
        ) + 1
        globally_claimed = self.store.get_memory(canonical_id)
        if not prior_versions and globally_claimed is None:
            physical_id = canonical_id
        elif not prior_versions:
            physical_id = f"{canonical_id}::scope:{workspace_id}:{time.time_ns()}"
        else:
            physical_id = f"{canonical_id}::v{version_ordinal}:{time.time_ns()}"
        if existing:
            self.store.conn.execute(
                "UPDATE memories SET valid_to=? WHERE id=? AND valid_to IS NULL",
                (now, existing.id),
            )

        correlations = list(existing_meta.get("mentionedCorrelationIds") or [])
        correlation_id = _text(authority.get("correlationId"))
        if correlation_id and correlation_id not in correlations:
            correlations.append(correlation_id)
        mention_count = max(int(existing_meta.get("mentionCount") or 0), int(properties.get("mention_count") or 0)) + 1
        metadata = {
            "canonicalId": canonical_id,
            "versionId": physical_id,
            "versionOrdinal": version_ordinal,
            "supersedesVersionId": existing.id if existing else "",
            "recordKind": kind,
            "properties": properties,
            "authority": "thinkgraph",
            "projectId": _text(authority.get("projectId")),
            "conversationId": _text(authority.get("conversationId")),
            "episodeId": _text(properties.get("episode") or properties.get("episode_id")),
            "jobId": _text(properties.get("job") or properties.get("job_id")),
            "runId": correlation_id,
            "goalId": _text(properties.get("goal") or properties.get("goal_id")),
            "cardId": _text(authority.get("cardId")),
            "correlationId": correlation_id,
            "productionPath": _text(properties.get("production_path")),
            "currentState": _text(properties.get("state") or properties.get("status")) or ("historical" if valid_to else "current"),
            "qualityState": _text(properties.get("quality_state") or properties.get("quality")),
            "trustState": _text(properties.get("trust") or properties.get("confidence")),
            "codeGraphRef": _text(properties.get("codegraph_ref") or properties.get("code_ref") or properties.get("cg_ref")),
            "knowGraphRef": _text(properties.get("knowgraph_ref") or properties.get("kg_ref")),
            "artifactRef": _text(properties.get("artifact") or properties.get("artifact_ref")),
            "promptRef": _text(properties.get("prompt_ref")),
            "mentionedCorrelationIds": correlations,
            "mentionCount": mention_count,
            "updatedAt": _iso(now),
            "embedModel": EMBED_MODEL,
            "embed_model": EMBED_MODEL,
        }
        memory_type = _mtype(kind, properties)
        vector = embedding
        if vector is None:
            vector = self.embedder.embed([f"{kind}\n{label}"])[0]
        record = MemoryRecord(
            id=physical_id,
            content=label,
            title=kind or canonical_id,
            mtype=memory_type,
            scope=Scope.REPO,
            workspace_id=workspace_id,
            repo_id=repo_id,
            session_id=_text(authority.get("conversationId")) or None,
            keywords=[kind] if kind else [],
            metadata=metadata,
            importance=float(properties.get("importance") or (existing.importance if existing else 0.5)),
            valid_from=valid_from if valid_from is not None else created_at or now,
            valid_to=None,
            ingested_at=ingested_at if ingested_at is not None else created_at or now,
            last_access=existing.last_access if existing else now,
            access_count=existing.access_count if existing else 0,
            stability=existing.stability if existing else 1.0,
            provenance={
                "authority": "thinkgraph",
                "projectId": _text(authority.get("projectId")),
                "conversationId": _text(authority.get("conversationId")),
                "cardId": _text(authority.get("cardId")),
                "correlationId": correlation_id,
                "sourceRef": _text(properties.get("source_ref")),
            },
            embedding=vector,
        )
        self.store.add_memory(record, audit=False, commit=False)
        self.store.conn.execute(
            """INSERT INTO entities(id, workspace_id, repo_id, name, etype, canonical_id, created_at)
               VALUES(?,?,?,?,?,?,?)
               """,
            (physical_id, workspace_id, repo_id, label, kind, canonical_id, created_at or now),
        )
        if existing:
            self._upsert_edge(
                f"supersedes:{physical_id}",
                physical_id,
                existing.id,
                "SUPERSEDES",
                workspace_id,
                repo_id,
                now,
                {"authority": "thinkgraph", "canonicalId": canonical_id},
            )
        return physical_id, True

    def apply_patch(self, authority: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
        project_id = _text(authority.get("projectId"))
        correlation_id = _text(authority.get("correlationId"))
        resources = list(patch.get("resources") or [])
        relations = list(patch.get("relations") or [])
        statements = list(patch.get("statements") or [])
        if not resources and not relations and not statements:
            return self._result("empty", correlation_id, [], [], 0)
        prepared_resources = [
            {
                "canonical_id": _text(resource.get("id")),
                "label": _text(resource.get("label")) or _text(resource.get("id")),
                "kind": _text(resource.get("kind")) or "Record",
                "properties": _scalar_properties(resource.get("properties")),
            }
            for resource in resources
        ]
        payload_hash = hashlib.sha256(
            json.dumps(
                {
                    "resources": resources,
                    "relations": relations,
                    "statements": statements,
                },
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest()
        with self.lock:
            workspace_id, repo_id = self._scope(project_id)
            receipt = self.store.conn.execute(
                "SELECT payload_hash FROM thinkgraph_patch_receipts WHERE project_id=? AND correlation_id=?",
                (project_id, correlation_id),
            ).fetchone()
            if receipt:
                prior_hash = _text(receipt[0])
                if prior_hash and prior_hash != payload_hash:
                    return {
                        "ok": False,
                        "status": "conflict",
                        "error": "thinkgraph_correlation_conflict",
                        "correlationId": correlation_id,
                    }
                return self._result("duplicate", correlation_id, [], [], 0)
            known = {
                _text((item.metadata or {}).get("canonicalId") or item.id)
                for item in self.store.list_memories(
                    SearchFilter(workspace_id=workspace_id, repo_id=repo_id),
                    include_invalid=True,
                )
            }
            declared = {_text(item.get("id")) for item in resources}
            for statement in statements:
                for endpoint_name in ("subject", "object"):
                    endpoint = _text(statement.get(endpoint_name))
                    if endpoint not in known and endpoint not in declared:
                        return {"ok": False, "error": f"patch_statement_{endpoint_name}_unresolved: {_text(statement.get('id'))} -> {endpoint}"}
            now = time.time()
            stored_resources: list[str] = []
            stored_statements: list[str] = []
            try:
                changed_indexes: list[int] = []
                embedding_texts: list[str] = []
                for index, resource in enumerate(prepared_resources):
                    existing = self._active_record(
                        workspace_id,
                        repo_id,
                        resource["canonical_id"],
                    )
                    existing_meta = dict(existing.metadata or {}) if existing else {}
                    if (
                        existing
                        and existing.content == resource["label"]
                        and _text(existing_meta.get("recordKind") or existing.title)
                        == resource["kind"]
                        and dict(existing_meta.get("properties") or {})
                        == resource["properties"]
                    ):
                        continue
                    changed_indexes.append(index)
                    embedding_texts.append(
                        f"{resource['kind']}\n{resource['label']}"
                    )
                embedded_rows = (
                    self.embedder.embed(embedding_texts)
                    if embedding_texts
                    else []
                )
                embeddings = {
                    resource_index: embedded_rows[position]
                    for position, resource_index in enumerate(changed_indexes)
                }
                for index, resource in enumerate(prepared_resources):
                    canonical_id = resource["canonical_id"]
                    self._write_memory(
                        canonical_id=canonical_id,
                        label=resource["label"],
                        kind=resource["kind"],
                        properties=resource["properties"],
                        authority=authority,
                        workspace_id=workspace_id,
                        repo_id=repo_id,
                        now=now,
                        embedding=embeddings.get(index),
                    )
                    stored_resources.append(canonical_id)
                for relation in relations:
                    a, b = _text(relation.get("a")), _text(relation.get("b"))
                    active_a = self._active_record(workspace_id, repo_id, a)
                    active_b = self._active_record(workspace_id, repo_id, b)
                    if not active_a or not active_b:
                        raise RuntimeError(f"patch_relation_endpoint_unresolved: {a} -> {b}")
                    edge_id = f"co:{min(a, b)}:{max(a, b)}"
                    self._upsert_edge(edge_id, active_a.id, active_b.id, "RELATED", workspace_id, repo_id, now, {"correlationId": correlation_id})
                for statement in statements:
                    statement_id = _text(statement.get("id"))
                    subject = _text(statement.get("subject"))
                    object_id = _text(statement.get("object"))
                    active_subject = self._active_record(workspace_id, repo_id, subject)
                    active_object = self._active_record(workspace_id, repo_id, object_id)
                    if not active_subject or not active_object:
                        raise RuntimeError(f"patch_statement_endpoint_unresolved: {statement_id}")
                    props = _scalar_properties(statement.get("properties"))
                    props.update({key: _text(statement.get(key)) for key in ("rationale", "review", "tag") if statement.get(key)})
                    self._upsert_edge(
                        statement_id,
                        active_subject.id,
                        active_object.id,
                        _text(statement.get("predicateTerm")) or "RELATED",
                        workspace_id,
                        repo_id,
                        now,
                        {"correlationId": correlation_id, "properties": props},
                    )
                    stored_statements.append(statement_id)
                self.store.conn.execute(
                    "INSERT INTO thinkgraph_patch_receipts(project_id, correlation_id, applied_at, payload_hash) VALUES(?,?,?,?)",
                    (project_id, correlation_id, now, payload_hash),
                )
                self.store.conn.commit()
            except Exception:
                self.store.conn.rollback()
                raise
            return self._result("applied", correlation_id, stored_resources, stored_statements, len(relations))

    def _upsert_edge(self, edge_id: str, source: str, target: str, relation: str,
                     workspace_id: str, repo_id: str, now: float, provenance: dict[str, Any]) -> None:
        existing = self.store.conn.execute(
            """SELECT id, src, dst, relation, provenance FROM edges
               WHERE workspace_id=? AND repo_id=? AND (id=? OR id LIKE ?) AND valid_to IS NULL
               ORDER BY valid_from DESC LIMIT 1""",
            (workspace_id, repo_id, edge_id, f"{edge_id}::v%"),
        ).fetchone()
        encoded_provenance = _json(provenance)
        if existing and existing[1] == source and existing[2] == target and existing[3] == relation and existing[4] == encoded_provenance:
            return
        globally_claimed = self.store.conn.execute("SELECT 1 FROM edges WHERE id=?", (edge_id,)).fetchone()
        physical_id = edge_id if globally_claimed is None else f"{edge_id}::scope:{workspace_id}:{time.time_ns()}"
        if existing:
            self.store.conn.execute("UPDATE edges SET valid_to=? WHERE id=?", (now, existing[0]))
            physical_id = f"{edge_id}::v{time.time_ns()}"
        self.store.conn.execute(
            """INSERT INTO edges(id, workspace_id, repo_id, src, dst, relation, weight,
                 valid_from, valid_to, ingested_at, expired_at, provenance)
               VALUES(?,?,?,?,?, ?,1.0,?,NULL,?,NULL,?)
               """,
            (physical_id, workspace_id, repo_id, source, target, relation, now, now, encoded_provenance),
        )

    @staticmethod
    def _result(status: str, correlation_id: str, resources: list[str], statements: list[str], relation_count: int) -> dict[str, Any]:
        return {
            "ok": True, "status": status, "correlationId": correlation_id,
            "storedResourceIds": resources, "storedStatementIds": statements,
            "relationCount": relation_count,
        }

    def projection(self, project_id: str, *, limit: int = 500, include_historical: bool = False,
                   memory_type: str | None = None) -> dict[str, Any]:
        with self.lock:
            workspace_id, repo_id = self._scope(project_id)
            mtypes = [MemoryType(memory_type)] if memory_type in {item.value for item in MemoryType} else None
            records = self.store.list_memories(
                SearchFilter(workspace_id=workspace_id, repo_id=repo_id, mtypes=mtypes),
                include_invalid=include_historical,
                limit=max(1, min(int(limit), 2000)),
            )
            ids = {record.id for record in records}
            identity_records = records if include_historical else self.store.list_memories(
                SearchFilter(workspace_id=workspace_id, repo_id=repo_id, mtypes=mtypes),
                include_invalid=True,
                limit=2000,
            )
            canonical_by_id = {
                record.id: _text((record.metadata or {}).get("canonicalId") or record.id)
                for record in identity_records
            }
            scoped_edges = self.store.edges_in_scope(SearchFilter(workspace_id=workspace_id, repo_id=repo_id))
            current_edges = [edge for edge in scoped_edges if edge.valid_to is None]
            accepted_resolutions = {
                (
                    canonical_by_id.get(edge.src, edge.src),
                    canonical_by_id.get(edge.dst, edge.dst),
                )
                for edge in current_edges
                if self._relation_token(edge.relation) == "resolved_for"
                and self._edge_review(edge) in {"accepted", "approved", "resolved"}
            }
            if include_historical:
                edges = [edge for edge in scoped_edges if edge.src in ids and edge.dst in ids]
            else:
                current_canonical_ids = {canonical_by_id[record.id] for record in records}
                canonical_edges: dict[tuple[str, str, str], Any] = {}
                for edge in current_edges:
                    source = canonical_by_id.get(edge.src)
                    target = canonical_by_id.get(edge.dst)
                    if edge.relation == "SUPERSEDES" or source not in current_canonical_ids or target not in current_canonical_ids:
                        continue
                    if (
                        self._relation_token(edge.relation) == "blocks"
                        and (source, target) in accepted_resolutions
                    ):
                        continue
                    canonical_edges.setdefault((source, edge.relation, target), edge)
                edges = list(canonical_edges.values())
            projected_edges = [
                self._project_edge(
                    edge,
                    canonical_by_id,
                    preserve_version_identity=include_historical,
                    superseded=(
                        self._relation_token(edge.relation) == "blocks"
                        and (
                            canonical_by_id.get(edge.src, edge.src),
                            canonical_by_id.get(edge.dst, edge.dst),
                        )
                        in accepted_resolutions
                    ),
                )
                for edge in edges
            ]
            degree: dict[str, int] = {}
            for edge in projected_edges:
                degree[edge["source"]] = degree.get(edge["source"], 0) + 1
                degree[edge["target"]] = degree.get(edge["target"], 0) + 1
            nodes = [
                self._project_record(
                    record,
                    project_id,
                    degree.get(
                        record.id
                        if include_historical
                        else canonical_by_id.get(record.id, record.id),
                        0,
                    ),
                    preserve_version_identity=include_historical,
                )
                for record in records
            ]
            latest = max((record.ingested_at or 0 for record in records), default=0)
            return {
                "schemaVersion": "thinkgraph.engraphis.v2",
                "authority": "engraphis-v2",
                "projectId": project_id,
                "revision": f"{int(latest * 1000)}:{len(nodes)}:{len(projected_edges)}",
                "embedding": self.model_info,
                "nodes": nodes,
                "edges": projected_edges,
                "counts": {"nodes": len(nodes), "edges": len(projected_edges)},
            }

    def _project_record(
        self,
        record: MemoryRecord,
        project_id: str,
        degree: int,
        *,
        preserve_version_identity: bool = False,
    ) -> dict[str, Any]:
        metadata = dict(record.metadata or {})
        props = dict(metadata.get("properties") or {})
        canonical_id = _text(metadata.get("canonicalId")) or record.id
        current_state = (
            "historical"
            if record.valid_to is not None
            else _text(metadata.get("currentState")) or "current"
        )
        lifecycle_state = current_state.lower()
        if lifecycle_state == "current" or lifecycle_state not in {
            "active",
            "provisional",
            "resolved",
            "superseded",
            "historical",
        }:
            lifecycle_state = "active"
        return {
            "id": record.id if preserve_version_identity else canonical_id,
            "canonicalId": canonical_id,
            "versionId": metadata.get("versionId") or record.id,
            "versionOrdinal": int(metadata.get("versionOrdinal") or 1),
            "supersedesVersionId": metadata.get("supersedesVersionId") or None,
            "label": record.content,
            "title": record.title,
            "type": metadata.get("recordKind") or record.title,
            "kind": "resource",
            "itemKind": metadata.get("recordKind") or record.title,
            "labels": [metadata.get("recordKind") or record.title],
            "authority": "engraphis-v2",
            "projectId": project_id,
            "conversationId": metadata.get("conversationId") or record.session_id,
            "episodeId": metadata.get("episodeId"),
            "jobId": metadata.get("jobId"),
            "runId": metadata.get("runId"),
            "cardId": metadata.get("cardId"),
            "correlationId": metadata.get("correlationId"),
            "goalId": metadata.get("goalId"),
            "memoryType": record.mtype.value,
            "currentState": current_state,
            "lifecycleState": lifecycle_state,
            "createdAt": _iso(record.valid_from),
            "validFrom": _iso(record.valid_from),
            "validTo": _iso(record.valid_to),
            "ingestedAt": _iso(record.ingested_at),
            "updatedAt": metadata.get("updatedAt"),
            "properties": props,
            "provenance": record.provenance,
            "codeGraphRef": metadata.get("codeGraphRef"),
            "knowGraphRef": metadata.get("knowGraphRef"),
            "artifactRef": metadata.get("artifactRef"),
            "promptRef": metadata.get("promptRef"),
            "trustState": metadata.get("trustState"),
            "qualityState": metadata.get("qualityState"),
            "productionPath": metadata.get("productionPath"),
            "mentionCount": int(metadata.get("mentionCount") or 1),
            "provenanceCount": len(metadata.get("mentionedCorrelationIds") or []) or 1,
            "lastMentionedAt": metadata.get("updatedAt") or _iso(record.ingested_at),
            "degree": degree,
            "retrievalReason": "current project projection",
        }

    @staticmethod
    def _relation_token(relation: Any) -> str:
        return _text(relation).lower().rsplit(":", 1)[-1]

    @staticmethod
    def _edge_review(edge: Any) -> str:
        try:
            provenance = dict(edge.provenance or {})
        except (TypeError, ValueError):
            return ""
        properties = provenance.get("properties")
        return (
            _text(properties.get("review")).lower()
            if isinstance(properties, dict)
            else ""
        )

    @classmethod
    def _project_edge(
        cls,
        edge: Any,
        canonical_by_id: dict[str, str],
        *,
        preserve_version_identity: bool = False,
        superseded: bool = False,
    ) -> dict[str, Any]:
        try:
            provenance = dict(edge.provenance or {})
        except (TypeError, ValueError):
            provenance = {}
        relation_token = cls._relation_token(edge.relation)
        review = cls._edge_review(edge)
        if edge.valid_to is not None:
            lifecycle_state = "historical"
        elif superseded or edge.relation == "SUPERSEDES":
            lifecycle_state = "superseded"
        elif relation_token == "resolved_for":
            lifecycle_state = "resolved"
        elif review == "provisional":
            lifecycle_state = "provisional"
        else:
            lifecycle_state = "active"
        return {
            "id": edge.id,
            "source": edge.src if preserve_version_identity else canonical_by_id.get(edge.src, edge.src),
            "target": edge.dst if preserve_version_identity else canonical_by_id.get(edge.dst, edge.dst),
            "predicate": edge.relation,
            "lifecycleState": lifecycle_state,
            "mentionCount": 1,
            "provenanceCount": 1,
            "validFrom": _iso(edge.valid_from),
            "validTo": _iso(edge.valid_to),
            "provenance": provenance,
            "properties": provenance.get("properties") or {},
        }

    def get_record(self, project_id: str, canonical_id: str) -> dict[str, Any] | None:
        projection = self.projection(project_id, limit=2000, include_historical=True)
        matches = [node for node in projection["nodes"] if node["canonicalId"] == canonical_id]
        return next((node for node in matches if node["validTo"] is None), matches[0] if matches else None)

    def neighborhood(self, project_id: str, canonical_id: str) -> dict[str, Any]:
        projection = self.projection(project_id, limit=2000, include_historical=True)
        center = next(
            (node for node in projection["nodes"] if node["canonicalId"] == canonical_id and node["validTo"] is None),
            None,
        )
        center_id = center["id"] if center else canonical_id
        edges = [edge for edge in projection["edges"] if center_id in {edge["source"], edge["target"]}]
        node_ids = {center_id}
        for edge in edges:
            node_ids.update((edge["source"], edge["target"]))
        return {
            **{key: projection[key] for key in ("schemaVersion", "authority", "projectId", "revision")},
            "centerId": center_id,
            "canonicalId": canonical_id,
            "nodes": [node for node in projection["nodes"] if node["id"] in node_ids],
            "edges": edges,
        }

    def recall(self, project_id: str, query: str, *, k: int = 8, memory_type: str | None = None,
               include_historical: bool = False) -> dict[str, Any]:
        with self.lock:
            workspace_id, repo_id = self._scope(project_id)
            mtypes = [MemoryType(memory_type)] if memory_type in {item.value for item in MemoryType} else None
            result = self.engine.recall(query, workspace_id=workspace_id, repo_id=repo_id, mtypes=mtypes, k=max(1, min(k, 20)))
            chunks = []
            for chunk in result.chunks:
                record = self.store.get_memory(chunk["id"])
                if not record or (record.valid_to is not None and not include_historical):
                    continue
                chunks.append({
                    **chunk,
                    "canonicalId": record.metadata.get("canonicalId") or record.id,
                    "versionId": record.id,
                    "recordKind": record.metadata.get("recordKind"),
                    "projectId": project_id,
                    "conversationId": record.metadata.get("conversationId") or record.session_id,
                    "episodeId": record.metadata.get("episodeId"),
                    "jobId": record.metadata.get("jobId"),
                    "why": f"{chunk.get('arm', 'hybrid')} retrieval; score={chunk.get('score', 0)}",
                })
            return {
                "engine": "engraphis-v2", "projectId": project_id, "query": query,
                "count": len(chunks), "chunks": chunks, "context": result.context,
            }

_INSTANCE: ThinkGraphEngraphis | None = None
_INSTANCE_LOCK = RLock()


def get_thinkgraph() -> ThinkGraphEngraphis:
    global _INSTANCE
    with _INSTANCE_LOCK:
        if _INSTANCE is None:
            path = os.environ.get("THINKGRAPH_ENGRAPHIS_DB", str(DEFAULT_DB_PATH))
            _INSTANCE = ThinkGraphEngraphis(path)
        return _INSTANCE
