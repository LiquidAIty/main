# @graph entity: ThinkGraph Research Note Writer
# @graph role: project-meaning-write-and-prior-reasoning-link
# @graph relates_to: Research Memory Delta
# @graph depends_on: Apache AGE, Postgres
# @graph feeds_to: ThinkGraph
"""ThinkGraph (Apache AGE / Postgres) writer for project-meaning research notes.

KnowGraph (Neo4j) holds the external evidence; ThinkGraph holds the project
meaning. This Python rails writer persists one concise ``:ResearchNote`` per
research run into the existing ``thinkgraph_liq`` AGE graph (the same graph the
TypeScript ThinkGraph memory uses) and links a later note to the prior one it
revisits via ``REVISITS``. It stores summary/conclusion/consequence/uncertainty
plus the linked KnowGraph assertion/source IDs — never raw search traces or chat
history, and never KnowGraph evidence (the two graphs stay separate).

Uses the same AGE call shape as ``apps/backend/src/services/graphService.ts``:
``SELECT * FROM ag_catalog.cypher('thinkgraph_liq', $$ ... $$, %s) AS (row agtype)``
with parameters passed as one JSON object referenced inside cypher as ``$key``.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

THINKGRAPH_GRAPH_NAME = "thinkgraph_liq"


class ThinkGraphWriteError(RuntimeError):
    """ThinkGraph (AGE/Postgres) unavailable or a write/read failed honestly."""


@dataclass
class ResearchNote:
    project_id: str
    run_id: str
    summary: str
    conclusion: str
    project_consequence: str
    uncertainty: list[str] = field(default_factory=list)
    linked_assertion_ids: list[str] = field(default_factory=list)
    linked_source_refs: list[str] = field(default_factory=list)
    prior_reasoning_ref: str = ""      # prior run_id this note revisits, if any
    created_by: str = "research_memory_delta"


def _clean(value: object) -> str:
    return "" if value is None else str(value).strip()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _read_env_file(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    if not path.is_file():
        return env
    for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[len("export "):]
        k, _, v = line.partition("=")
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def load_pg_config() -> dict[str, Any]:
    """Resolve Postgres settings: process env first, then apps/backend/.env."""
    file_env = _read_env_file(_repo_root() / "apps" / "backend" / ".env")

    def pick(key: str, default: str) -> str:
        return (os.getenv(key) or file_env.get(key) or default).strip()

    return {
        "host": pick("POSTGRES_HOST", "localhost"),
        "port": int(pick("POSTGRES_PORT", "5433") or "5433"),
        "dbname": pick("POSTGRES_DB", "liquidaity"),
        "user": pick("POSTGRES_USER", "liquidaity-user"),
        "password": pick("POSTGRES_PASSWORD", "LiquidAIty"),
    }


def _connect(config: dict[str, Any] | None = None):
    try:
        import psycopg
    except ImportError as exc:  # pragma: no cover
        raise ThinkGraphWriteError(
            "psycopg is required for the ThinkGraph Python writer (pip install 'psycopg[binary]')"
        ) from exc
    config = config or load_pg_config()
    try:
        conn = psycopg.connect(
            host=config["host"], port=config["port"], dbname=config["dbname"],
            user=config["user"], password=config["password"], connect_timeout=8,
        )
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute("LOAD 'age'")
            cur.execute('SET search_path = ag_catalog, "$user", public')
    except Exception as exc:
        raise ThinkGraphWriteError(f"thinkgraph_postgres_unavailable: {exc}") from exc
    return conn


def _parse_agtype(value: Any) -> Any:
    if value is None:
        return None
    text = str(value)
    text = re.sub(r"::\w+$", "", text.strip())  # strip a trailing ::vertex/::map annotation
    try:
        return json.loads(text)
    except ValueError:
        return text


def run_cypher(conn, cypher: str, params: dict[str, Any] | None = None) -> list[Any]:
    """Run one AGE cypher on thinkgraph_liq, mirroring graphService.runCypherOnGraph."""
    cleaned = cypher.strip().rstrip(";")
    if "$$" in cleaned:
        raise ThinkGraphWriteError("cypher query cannot contain $$")
    with conn.cursor() as cur:
        if params is not None:
            cur.execute(
                f"SELECT * FROM ag_catalog.cypher('{THINKGRAPH_GRAPH_NAME}', $$ {cleaned} $$, %s) AS (row agtype)",
                [json.dumps(params)],
            )
        else:
            cur.execute(
                f"SELECT * FROM ag_catalog.cypher('{THINKGRAPH_GRAPH_NAME}', $$ {cleaned} $$) AS (row agtype)"
            )
        return [_parse_agtype(r[0]) for r in cur.fetchall()]


_NOTE_CREATE = """
CREATE (n:ResearchNote {
  id: $id, project_id: $projectId, run_id: $runId, ts: $ts,
  summary: $summary, conclusion: $conclusion, project_consequence: $consequence,
  uncertainty: $uncertainty, linked_assertion_ids: $linkedAssertionIds,
  linked_source_refs: $linkedSourceRefs, prior_reasoning_ref: $priorRef,
  created_by: $createdBy
})
RETURN n.id
"""

_NOTE_REVISIT = """
MATCH (n:ResearchNote {project_id: $projectId, run_id: $runId}),
      (p:ResearchNote {project_id: $projectId, run_id: $priorRunId})
MERGE (n)-[:REVISITS]->(p)
RETURN p.run_id
"""


def write_research_note(note: ResearchNote, *, conn=None, config: dict[str, Any] | None = None) -> dict[str, Any]:
    """Persist one ResearchNote to ThinkGraph; link REVISITS to a prior note when present."""
    if not _clean(note.project_id):
        raise ThinkGraphWriteError("project_id_required")
    if not _clean(note.run_id):
        raise ThinkGraphWriteError("run_id_required")
    owns = conn is None
    conn = conn or _connect(config)
    ts = _now()
    note_id = f"rmnote:{note.project_id}:{note.run_id}"
    try:
        run_cypher(conn, _NOTE_CREATE, {
            "id": note_id, "projectId": note.project_id, "runId": note.run_id, "ts": ts,
            "summary": _clean(note.summary)[:2000], "conclusion": _clean(note.conclusion)[:2000],
            "consequence": _clean(note.project_consequence)[:2000],
            "uncertainty": [_clean(u) for u in note.uncertainty if _clean(u)],
            "linkedAssertionIds": [_clean(a) for a in note.linked_assertion_ids if _clean(a)],
            "linkedSourceRefs": [_clean(s) for s in note.linked_source_refs if _clean(s)],
            "priorRef": _clean(note.prior_reasoning_ref), "createdBy": _clean(note.created_by) or "research_memory_delta",
        })
        revisited = None
        if _clean(note.prior_reasoning_ref):
            rows = run_cypher(conn, _NOTE_REVISIT, {
                "projectId": note.project_id, "runId": note.run_id,
                "priorRunId": _clean(note.prior_reasoning_ref),
            })
            revisited = rows[0] if rows else None
    finally:
        if owns:
            conn.close()
    return {"id": note_id, "ts": ts, "revisited_prior_run_id": revisited}


_NOTE_READ = """
MATCH (n:ResearchNote {project_id: $projectId, run_id: $runId})
RETURN {
  id: n.id, run_id: n.run_id, summary: n.summary, conclusion: n.conclusion,
  project_consequence: n.project_consequence, uncertainty: n.uncertainty,
  linked_assertion_ids: n.linked_assertion_ids, linked_source_refs: n.linked_source_refs,
  prior_reasoning_ref: n.prior_reasoning_ref, ts: n.ts
}
ORDER BY n.ts DESC
LIMIT 1
"""


def read_research_note(project_id: str, run_id: str, *, conn=None, config: dict[str, Any] | None = None) -> dict[str, Any] | None:
    owns = conn is None
    conn = conn or _connect(config)
    try:
        rows = run_cypher(conn, _NOTE_READ, {"projectId": project_id, "runId": run_id})
    finally:
        if owns:
            conn.close()
    return rows[0] if rows and isinstance(rows[0], dict) else None


def count_research_notes(project_id: str, *, conn=None, config: dict[str, Any] | None = None) -> int:
    owns = conn is None
    conn = conn or _connect(config)
    try:
        rows = run_cypher(conn, "MATCH (n:ResearchNote {project_id: $projectId}) RETURN count(n)",
                          {"projectId": project_id})
    finally:
        if owns:
            conn.close()
    try:
        return int(rows[0]) if rows else 0
    except (TypeError, ValueError):
        return 0
