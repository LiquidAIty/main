"""ThinkGraph noun-and-verb projection — ``thinkgraph.projection.v1``.

Python + Apache AGE are the ThinkGraph authority. This module reads the ACTUAL
persisted project records — ``:Resource`` vertices (noun entities) and
reified ``:Statement`` vertices with their stored subject/object references —
from the ``thinkgraph_liq`` graph and returns one bounded direct graph per
project: real stable IDs, real labels, real predicates, real attached
properties, and mechanical mention/provenance counters. Every Statement is a
direct subject -> object edge between two real Resources.

One graph model: nouns and verb phrases. No lifecycle, no frame, no
active-focus wrapper. A resource's stored ``kind`` (model-authored, free-form:
Goal / Question / Decision / …) IS surfaced — as the shared-projection ``type``
(+ ``labels``) so the graph renderer can color and label nodes by type.
Product decision 2026-07-14 (overrides the earlier nouns-and-verbs-only stance
for the returned shape); ``type`` is stored data, never invented or inferred
from label text, and is simply omitted when a node has no stored kind. Mention
counting remains the only other signal, from the writer's provenance-gated
counters (mechanical, never model-reported).

Co-occurrence (``:CO_OCCURRED_WITH``) is not a verb phrase — it stays stored
but is not part of this projection's returned edges.

Nothing is invented: a statement whose subject or object is not present in
the returned resource slice is still returned — the renderer decides whether
it can draw the edge and reports the exact reason when it cannot. DB failures
raise honestly — there is no fallback projection.
"""

from __future__ import annotations

import json
from typing import Any

SCHEMA_VERSION = "thinkgraph.projection.v1"
GRAPH_NAME = "thinkgraph_liq"

_MAX_LIMIT = 2000
_DEFAULT_LIMIT = 500


def _s(value: Any) -> str:
    return value if isinstance(value, str) else "" if value is None else str(value)


def _int(value: Any) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return 0
    return n if n > 0 else 0


def _properties(value: Any) -> dict[str, Any]:
    """Flat key/value map exactly as stored. Never invented, never inferred."""
    return value if isinstance(value, dict) and value else {}


# ---------------------------------------------------------------------------
# Pure assembly (unit-testable without a database).
# ---------------------------------------------------------------------------


def assemble_projection(
    project_id: str,
    resource_rows: list[dict[str, Any]],
    statement_rows: list[dict[str, Any]],
) -> dict[str, Any]:
    """Assemble the direct noun-and-verb projection from actual stored rows.

    ``resource_rows`` / ``statement_rows`` are the raw maps returned by the
    AGE queries below (or equivalent stored records in tests).
    """
    nodes: list[dict[str, Any]] = []
    for row in resource_rows:
        node_id = _s(row.get("id")).strip()
        if not node_id:
            continue
        mention_count = _int(row.get("mention_count"))
        kind = _s(row.get("kind")).strip()
        nodes.append(
            {
                "id": node_id,
                "label": _s(row.get("label")) or node_id,
                # Stored resource kind → shared-projection type (+labels) so the
                # renderer colors/labels by type. Stored data, never invented;
                # omitted entirely when a node has no stored kind.
                **({"type": kind, "labels": [kind]} if kind else {}),
                "mentionCount": mention_count,
                **({"lastMentionedAt": row["last_mentioned_at"]} if row.get("last_mentioned_at") else {}),
                "properties": _properties(row.get("properties")),
                "provenanceCount": mention_count,
                # Stored write provenance (conversation / card / run correlation),
                # exactly as persisted by the one canonical writer. Never invented.
                **({"conversationId": row["conversation_id"]} if row.get("conversation_id") else {}),
                **({"cardId": row["card_id"]} if row.get("card_id") else {}),
                **({"correlationId": row["correlation_id"]} if row.get("correlation_id") else {}),
            }
        )

    edges: list[dict[str, Any]] = []
    for row in statement_rows:
        statement_id = _s(row.get("id")).strip()
        if not statement_id:
            continue
        subject = _s(row.get("subject")).strip()
        obj = _s(row.get("object")).strip()
        if not subject or not obj:
            continue
        predicate = _s(row.get("predicate_term")).strip() or statement_id
        mention_count = _int(row.get("mention_count"))
        edges.append(
            {
                "id": statement_id,
                "source": subject,
                "target": obj,
                "predicate": predicate,
                "mentionCount": mention_count,
                **({"lastMentionedAt": row["last_mentioned_at"]} if row.get("last_mentioned_at") else {}),
                "properties": _properties(row.get("properties")),
                "provenanceCount": mention_count,
            }
        )

    return {
        "schemaVersion": SCHEMA_VERSION,
        "projectId": project_id,
        "nodes": nodes,
        "edges": edges,
    }


# ---------------------------------------------------------------------------
# Actual AGE reads (same Postgres and the same ag_catalog.cypher SQL shape the
# existing store uses; agtype map rows print as JSON and parse with json.loads).
# ---------------------------------------------------------------------------


def _cypher_rows(cur, cypher: str, params: dict[str, Any]) -> list[dict[str, Any]]:
    # AGE resolves the graph name at parse time — it must be a literal (module
    # constant, never user input), exactly like the existing backend store.
    cur.execute(
        f"SELECT * FROM ag_catalog.cypher('{GRAPH_NAME}', $$ " + cypher + " $$, %s) AS (row ag_catalog.agtype)",
        (json.dumps(params),),
    )
    rows: list[dict[str, Any]] = []
    for (raw,) in cur.fetchall():
        try:
            parsed = json.loads(str(raw))
        except (TypeError, ValueError):
            continue
        if isinstance(parsed, dict):
            rows.append(parsed)
    return rows


def read_projection(project_id: str, limit: int | None = None) -> dict[str, Any]:
    """Read the actual persisted ThinkGraph records for one project and return
    the direct noun-and-verb graph, bounded by limit and recency. Raises
    honestly on DB errors — no fallback."""
    cleaned_project = _s(project_id).strip()
    if not cleaned_project:
        raise ValueError("project_id_required")
    bounded_limit = min(max(int(limit or _DEFAULT_LIMIT), 1), _MAX_LIMIT)

    # Same short-lived autocommit connection convention as runtime_assignments —
    # one Postgres, one graph authority. Imported lazily so pure-assembly tests
    # never need psycopg.
    from app.python_models.runtime_assignments import _connect

    with _connect() as conn:
        with conn.cursor() as cur:
            resource_rows = _cypher_rows(
                cur,
                f"""
                MATCH (n:Resource {{project_id: $projectId}})
                RETURN {{ id: n.id, label: n.label, kind: n.kind, mention_count: n.mention_count,
                          last_mentioned_at: n.last_mentioned_at, properties: n.properties,
                          conversation_id: n.conversation_id, card_id: n.card_id,
                          correlation_id: n.correlation_id }} AS row
                ORDER BY n.updated_at DESC
                LIMIT {bounded_limit}
                """,
                {"projectId": cleaned_project},
            )
            statement_rows = _cypher_rows(
                cur,
                f"""
                MATCH (st:Statement {{project_id: $projectId}})
                RETURN {{ id: st.id, subject: st.subject, predicate_term: st.predicate_term,
                          object: st.object, mention_count: st.mention_count,
                          last_mentioned_at: st.last_mentioned_at, properties: st.properties }} AS row
                ORDER BY st.updated_at DESC
                LIMIT {bounded_limit}
                """,
                {"projectId": cleaned_project},
            )

    return assemble_projection(cleaned_project, resource_rows, statement_rows)
