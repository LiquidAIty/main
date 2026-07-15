"""LiquidAIty's canonical ThinkGraph adapter over Engraphis v2.

The adapter preserves LiquidAIty record IDs and authority while using Engraphis
for scoped, bi-temporal memory, local embeddings, hybrid recall, and directed
graph relationships. The retired AGE store is neither read nor written.
"""
from __future__ import annotations

from datetime import datetime, timezone
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
    if not isinstance(value, dict):
        return {}
    return {
        str(key): item
        for key, item in value.items()
        if isinstance(item, (str, int, float, bool)) and not isinstance(item, complex)
    }


class ThinkGraphEngraphis:
    def __init__(self, db_path: str | Path, *, embedder: Any | None = None) -> None:
        self.db_path = str(db_path)
        self.store = Store(self.db_path)
        self.embedder = embedder or SentenceTransformerEmbedder(EMBED_MODEL)
        if int(self.embedder.dim) != 384:
            raise RuntimeError(f"thinkgraph_embedding_dimension_mismatch: {self.embedder.dim}")
        self.index = NumpyVectorIndex(self.store)
        self.engine = MemoryEngine(
            self.store,
            self.embedder,
            self.index,
            IdentityReranker(),
            auto_evolve=False,
        )
        self.lock = RLock()
        self.store.conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS thinkgraph_patch_receipts (
                project_id TEXT NOT NULL,
                correlation_id TEXT NOT NULL,
                applied_at REAL NOT NULL,
                PRIMARY KEY(project_id, correlation_id)
            );
            CREATE INDEX IF NOT EXISTS idx_tg_entity_canonical
                ON entities(workspace_id, repo_id, canonical_id);
            """
        )
        self.store.conn.commit()

    @property
    def model_info(self) -> dict[str, Any]:
        return {
            "engine": "engraphis-v2",
            "engraphisSchemaVersion": self.store.schema_version,
            "embeddingModel": EMBED_MODEL,
            "embeddingDimension": int(self.embedder.dim),
            "normalized": True,
            "storage": self.db_path,
            "remoteEmbeddingFallback": False,
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
        }
        memory_type = _mtype(kind, properties)
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
        self.store.conn.execute(
            """INSERT INTO memories
               (id, workspace_id, repo_id, session_id, scope, mtype, title, content, summary,
                keywords, metadata, importance, surprise, stability, access_count, last_access,
                valid_from, valid_to, ingested_at, expired_at, pinned, sensitivity, provenance)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
               """,
            (
                record.id, record.workspace_id, record.repo_id, record.session_id,
                record.scope.value, record.mtype.value, record.title, record.content,
                record.summary, _json(record.keywords), _json(record.metadata),
                record.importance, record.surprise, record.stability, record.access_count,
                record.last_access, record.valid_from, record.valid_to, record.ingested_at,
                record.expired_at, int(record.pinned), record.sensitivity,
                _json(record.provenance),
            ),
        )
        self.store.conn.execute(
            "INSERT INTO mem_fts(id, title, content, keywords) VALUES(?,?,?,?)",
            (record.id, record.title, record.content, " ".join(record.keywords)),
        )
        self.store.put_vector(record.id, vector, model=EMBED_MODEL)
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
        with self.lock:
            workspace_id, repo_id = self._scope(project_id)
            receipt = self.store.conn.execute(
                "SELECT 1 FROM thinkgraph_patch_receipts WHERE project_id=? AND correlation_id=?",
                (project_id, correlation_id),
            ).fetchone()
            if receipt:
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
                for resource in resources:
                    canonical_id = _text(resource.get("id"))
                    self._write_memory(
                        canonical_id=canonical_id,
                        label=_text(resource.get("label")) or canonical_id,
                        kind=_text(resource.get("kind")) or "Record",
                        properties=_scalar_properties(resource.get("properties")),
                        authority=authority,
                        workspace_id=workspace_id,
                        repo_id=repo_id,
                        now=now,
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
                    "INSERT INTO thinkgraph_patch_receipts(project_id, correlation_id, applied_at) VALUES(?,?,?)",
                    (project_id, correlation_id, now),
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
            edges = [edge for edge in self.store.edges_in_scope(SearchFilter(workspace_id=workspace_id, repo_id=repo_id)) if edge.src in ids and edge.dst in ids]
            degree: dict[str, int] = {record_id: 0 for record_id in ids}
            for edge in edges:
                degree[edge.src] += 1
                degree[edge.dst] += 1
            nodes = [self._project_record(record, project_id, degree.get(record.id, 0)) for record in records]
            projected_edges = [self._project_edge(edge) for edge in edges]
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

    def _project_record(self, record: MemoryRecord, project_id: str, degree: int) -> dict[str, Any]:
        metadata = dict(record.metadata or {})
        props = dict(metadata.get("properties") or {})
        return {
            "id": record.id,
            "canonicalId": metadata.get("canonicalId") or record.id,
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
            "currentState": "historical" if record.valid_to is not None else metadata.get("currentState") or "current",
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
    def _project_edge(edge: Any) -> dict[str, Any]:
        try:
            provenance = dict(edge.provenance or {})
        except (TypeError, ValueError):
            provenance = {}
        return {
            "id": edge.id,
            "source": edge.src,
            "target": edge.dst,
            "predicate": edge.relation,
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
