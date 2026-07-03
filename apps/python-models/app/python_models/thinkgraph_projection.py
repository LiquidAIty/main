"""ThinkGraphProjectionV1 — the Python-owned read-only graph projection.

Python + Apache AGE are the ThinkGraph authority: this module reads the ACTUAL
persisted project records (``:Resource`` vertices, reified ``:Statement``
vertices with their stored subject/predicate/object references, and derived
``:CO_OCCURRED_WITH`` relations) from the ``thinkgraph_liq`` graph and emits one
projection per project. It preserves real stable IDs, real labels, real stored
kinds/predicates, and actual provenance fields — and assigns the display classes
(``visual.nodeClass`` / ``visual.edgeClass`` / ``visual.directed``) from those
stored values so TypeScript never reinterprets graph meaning.

It never invents nodes, edges, labels, relations, source references, confidence,
or status. Unknown stored kinds/predicates keep their original value and get an
explicit ``unknown_node`` / ``unknown_relation`` display class. DB failures
raise honestly — there is no fallback projection.
"""

from __future__ import annotations

import json
from typing import Any

SCHEMA_VERSION = "thinkgraph.projection.v1"
GRAPH_NAME = "thinkgraph_liq"

_NODE_CLASS_BY_KIND = {"resource": "resource", "statement": "statement"}
_CO_OCCURRENCE_PREDICATE = "co_occurred_with"

_MAX_LIMIT = 2000
_DEFAULT_LIMIT = 500


def _s(value: Any) -> str:
    return value if isinstance(value, str) else "" if value is None else str(value)


def _provenance(row: dict[str, Any], keys: dict[str, str]) -> dict[str, Any]:
    """Actual returned fields only: copy the listed stored fields that are present
    and non-empty. Nothing is derived or invented."""
    out: dict[str, Any] = {}
    for stored_key, out_key in keys.items():
        value = row.get(stored_key)
        if value is None:
            continue
        text = _s(value)
        if text:
            out[out_key] = value
    return out


# ---------------------------------------------------------------------------
# Pure assembly (unit-testable without a database).
# ---------------------------------------------------------------------------


def assemble_projection(
    project_id: str,
    resource_rows: list[dict[str, Any]],
    statement_rows: list[dict[str, Any]],
    relation_rows: list[dict[str, Any]],
) -> dict[str, Any]:
    """Assemble ThinkGraphProjectionV1 from actual stored rows.

    ``resource_rows`` / ``statement_rows`` / ``relation_rows`` are the raw maps
    returned by the AGE queries below (or equivalent stored records in tests).
    """
    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []

    for row in resource_rows:
        node_id = _s(row.get("id")).strip()
        if not node_id:
            continue
        kind = _s(row.get("kind")) or "resource"
        nodes.append(
            {
                "id": node_id,
                "label": _s(row.get("label")) or node_id,
                "kind": kind,
                **(
                    {"sourceRef": _s(row.get("correlation_id") or row.get("turn_id"))}
                    if _s(row.get("correlation_id") or row.get("turn_id"))
                    else {}
                ),
                "provenance": _provenance(
                    row,
                    {
                        "conversation_id": "conversationId",
                        "user_message_id": "userMessageId",
                        "assistant_message_id": "assistantMessageId",
                        "card_id": "cardId",
                        "correlation_id": "correlationId",
                        "updated_at": "updatedAt",
                    },
                ),
                "visual": {
                    "nodeClass": _NODE_CLASS_BY_KIND.get(kind, "unknown_node"),
                    "x": None,
                    "y": None,
                },
            }
        )

    resource_ids = {n["id"] for n in nodes}

    for row in statement_rows:
        statement_id = _s(row.get("id")).strip()
        if not statement_id:
            continue
        subject = _s(row.get("subject")).strip()
        obj = _s(row.get("object")).strip()
        predicate = _s(row.get("predicate_term")).strip()
        label = _s(row.get("rationale")).strip() or (
            f"{subject} —{predicate}→ {obj}" if subject or obj else statement_id
        )
        provenance = _provenance(
            row,
            {
                "review": "review",
                "conversation_id": "conversationId",
                "user_message_id": "userMessageId",
                "assistant_message_id": "assistantMessageId",
                "card_id": "cardId",
                "correlation_id": "correlationId",
                "updated_at": "updatedAt",
            },
        )
        source_ref = _s(row.get("correlation_id") or row.get("turn_id"))
        nodes.append(
            {
                "id": statement_id,
                "label": label,
                "kind": "statement",
                **({"sourceRef": source_ref} if source_ref else {}),
                "provenance": provenance,
                "visual": {"nodeClass": "statement", "x": None, "y": None},
            }
        )

        # The reified statement's OWN stored endpoint references become its two
        # rendered edges — exactly the stored subject/predicate/object fields,
        # only when the referenced resource actually exists in this projection.
        edge_class = "semantic_relation" if predicate else "unknown_relation"
        if subject and subject in resource_ids:
            edges.append(
                {
                    "id": f"{statement_id}|subj",
                    "source": subject,
                    "target": statement_id,
                    "label": predicate or "statement",
                    **({"predicate": predicate} if predicate else {}),
                    **({"sourceRef": source_ref} if source_ref else {}),
                    "provenance": provenance,
                    "visual": {"edgeClass": edge_class, "directed": True},
                }
            )
        if obj and obj in resource_ids:
            edges.append(
                {
                    "id": f"{statement_id}|obj",
                    "source": statement_id,
                    "target": obj,
                    "label": predicate or "statement",
                    **({"predicate": predicate} if predicate else {}),
                    **({"sourceRef": source_ref} if source_ref else {}),
                    "provenance": provenance,
                    "visual": {"edgeClass": edge_class, "directed": True},
                }
            )

    for row in relation_rows:
        source = _s(row.get("from")).strip()
        target = _s(row.get("to")).strip()
        if not source or not target:
            continue
        if source not in resource_ids or target not in resource_ids:
            continue
        predicate = _s(row.get("predicate")).strip() or _CO_OCCURRENCE_PREDICATE
        if predicate == _CO_OCCURRENCE_PREDICATE:
            edge_class, directed = "co_occurrence", False
        else:
            edge_class, directed = "unknown_relation", True
        edges.append(
            {
                "id": f"{source}|co|{target}",
                "source": source,
                "target": target,
                "label": predicate,
                "predicate": predicate,
                **(
                    {"sourceRef": _s(row.get("correlation_id"))}
                    if _s(row.get("correlation_id"))
                    else {}
                ),
                "provenance": _provenance(
                    row,
                    {
                        "observation_count": "observationCount",
                        "first_observed": "firstObserved",
                        "last_observed": "lastObserved",
                        "card_id": "cardId",
                        "correlation_id": "correlationId",
                    },
                ),
                "visual": {"edgeClass": edge_class, "directed": directed},
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
    ThinkGraphProjectionV1. Raises honestly on DB errors — no fallback."""
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
                RETURN {{ id: n.id, label: n.label, kind: 'resource',
                          turn_id: n.last_turn_id, conversation_id: n.conversation_id,
                          user_message_id: n.source_user_message_id,
                          assistant_message_id: n.source_assistant_message_id,
                          card_id: n.card_id, correlation_id: n.correlation_id,
                          updated_at: n.updated_at }} AS row
                LIMIT {bounded_limit}
                """,
                {"projectId": cleaned_project},
            )
            statement_rows = _cypher_rows(
                cur,
                f"""
                MATCH (st:Statement {{project_id: $projectId}})
                RETURN {{ id: st.id, subject: st.subject, predicate_term: st.predicate_term,
                          object: st.object, review: st.review, rationale: st.rationale,
                          turn_id: st.turn_id, conversation_id: st.conversation_id,
                          user_message_id: st.source_user_message_id,
                          assistant_message_id: st.source_assistant_message_id,
                          card_id: st.card_id, correlation_id: st.correlation_id,
                          updated_at: st.updated_at }} AS row
                LIMIT {bounded_limit}
                """,
                {"projectId": cleaned_project},
            )
            relation_rows = _cypher_rows(
                cur,
                f"""
                MATCH (a:Resource {{project_id: $projectId}})-[r:CO_OCCURRED_WITH]->(b:Resource {{project_id: $projectId}})
                RETURN {{ from: a.id, to: b.id, predicate: 'co_occurred_with',
                          observation_count: r.observation_count,
                          first_observed: r.first_observed, last_observed: r.last_observed,
                          card_id: r.card_id, correlation_id: r.correlation_id }} AS row
                LIMIT {bounded_limit * 4}
                """,
                {"projectId": cleaned_project},
            )

    return assemble_projection(cleaned_project, resource_rows, statement_rows, relation_rows)
