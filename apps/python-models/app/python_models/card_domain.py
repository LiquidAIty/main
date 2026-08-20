"""Stable Card/deck authority and transient runtime-input preparation.

PostgreSQL owns stable Project, Deck, Card revision, runtime, grants, layout, and
Run identities. AGE owns Card relationships. Dynamic communication
is materialized and validated in memory and is never written by this module.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from hashlib import sha256
from typing import Any
from uuid import uuid4

from psycopg.rows import dict_row

from app.python_models.idd import (
    IddValidationError,
    load_input_data_dictionary,
    materialize_tool_catalog,
    tool_access,
    validate_record,
)
from app.python_models.idf import materialize_idf
from app.python_models.data_anchor import DataAnchorError, resolve_data_anchors
from app.python_models.postgres import connect_postgres
from app.python_models.tool_registry import tool_manifest


class CardDomainError(ValueError):
    """Typed failure at the stable Card/transient communication boundary."""


GRANT_FIELDS = {
    "tool": "tools",
    "native_tool": "nativeTools",
    "skill": "skills",
    "toolset": "toolsets",
    "mcp_connection": "mcpConnectionIds",
}
KNOWN_RUNTIME_OPTION_FIELDS = {
    "tools", "nativeTools", "skills", "toolsets", "mcpConnectionIds",
    "provider", "modelKey", "providerModelId", "accessMode", "reasoningEffort",
    "temperature", "maxTokens", "maxTurns", "enabled",
}
KNOWN_CARD_FIELDS = {
    "id", "kind", "templateId", "title", "subtitle", "role", "status",
    "parentGraphId", "prompt", "outputContract", "runtime",
    "runtimeOptions", "provider", "providerModelId",
    "enabled", "position",
    "_cardRevisionId", "_cardRevision", "_cardRevisionSha256",
}


def _edge_labels() -> dict[str, str]:
    """Read the one literal IDD relationship vocabulary mechanically."""
    return {
        str(item["canvasValue"]): str(item["name"])
        for item in load_input_data_dictionary()["relationships"]
    }


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _required_text(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise CardDomainError(f"{field}_required")
    return value.strip()


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _sha(value: str) -> str:
    return sha256(value.encode("utf-8")).hexdigest()


def _json_object(value: Any, field: str) -> dict[str, Any]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise CardDomainError(f"{field}_invalid")
    return dict(value)


def _string_list(value: Any, field: str) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise CardDomainError(f"{field}_invalid")
    result: list[str] = []
    seen: set[str] = set()
    for item in value:
        text = _required_text(item, field)
        if text in seen:
            raise CardDomainError(f"{field}_duplicate:{text}")
        seen.add(text)
        result.append(text)
    return result


def _card_runtime(card: dict[str, Any]) -> dict[str, str]:
    runtime = _json_object(card.get("runtime"), "card_runtime")
    unknown = set(runtime) - {"kind", "mode", "profile"}
    if unknown:
        raise CardDomainError(f"card_runtime_fields_unsupported:{','.join(sorted(unknown))}")
    kind = _required_text(runtime.get("kind"), "runtime_kind")
    mode = _required_text(runtime.get("mode"), "runtime_mode")
    if kind == "hermes":
        if mode not in {"main", "delegate", "kanban"}:
            raise CardDomainError(f"hermes_runtime_mode_unsupported:{mode}")
        return {
            "kind": kind,
            "mode": mode,
            "profile": _required_text(runtime.get("profile"), "runtime_profile"),
        }
    if kind == "autogen":
        if mode not in {"assistant", "magentic_one"}:
            raise CardDomainError(f"autogen_runtime_mode_unsupported:{mode}")
        if runtime.get("profile") is not None:
            raise CardDomainError("autogen_runtime_profile_forbidden")
        return {"kind": kind, "mode": mode}
    raise CardDomainError(f"runtime_kind_unsupported:{kind}")


def _resolve_project(cursor: Any, project_id: str) -> dict[str, Any]:
    cursor.execute(
        """
        SELECT id, code, project_type
        FROM ag_catalog.projects
        WHERE id::text = %s OR code = %s
        ORDER BY CASE WHEN id::text = %s THEN 0 ELSE 1 END
        LIMIT 1
        """,
        (project_id, project_id, project_id),
    )
    row = cursor.fetchone()
    if row is None:
        raise CardDomainError("project_not_found")
    return dict(row)


def _age_rows(cursor: Any, query: str, params: dict[str, Any], columns: str) -> list[dict[str, Any]]:
    # AGE requires the Cypher source to be a SQL literal. Callers select from
    # fixed queries only; runtime values travel through the agtype parameter.
    statement = (
        "SELECT * FROM ag_catalog.cypher('agentgraph', $age$"
        + query
        + "$age$, %s::agtype) AS ("
        + columns
        + ")"
    )
    cursor.execute(statement, (_canonical_json(params),))
    rows: list[dict[str, Any]] = []
    for row in cursor.fetchall():
        converted: dict[str, Any] = {}
        for key, value in dict(row).items():
            raw = str(value)
            try:
                converted[key] = json.loads(raw)
            except json.JSONDecodeError:
                converted[key] = raw
        rows.append(converted)
    return rows


def _ensure_age_card(cursor: Any, project_id: str, deck_id: str, card_id: str) -> None:
    _age_rows(
        cursor,
        """
        MERGE (card:Card {projectId: $projectId, deckId: $deckId, cardId: $cardId})
        RETURN properties(card)
        """,
        {"projectId": project_id, "deckId": deck_id, "cardId": card_id},
        "value agtype",
    )


def _edge_core(edge: dict[str, Any]) -> dict[str, Any]:
    edge_type = _required_text(edge.get("edgeType"), "edge_type")
    if edge_type not in _edge_labels():
        raise CardDomainError(f"edge_type_unsupported:{edge_type}")
    edge_id = _required_text(edge.get("id"), "edge_id")
    source = _required_text(edge.get("source"), "edge_source")
    target = _required_text(edge.get("target"), "edge_target")
    presentation = {
        key: value for key, value in edge.items()
        if key not in {"id", "source", "target", "edgeType", "sourceHandle", "targetHandle"}
    }
    return {
        "id": edge_id,
        "source": source,
        "target": target,
        "edgeType": edge_type,
        "sourceHandle": edge.get("sourceHandle"),
        "targetHandle": edge.get("targetHandle"),
        "presentation": presentation,
    }


def _validated_deck_collections(
    document: dict[str, Any],
    deck_id: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """Validate one complete user-authored Deck document before any write."""
    if not isinstance(document, dict) or document.get("id") != deck_id:
        raise CardDomainError("deck_document_invalid")
    nodes = document.get("nodes")
    edges = document.get("edges")
    templates = document.get("promptTemplates")
    if not isinstance(nodes, list) or not isinstance(edges, list) or not isinstance(templates, list):
        raise CardDomainError("deck_document_invalid")

    node_ids: set[str] = set()
    for node in nodes:
        if not isinstance(node, dict):
            raise CardDomainError("deck_document_invalid")
        card_id = _required_text(node.get("id"), "card_id")
        if card_id in node_ids:
            raise CardDomainError(f"card_id_duplicate:{card_id}")
        node_ids.add(card_id)

    edge_ids: set[str] = set()
    for edge in edges:
        if not isinstance(edge, dict):
            raise CardDomainError("deck_document_invalid")
        core = _edge_core(edge)
        if core["id"] in edge_ids:
            raise CardDomainError(f"edge_id_duplicate:{core['id']}")
        edge_ids.add(core["id"])
        if core["source"] not in node_ids or core["target"] not in node_ids:
            raise CardDomainError(f"edge_endpoint_missing:{core['id']}")

    template_ids: set[str] = set()
    for template in templates:
        if not isinstance(template, dict):
            raise CardDomainError("deck_document_invalid")
        template_id = _required_text(template.get("id"), "template_id")
        if template_id in template_ids:
            raise CardDomainError(f"template_id_duplicate:{template_id}")
        template_ids.add(template_id)
    return nodes, edges, templates


def _upsert_age_edge(
    cursor: Any,
    project_id: str,
    deck_id: str,
    edge: dict[str, Any],
    ordinal: int,
) -> None:
    core = _edge_core(edge)
    label = _edge_labels()[core["edgeType"]]
    query = f"""
        MATCH (source:Card {{projectId: $projectId, deckId: $deckId, cardId: $source}})
        MATCH (target:Card {{projectId: $projectId, deckId: $deckId, cardId: $target}})
        MERGE (source)-[edge:{label} {{edgeId: $edgeId}}]->(target)
        SET edge.edgeType = $edgeType,
            edge.direction = 'source-to-target',
            edge.sourceHandle = $sourceHandle,
            edge.targetHandle = $targetHandle,
            edge.ordinal = $ordinal,
            edge.presentation = $presentation
        RETURN properties(edge)
    """
    rows = _age_rows(
        cursor,
        query,
        {
            "projectId": project_id,
            "deckId": deck_id,
            "source": core["source"],
            "target": core["target"],
            "edgeId": core["id"],
            "edgeType": core["edgeType"],
            "sourceHandle": core["sourceHandle"],
            "targetHandle": core["targetHandle"],
            "ordinal": ordinal,
            "presentation": core["presentation"],
        },
        "value agtype",
    )
    if len(rows) != 1:
        raise CardDomainError(f"age_edge_upsert_failed:{core['id']}")


def _delete_age_edge(cursor: Any, project_id: str, deck_id: str, edge: dict[str, Any]) -> None:
    core = _edge_core(edge)
    label = _edge_labels()[core["edgeType"]]
    rows = _age_rows(
        cursor,
        f"""
        MATCH (:Card {{projectId: $projectId, deckId: $deckId}})
              -[edge:{label} {{edgeId: $edgeId}}]->
              (:Card {{projectId: $projectId, deckId: $deckId}})
        DELETE edge
        RETURN $edgeId
        """,
        {"projectId": project_id, "deckId": deck_id, "edgeId": core["id"]},
        "value agtype",
    )
    if len(rows) != 1:
        raise CardDomainError(f"age_edge_delete_failed:{core['id']}")


def _load_age_edges(cursor: Any, project_id: str, deck_id: str) -> list[dict[str, Any]]:
    edges: list[dict[str, Any]] = []
    for edge_type, label in _edge_labels().items():
        rows = _age_rows(
            cursor,
            f"""
            MATCH (source:Card {{projectId: $projectId, deckId: $deckId}})
                  -[edge:{label}]->
                  (target:Card {{projectId: $projectId, deckId: $deckId}})
            RETURN source.cardId, target.cardId, properties(edge)
            """,
            {"projectId": project_id, "deckId": deck_id},
            "source agtype, target agtype, properties agtype",
        )
        for row in rows:
            props = row.get("properties") if isinstance(row.get("properties"), dict) else {}
            presentation = props.get("presentation") if isinstance(props.get("presentation"), dict) else {}
            value = {
                **presentation,
                "id": str(props.get("edgeId") or ""),
                "source": str(row.get("source") or ""),
                "target": str(row.get("target") or ""),
                "edgeType": edge_type,
            }
            if props.get("sourceHandle") is not None:
                value["sourceHandle"] = props["sourceHandle"]
            if props.get("targetHandle") is not None:
                value["targetHandle"] = props["targetHandle"]
            edges.append((int(props.get("ordinal") or 0), value))
    return [value for _, value in sorted(edges, key=lambda item: (item[0], item[1]["id"]))]


def _stable_card(card: dict[str, Any]) -> dict[str, Any]:
    options = _json_object(card.get("runtimeOptions"), "runtime_options")
    grants = {
        field: _string_list(options.get(field, card.get(field)), field)
        for field in GRANT_FIELDS.values()
    }
    extensions = {key: value for key, value in options.items() if key not in KNOWN_RUNTIME_OPTION_FIELDS}
    stable = {
        "cardId": _required_text(card.get("id"), "card_id"),
        "templateId": _required_text(card.get("templateId"), "template_id"),
        "kind": str(card.get("kind") or "agent"),
        "title": _required_text(card.get("title"), "card_title"),
        "subtitle": card.get("subtitle"),
        "role": card.get("role"),
        "status": card.get("status"),
        "parentGraphId": card.get("parentGraphId"),
        "basePrompt": str(card.get("prompt") or ""),
        "stableOutputContract": card.get("outputContract"),
        "runtime": _card_runtime(card),
        "provider": options.get("provider") or card.get("provider"),
        "modelKey": options.get("modelKey"),
        "providerModelId": options.get("providerModelId") or card.get("providerModelId"),
        "accessMode": options.get("accessMode"),
        "reasoningEffort": options.get("reasoningEffort"),
        "temperature": options.get("temperature"),
        "maxTokens": options.get("maxTokens"),
        "maxTurns": options.get("maxTurns"),
        "enabled": card.get("enabled", options.get("enabled", True)) is not False,
        "enabledLocation": (
            "card" if "enabled" in card
            else "runtime-options" if "enabled" in options
            else "default"
        ),
        "runtimeExtensions": extensions,
        "grants": grants,
        "presentationProperties": {
            key: value for key, value in card.items() if key not in KNOWN_CARD_FIELDS
        },
    }
    if stable["kind"] != "agent":
        raise CardDomainError("card_kind_unsupported")
    return stable


def _insert_revision(
    cursor: Any,
    project_id: str,
    deck_id: str,
    card: dict[str, Any],
    revision_number: int,
) -> str:
    stable = _stable_card(card)
    revision_id = str(uuid4())
    revision_sha = _sha(_canonical_json(stable))
    cursor.execute(
        """
        INSERT INTO ag_catalog.agent_card_revisions (
          revision_id, project_id, deck_id, card_id, revision_number,
          template_id, kind, title, subtitle, role, status, parent_graph_id,
          base_prompt, base_prompt_sha256, stable_output_contract,
          runtime_kind, runtime_mode, runtime_profile, provider, model_key, provider_model_id,
          access_mode, reasoning_effort, temperature, max_tokens, max_turns,
          enabled, enabled_location, runtime_extension_config, revision_sha256
        ) VALUES (
          %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
          %s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s
        )
        """,
        (
            revision_id, project_id, deck_id, stable["cardId"], revision_number,
            stable["templateId"], stable["kind"], stable["title"], stable["subtitle"],
            stable["role"], stable["status"], stable["parentGraphId"], stable["basePrompt"],
            _sha(stable["basePrompt"]), stable["stableOutputContract"], stable["runtime"]["kind"],
            stable["runtime"]["mode"], stable["runtime"].get("profile"),
            stable["provider"], stable["modelKey"],
            stable["providerModelId"], stable["accessMode"], stable["reasoningEffort"],
            stable["temperature"], stable["maxTokens"], stable["maxTurns"],
            stable["enabled"], stable["enabledLocation"],
            _canonical_json(stable["runtimeExtensions"]), revision_sha,
        ),
    )
    for grant_kind, field in GRANT_FIELDS.items():
        for ordinal, grant_id in enumerate(stable["grants"][field]):
            cursor.execute(
                """
                INSERT INTO ag_catalog.card_capability_grants
                  (revision_id, grant_kind, ordinal, grant_id)
                VALUES (%s,%s,%s,%s)
                """,
                (revision_id, grant_kind, ordinal, grant_id),
            )
    return revision_id


def _load_deck_with_cursor(
    cursor: Any,
    project_ref: str,
    deck_id: str,
    *,
    include_internal: bool = False,
) -> dict[str, Any]:
    project = _resolve_project(cursor, project_ref)
    project_id = str(project["id"])
    cursor.execute(
        "SELECT * FROM ag_catalog.agent_decks WHERE project_id=%s AND deck_id=%s",
        (project_id, deck_id),
    )
    deck_row = cursor.fetchone()
    if deck_row is None:
        raise CardDomainError("deck_not_found")
    cursor.execute(
        """
        SELECT revision.*, membership.ordinal, membership.position_x, membership.position_y,
               membership.display_status, membership.presentation_config
        FROM ag_catalog.agent_cards AS card
        JOIN ag_catalog.agent_card_revisions AS revision
          ON revision.revision_id = card.current_revision_id
        JOIN ag_catalog.deck_card_memberships AS membership
          ON membership.project_id=card.project_id AND membership.deck_id=card.deck_id
         AND membership.card_id=card.card_id
        WHERE card.project_id=%s AND card.deck_id=%s
        ORDER BY membership.ordinal
        """,
        (project_id, deck_id),
    )
    rows = [dict(row) for row in cursor.fetchall()]
    revision_ids = [str(row["revision_id"]) for row in rows]
    grants_by_revision: dict[str, dict[str, list[str]]] = {
        revision_id: {field: [] for field in GRANT_FIELDS.values()}
        for revision_id in revision_ids
    }
    if revision_ids:
        cursor.execute(
            """
            SELECT revision_id, grant_kind, grant_id
            FROM ag_catalog.card_capability_grants
            WHERE revision_id = ANY(%s::uuid[])
            ORDER BY revision_id, grant_kind, ordinal
            """,
            (revision_ids,),
        )
        for grant in cursor.fetchall():
            grants_by_revision[str(grant["revision_id"])][GRANT_FIELDS[grant["grant_kind"]]].append(grant["grant_id"])
    nodes: list[dict[str, Any]] = []
    for row in rows:
        options = dict(row.get("runtime_extension_config") or {})
        for field, values in grants_by_revision[str(row["revision_id"])].items():
            if values:
                options[field] = values
        for key, column in (
            ("provider", "provider"), ("modelKey", "model_key"),
            ("providerModelId", "provider_model_id"), ("accessMode", "access_mode"),
            ("reasoningEffort", "reasoning_effort"), ("temperature", "temperature"),
            ("maxTokens", "max_tokens"), ("maxTurns", "max_turns"),
        ):
            if row.get(column) is not None:
                options[key] = row[column]
        presentation = dict(row.get("presentation_config") or {})
        node = {
            **presentation,
            "id": row["card_id"], "kind": row["kind"], "title": row["title"],
            "prompt": row["base_prompt"], "status": row.get("status") or row.get("display_status"),
            "position": {"x": float(row["position_x"]), "y": float(row["position_y"])},
            "subtitle": row.get("subtitle"), "templateId": row["template_id"],
            "runtime": {
                "kind": row["runtime_kind"],
                "mode": row["runtime_mode"],
                **({"profile": row["runtime_profile"]} if row.get("runtime_profile") else {}),
            },
            "parentGraphId": row.get("parent_graph_id"), "runtimeOptions": options,
        }
        if row.get("enabled_location") == "card":
            node["enabled"] = row.get("enabled") is not False
        elif row.get("enabled_location") == "runtime-options":
            options["enabled"] = row.get("enabled") is not False
        if row.get("role") is not None:
            node["role"] = row["role"]
        if row.get("stable_output_contract") is not None:
            node["outputContract"] = row["stable_output_contract"]
        if include_internal:
            node["_cardRevisionId"] = str(row["revision_id"])
            node["_cardRevision"] = int(row["revision_number"])
            node["_cardRevisionSha256"] = row["revision_sha256"]
        nodes.append(node)
    cursor.execute(
        """
        SELECT template_id, content FROM ag_catalog.deck_prompt_templates
        WHERE project_id=%s AND deck_id=%s ORDER BY ordinal
        """,
        (project_id, deck_id),
    )
    templates = [{"id": row["template_id"], "content": row["content"]} for row in cursor.fetchall()]
    return {
        "projectId": project_id,
        "deck": {
            "id": deck_row["deck_id"], "name": deck_row["name"],
            "version": int(deck_row["document_version"]),
            "workspaceRoot": deck_row.get("workspace_root"),
            "nodes": nodes, "edges": _load_age_edges(cursor, project_id, deck_id),
            "promptTemplates": templates,
        },
        "meta": {
            "deckRevision": deck_row["revision"],
            "deckSavedAt": deck_row["saved_at"].isoformat(),
        },
    }


def load_deck(project_ref: str, deck_id: str) -> dict[str, Any]:
    with connect_postgres() as connection, connection.cursor(row_factory=dict_row) as cursor:
        return _load_deck_with_cursor(cursor, project_ref, deck_id)


def observe_native_attention(event: dict[str, Any]) -> bool:
    """Observe one proven MCP native-reference result on the existing Run in AGE.

    This is deliberately fail-open for the tool caller: AGE observation never owns
    dispatch.  Missing or mismatched Run/Card identity produces no graph write.
    """
    project_id = str(event.get("projectId") or "").strip()
    deck_id = str(event.get("deckId") or "").strip()
    run_id = str(event.get("runId") or "").strip()
    card_id = str(event.get("cardId") or "").strip()
    event_id = str(event.get("eventId") or "").strip()
    tool_name = str(event.get("toolName") or "").strip()
    authority = str(event.get("authority") or "").strip()
    operation = str(event.get("operation") or "").strip()
    timestamp = str(event.get("timestamp") or "").strip()
    result_hash = str(event.get("resultHash") or "").strip()
    node_ids = [
        str(value).strip() for value in event.get("nativeNodeIds") or []
        if str(value).strip()
    ][:128]
    edge_ids = [
        str(value).strip() for value in event.get("nativeEdgeIds") or []
        if str(value).strip()
    ][:256]
    if not all((project_id, deck_id, run_id, card_id, event_id, tool_name, authority,
                operation, timestamp, result_hash)):
        return False
    references = [
        {"nativeId": native_id, "nativeKind": native_kind}
        for native_kind, native_ids in (("node", node_ids), ("edge", edge_ids))
        for native_id in native_ids
    ]
    if not references:
        return False
    try:
        with connect_postgres() as connection, connection.cursor(row_factory=dict_row) as cursor:
            matched = _age_rows(
                cursor,
                """
                MATCH (run:Run {
                  projectId: $projectId, deckId: $deckId, runId: $runId
                })-[:EXECUTED_BY]->(card:Card {
                  projectId: $projectId, deckId: $deckId, cardId: $cardId
                })
                MERGE (tool:Tool {toolId: $toolName})
                MERGE (run)-[used:USED_TOOL {eventId: $eventId}]->(tool)
                SET used.timestamp=$timestamp,
                    used.projectId=$projectId,
                    used.deckId=$deckId,
                    used.conversationId=$conversationId,
                    used.cardId=$cardId,
                    used.authority=$authority,
                    used.operation=$operation,
                    used.toolName=$toolName,
                    used.nativeNodeIds=$nativeNodeIds,
                    used.nativeEdgeIds=$nativeEdgeIds,
                    used.resultHash=$resultHash,
                    used.truncated=$truncated
                RETURN run.runId
                """,
                {
                    "projectId": project_id,
                    "deckId": deck_id,
                    "conversationId": str(event.get("conversationId") or ""),
                    "runId": run_id,
                    "cardId": card_id,
                    "eventId": event_id,
                    "timestamp": timestamp,
                    "authority": authority,
                    "operation": operation,
                    "toolName": tool_name,
                    "nativeNodeIds": node_ids,
                    "nativeEdgeIds": edge_ids,
                    "resultHash": result_hash,
                    "truncated": event.get("truncated") is True,
                },
                "run_id agtype",
            )
            if len(matched) != 1:
                return False
            _age_rows(
                cursor,
                """
                MATCH (run:Run {
                  projectId: $projectId, deckId: $deckId, runId: $runId
                })
                UNWIND $references AS reference
                MERGE (native:NativeReference {
                  projectId: $projectId,
                  authority: $authority,
                  nativeId: reference.nativeId
                })
                MERGE (run)-[used:USED {
                  eventId: $eventId,
                  nativeId: reference.nativeId,
                  nativeKind: reference.nativeKind
                }]->(native)
                SET used.timestamp=$timestamp,
                    used.toolName=$toolName,
                    used.operation=$operation,
                    used.resultHash=$resultHash
                RETURN count(used)
                """,
                {
                    "projectId": project_id,
                    "deckId": deck_id,
                    "runId": run_id,
                    "eventId": event_id,
                    "timestamp": timestamp,
                    "authority": authority,
                    "operation": operation,
                    "toolName": tool_name,
                    "resultHash": result_hash,
                    "references": references,
                },
                "observed agtype",
            )
        return True
    except Exception:
        return False


def inspect_agentgraph(payload: dict[str, Any]) -> dict[str, Any]:
    """Read bounded current Card authority and identity-only AGE telemetry."""
    project_ref = _required_text(payload.get("projectId"), "project_id")
    deck_id = _required_text(payload.get("deckId"), "deck_id")
    run_id = str(payload.get("runId") or "").strip()
    assignment_id = str(payload.get("assignmentId") or "").strip()
    raw_limit = payload.get("limit", 20)
    if isinstance(raw_limit, bool) or not isinstance(raw_limit, int) or not 1 <= raw_limit <= 50:
        raise CardDomainError("agentgraph_limit_invalid")
    limit = raw_limit
    edge_limit = min(1000, limit * 20)

    with connect_postgres(autocommit=False) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute("SET TRANSACTION READ ONLY")
            loaded = _load_deck_with_cursor(cursor, project_ref, deck_id)
            project_id = loaded["projectId"]
            run_filter = "AND run.runId = $runId" if run_id else ""
            run_rows = _age_rows(
                cursor,
                f"""
                MATCH (run:Run {{projectId: $projectId, deckId: $deckId}})
                      -[:EXECUTED_BY]->
                      (card:Card {{projectId: $projectId, deckId: $deckId}})
                WHERE true {run_filter}
                RETURN properties(run), card.cardId
                ORDER BY run.runId DESC
                LIMIT {limit}
                """,
                {"projectId": project_id, "deckId": deck_id, "runId": run_id},
                "run agtype, card_id agtype",
            )
            runs: dict[str, dict[str, Any]] = {}
            for row in run_rows:
                properties = row.get("run") if isinstance(row.get("run"), dict) else {}
                current_run_id = str(properties.get("runId") or "")
                if not current_run_id:
                    continue
                runs[current_run_id] = {
                    "runId": current_run_id,
                    "correlationId": str(properties.get("correlationId") or ""),
                    "state": str(properties.get("state") or "unknown"),
                    "cardId": str(row.get("card_id") or ""),
                    "assignedFromCardIds": [],
                    "parentRunIds": [],
                    "childRunIds": [],
                    "usedTools": [],
                    "attentionEvents": [],
                    "nativeReferences": [],
                    "viewedNativeReferences": [],
                    "artifacts": [],
                }

            run_ids = list(runs)
            if run_ids:
                telemetry_queries = {
                    "assignments": (
                        """
                        MATCH (sender:Card {projectId: $projectId, deckId: $deckId})
                              -[edge:ASSIGNED_TO]->
                              (target:Card {projectId: $projectId, deckId: $deckId})
                        WHERE edge.runId IN $runIds
                        RETURN edge.runId, sender.cardId, target.cardId
                        """,
                        "run_id agtype, sender_card_id agtype, target_card_id agtype",
                    ),
                    "lineage": (
                        """
                        MATCH (parent:Run {projectId: $projectId, deckId: $deckId})
                              -[:CHILD_RUN]->
                              (child:Run {projectId: $projectId, deckId: $deckId})
                        WHERE parent.runId IN $runIds OR child.runId IN $runIds
                        RETURN parent.runId, child.runId
                        """,
                        "parent_run_id agtype, child_run_id agtype",
                    ),
                    "tools": (
                        """
                        MATCH (run:Run {projectId: $projectId, deckId: $deckId})
                              -[edge:USED_TOOL]->(tool:Tool)
                        WHERE run.runId IN $runIds
                        RETURN run.runId, tool.toolId, properties(edge)
                        """,
                        "run_id agtype, tool_id agtype, event agtype",
                    ),
                    "used": (
                        """
                        MATCH (run:Run {projectId: $projectId, deckId: $deckId})
                              -[:USED]->(native:NativeReference)
                        WHERE run.runId IN $runIds
                        RETURN run.runId, native.authority, native.nativeId
                        """,
                        "run_id agtype, authority agtype, native_id agtype",
                    ),
                    "viewed": (
                        """
                        MATCH (run:Run {projectId: $projectId, deckId: $deckId})
                              -[:VIEWED]->(native:NativeReference)
                        WHERE run.runId IN $runIds
                        RETURN run.runId, native.authority, native.nativeId
                        """,
                        "run_id agtype, authority agtype, native_id agtype",
                    ),
                    "artifacts": (
                        """
                        MATCH (run:Run {projectId: $projectId, deckId: $deckId})
                              -[:PRODUCED_ARTIFACT]->(artifact:Artifact)
                        WHERE run.runId IN $runIds
                        RETURN run.runId, properties(artifact)
                        """,
                        "run_id agtype, artifact agtype",
                    ),
                }
                telemetry = {
                    name: _age_rows(
                        cursor,
                        query + f"\nLIMIT {edge_limit}",
                        {
                            "projectId": project_id,
                            "deckId": deck_id,
                            "runIds": run_ids,
                        },
                        columns,
                    )
                    for name, (query, columns) in telemetry_queries.items()
                }
                for row in telemetry["assignments"]:
                    item = runs.get(str(row.get("run_id") or ""))
                    if item is not None:
                        item["assignedFromCardIds"].append(
                            str(row.get("sender_card_id") or "")
                        )
                for row in telemetry["lineage"]:
                    parent_id = str(row.get("parent_run_id") or "")
                    child_id = str(row.get("child_run_id") or "")
                    if child_id in runs and parent_id:
                        runs[child_id]["parentRunIds"].append(parent_id)
                    if parent_id in runs and child_id:
                        runs[parent_id]["childRunIds"].append(child_id)
                for row in telemetry["tools"]:
                    item = runs.get(str(row.get("run_id") or ""))
                    if item is not None:
                        tool_id = str(row.get("tool_id") or "")
                        if tool_id and tool_id not in item["usedTools"]:
                            item["usedTools"].append(tool_id)
                        event = row.get("event")
                        if isinstance(event, dict) and str(event.get("eventId") or "").strip():
                            item["attentionEvents"].append({
                                "eventId": str(event.get("eventId") or ""),
                                "timestamp": str(event.get("timestamp") or ""),
                                "projectId": str(event.get("projectId") or project_id),
                                "deckId": str(event.get("deckId") or deck_id),
                                "conversationId": str(event.get("conversationId") or "") or None,
                                "runId": str(row.get("run_id") or "") or None,
                                "cardId": str(event.get("cardId") or "") or None,
                                "authority": str(event.get("authority") or ""),
                                "operation": str(event.get("operation") or ""),
                                "toolName": str(event.get("toolName") or tool_id),
                                "nativeNodeIds": [str(value) for value in event.get("nativeNodeIds") or []],
                                "nativeEdgeIds": [str(value) for value in event.get("nativeEdgeIds") or []],
                                "resultHash": str(event.get("resultHash") or ""),
                                "truncated": event.get("truncated") is True,
                            })
                for telemetry_name, output_name in (
                    ("used", "nativeReferences"),
                    ("viewed", "viewedNativeReferences"),
                ):
                    for row in telemetry[telemetry_name]:
                        item = runs.get(str(row.get("run_id") or ""))
                        if item is not None:
                            item[output_name].append({
                                "authority": str(row.get("authority") or ""),
                                "nativeId": str(row.get("native_id") or ""),
                            })
                for row in telemetry["artifacts"]:
                    item = runs.get(str(row.get("run_id") or ""))
                    artifact = row.get("artifact")
                    if item is not None and isinstance(artifact, dict):
                        item["artifacts"].append({
                            "artifactId": str(artifact.get("artifactId") or ""),
                            "artifactKind": str(artifact.get("artifactKind") or ""),
                            "locator": str(artifact.get("locator") or "")[:2048],
                        })

    deck = loaded["deck"]
    cards = [
        {
            "cardId": str(card.get("id") or ""),
            "title": str(card.get("title") or ""),
            "runtime": _card_runtime(card),
            "enabled": card.get("enabled") is not False
            and (card.get("runtimeOptions") or {}).get("enabled") is not False,
        }
        for card in deck["nodes"]
    ]
    relationships = [
        {
            "id": str(edge.get("id") or ""),
            "source": str(edge.get("source") or ""),
            "target": str(edge.get("target") or ""),
            "edgeType": str(edge.get("edgeType") or ""),
            "enabled": edge.get("enabled") is not False,
        }
        for edge in deck["edges"]
    ]
    legacy_assignment = (
        {
            "assignmentId": assignment_id,
            "available": False,
            "reason": "assignmentId is not a current AgentGraph identity; use runId",
        }
        if assignment_id
        else None
    )
    return {
        "ok": True,
        "authority": "postgresql-age-agentgraph",
        "projectId": project_id,
        "deckId": deck_id,
        "scope": {
            "readScope": "project-deck",
            "projectWideRequested": payload.get("projectWide") is True,
            "conversationId": str(payload.get("conversationId") or ""),
            "conversationFilterAvailable": False,
        },
        "cards": cards,
        "relationships": relationships,
        "runs": list(runs.values()),
        "telemetry": {
            "runIdentity": True,
            "usedNativeReferences": True,
            "viewedNativeReferences": True,
            "nativeAttentionEvents": True,
            "artifacts": True,
            "rawIdfStored": False,
        },
        "legacyAssignment": legacy_assignment,
    }


def _load_deck_internal(project_ref: str, deck_id: str) -> dict[str, Any]:
    with connect_postgres() as connection, connection.cursor(row_factory=dict_row) as cursor:
        return _load_deck_with_cursor(cursor, project_ref, deck_id, include_internal=True)


def list_decks(project_ref: str) -> dict[str, Any]:
    """List every relational Deck owned by one existing Project."""
    with connect_postgres() as connection, connection.cursor(row_factory=dict_row) as cursor:
        project = _resolve_project(cursor, project_ref)
        project_id = str(project["id"])
        cursor.execute(
            """
            SELECT deck_id, name, revision, saved_at
            FROM ag_catalog.agent_decks
            WHERE project_id=%s
            ORDER BY updated_at DESC, deck_id
            """,
            (project_id,),
        )
        return {
            "projectId": project_id,
            "decks": [
                {
                    "id": row["deck_id"],
                    "name": row["name"],
                    "meta": {
                        "deckRevision": row["revision"],
                        "deckSavedAt": row["saved_at"].isoformat(),
                    },
                }
                for row in cursor.fetchall()
            ],
        }


def save_deck(
    project_ref: str,
    deck_id: str,
    document: dict[str, Any],
    expected_revision: str | None,
) -> dict[str, Any]:
    incoming_nodes, incoming_edges, incoming_templates = _validated_deck_collections(
        document,
        deck_id,
    )
    with connect_postgres(autocommit=False) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            project = _resolve_project(cursor, project_ref)
            project_id = str(project["id"])
            cursor.execute(
                "SELECT 1 FROM ag_catalog.agent_decks WHERE project_id=%s AND deck_id=%s FOR UPDATE",
                (project_id, deck_id),
            )
            if cursor.fetchone() is None:
                if expected_revision:
                    raise CardDomainError("deck_conflict")
                revision = str(uuid4())
                saved_at = _now()
                cursor.execute(
                    """
                    INSERT INTO ag_catalog.agent_decks (
                      project_id, deck_id, name, workspace_root, document_version,
                      revision, saved_at, updated_at
                    ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
                    """,
                    (
                        project_id, deck_id, _required_text(document.get("name"), "deck_name"),
                        document.get("workspaceRoot"), int(document.get("version") or 1),
                        revision, saved_at, saved_at,
                    ),
                )
                for ordinal, template in enumerate(incoming_templates):
                    cursor.execute(
                        """
                        INSERT INTO ag_catalog.deck_prompt_templates
                          (project_id, deck_id, template_id, ordinal, content)
                        VALUES (%s,%s,%s,%s,%s)
                        """,
                        (
                            project_id, deck_id, template["id"], ordinal,
                            str(template.get("content") or ""),
                        ),
                    )
                for ordinal, node in enumerate(incoming_nodes):
                    card_id = node["id"]
                    cursor.execute(
                        "INSERT INTO ag_catalog.agent_cards (project_id, deck_id, card_id) VALUES (%s,%s,%s)",
                        (project_id, deck_id, card_id),
                    )
                    revision_id = _insert_revision(cursor, project_id, deck_id, node, 1)
                    cursor.execute(
                        "UPDATE ag_catalog.agent_cards SET current_revision_id=%s WHERE project_id=%s AND deck_id=%s AND card_id=%s",
                        (revision_id, project_id, deck_id, card_id),
                    )
                    position = _json_object(node.get("position"), "card_position")
                    cursor.execute(
                        """
                        INSERT INTO ag_catalog.deck_card_memberships (
                          project_id, deck_id, card_id, ordinal, position_x, position_y,
                          parent_graph_id, display_status, presentation_config
                        ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb)
                        """,
                        (
                            project_id, deck_id, card_id, ordinal,
                            float(position.get("x") or 0), float(position.get("y") or 0),
                            node.get("parentGraphId"), node.get("status"),
                            _canonical_json(_stable_card(node)["presentationProperties"]),
                        ),
                    )
                    _ensure_age_card(cursor, project_id, deck_id, card_id)
                for ordinal, edge in enumerate(incoming_edges):
                    _upsert_age_edge(cursor, project_id, deck_id, edge, ordinal)
                connection.commit()
                return load_deck(project_id, deck_id)

            current = _load_deck_with_cursor(cursor, project_ref, deck_id, include_internal=True)
            if expected_revision and current["meta"]["deckRevision"] != expected_revision:
                raise CardDomainError("deck_conflict")
            current_by_id = {node["id"]: node for node in current["deck"]["nodes"]}
            incoming_by_id = {_required_text(node.get("id"), "card_id"): node for node in incoming_nodes}
            if set(current_by_id) - set(incoming_by_id):
                raise CardDomainError("card_deletion_requires_explicit_operation")
            for ordinal, node in enumerate(incoming_nodes):
                card_id = node["id"]
                previous = current_by_id.get(card_id)
                if previous is None:
                    cursor.execute(
                        "INSERT INTO ag_catalog.agent_cards (project_id, deck_id, card_id) VALUES (%s,%s,%s)",
                        (project_id, deck_id, card_id),
                    )
                    revision_number = 1
                    revision_id = _insert_revision(cursor, project_id, deck_id, node, revision_number)
                    _ensure_age_card(cursor, project_id, deck_id, card_id)
                else:
                    next_stable = _stable_card(node)
                    previous_stable = _stable_card(previous)
                    if _canonical_json(next_stable) == _canonical_json(previous_stable):
                        revision_id = previous["_cardRevisionId"]
                    else:
                        revision_number = int(previous["_cardRevision"]) + 1
                        revision_id = _insert_revision(cursor, project_id, deck_id, node, revision_number)
                cursor.execute(
                    "UPDATE ag_catalog.agent_cards SET current_revision_id=%s WHERE project_id=%s AND deck_id=%s AND card_id=%s",
                    (revision_id, project_id, deck_id, card_id),
                )
                position = _json_object(node.get("position"), "card_position")
                cursor.execute(
                    """
                    INSERT INTO ag_catalog.deck_card_memberships (
                      project_id, deck_id, card_id, ordinal, position_x, position_y,
                      parent_graph_id, display_status, presentation_config
                    ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb)
                    ON CONFLICT (project_id, deck_id, card_id) DO UPDATE SET
                      ordinal=EXCLUDED.ordinal, position_x=EXCLUDED.position_x,
                      position_y=EXCLUDED.position_y, parent_graph_id=EXCLUDED.parent_graph_id,
                      display_status=EXCLUDED.display_status,
                      presentation_config=EXCLUDED.presentation_config
                    """,
                    (
                        project_id, deck_id, card_id, ordinal,
                        float(position.get("x") or 0), float(position.get("y") or 0),
                        node.get("parentGraphId"), node.get("status"),
                        _canonical_json(_stable_card(node)["presentationProperties"]),
                    ),
                )
            current_edges = {edge["id"]: edge for edge in current["deck"]["edges"]}
            next_edges = {_edge_core(edge)["id"]: edge for edge in incoming_edges}
            for edge_id, edge in current_edges.items():
                next_edge = next_edges.get(edge_id)
                changed_identity = next_edge is not None and any(
                    _edge_core(edge)[field] != _edge_core(next_edge)[field]
                    for field in ("source", "target", "edgeType")
                )
                if next_edge is None or changed_identity:
                    _delete_age_edge(cursor, project_id, deck_id, edge)
            for ordinal, edge in enumerate(incoming_edges):
                _upsert_age_edge(cursor, project_id, deck_id, edge, ordinal)
            cursor.execute(
                "DELETE FROM ag_catalog.deck_prompt_templates WHERE project_id=%s AND deck_id=%s",
                (project_id, deck_id),
            )
            for ordinal, template in enumerate(incoming_templates):
                cursor.execute(
                    """
                    INSERT INTO ag_catalog.deck_prompt_templates
                      (project_id, deck_id, template_id, ordinal, content)
                    VALUES (%s,%s,%s,%s,%s)
                    """,
                    (project_id, deck_id, template["id"], ordinal, str(template.get("content") or "")),
                )
            revision = str(uuid4())
            saved_at = _now()
            cursor.execute(
                """
                UPDATE ag_catalog.agent_decks SET name=%s, workspace_root=%s,
                  document_version=%s, revision=%s, saved_at=%s, updated_at=%s
                WHERE project_id=%s AND deck_id=%s
                """,
                (
                    _required_text(document.get("name"), "deck_name"), document.get("workspaceRoot"),
                    int(document.get("version") or 1), revision, saved_at, saved_at,
                    project_id, deck_id,
                ),
            )
        connection.commit()
    return load_deck(project_id, deck_id)


def _runtime_owner(card: dict[str, Any]) -> str:
    """Resolve one transport owner from the one explicit saved runtime union."""
    runtime = _card_runtime(card)
    if runtime["kind"] == "hermes":
        return "hermes"
    if runtime["mode"] == "magentic_one":
        return "mag_one"
    return "autogen"


def _card_enabled(card: dict[str, Any]) -> bool:
    options = card.get("runtimeOptions")
    option_enabled = options.get("enabled") if isinstance(options, dict) else None
    return card.get("enabled") is not False and option_enabled is not False


def _is_magentic_worker_card(card: dict[str, Any]) -> bool:
    """Only saved AutoGen Assistant Cards may be Mag One workers in the MVP."""
    runtime = _card_runtime(card)
    return runtime == {"kind": "autogen", "mode": "assistant"} and _card_enabled(card)


def _direct_subagents(
    card_id: str,
    cards: dict[str, dict[str, Any]],
    edges: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Project saved Hermes delegate profiles from exact enabled FLOW targets."""
    direct: list[dict[str, Any]] = []
    seen: set[str] = set()
    for edge in edges:
        target_id = str(edge.get("target") or "")
        target = cards.get(target_id)
        if (
            edge.get("source") != card_id
            or edge.get("edgeType") != "flow"
            or edge.get("enabled") is False
            or target_id == card_id
            or target_id in seen
            or target is None
            or target.get("kind") != "agent"
            or str(target.get("parentGraphId") or "").strip()
            or not _card_enabled(target)
        ):
            continue
        runtime = _card_runtime(target)
        if runtime.get("kind") != "hermes" or runtime.get("mode") not in {"delegate", "kanban"}:
            continue
        options = _json_object(target.get("runtimeOptions"), "delegate_runtime_options")
        provider = _required_text(options.get("provider"), "delegate_provider")
        model_key = _required_text(options.get("modelKey"), "delegate_model_key")
        provider_model_id = _required_text(
            options.get("providerModelId") or model_key,
            "delegate_provider_model_id",
        )
        seen.add(target_id)
        direct.append({
            "cardId": target_id,
            "title": str(target.get("title") or target_id),
            "runtime": runtime,
            "prompt": str(target.get("prompt") or ""),
            "provider": provider,
            "modelKey": model_key,
            "providerModelId": provider_model_id,
            "accessMode": _required_text(
                options.get("accessMode"), "delegate_access_mode"
            ),
            "tools": _string_list(options.get("tools"), "delegate_tools"),
            "nativeTools": _string_list(
                options.get("nativeTools"), "delegate_native_tools"
            ),
            "skills": _string_list(options.get("skills"), "delegate_skills"),
            "toolsets": _string_list(options.get("toolsets"), "delegate_toolsets"),
            "mcpConnectionIds": _string_list(
                options.get("mcpConnectionIds"), "delegate_mcp_connection_ids"
            ),
        })
    return direct


_NATIVE_REFERENCE_LIMIT = 32
_NATIVE_REFERENCE_TEXT_LIMIT = 65_536
_DATA_ANCHOR_LIMIT = 16


def _normalized_native_references(value: Any) -> list[dict[str, Any]]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise CardDomainError("native_references_invalid")
    if len(value) > _NATIVE_REFERENCE_LIMIT:
        raise CardDomainError("native_reference_limit_exceeded")
    normalized: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for item in value:
        if not isinstance(item, dict):
            raise CardDomainError("native_reference_invalid")
        try:
            reference = validate_record("native-reference", item)
        except IddValidationError as error:
            raise CardDomainError(str(error)) from error
        authority = _required_text(reference.get("authority"), "native_reference_authority")
        native_id = _required_text(reference.get("nativeId"), "native_reference_id")
        identity = (authority, native_id)
        if identity in seen:
            raise CardDomainError("native_reference_duplicate")
        seen.add(identity)
        normalized.append({
            "authority": authority,
            "nativeId": native_id,
            "reason": _required_text(reference.get("reason"), "native_reference_reason"),
            "asOf": _required_text(reference.get("asOf"), "native_reference_as_of"),
            "required": reference.get("required") is True,
        })
    if len(_canonical_json(normalized).encode("utf-8")) > _NATIVE_REFERENCE_TEXT_LIMIT:
        raise CardDomainError("native_reference_text_limit_exceeded")
    return normalized


def _normalized_data_anchors(value: Any, *, record_name: str) -> list[dict[str, Any]]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise CardDomainError("data_anchors_invalid")
    if len(value) > _DATA_ANCHOR_LIMIT:
        raise CardDomainError("data_anchor_limit_exceeded")
    normalized: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            raise CardDomainError("data_anchor_invalid")
        try:
            anchor = validate_record(record_name, item)
        except IddValidationError as error:
            raise CardDomainError(str(error)) from error
        authority = _required_text(anchor.get("authority"), "data_anchor_authority")
        native_id = _required_text(anchor.get("nativeId"), "data_anchor_native_id")
        identity = (authority, native_id)
        if identity in seen:
            raise CardDomainError("data_anchor_duplicate")
        seen.add(identity)
        bounded_expansion = anchor.get("boundedExpansion")
        if bounded_expansion < 0 or bounded_expansion > 3:
            raise CardDomainError("data_anchor_expansion_invalid")
        normalized.append({
            "authority": authority,
            "nativeId": native_id,
            "reason": _required_text(anchor.get("reason"), "data_anchor_reason")[:2_000],
            "priority": int(anchor.get("priority", 0)),
            "boundedExpansion": bounded_expansion,
            "required": anchor.get("required") is True,
            "_inputOrder": index,
        })
    return normalized


def _normalized_graph_hooks(value: Any) -> list[dict[str, Any]]:
    hooks = _normalized_data_anchors(value, record_name="graph-hook")
    for index, hook in enumerate(value or []):
        hooks[index]["priority"] = -int(hook["order"])
    return sorted(hooks, key=lambda item: (-item["priority"], item["_inputOrder"]))


def _prepare_invocation(
    payload: dict[str, Any],
    *,
    require_assignment: bool = True,
    include_tool_definitions: bool = True,
) -> dict[str, Any]:
    project_ref = _required_text(payload.get("projectId"), "project_id")
    deck_id = _required_text(payload.get("deckId"), "deck_id")
    card_id = _required_text(payload.get("cardId"), "card_id")
    assignment = (
        _required_text(payload.get("assignment"), "assignment")
        if require_assignment
        else str(payload.get("assignment") or "")
    )
    loaded = _load_deck_internal(project_ref, deck_id)
    cards = {card["id"]: card for card in loaded["deck"]["nodes"]}
    card = cards.get(card_id)
    if card is None:
        raise CardDomainError("card_not_found")
    if not _card_enabled(card):
        raise CardDomainError("card_disabled")
    sender_id = str(payload.get("senderCardId") or "").strip()
    if sender_id:
        if sender_id == card_id:
            raise CardDomainError("card_invocation_self_handoff_forbidden")
        sender = cards.get(sender_id)
        target_runtime = _card_runtime(card)
        sender_runtime = _card_runtime(sender) if sender is not None else None
        if target_runtime == {"kind": "autogen", "mode": "magentic_one"}:
            authorized = any(
                edge["source"] == sender_id
                and edge["target"] == card_id
                and edge["edgeType"] == "magentic_control"
                and edge.get("enabled") is not False
                for edge in loaded["deck"]["edges"]
            )
        elif sender_runtime == {"kind": "autogen", "mode": "magentic_one"}:
            authorized = any(
                edge["edgeType"] == "magentic_option"
                and {edge["source"], edge["target"]} == {sender_id, card_id}
                and edge.get("enabled") is not False
                for edge in loaded["deck"]["edges"]
            )
        else:
            authorized = any(
                edge["source"] == sender_id
                and edge["target"] == card_id
                and edge["edgeType"] == "flow"
                and edge.get("enabled") is not False
                for edge in loaded["deck"]["edges"]
            )
        if sender is None or not authorized:
            raise CardDomainError("card_invocation_edge_authority_required")
    options = _json_object(card.get("runtimeOptions"), "runtime_options")
    graph_hooks = _normalized_graph_hooks(options.get("graphHooks"))
    ceiling = _string_list(options.get("tools"), "tools")
    requested_tools = _string_list(payload.get("tools"), "tools") if payload.get("tools") is not None else ceiling
    if not set(requested_tools).issubset(set(ceiling)):
        raise CardDomainError("invocation_tool_ceiling_exceeded")
    runtime = _card_runtime(card)
    owner = _runtime_owner(card)
    common_prompt = str(card.get("prompt") or "")
    system_text = common_prompt
    provider = str(options.get("provider") or "")
    model_key = str(options.get("modelKey") or "")
    provider_model_id = str(options.get("providerModelId") or model_key)
    if not provider or not model_key or not provider_model_id:
        raise CardDomainError("card_model_configuration_incomplete")
    runtime_options = {
        "reasoningEffort": options.get("reasoningEffort"),
        "temperature": options.get("temperature"),
        "maxTokens": options.get("maxTokens"),
        "maxTurns": options.get("maxTurns"),
    }
    if options.get("writeMode") is not None:
        write_mode = str(options.get("writeMode") or "read-only")
        if write_mode not in {"read-only", "edit"}:
            raise CardDomainError("coder_write_mode_invalid")
        runtime_options["writeMode"] = write_mode
    direct_subagents = _direct_subagents(card_id, cards, loaded["deck"]["edges"])
    card_identity = {"cardId": card_id, "title": card["title"]}
    call_config = {
        "systemPrompt": common_prompt,
        "runtime": runtime,
        "provider": {
            "accessMode": str(options.get("accessMode") or ""),
            "provider": provider,
            "modelKey": model_key,
            "providerModelId": provider_model_id,
        },
        "runtimeOptions": runtime_options,
        "enabledTools": requested_tools,
        "nativeTools": _string_list(options.get("nativeTools"), "native_tools"),
        "skills": _string_list(options.get("skills"), "skills"),
        "toolsets": _string_list(options.get("toolsets"), "toolsets"),
        "mcpConnectionIds": _string_list(options.get("mcpConnectionIds"), "mcp_connection_ids"),
    }
    try:
        catalog = materialize_tool_catalog(tool_manifest())
    except IddValidationError as error:
        raise CardDomainError(str(error)) from error
    by_id = {item["canonicalId"]: item for item in catalog}
    effective_tools = list(call_config["enabledTools"])
    unknown_tools = [name for name in effective_tools if name not in by_id]
    if unknown_tools:
        raise CardDomainError(f"configured_tool_unknown:{unknown_tools[0]}")
    write_tools = [name for name in effective_tools if tool_access(name) == "write"]
    call_config["enabledTools"] = write_tools
    tool_definitions = [by_id[name] for name in write_tools]
    for delegate in direct_subagents:
        unknown_delegate_tools = [
            name for name in delegate["tools"] if name not in by_id
        ]
        if unknown_delegate_tools:
            raise CardDomainError(
                f"configured_tool_unknown:{unknown_delegate_tools[0]}"
            )
        delegate["tools"] = [
            name for name in delegate["tools"] if tool_access(name) == "write"
        ]
    return {
        "ok": True,
        "ephemeral": True,
        "projectId": loaded["projectId"],
        "deckId": deck_id,
        "cardRevisionId": card["_cardRevisionId"],
        "cardRevision": card["_cardRevision"],
        "cardRevisionSha256": card["_cardRevisionSha256"],
        "runtimeOwner": owner,
        "_outputRequirements": str(
            payload.get("outputRequirements") or card.get("outputContract") or ""
        ),
        "assignment": assignment,
        "cardIdentity": card_identity,
        "delegationTargets": direct_subagents,
        "_callConfig": call_config,
        "_toolDefinitions": tool_definitions if include_tool_definitions else [],
        "_graphHooks": graph_hooks,
    }


def materialize_invocation(payload: dict[str, Any]) -> dict[str, Any]:
    prepared = _prepare_invocation(payload)
    output_requirements = prepared.pop("_outputRequirements")
    call_config = prepared.pop("_callConfig")
    assignment = prepared.pop("assignment")
    tool_definitions = prepared.pop("_toolDefinitions")
    graph_hooks = prepared.pop("_graphHooks")
    references = _normalized_native_references(payload.get("nativeReferences"))
    incoming_anchors = _normalized_data_anchors(
        payload.get("dataAnchors"), record_name="data-anchor-reference"
    )
    incoming_anchors.sort(key=lambda item: (-item["priority"], item["_inputOrder"]))
    anchors = [*graph_hooks, *incoming_anchors]
    anchor_identities = [
        (anchor["authority"], anchor["nativeId"]) for anchor in anchors
    ]
    if len(anchor_identities) != len(set(anchor_identities)):
        raise CardDomainError("data_anchor_duplicate")
    for anchor in anchors:
        anchor.pop("_inputOrder", None)
        anchor.pop("priority", None)
    try:
        graph_seed, anchor_references = resolve_data_anchors(
            prepared["projectId"], anchors
        )
    except DataAnchorError as error:
        raise CardDomainError(str(error)) from error
    existing_reference_ids = {
        (reference["authority"], reference["nativeId"]) for reference in references
    }
    references.extend(
        reference for reference in anchor_references
        if (reference["authority"], reference["nativeId"]) not in existing_reference_ids
    )
    images = payload.get("images") or []
    if not isinstance(images, list) or any(not isinstance(item, dict) for item in images):
        raise CardDomainError("images_invalid")
    idf = materialize_idf(
        system_prompt=call_config["systemPrompt"],
        dynamic_input=assignment,
        runtime=call_config["runtime"],
        provider=call_config["provider"],
        runtime_options=call_config["runtimeOptions"],
        enabled_tools=call_config["enabledTools"],
        tool_definitions=tool_definitions,
        native_tools=call_config["nativeTools"],
        skills=call_config["skills"],
        toolsets=call_config["toolsets"],
        mcp_connection_ids=call_config["mcpConnectionIds"],
        context_markdown=str(payload.get("contextMarkdown") or ""),
        graph_seed=graph_seed,
        output_requirements=output_requirements,
        native_references=references,
        images=images,
    )
    return {
        **prepared,
        "idf": idf.model_dump(),
    }


def prepare_main_chat(payload: dict[str, Any]) -> dict[str, Any]:
    """Prepare saved Main authority and the natural user message."""
    project_ref = _required_text(payload.get("projectId"), "project_id")
    deck_id = _required_text(payload.get("deckId"), "deck_id")
    loaded = _load_deck_internal(project_ref, deck_id)
    main_cards = [
        card for card in loaded["deck"]["nodes"]
        if _card_runtime(card).get("kind") == "hermes"
        and _card_runtime(card).get("mode") == "main"
    ]
    if len(main_cards) != 1:
        raise CardDomainError("main_card_identity_ambiguous")
    message = str(payload.get("message") or "")
    if message:
        return materialize_invocation({
            **payload,
            "projectId": loaded["projectId"],
            "deckId": deck_id,
            "cardId": main_cards[0]["id"],
            "assignment": message,
        })
    prepared = _prepare_invocation({
        **payload,
        "projectId": loaded["projectId"],
        "deckId": deck_id,
        "cardId": main_cards[0]["id"],
        "assignment": "",
    }, require_assignment=False, include_tool_definitions=True)
    prepared.pop("_outputRequirements", None)
    prepared.pop("assignment", None)
    call_config = prepared.pop("_callConfig")
    prepared.pop("_toolDefinitions")
    return {**prepared, "sessionProfile": call_config}


def resolve_magentic_card_identity(project_ref: str, deck_id: str) -> dict[str, str]:
    """Resolve the one saved Mag One Card without materializing or running it."""
    loaded = _load_deck_internal(
        _required_text(project_ref, "project_id"),
        _required_text(deck_id, "deck_id"),
    )
    targets = [
        card for card in loaded["deck"]["nodes"]
        if _card_enabled(card)
        and _card_runtime(card) == {"kind": "autogen", "mode": "magentic_one"}
    ]
    if len(targets) != 1:
        raise CardDomainError("magentic_card_identity_ambiguous")
    target = targets[0]
    return {
        "projectId": str(loaded["projectId"]),
        "deckId": deck_id,
        "targetCardId": str(target["id"]),
        "targetCardTitle": str(target.get("title") or "Mag One"),
    }


def materialize_magentic_invocation(payload: dict[str, Any]) -> dict[str, Any]:
    """Resolve the one Mag One Card controlled by the explicit sender edge."""
    project_ref = _required_text(payload.get("projectId"), "project_id")
    deck_id = _required_text(payload.get("deckId"), "deck_id")
    sender_id = _required_text(payload.get("senderCardId"), "sender_card_id")
    loaded = _load_deck_internal(project_ref, deck_id)
    target_ids = {
        edge["target"]
        for edge in loaded["deck"]["edges"]
        if edge["source"] == sender_id and edge["edgeType"] == "magentic_control"
    }
    targets = [
        card for card in loaded["deck"]["nodes"]
        if card["id"] in target_ids
        and _card_runtime(card) == {"kind": "autogen", "mode": "magentic_one"}
    ]
    if len(targets) != 1:
        raise CardDomainError("magentic_control_target_ambiguous")
    return materialize_invocation({
        **payload,
        "projectId": loaded["projectId"],
        "deckId": deck_id,
        "cardId": targets[0]["id"],
    })


def describe_magentic_agents(project_ref: str, deck_id: str) -> dict[str, Any]:
    """Read the AGE-authored worker roster without executing any runtime."""
    loaded = _load_deck_internal(project_ref, deck_id)
    cards = {card["id"]: card for card in loaded["deck"]["nodes"]}
    magentic = [
        card for card in cards.values()
        if _card_runtime(card) == {"kind": "autogen", "mode": "magentic_one"}
    ]
    if len(magentic) != 1:
        raise CardDomainError("magentic_card_identity_ambiguous")
    orchestrator = magentic[0]
    connected: list[dict[str, Any]] = []
    seen: set[str] = set()
    known_tools = {item["canonicalId"] for item in materialize_tool_catalog(tool_manifest())}
    for edge in loaded["deck"]["edges"]:
        if edge["edgeType"] != "magentic_option" or orchestrator["id"] not in {edge["source"], edge["target"]}:
            continue
        card_id = edge["target"] if edge["source"] == orchestrator["id"] else edge["source"]
        card = cards.get(card_id)
        if card is None or card_id in seen or not _card_enabled(card):
            continue
        if not _is_magentic_worker_card(card):
            continue
        seen.add(card_id)
        options = _json_object(card.get("runtimeOptions"), "runtime_options")
        tools = _string_list(options.get("tools"), "tools")
        unknown = [tool for tool in tools if tool not in known_tools]
        provider = str(options.get("provider") or "").strip()
        model = str(options.get("providerModelId") or options.get("modelKey") or "").strip()
        reason = (
            f"configured_tool_unknown:{unknown[0]}" if unknown
            else "card_model_configuration_incomplete" if not provider or not model
            else None
        )
        connected.append({
            "cardId": card_id,
            "title": card.get("title") or card_id,
            "model": {"modelKey": model or None, "provider": provider or None},
            "tools": tools,
            "connected": True,
            "executionReady": reason is None,
            "readinessState": "ready" if reason is None else "configuration_invalid",
            "readinessReason": reason,
        })
    return {
        "projectId": loaded["projectId"],
        "deckId": deck_id,
        "orchestratorCardId": orchestrator["id"],
        "connectedAgents": connected,
    }


def _autogen_participant(card: dict[str, Any]) -> dict[str, Any]:
    """Project only saved worker identity; its Card materializes when invoked."""
    runtime = _card_runtime(card)
    if runtime != {"kind": "autogen", "mode": "assistant"}:
        raise CardDomainError("magentic_worker_runtime_invalid")
    return {
        "cardId": card["id"],
        "title": card.get("title") or card["id"],
        "runtime": runtime,
    }


def prepare_run_invocation(payload: dict[str, Any]) -> dict[str, Any]:
    """Resolve one saved Card and materialize its current transient input."""

    prepared = materialize_invocation(payload)
    expected_revision = str(payload.get("cardRevisionId") or "").strip()
    if expected_revision and prepared["cardRevisionId"] != expected_revision:
        raise CardDomainError("card_revision_changed")
    return prepared


def _insert_run(
    prepared: dict[str, Any],
    *,
    run_id: str,
    correlation_id: str,
) -> None:
    idf = prepared["idf"]
    runtime = idf["runtime"]
    provider = idf["provider"]
    with connect_postgres() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO ag_catalog.agent_runs (
              run_id, project_id, deck_id, target_card_revision_id,
              runtime_kind, runtime_mode,
              provider, model_key, provider_model_id, access_mode, correlation_id,
              state, started_at
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'running',NOW())
            """,
            (
                run_id, prepared["projectId"], prepared["deckId"],
                prepared["cardRevisionId"], runtime["kind"],
                runtime["mode"], provider.get("provider"),
                provider.get("modelKey"), provider.get("providerModelId"),
                provider.get("accessMode"), correlation_id,
            ),
        )

def begin_main_chat_run(payload: dict[str, Any]) -> dict[str, Any]:
    """Begin Main with the same canonical transient Card input as every call."""
    message = _required_text(payload.get("message"), "message")
    prepared = prepare_main_chat({**payload, "message": message})
    expected_revision = str(payload.get("cardRevisionId") or "").strip()
    if expected_revision and prepared["cardRevisionId"] != expected_revision:
        raise CardDomainError("card_revision_changed")
    run_id = _required_text(payload.get("runId"), "run_id")
    correlation_id = _required_text(payload.get("correlationId"), "correlation_id")
    _insert_run(prepared, run_id=run_id, correlation_id=correlation_id)
    telemetry_written = _observe_run_start(
        prepared,
        payload,
        run_id=run_id,
        correlation_id=correlation_id,
    )
    return {
        **prepared,
        "runId": run_id,
        "correlationId": correlation_id,
        "telemetryWritten": telemetry_written,
        "nativeRuntimeRequest": None,
        "hermesTransport": {
            "idf": prepared["idf"],
            "cardIdentity": prepared["cardIdentity"],
            "delegationTargets": prepared.get("delegationTargets") or [],
        },
    }


def begin_run(payload: dict[str, Any]) -> dict[str, Any]:
    """Create one Run around the single Python-materialized Card input."""

    prepared = prepare_run_invocation(payload)
    run_id = _required_text(payload.get("runId"), "run_id")
    correlation_id = _required_text(payload.get("correlationId"), "correlation_id")
    card_identity = prepared["cardIdentity"]
    owner = prepared["runtimeOwner"]
    native_runtime_request = None
    if owner in {"autogen", "mag_one"}:
        if owner == "mag_one":
            loaded = _load_deck_internal(prepared["projectId"], prepared["deckId"])
            cards = {card["id"]: card for card in loaded["deck"]["nodes"]}
            worker_ids: list[str] = []
            for edge in loaded["deck"]["edges"]:
                if (
                    edge["edgeType"] != "magentic_option"
                    or card_identity["cardId"] not in {edge["source"], edge["target"]}
                ):
                    continue
                worker_id = (
                    edge["target"]
                    if edge["source"] == card_identity["cardId"]
                    else edge["source"]
                )
                worker = cards.get(worker_id)
                if (
                    worker is not None
                    and worker_id not in worker_ids
                    and _is_magentic_worker_card(worker)
                ):
                    worker_ids.append(worker_id)
            participants = [
                _autogen_participant(cards[worker_id])
                for worker_id in worker_ids
            ]
            if not participants:
                raise CardDomainError("magentic_runtime_no_connected_participants")
        else:
            participants = []
        native_runtime_request = {
            "session": {
                "sessionId": f"{prepared['deckId']}:{card_identity['cardId']}:{run_id}",
                "projectId": prepared["projectId"],
                "deckId": prepared["deckId"],
                "cardId": card_identity["cardId"],
                "conversationId": str(payload.get("conversationId") or "active"),
                "turnId": correlation_id,
                "runId": run_id,
                **(
                    {"parentRunId": str(payload.get("originatingRunId")).strip()}
                    if str(payload.get("originatingRunId") or "").strip()
                    else {}
                ),
                "route": "deck_runtime" if owner == "mag_one" else "single_card",
                "orchestrator": (
                    "magentic_one" if owner == "mag_one" else "assistant_agent"
                ),
                "startedAt": _now().isoformat(),
            },
            "idf": prepared["idf"],
            "participants": participants,
        }
    _insert_run(prepared, run_id=run_id, correlation_id=correlation_id)
    telemetry_written = _observe_run_start(
        prepared,
        payload,
        run_id=run_id,
        correlation_id=correlation_id,
    )
    return {
        **prepared,
        "runId": run_id,
        "correlationId": correlation_id,
        "telemetryWritten": telemetry_written,
        "nativeRuntimeRequest": native_runtime_request,
        "hermesTransport": {
            "idf": prepared["idf"],
            "cardIdentity": card_identity,
            "delegationTargets": prepared.get("delegationTargets") or [],
        } if owner == "hermes" else None,
    }


def _observe_run_start(
    prepared: dict[str, Any],
    payload: dict[str, Any],
    *,
    run_id: str,
    correlation_id: str,
) -> bool:
    """Write identity-only AGE telemetry without affecting durable Run state."""
    try:
        with connect_postgres() as connection, connection.cursor(row_factory=dict_row) as cursor:
            identity = prepared["cardIdentity"]
            runtime = (prepared.get("idf") or {}).get("runtime") or {}
            _age_rows(
                cursor,
                """
                MERGE (run:Run {runId: $runId})
                SET run.projectId=$projectId, run.deckId=$deckId,
                    run.correlationId=$correlationId, run.state='running',
                    run.nativeChildId=$nativeChildId,
                    run.nativeProfileId=$nativeProfileId,
                    run.conversationId=$conversationId,
                    run.rootRunId=$rootRunId
                WITH run
                MATCH (card:Card {projectId: $projectId, deckId: $deckId, cardId: $cardId})
                MERGE (run)-[:EXECUTED_BY]->(card)
                RETURN properties(run)
                """,
                {
                    "runId": run_id,
                    "projectId": prepared["projectId"],
                    "deckId": prepared["deckId"],
                    "correlationId": correlation_id,
                    "cardId": identity["cardId"],
                    "nativeChildId": str(payload.get("nativeChildId") or "").strip() or None,
                    "nativeProfileId": (
                        str(runtime.get("profile") or "").strip()
                        or None
                    ),
                    "conversationId": str(payload.get("conversationId") or "").strip() or None,
                    "rootRunId": str(payload.get("rootRunId") or run_id).strip(),
                },
                "value agtype",
            )
            sender_id = str(payload.get("senderCardId") or "").strip()
            if sender_id:
                _age_rows(
                    cursor,
                    """
                    MATCH (sender:Card {projectId: $projectId, deckId: $deckId, cardId: $senderId})
                    MATCH (target:Card {projectId: $projectId, deckId: $deckId, cardId: $targetId})
                    MERGE (sender)-[assignment:ASSIGNED_TO {runId: $runId}]->(target)
                    SET assignment.correlationId=$correlationId
                    RETURN properties(assignment)
                    """,
                    {
                        "projectId": prepared["projectId"],
                        "deckId": prepared["deckId"],
                        "senderId": sender_id,
                        "targetId": identity["cardId"],
                        "runId": run_id,
                        "correlationId": correlation_id,
                    },
                    "value agtype",
                )
            parent_run_id = str(payload.get("originatingRunId") or "").strip()
            if parent_run_id:
                _age_rows(
                    cursor,
                    """
                    MATCH (parent:Run {runId: $parentRunId})
                    MATCH (child:Run {runId: $runId})
                    MERGE (parent)-[edge:CHILD_RUN]->(child)
                    RETURN properties(edge)
                    """,
                    {"parentRunId": parent_run_id, "runId": run_id},
                    "value agtype",
                )
        return True
    except Exception:
        return False


def begin_native_hermes_child_run(payload: dict[str, Any]) -> dict[str, Any]:
    """Create an execution-only child Run for one native Hermes delegation.

    The owning saved Card is inherited from the active parent Run. No child
    prompt, alternate Card definition, or model input is accepted here.
    """
    run_id = _required_text(payload.get("runId"), "run_id")
    correlation_id = _required_text(payload.get("correlationId"), "correlation_id")
    parent_run_id = _required_text(payload.get("parentRunId"), "parent_run_id")
    root_run_id = _required_text(payload.get("rootRunId"), "root_run_id")
    project_id = _required_text(payload.get("projectId"), "project_id")
    deck_id = _required_text(payload.get("deckId"), "deck_id")
    card_id = _required_text(payload.get("cardId"), "card_id")
    native_child_id = _required_text(payload.get("nativeChildId"), "native_child_id")
    with connect_postgres() as connection, connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """
            SELECT run.*, revision.card_id
            FROM ag_catalog.agent_runs AS run
            JOIN ag_catalog.agent_card_revisions AS revision
              ON revision.revision_id=run.target_card_revision_id
            WHERE run.run_id IN (%s, %s)
            """,
            (parent_run_id, root_run_id),
        )
        rows = {str(row["run_id"]): dict(row) for row in cursor.fetchall()}
        parent = rows.get(parent_run_id)
        root = rows.get(root_run_id)
        if parent is None or root is None:
            raise CardDomainError("hermes_child_parent_run_not_found")
        for owner in (parent, root):
            if (
                str(owner["project_id"]) != project_id
                or str(owner["deck_id"]) != deck_id
                or owner["runtime_kind"] != "hermes"
                or owner["state"] != "running"
            ):
                raise CardDomainError("hermes_child_parent_authority_mismatch")
        if str(parent["card_id"]) != card_id:
            raise CardDomainError("hermes_child_parent_card_mismatch")
        target_owner = parent
        cursor.execute(
            """
            INSERT INTO ag_catalog.agent_runs (
              run_id, project_id, deck_id, target_card_revision_id,
              runtime_kind, runtime_mode, provider, model_key, provider_model_id,
              access_mode, correlation_id, state, started_at
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'running',NOW())
            """,
            (
                run_id, root["project_id"], root["deck_id"],
                target_owner.get("revision_id", target_owner.get("target_card_revision_id")),
                target_owner["runtime_kind"], target_owner["runtime_mode"],
                target_owner["provider"], target_owner["model_key"],
                target_owner["provider_model_id"], target_owner["access_mode"], correlation_id,
            ),
        )
    prepared = {
        "projectId": project_id,
        "deckId": deck_id,
        "cardIdentity": {"cardId": card_id},
    }
    telemetry_written = _observe_run_start(
        prepared,
        {
            "originatingRunId": parent_run_id,
            "rootRunId": root_run_id,
            "conversationId": str(payload.get("conversationId") or "").strip(),
            "nativeChildId": native_child_id,
        },
        run_id=run_id,
        correlation_id=correlation_id,
    )
    return {
        "ok": True,
        "runId": run_id,
        "parentRunId": parent_run_id,
        "rootRunId": root_run_id,
        "cardId": card_id,
        "nativeChildId": native_child_id,
        "telemetryWritten": telemetry_written,
    }


def finish_run(payload: dict[str, Any]) -> dict[str, Any]:
    run_id = _required_text(payload.get("runId"), "run_id")
    state = _required_text(payload.get("state"), "state")
    if state not in {"completed", "failed", "cancelled"}:
        raise CardDomainError("run_terminal_state_invalid")
    with connect_postgres() as connection, connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """
            UPDATE ag_catalog.agent_runs SET state=%s, finished_at=NOW(),
              provider_thread_ref=%s, provider_turn_ref=%s,
              error_code=%s, error_summary=%s,
              provider_input_tokens=%s, provider_output_tokens=%s, total_cost_usd=%s
            WHERE run_id=%s
            """,
            (
                state, payload.get("providerThreadRef"), payload.get("providerTurnRef"),
                payload.get("errorCode"), payload.get("errorSummary"),
                payload.get("providerInputTokens"), payload.get("providerOutputTokens"),
                payload.get("totalCostUsd"), run_id,
            ),
        )
        if cursor.rowcount != 1:
            raise CardDomainError("run_not_found")
        cursor.execute(
            """
            SELECT run_id, project_id, deck_id, target_card_revision_id,
                   runtime_kind, runtime_mode, provider, model_key, provider_model_id,
                   access_mode, correlation_id, provider_thread_ref,
                   provider_turn_ref, state, started_at, finished_at,
                   error_code, error_summary, provider_input_tokens,
                   provider_output_tokens, total_cost_usd
            FROM ag_catalog.agent_runs WHERE run_id=%s
            """,
            (run_id,),
        )
        receipt = dict(cursor.fetchone())
    telemetry_written = _observe_run_finish(run_id, state, payload)
    return {
        "ok": True,
        "runId": run_id,
        "state": state,
        "telemetryWritten": telemetry_written,
        "receipt": {
            key: value.isoformat() if isinstance(value, datetime) else str(value) if key.endswith("_id") and value is not None else value
            for key, value in receipt.items()
        },
    }


def _observe_run_finish(
    run_id: str,
    state: str,
    payload: dict[str, Any] | None = None,
) -> bool:
    try:
        with connect_postgres() as connection, connection.cursor(row_factory=dict_row) as cursor:
            _age_rows(
                cursor,
                """
                MATCH (run:Run {runId: $runId})
                SET run.state=$state, run.finishedAt=$finishedAt,
                    run.durationMs=$durationMs,
                    run.providerInputTokens=$providerInputTokens,
                    run.providerOutputTokens=$providerOutputTokens,
                    run.totalCostUsd=$totalCostUsd
                RETURN properties(run)
                """,
                {
                    "runId": run_id,
                    "state": state,
                    "finishedAt": _now().isoformat(),
                    "durationMs": (payload or {}).get("durationMs"),
                    "providerInputTokens": (payload or {}).get("providerInputTokens"),
                    "providerOutputTokens": (payload or {}).get("providerOutputTokens"),
                    "totalCostUsd": (payload or {}).get("totalCostUsd"),
                },
                "value agtype",
            )
        return True
    except Exception:
        return False


def record_explicit_artifact(payload: dict[str, Any]) -> dict[str, Any]:
    artifact_id = _required_text(payload.get("artifactId"), "artifact_id")
    run_id = _required_text(payload.get("runId"), "run_id")
    artifact_kind = _required_text(payload.get("artifactKind"), "artifact_kind")
    locator = _required_text(payload.get("locator"), "artifact_locator")
    with connect_postgres() as connection, connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """
            INSERT INTO ag_catalog.run_artifacts (
              artifact_id, producing_run_id, artifact_kind, locator, media_type,
              content_sha256, provenance_ref, size_bytes
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
            RETURNING *
            """,
            (
                artifact_id, run_id, artifact_kind, locator,
                payload.get("mediaType"), payload.get("contentSha256"),
                payload.get("provenanceRef"), payload.get("sizeBytes"),
            ),
        )
        artifact = dict(cursor.fetchone())
    telemetry_written = _observe_artifact(run_id, artifact_id, artifact_kind, locator)
    return {
        "ok": True,
        "artifact": {
            key: value.isoformat() if isinstance(value, datetime) else value
            for key, value in artifact.items()
        },
        "telemetryWritten": telemetry_written,
    }


def _observe_artifact(run_id: str, artifact_id: str, artifact_kind: str, locator: str) -> bool:
    try:
        with connect_postgres() as connection, connection.cursor(row_factory=dict_row) as cursor:
            _age_rows(
                cursor,
                """
                MATCH (run:Run {runId: $runId})
                MERGE (artifact:Artifact {artifactId: $artifactId})
                SET artifact.artifactKind=$artifactKind, artifact.locator=$locator
                MERGE (run)-[edge:PRODUCED_ARTIFACT]->(artifact)
                RETURN properties(edge)
                """,
                {
                    "runId": run_id,
                    "artifactId": artifact_id,
                    "artifactKind": artifact_kind,
                    "locator": locator,
                },
                "value agtype",
            )
        return True
    except Exception:
        return False
