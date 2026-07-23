"""Compact Apache AGE context references for one agent handoff.

AgentGraph owns importance, cross-authority references, handoff identity, and
result lineage only. ThinkGraph owns persisted Graph View identity. CodeGraph
reference expansion is discovery-only; deliberate selection must already have
been persisted through ThinkGraph before AgentGraph can reference it.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
from datetime import datetime, timezone
from typing import Any, Callable

from app.python_models.postgres import connect_postgres


AGENTGRAPH_NAME = "agentgraph"
_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$")
_AUTHORITIES = {"thinkgraph", "knowgraph", "codegraph"}
_ITEM_KINDS = {"finding", "decision", "entity", "constraint", "question"}
_RELATIONSHIPS = {
    "SUPPORTS",
    "USES",
    "DEPENDS_ON",
    "CONTRADICTS",
    "ANSWERS",
    "REQUIRES",
    "RELATES_TO",
}
_EXPAND_TOOLS = {
    "thinkgraph": "thinkgraph.get_graph_slice",
    "knowgraph": "knowgraph.query",
    "codegraph": "codegraph.search",
}
_MAX_ITEMS = 24
_MAX_RELATIONSHIPS = 48
_MAX_REFERENCES = 12
_MAX_PROPERTIES = 16
_MAX_TEXT = 500
_MAX_PROMPT = 4000


class AgentGraphError(ValueError):
    """Typed, user-visible AgentGraph contract failure."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _required_id(value: Any, field: str) -> str:
    text = str(value or "").strip()
    if not _ID.fullmatch(text):
        raise AgentGraphError(f"agentgraph_{field}_invalid")
    return text


def _text(value: Any, field: str, *, maximum: int = _MAX_TEXT, required: bool = True) -> str:
    text = str(value or "").strip()
    if (required and not text) or len(text) > maximum:
        raise AgentGraphError(f"agentgraph_{field}_invalid")
    return text


def _scalar_properties(value: Any, field: str) -> dict[str, str | int | float | bool]:
    if value is None:
        return {}
    if not isinstance(value, dict) or len(value) > _MAX_PROPERTIES:
        raise AgentGraphError(f"agentgraph_{field}_invalid")
    result: dict[str, str | int | float | bool] = {}
    for key, raw in value.items():
        name = _required_id(key, f"{field}_key")
        if not isinstance(raw, (str, int, float, bool)) or isinstance(raw, str) and len(raw) > _MAX_TEXT:
            raise AgentGraphError(f"agentgraph_{field}_scalar_required")
        result[name] = raw
    return result


def _agtype(value: Any) -> Any:
    if value is None or isinstance(value, (dict, list, int, float, bool)):
        return value
    text = str(value)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # AGE renders scalar text properties without JSON string quotes while
        # maps/lists remain JSON. Preserve that exact scalar value.
        return text


def _cypher(cursor: Any, statement: str, parameters: dict[str, Any], columns: tuple[str, ...]) -> list[tuple[Any, ...]]:
    declarations = ", ".join(f"{name} ag_catalog.agtype" for name in columns)
    selections = ", ".join(f"{name}::text" for name in columns)
    cursor.execute(
        f"""
        SELECT {selections}
        FROM ag_catalog.cypher(
          '{AGENTGRAPH_NAME}',
          $cypher${statement}$cypher$,
          %s::ag_catalog.agtype
        ) AS ({declarations})
        """,
        (json.dumps(parameters, separators=(",", ":")),),
    )
    return [tuple(_agtype(value) for value in row) for row in cursor.fetchall()]


def _configure_age(cursor: Any) -> None:
    cursor.execute("LOAD 'age'")
    cursor.execute('SET search_path = ag_catalog, "$user", public')
    cursor.execute("SELECT 1 FROM ag_catalog.ag_graph WHERE name = %s", (AGENTGRAPH_NAME,))
    if cursor.fetchone() is None:
        raise AgentGraphError("agentgraph_graph_missing: apply migration 003_create_agentgraph.sql")


def _default_graph_views(project_id: str, conversation_id: str) -> list[dict[str, Any]]:
    from app.python_models.thinkgraph_engraphis import get_thinkgraph

    return list(get_thinkgraph().graph_views(project_id, conversation_id).get("views") or [])


def _default_receiver_validator(project_id: str, deck_id: str, receiving_agent_id: str) -> None:
    from app import control_plane

    deck, _revision = control_plane._load_deck(project_id, deck_id)
    card = next(
        (node for node in deck.get("nodes") or [] if str(node.get("id") or "") == receiving_agent_id),
        None,
    )
    if not isinstance(card, dict):
        raise AgentGraphError(f"agentgraph_receiving_agent_not_found: {receiving_agent_id}")
    if str(card.get("kind") or "") != "agent" or card.get("enabled") is False:
        raise AgentGraphError(f"agentgraph_receiving_agent_invalid: {receiving_agent_id}")


def _resolved_view(
    views: list[dict[str, Any]],
    *,
    authority: str,
    canonical_id: str,
) -> dict[str, Any]:
    view = next(
        (
            candidate
            for candidate in views
            if str(candidate.get("viewId") or "") == canonical_id
            and str(candidate.get("authority") or "") == authority
        ),
        None,
    )
    if not isinstance(view, dict):
        raise AgentGraphError(
            f"agentgraph_reference_not_found: authority={authority} canonical_id={canonical_id}"
        )
    return view


def _validate_proposal(
    proposal: dict[str, Any],
    *,
    project_id: str,
    conversation_id: str,
    graph_view_reader: Callable[[str, str], list[dict[str, Any]]],
) -> dict[str, Any]:
    allowed = {
        "prompt",
        "promptRef",
        "items",
        "relationships",
        "references",
        "priorContextId",
        "producingRunId",
    }
    unknown = sorted(set(proposal) - allowed)
    if unknown:
        raise AgentGraphError(f"agentgraph_proposal_fields_rejected: {','.join(unknown)}")
    prompt = _text(proposal.get("prompt"), "prompt", maximum=_MAX_PROMPT, required=False)
    prompt_ref = _text(proposal.get("promptRef"), "prompt_ref", required=False)
    if not prompt and not prompt_ref:
        raise AgentGraphError("agentgraph_prompt_or_prompt_ref_required")

    raw_items = proposal.get("items")
    if not isinstance(raw_items, list) or not 1 <= len(raw_items) <= _MAX_ITEMS:
        raise AgentGraphError("agentgraph_items_must_contain_1_to_24_items")
    items: list[dict[str, Any]] = []
    local_ids: set[str] = set()
    for raw in raw_items:
        if not isinstance(raw, dict) or set(raw) - {"id", "kind", "text", "properties"}:
            raise AgentGraphError("agentgraph_item_shape_invalid")
        local_id = _required_id(raw.get("id"), "item_id")
        if local_id in local_ids:
            raise AgentGraphError(f"agentgraph_duplicate_local_id: {local_id}")
        kind = str(raw.get("kind") or "").strip().lower()
        if kind not in _ITEM_KINDS:
            raise AgentGraphError(f"agentgraph_item_kind_invalid: {kind}")
        local_ids.add(local_id)
        items.append(
            {
                "localId": local_id,
                "kind": kind,
                "text": _text(raw.get("text"), "item_text"),
                "properties": _scalar_properties(raw.get("properties"), "item_properties"),
            }
        )

    raw_references = proposal.get("references")
    if not isinstance(raw_references, list) or not 1 <= len(raw_references) <= _MAX_REFERENCES:
        raise AgentGraphError("agentgraph_references_must_contain_1_to_12_items")
    views = graph_view_reader(project_id, conversation_id)
    references: list[dict[str, Any]] = []
    for raw in raw_references:
        if not isinstance(raw, dict) or set(raw) - {"id", "authority", "canonicalId"}:
            raise AgentGraphError("agentgraph_reference_shape_invalid")
        local_id = _required_id(raw.get("id"), "reference_id")
        if local_id in local_ids:
            raise AgentGraphError(f"agentgraph_duplicate_local_id: {local_id}")
        authority = str(raw.get("authority") or "").strip().lower()
        if authority not in _AUTHORITIES:
            raise AgentGraphError(f"agentgraph_reference_authority_invalid: {authority}")
        canonical_id = _text(raw.get("canonicalId"), "reference_canonical_id")
        _resolved_view(views, authority=authority, canonical_id=canonical_id)
        local_ids.add(local_id)
        references.append(
            {
                "localId": local_id,
                "authority": authority,
                "canonicalId": canonical_id,
                "expandTool": _EXPAND_TOOLS[authority],
            }
        )

    raw_relationships = proposal.get("relationships")
    if not isinstance(raw_relationships, list) or not 1 <= len(raw_relationships) <= _MAX_RELATIONSHIPS:
        raise AgentGraphError("agentgraph_relationships_must_contain_1_to_48_items")
    relationships: list[dict[str, str]] = []
    for raw in raw_relationships:
        if not isinstance(raw, dict) or set(raw) - {"source", "target", "type"}:
            raise AgentGraphError("agentgraph_relationship_shape_invalid")
        source = _required_id(raw.get("source"), "relationship_source")
        target = _required_id(raw.get("target"), "relationship_target")
        predicate = str(raw.get("type") or "").strip().upper()
        if source not in local_ids or target not in local_ids or source == target:
            raise AgentGraphError("agentgraph_relationship_endpoint_invalid")
        if predicate not in _RELATIONSHIPS:
            raise AgentGraphError(f"agentgraph_relationship_type_invalid: {predicate}")
        relationships.append({"source": source, "target": target, "type": predicate})

    return {
        "prompt": prompt,
        "promptRef": prompt_ref,
        "items": items,
        "references": references,
        "relationships": relationships,
        "priorContextId": _text(proposal.get("priorContextId"), "prior_context_id", required=False),
        "producingRunId": _text(proposal.get("producingRunId"), "producing_run_id", required=False),
    }


def create_context(
    *,
    project_id: str,
    deck_id: str,
    conversation_id: str,
    receiving_agent_id: str,
    proposal: dict[str, Any],
    graph_view_reader: Callable[[str, str], list[dict[str, Any]]] = _default_graph_views,
    receiver_validator: Callable[[str, str, str], None] = _default_receiver_validator,
    conn: Any | None = None,
) -> dict[str, Any]:
    project_id = _text(project_id, "project_id")
    deck_id = _text(deck_id, "deck_id")
    conversation_id = _text(conversation_id, "conversation_id")
    receiving_agent_id = _required_id(receiving_agent_id, "receiving_agent_id")
    if not isinstance(proposal, dict):
        raise AgentGraphError("agentgraph_proposal_object_required")
    receiver_validator(project_id, deck_id, receiving_agent_id)
    validated = _validate_proposal(
        proposal,
        project_id=project_id,
        conversation_id=conversation_id,
        graph_view_reader=graph_view_reader,
    )
    context_id = f"agentctx:{hashlib.sha256(f'{project_id}|{conversation_id}|{receiving_agent_id}|{_now()}'.encode()).hexdigest()[:24]}"
    created_at = _now()
    own = conn is None
    connection = conn or connect_postgres(autocommit=False)
    try:
        with connection.cursor() as cursor:
            _configure_age(cursor)
            cursor.execute("SELECT 1 FROM ag_catalog.projects WHERE id::text = %s", (project_id,))
            if cursor.fetchone() is None:
                raise AgentGraphError(f"agentgraph_project_not_found: {project_id}")
            _cypher(
                cursor,
                """
                CREATE (c:AgentContext {
                  context_id: $context_id,
                  project_id: $project_id,
                  deck_id: $deck_id,
                  conversation_id: $conversation_id,
                  receiving_agent_id: $receiving_agent_id,
                  prompt: $prompt,
                  prompt_ref: $prompt_ref,
                  producing_run_id: $producing_run_id,
                  created_at: $created_at
                })
                RETURN c.context_id AS value
                """,
                {
                    "context_id": context_id,
                    "project_id": project_id,
                    "deck_id": deck_id,
                    "conversation_id": conversation_id,
                    "receiving_agent_id": receiving_agent_id,
                    "prompt": validated["prompt"],
                    "prompt_ref": validated["promptRef"],
                    "producing_run_id": validated["producingRunId"],
                    "created_at": created_at,
                },
                ("value",),
            )
            _cypher(
                cursor,
                """
                MATCH (c:AgentContext {context_id: $context_id})
                MERGE (a:Agent {project_id: $project_id, agent_id: $agent_id})
                MERGE (c)-[:SENT_TO]->(a)
                RETURN a.agent_id AS value
                """,
                {"context_id": context_id, "project_id": project_id, "agent_id": receiving_agent_id},
                ("value",),
            )
            persisted_ids: dict[str, str] = {}
            for item in validated["items"]:
                item_id = f"{context_id}:item:{item['localId']}"
                persisted_ids[item["localId"]] = item_id
                _cypher(
                    cursor,
                    """
                    MATCH (c:AgentContext {context_id: $context_id})
                    CREATE (i:ContextItem {
                      item_id: $item_id,
                      local_id: $local_id,
                      context_id: $context_id,
                      kind: $kind,
                      text: $text,
                      properties_json: $properties_json
                    })
                    MERGE (c)-[:HAS_ITEM]->(i)
                    RETURN i.item_id AS value
                    """,
                    {
                        "context_id": context_id,
                        "item_id": item_id,
                        "local_id": item["localId"],
                        "kind": item["kind"],
                        "text": item["text"],
                        "properties_json": json.dumps(item["properties"], separators=(",", ":")),
                    },
                    ("value",),
                )
            reference_ids: list[str] = []
            for reference in validated["references"]:
                reference_id = "agentref:" + hashlib.sha256(
                    f"{context_id}|{reference['authority']}|{reference['canonicalId']}".encode()
                ).hexdigest()[:24]
                reference_ids.append(reference_id)
                persisted_ids[reference["localId"]] = reference_id
                _cypher(
                    cursor,
                    """
                    MATCH (c:AgentContext {context_id: $context_id})
                    CREATE (r:Reference {
                      reference_id: $reference_id,
                      local_id: $local_id,
                      context_id: $context_id,
                      project_id: $project_id,
                      conversation_id: $conversation_id,
                      authority: $authority,
                      canonical_id: $canonical_id,
                      expand_tool: $expand_tool
                    })
                    MERGE (c)-[:HAS_REFERENCE]->(r)
                    RETURN r.reference_id AS value
                    """,
                    {
                        "context_id": context_id,
                        "reference_id": reference_id,
                        "local_id": reference["localId"],
                        "project_id": project_id,
                        "conversation_id": conversation_id,
                        "authority": reference["authority"],
                        "canonical_id": reference["canonicalId"],
                        "expand_tool": reference["expandTool"],
                    },
                    ("value",),
                )
            for relationship in validated["relationships"]:
                predicate = relationship["type"]
                _cypher(
                    cursor,
                    f"""
                    MATCH (a), (b)
                    WHERE (a.item_id = $source_id OR a.reference_id = $source_id)
                      AND (b.item_id = $target_id OR b.reference_id = $target_id)
                    CREATE (a)-[r:{predicate} {{context_id: $context_id}}]->(b)
                    RETURN type(r) AS value
                    """,
                    {
                        "context_id": context_id,
                        "source_id": persisted_ids[relationship["source"]],
                        "target_id": persisted_ids[relationship["target"]],
                    },
                    ("value",),
                )
            prior_context_id = validated["priorContextId"]
            if prior_context_id:
                rows = _cypher(
                    cursor,
                    """
                    MATCH (c:AgentContext {context_id: $context_id}),
                          (p:AgentContext {context_id: $prior_context_id})
                    WHERE p.project_id = $project_id
                    MERGE (c)-[:DERIVED_FROM]->(p)
                    RETURN p.context_id AS value
                    """,
                    {
                        "context_id": context_id,
                        "prior_context_id": prior_context_id,
                        "project_id": project_id,
                    },
                    ("value",),
                )
                if not rows:
                    raise AgentGraphError(f"agentgraph_prior_context_not_found: {prior_context_id}")
        if own:
            connection.commit()
    except Exception:
        if own:
            connection.rollback()
        raise
    finally:
        if own:
            connection.close()
    return {
        "ok": True,
        "contextId": context_id,
        "projectId": project_id,
        "conversationId": conversation_id,
        "receivingAgentId": receiving_agent_id,
        "referenceIds": reference_ids,
    }


def _context_rows(
    context_id: str,
    project_id: str,
    *,
    conn: Any | None = None,
) -> dict[str, Any]:
    own = conn is None
    connection = conn or connect_postgres()
    try:
        with connection.cursor() as cursor:
            _configure_age(cursor)
            context_rows = _cypher(
                cursor,
                """
                MATCH (c:AgentContext {context_id: $context_id})
                WHERE c.project_id = $project_id
                RETURN properties(c) AS value
                """,
                {"context_id": context_id, "project_id": project_id},
                ("value",),
            )
            if not context_rows:
                raise AgentGraphError(f"agentgraph_context_not_found: {context_id}")
            item_rows = _cypher(
                cursor,
                """
                MATCH (c:AgentContext {context_id: $context_id})-[:HAS_ITEM]->(i:ContextItem)
                RETURN properties(i) AS value
                """,
                {"context_id": context_id},
                ("value",),
            )
            reference_rows = _cypher(
                cursor,
                """
                MATCH (c:AgentContext {context_id: $context_id})-[:HAS_REFERENCE]->(r:Reference)
                RETURN properties(r) AS value
                """,
                {"context_id": context_id},
                ("value",),
            )
            relationship_rows = _cypher(
                cursor,
                """
                MATCH (a)-[r]->(b)
                WHERE r.context_id = $context_id
                RETURN properties(a) AS source, type(r) AS predicate, properties(b) AS target
                """,
                {"context_id": context_id},
                ("source", "predicate", "target"),
            )
            agent_rows = _cypher(
                cursor,
                """
                MATCH (c:AgentContext {context_id: $context_id})-[:SENT_TO]->(a:Agent)
                RETURN properties(a) AS value
                """,
                {"context_id": context_id},
                ("value",),
            )
            result_rows = _cypher(
                cursor,
                """
                MATCH (c:AgentContext {context_id: $context_id})-[:PRODUCED]->(r:Result)
                RETURN properties(r) AS value
                """,
                {"context_id": context_id},
                ("value",),
            )
    finally:
        if own:
            connection.close()
    return {
        "context": context_rows[0][0],
        "items": [row[0] for row in item_rows],
        "references": [row[0] for row in reference_rows],
        "relationships": [
            {"source": row[0], "type": row[1], "target": row[2]} for row in relationship_rows
        ],
        "agent": agent_rows[0][0] if agent_rows else {},
        "results": [row[0] for row in result_rows],
    }


def _expansion_for_view(reference: dict[str, Any], view: dict[str, Any]) -> dict[str, Any]:
    authority = str(reference["authority"])
    if authority == "codegraph":
        return {
            "tool": "codegraph.search",
            "arguments": {
                "projectId": reference["project_id"],
                "conversationId": reference["conversation_id"],
                "query": str(view.get("query") or reference["canonical_id"]),
                "canonicalRefs": list(view.get("rootCanonicalNodeIds") or [])[:20],
                "limit": min(20, max(1, len(view.get("includedCanonicalNodeIds") or []) or 15)),
            },
        }
    if authority == "knowgraph":
        return {
            "tool": "knowgraph.query",
            "arguments": {
                "projectId": reference["project_id"],
                "conversationId": reference["conversation_id"],
                "query": str(view.get("query") or reference["canonical_id"]),
                "anchors": list(view.get("rootCanonicalNodeIds") or [])[:12],
                "maxResults": 5,
                "parentViewId": reference["canonical_id"],
            },
        }
    return {
        "tool": "thinkgraph.get_graph_slice",
        "arguments": {"projectId": reference["project_id"], "limit": 50},
    }


def _node_name(properties: dict[str, Any]) -> str:
    if properties.get("reference_id"):
        return f"Reference:{properties['reference_id']}"
    return f"{str(properties.get('kind') or 'item').title()}:{properties.get('text')}"


def _render_literate(rows: dict[str, Any]) -> str:
    context = rows["context"]
    references = {str(reference["reference_id"]): reference for reference in rows["references"]}
    lines = [
        f"[CONTEXT {context['context_id']}]",
        f"project = {context['project_id']} | conversation = {context['conversation_id']}",
        f"prompt reference = {context.get('prompt_ref') or 'inline'}",
    ]
    for relationship in rows["relationships"]:
        lines.append(
            f"({_node_name(relationship['source'])})-[:{relationship['type']}]->({_node_name(relationship['target'])})"
        )
    lines.append(f"(Context:{context['context_id']})-[:SENT_TO]->(Agent:{rows['agent'].get('agent_id')})")
    for reference in references.values():
        expansion = reference["expansion"]
        lines.extend(
            [
                "",
                f"Reference {reference['reference_id']}:",
                f"  authority = {reference['authority']}",
                f"  canonical view = {reference['canonical_id']}",
                f"  expand with = {expansion['tool']}",
                f"  arguments = {json.dumps(expansion['arguments'], separators=(',', ':'))}",
            ]
        )
    return "\n".join(lines)


def read_context(
    context_id: str,
    project_id: str,
    *,
    graph_view_reader: Callable[[str, str], list[dict[str, Any]]] = _default_graph_views,
    conn: Any | None = None,
) -> dict[str, Any]:
    context_id = _text(context_id, "context_id")
    project_id = _text(project_id, "project_id")
    rows = _context_rows(context_id, project_id, conn=conn)
    views = graph_view_reader(project_id, str(rows["context"]["conversation_id"]))
    for reference in rows["references"]:
        view = _resolved_view(
            views,
            authority=str(reference["authority"]),
            canonical_id=str(reference["canonical_id"]),
        )
        reference["expansion"] = _expansion_for_view(reference, view)
    return {
        "ok": True,
        "contextId": context_id,
        "projectId": project_id,
        "conversationId": rows["context"]["conversation_id"],
        "receivingAgentId": rows["agent"].get("agent_id"),
        "literateQueryView": _render_literate(rows),
        "items": rows["items"],
        "relationships": rows["relationships"],
        "references": rows["references"],
        "results": rows["results"],
    }


def record_result(
    *,
    context_id: str,
    project_id: str,
    result_id: str,
    run_id: str,
    status: str,
    result_ref: str = "",
    conn: Any | None = None,
) -> dict[str, Any]:
    context_id = _text(context_id, "context_id")
    project_id = _text(project_id, "project_id")
    result_id = _required_id(result_id, "result_id")
    run_id = _text(run_id, "result_run_id")
    status = _text(status, "result_status")
    result_ref = _text(result_ref, "result_ref", required=False)
    own = conn is None
    connection = conn or connect_postgres(autocommit=False)
    try:
        with connection.cursor() as cursor:
            _configure_age(cursor)
            rows = _cypher(
                cursor,
                """
                MATCH (c:AgentContext {context_id: $context_id})
                WHERE c.project_id = $project_id
                MERGE (r:Result {result_id: $result_id})
                SET r.run_id = $run_id,
                    r.status = $status,
                    r.result_ref = $result_ref,
                    r.created_at = $created_at
                MERGE (c)-[:PRODUCED]->(r)
                RETURN r.result_id AS value
                """,
                {
                    "context_id": context_id,
                    "project_id": project_id,
                    "result_id": result_id,
                    "run_id": run_id,
                    "status": status,
                    "result_ref": result_ref,
                    "created_at": _now(),
                },
                ("value",),
            )
            if not rows:
                raise AgentGraphError(f"agentgraph_context_not_found: {context_id}")
        if own:
            connection.commit()
    except Exception:
        if own:
            connection.rollback()
        raise
    finally:
        if own:
            connection.close()
    return {"ok": True, "contextId": context_id, "resultId": result_id}


async def expand_reference(
    reference_id: str,
    project_id: str,
    *,
    graph_view_reader: Callable[[str, str], list[dict[str, Any]]] = _default_graph_views,
    conn: Any | None = None,
) -> dict[str, Any]:
    reference_id = _text(reference_id, "reference_id")
    project_id = _text(project_id, "project_id")
    own = conn is None
    connection = conn or connect_postgres()
    try:
        with connection.cursor() as cursor:
            _configure_age(cursor)
            rows = _cypher(
                cursor,
                """
                MATCH (c:AgentContext)-[:HAS_REFERENCE]->(r:Reference {reference_id: $reference_id})
                WHERE c.project_id = $project_id
                RETURN properties(r) AS reference
                """,
                {"reference_id": reference_id, "project_id": project_id},
                ("reference",),
            )
    finally:
        if own:
            connection.close()
    if not rows:
        raise AgentGraphError(f"agentgraph_reference_not_found: {reference_id}")
    reference = rows[0][0]
    views = await asyncio.to_thread(
        graph_view_reader,
        project_id,
        str(reference["conversation_id"]),
    )
    view = _resolved_view(
        views,
        authority=str(reference["authority"]),
        canonical_id=str(reference["canonical_id"]),
    )
    expansion = _expansion_for_view(reference, view)
    authority = str(reference["authority"])
    if authority == "thinkgraph":
        result: dict[str, Any] = {"view": view}
    elif authority == "knowgraph":
        from app.python_models.tool_registry import retrieve_knowgraph_context_tool

        args = expansion["arguments"]
        result = await retrieve_knowgraph_context_tool(
            project_id=str(args["projectId"]),
            conversation_id=str(args["conversationId"]),
            query=str(args["query"]),
            anchors=[str(value) for value in args["anchors"]],
            max_results=int(args["maxResults"]),
            parent_view_id=str(args["parentViewId"]),
        )
    else:
        from app import control_plane

        result = await asyncio.to_thread(
            control_plane._backend_json,
            "POST",
            "/api/coder/mcp-bridge/codegraph_search",
            expansion["arguments"],
        )
    if not isinstance(result, dict) or result.get("ok") is False:
        detail = result.get("error") if isinstance(result, dict) else "invalid_result"
        raise AgentGraphError(f"agentgraph_reference_expansion_failed: {detail}")
    return {
        "ok": True,
        "referenceId": reference_id,
        "authority": authority,
        "canonicalId": reference["canonical_id"],
        "delegatedTool": expansion["tool"],
        "result": result,
    }
