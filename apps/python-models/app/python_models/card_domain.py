"""Stable Card/deck authority and transient IDF preparation.

PostgreSQL owns stable Project, Deck, Card revision, runtime, grants, layout, and
prompt-free Run identities. AGE owns Card relationships. Dynamic communication
is materialized and validated in memory and is never written by this module.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from hashlib import sha256
from typing import Any
from uuid import UUID, uuid4

from psycopg.rows import dict_row

from app.python_models.idd import (
    IDD_PATH,
    IddValidationError,
    load_input_data_dictionary,
    materialize_tool_catalog,
    validate_record,
    validate_idf_islands,
)
from app.python_models.idf import render_content_markdown
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
) -> list[dict[str, str]]:
    """Project exact eligible FLOW targets without inventing Card authority."""
    direct: list[dict[str, str]] = []
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
            or _card_runtime(target) == {"kind": "autogen", "mode": "magentic_one"}
            or str(target.get("parentGraphId") or "").strip()
            or not _card_enabled(target)
        ):
            continue
        seen.add(target_id)
        direct.append({
            "cardId": target_id,
            "title": str(target.get("title") or target_id),
            "runtime": _card_runtime(target),
        })
    return direct


_NATIVE_REFERENCE_LIMIT = 32
_NATIVE_REFERENCE_TEXT_LIMIT = 65_536


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


def _native_hermes_delegates(
    direct_subagents: list[dict[str, Any]],
    cards: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """Project saved Hermes FLOW targets for the native delegate_task seam.

    This transport metadata is deliberately excluded from serialized IDF.  It
    gives the already-selected Hermes runtime the saved target configuration;
    it does not choose a target or grant a relationship by itself.
    """
    delegates: list[dict[str, Any]] = []
    for direct in direct_subagents:
        target = cards[direct["cardId"]]
        runtime = _card_runtime(target)
        if runtime["kind"] != "hermes" or runtime["mode"] != "delegate":
            continue
        options = _json_object(target.get("runtimeOptions"), "runtime_options")
        provider = _required_text(options.get("provider"), "card_provider")
        model_key = _required_text(options.get("modelKey"), "card_model_key")
        provider_model_id = _required_text(
            options.get("providerModelId") or model_key,
            "card_provider_model_id",
        )
        delegates.append({
            **direct,
            "runtimeOwner": "hermes",
            "prompt": str(target.get("prompt") or ""),
            "provider": provider,
            "modelKey": model_key,
            "providerModelId": provider_model_id,
            "accessMode": str(options.get("accessMode") or ""),
            "tools": _string_list(options.get("tools"), "tools"),
            "nativeTools": _string_list(options.get("nativeTools"), "native_tools"),
            "skills": _string_list(options.get("skills"), "skills"),
            "toolsets": _string_list(options.get("toolsets"), "toolsets"),
            "mcpConnectionIds": _string_list(
                options.get("mcpConnectionIds"),
                "mcp_connection_ids",
            ),
        })
    return delegates


def materialize_invocation(payload: dict[str, Any]) -> dict[str, Any]:
    project_ref = _required_text(payload.get("projectId"), "project_id")
    deck_id = _required_text(payload.get("deckId"), "deck_id")
    card_id = _required_text(payload.get("cardId"), "card_id")
    assignment = _required_text(payload.get("assignment"), "assignment")
    loaded = _load_deck_internal(project_ref, deck_id)
    cards = {card["id"]: card for card in loaded["deck"]["nodes"]}
    card = cards.get(card_id)
    if card is None:
        raise CardDomainError("card_not_found")
    if not _card_enabled(card):
        raise CardDomainError("card_disabled")
    sender_id = str(payload.get("senderCardId") or "").strip()
    if sender_id:
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
    ceiling = _string_list(options.get("tools"), "tools")
    requested_tools = _string_list(payload.get("tools"), "tools") if payload.get("tools") is not None else ceiling
    if not set(requested_tools).issubset(set(ceiling)):
        raise CardDomainError("invocation_tool_ceiling_exceeded")
    runtime = _card_runtime(card)
    owner = _runtime_owner(card)
    common_prompt = str(card.get("prompt") or "")
    system_text = common_prompt
    dynamic_context = str(payload.get("contextMarkdown") or "")
    output_requirements = str(payload.get("outputRequirements") or card.get("outputContract") or "")
    references = _normalized_native_references(payload.get("nativeReferences"))
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
    native_hermes_delegates = (
        _native_hermes_delegates(direct_subagents, cards)
        if owner == "hermes"
        else []
    )
    card_context = {
        "cardId": card_id, "title": card["title"], "prompt": common_prompt,
        "runtime": runtime, "accessMode": str(options.get("accessMode") or ""),
        "provider": provider,
        "modelKey": model_key,
        "providerModelId": provider_model_id,
        "tools": requested_tools,
        "nativeTools": _string_list(options.get("nativeTools"), "native_tools"),
        "skills": _string_list(options.get("skills"), "skills"),
        "toolsets": _string_list(options.get("toolsets"), "toolsets"),
        "mcpConnectionIds": _string_list(options.get("mcpConnectionIds"), "mcp_connection_ids"),
        "runtimeOptions": runtime_options,
    }
    try:
        catalog = materialize_tool_catalog(tool_manifest())
    except IddValidationError as error:
        raise CardDomainError(str(error)) from error
    by_id = {item["canonicalId"]: item for item in catalog}
    effective_tools = list(card_context["tools"])
    unknown_tools = [name for name in effective_tools if name not in by_id]
    if unknown_tools:
        raise CardDomainError(f"configured_tool_unknown:{unknown_tools[0]}")
    tool_definitions = [by_id[name] for name in effective_tools]
    card_context["toolDefinitions"] = tool_definitions
    dynamic_sections = dynamic_context
    if output_requirements:
        dynamic_sections = (dynamic_sections + "\n\n" if dynamic_sections else "") + f"[RETURN]\n{output_requirements}\n[/RETURN]"
    exact_idf = render_content_markdown(
        system_text=system_text,
        user_text=assignment,
        card_context=card_context,
        dynamic_context_markdown=dynamic_sections,
        native_references=references,
    )
    validate_idf_islands(exact_idf)
    return {
        "ok": True,
        "ephemeral": True,
        "projectId": loaded["projectId"],
        "deckId": deck_id,
        "cardRevisionId": card["_cardRevisionId"],
        "cardRevision": card["_cardRevision"],
        "cardRevisionSha256": card["_cardRevisionSha256"],
        "runtimeOwner": owner,
        "assignment": assignment,
        "cardContext": card_context,
        "delegationTargets": direct_subagents,
        "nativeHermesDelegates": native_hermes_delegates,
        "exactIdf": exact_idf,
        "providerProjection": {
            "systemPrompt": system_text,
            "message": exact_idf,
            "toolDefinitions": tool_definitions,
            "enabledTools": effective_tools,
        },
    }


def materialize_main_invocation(payload: dict[str, Any]) -> dict[str, Any]:
    """Resolve the one saved Main Card inside an explicitly selected Deck."""
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
    return materialize_invocation({
        **payload,
        "projectId": loaded["projectId"],
        "deckId": deck_id,
        "cardId": main_cards[0]["id"],
    })


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


def _autogen_participant(card: dict[str, Any], known_tools: set[str]) -> dict[str, Any]:
    options = _json_object(card.get("runtimeOptions"), "runtime_options")
    provider = _required_text(options.get("provider"), "participant_provider")
    model = _required_text(
        options.get("providerModelId") or options.get("modelKey"),
        "participant_model",
    )
    access_mode = _required_text(options.get("accessMode"), "participant_access_mode")
    selected_tools = _string_list(options.get("tools"), "tools")
    unknown = [tool for tool in selected_tools if tool not in known_tools]
    if unknown:
        raise CardDomainError(f"configured_tool_unknown:{unknown[0]}")
    runtime = _card_runtime(card)
    if runtime != {"kind": "autogen", "mode": "assistant"}:
        raise CardDomainError("magentic_worker_runtime_invalid")
    return {
        "cardId": card["id"],
        "title": card.get("title") or card["id"],
        "runtime": runtime,
        "tools": selected_tools,
        "prompt": str(card.get("prompt") or ""),
        "provider": provider,
        "accessMode": access_mode,
        "providerModelId": model,
        "reasoningEffort": options.get("reasoningEffort"),
        "temperature": options.get("temperature"),
        "maxTokens": options.get("maxTokens"),
    }


def validate_exact_invocation(payload: dict[str, Any]) -> dict[str, Any]:
    exact_idf_value = payload.get("exactIdf")
    if not isinstance(exact_idf_value, str) or not exact_idf_value.strip():
        raise CardDomainError("exact_idf_required")
    exact_idf = exact_idf_value
    expected_revision = _required_text(payload.get("cardRevisionId"), "card_revision_id")
    preview = materialize_invocation(payload)
    if preview["cardRevisionId"] != expected_revision:
        raise CardDomainError("card_revision_changed")
    idf_inspection = _validate_exact_idf(preview, exact_idf)
    return {
        **preview,
        "exactIdf": exact_idf,
        "providerProjection": {
            **preview["providerProjection"],
            "message": exact_idf,
        },
        "idfInspection": idf_inspection,
        "validatedForDispatch": True,
    }


def _validate_exact_idf(preview: dict[str, Any], exact_idf: str) -> dict[str, Any]:
    """Validate one exact IDF without making its destination part of the document."""
    islands = validate_idf_islands(exact_idf)
    del preview
    if "\n\n## Current Input\n\n" not in exact_idf:
        raise CardDomainError("exact_idf_input_missing")
    assignment = exact_idf.split("\n\n## Current Input\n\n", 1)[1]
    if not assignment.strip():
        raise CardDomainError("exact_idf_input_missing")
    serialized_cards: list[dict[str, Any]] = []
    native_references: list[dict[str, Any]] = []
    for island in islands.get("JSON", []):
        value = json.loads(island["content"])
        if value.get("type") == "resolved-card-invocation":
            raise CardDomainError("exact_idf_orchestration_envelope_forbidden")
        if value.get("type") == "serialized-card":
            try:
                serialized_cards.append(validate_record("card-context", value.get("card")))
            except IddValidationError as error:
                raise CardDomainError(str(error)) from error
        if value.get("type") == "native-references":
            references = value.get("references")
            if not isinstance(references, list):
                raise CardDomainError("native_references_invalid")
            native_references.extend(references)
    if len(serialized_cards) != 1:
        raise CardDomainError("exact_idf_serialized_card_invalid")
    system_values = [island["content"] for island in islands.get("SYSTEM", [])]
    return {
        "assignment": assignment,
        "instructionText": system_values[0] if system_values else "",
        "cardContext": serialized_cards[0],
        "nativeReferences": _normalized_native_references(native_references),
        "message": exact_idf,
    }


def _uuid(value: Any, field: str) -> UUID:
    try:
        return UUID(_required_text(value, field))
    except (TypeError, ValueError, AttributeError) as error:
        raise CardDomainError(f"{field}_invalid") from error


def _idd_identity() -> tuple[int, str]:
    document = load_input_data_dictionary()
    metadata = document.get("dictionary") if isinstance(document, dict) else None
    version = metadata.get("version") if isinstance(metadata, dict) else None
    if not isinstance(version, int) or version < 1:
        raise CardDomainError("idd_version_invalid")
    try:
        digest = sha256(IDD_PATH.read_bytes()).hexdigest()
    except OSError as error:
        raise CardDomainError("idd_load_failed") from error
    return version, digest


def _saved_idf_payload(row: dict[str, Any], *, include_content: bool) -> dict[str, Any]:
    payload = {
        "idfId": str(row["idf_id"]),
        "revision": int(row["revision"]),
        "projectId": str(row["project_id"]),
        "deckId": str(row["deck_id"]),
        "targetCardId": str(row["target_card_id"]),
        "targetCardRevisionId": str(row["target_card_revision_id"]),
        "targetCardRevision": int(row["target_card_revision_number"]),
        "targetCardRevisionSha256": str(row["target_card_revision_sha256"]),
        "iddVersion": int(row["idd_version"]),
        "iddSha256": str(row["idd_sha256"]),
        "contentSha256": str(row["content_sha256"]),
        "state": str(row["state"]),
        "provenanceKind": str(row["provenance_kind"]),
        "createdAt": row["created_at"].isoformat(),
    }
    if include_content:
        payload["contentMarkdown"] = str(row["content_markdown"])
    return payload


def _inspect_saved_idf(content: str) -> dict[str, Any]:
    """Mechanically inspect a saved non-directional body without deriving routing."""
    islands = validate_idf_islands(content)
    input_marker = "\n\n## Current Input\n\n"
    assignment = content.split(input_marker, 1)[1] if input_marker in content else ""
    system_values = [island["content"] for island in islands.get("SYSTEM", [])]
    serialized_cards: list[dict[str, Any]] = []
    legacy_cards: list[dict[str, Any]] = []
    native_references: list[dict[str, Any]] = []
    for island in islands.get("JSON", []):
        value = json.loads(island["content"])
        if value.get("type") == "resolved-card-invocation" and isinstance(value.get("cardContext"), dict):
            legacy_cards.append(value["cardContext"])
        if value.get("type") == "serialized-card":
            try:
                serialized_cards.append(validate_record("card-context", value.get("card")))
            except IddValidationError as error:
                raise CardDomainError(str(error)) from error
        if value.get("type") == "native-references":
            references = value.get("references")
            if not isinstance(references, list):
                raise CardDomainError("native_references_invalid")
            native_references.extend(references)
    contexts = serialized_cards or legacy_cards
    if not assignment.strip() or len(system_values) > 1 or len(contexts) != 1:
        raise CardDomainError("saved_idf_structure_invalid")
    context = contexts[0]
    runtime_owner = _runtime_owner(context)
    return {
        "assignment": assignment,
        "instructionText": system_values[0] if system_values else "",
        "cardContext": context,
        "runtimeOwner": runtime_owner,
        "nativeReferences": _normalized_native_references(native_references),
        "providerProjection": {
            "systemPrompt": system_values[0] if system_values else "",
            "message": content,
            "toolDefinitions": context.get("toolDefinitions") or [],
            "enabledTools": context.get("tools") or [],
        },
        "message": content,
    }


def save_idf_revision(payload: dict[str, Any]) -> dict[str, Any]:
    """Persist one explicit immutable IDF revision after current Card validation."""
    prepared = validate_exact_invocation(payload)
    content = prepared["exactIdf"]
    provenance = str(payload.get("provenanceKind") or "inspector").strip()
    if provenance not in {"inspector", "main", "agent", "import"}:
        raise CardDomainError("saved_idf_provenance_invalid")
    requested_id = payload.get("idfId")
    idf_id = _uuid(requested_id, "idf_id") if requested_id else uuid4()
    idd_version, idd_sha = _idd_identity()
    content_sha = _sha(content)
    project_id = UUID(prepared["projectId"])
    deck_id = prepared["deckId"]
    card_id = prepared["cardContext"]["cardId"]
    card_revision_id = UUID(prepared["cardRevisionId"])

    with connect_postgres(autocommit=False) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                SELECT idf_id, project_id, deck_id, target_card_id,
                       head_revision, state
                FROM ag_catalog.saved_idfs
                WHERE idf_id=%s
                FOR UPDATE
                """,
                (idf_id,),
            )
            identity = cursor.fetchone()
            if identity is None:
                revision = 1
                cursor.execute(
                    """
                    INSERT INTO ag_catalog.saved_idfs (
                      idf_id, project_id, deck_id, target_card_id,
                      head_revision, state
                    ) VALUES (%s,%s,%s,%s,1,'saved')
                    """,
                    (idf_id, project_id, deck_id, card_id),
                )
            else:
                if (
                    str(identity["project_id"]) != str(project_id)
                    or identity["deck_id"] != deck_id
                    or identity["target_card_id"] != card_id
                ):
                    raise CardDomainError("saved_idf_identity_mismatch")
                if identity["state"] != "saved":
                    raise CardDomainError("saved_idf_not_active")
                revision = int(identity["head_revision"]) + 1
                cursor.execute(
                    """
                    UPDATE ag_catalog.saved_idfs
                    SET head_revision=%s, updated_at=NOW()
                    WHERE idf_id=%s
                    """,
                    (revision, idf_id),
                )
            cursor.execute(
                """
                INSERT INTO ag_catalog.saved_idf_revisions (
                  idf_id, revision, project_id, deck_id, target_card_id,
                  target_card_revision_id, idd_version, idd_sha256,
                  content_markdown, content_sha256, provenance_kind
                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                RETURNING idf_id, revision, project_id, deck_id,
                          target_card_id, target_card_revision_id, idd_version,
                          idd_sha256, content_markdown, content_sha256,
                          provenance_kind, created_at
                """,
                (
                    idf_id, revision, project_id, deck_id, card_id,
                    card_revision_id, idd_version, idd_sha, content,
                    content_sha, provenance,
                ),
            )
            row = dict(cursor.fetchone())
            row["state"] = "saved"
            row["target_card_revision_number"] = prepared["cardRevision"]
            row["target_card_revision_sha256"] = prepared["cardRevisionSha256"]
    return {
        "ok": True,
        "savedIdf": _saved_idf_payload(row, include_content=True),
        "inspection": _inspect_saved_idf(content),
    }


def list_saved_idfs(project_ref: str, deck_id: str, card_id: str | None = None) -> dict[str, Any]:
    """List bounded metadata; exact bodies load only on explicit selection."""
    project_ref = _required_text(project_ref, "project_id")
    deck_id = _required_text(deck_id, "deck_id")
    card_id = str(card_id or "").strip()
    with connect_postgres() as connection, connection.cursor(row_factory=dict_row) as cursor:
        project = _resolve_project(cursor, project_ref)
        cursor.execute(
            """
            SELECT identity.idf_id, revision.revision, revision.project_id,
                   revision.deck_id, revision.target_card_id,
                   revision.target_card_revision_id, revision.idd_version,
                   revision.idd_sha256, revision.content_sha256,
                   revision.provenance_kind, revision.created_at,
                   identity.state, card_revision.revision_number AS target_card_revision_number,
                   card_revision.revision_sha256 AS target_card_revision_sha256
            FROM ag_catalog.saved_idfs identity
            JOIN ag_catalog.saved_idf_revisions revision
              ON revision.idf_id=identity.idf_id
            JOIN ag_catalog.agent_card_revisions card_revision
              ON card_revision.revision_id=revision.target_card_revision_id
            WHERE identity.project_id=%s AND identity.deck_id=%s
              AND (%s='' OR identity.target_card_id=%s)
            ORDER BY identity.updated_at DESC, identity.idf_id, revision.revision DESC
            LIMIT 100
            """,
            (project["id"], deck_id, card_id, card_id),
        )
        rows = [
            _saved_idf_payload(dict(row), include_content=False)
            for row in cursor.fetchall()
        ]
    return {"ok": True, "projectId": str(project["id"]), "deckId": deck_id, "savedIdfs": rows}


def load_saved_idf_revision(
    project_ref: str,
    idf_ref: str,
    revision: int | None = None,
) -> dict[str, Any]:
    project_ref = _required_text(project_ref, "project_id")
    idf_id = _uuid(idf_ref, "idf_id")
    if revision is not None and (not isinstance(revision, int) or revision < 1):
        raise CardDomainError("idf_revision_invalid")
    with connect_postgres() as connection, connection.cursor(row_factory=dict_row) as cursor:
        project = _resolve_project(cursor, project_ref)
        cursor.execute(
            """
            SELECT revision.idf_id, revision.revision, revision.project_id,
                   revision.deck_id, revision.target_card_id,
                   revision.target_card_revision_id, revision.idd_version,
                   revision.idd_sha256, revision.content_markdown,
                   revision.content_sha256, revision.provenance_kind,
                   revision.created_at, identity.state,
                   card_revision.revision_number AS target_card_revision_number,
                   card_revision.revision_sha256 AS target_card_revision_sha256
            FROM ag_catalog.saved_idfs identity
            JOIN ag_catalog.saved_idf_revisions revision
              ON revision.idf_id=identity.idf_id
             AND revision.revision=COALESCE(%s, identity.head_revision)
            JOIN ag_catalog.agent_card_revisions card_revision
              ON card_revision.revision_id=revision.target_card_revision_id
            WHERE identity.idf_id=%s AND identity.project_id=%s
            """,
            (revision, idf_id, project["id"]),
        )
        row = cursor.fetchone()
    if row is None:
        raise CardDomainError("saved_idf_not_found")
    materialized = dict(row)
    if _sha(str(materialized["content_markdown"])) != materialized["content_sha256"]:
        raise CardDomainError("saved_idf_hash_mismatch")
    return {
        "ok": True,
        "savedIdf": _saved_idf_payload(materialized, include_content=True),
        "inspection": _inspect_saved_idf(str(materialized["content_markdown"])),
    }


def save_magentic_instructions(payload: dict[str, Any]) -> dict[str, Any]:
    """Materialize and persist one reviewed Mag One instruction IDF without running it."""
    instructions = _required_text(payload.get("instructions"), "instructions")
    sender_card_id = _required_text(payload.get("senderCardId"), "sender_card_id")
    preview = materialize_magentic_invocation({
        "projectId": _required_text(payload.get("projectId"), "project_id"),
        "deckId": _required_text(payload.get("deckId"), "deck_id"),
        "senderCardId": sender_card_id,
        "assignment": instructions,
    })
    saved = save_idf_revision({
        "projectId": preview["projectId"],
        "deckId": preview["deckId"],
        "cardId": preview["cardContext"]["cardId"],
        "senderCardId": sender_card_id,
        "assignment": instructions,
        "exactIdf": preview["exactIdf"],
        "cardRevisionId": preview["cardRevisionId"],
        "provenanceKind": "agent",
    })
    saved_idf = saved["savedIdf"]
    return {
        "ok": True,
        "idfId": saved_idf["idfId"],
        "revision": saved_idf["revision"],
        "savedIdf": saved_idf,
        "inspection": saved["inspection"],
        "started": False,
    }


def load_magentic_saved_invocation(payload: dict[str, Any]) -> dict[str, Any]:
    """Reload and revalidate one saved Mag One IDF against current Card/AGE authority."""
    project_ref = _required_text(payload.get("projectId"), "project_id")
    deck_id = _required_text(payload.get("deckId"), "deck_id")
    sender_card_id = _required_text(payload.get("senderCardId"), "sender_card_id")
    idf_id = _required_text(payload.get("idfId"), "idf_id")
    loaded = load_saved_idf_revision(project_ref, idf_id)
    saved_idf = loaded["savedIdf"]
    inspection = loaded["inspection"]
    if saved_idf["deckId"] != deck_id:
        raise CardDomainError("saved_idf_deck_mismatch")
    if inspection.get("runtimeOwner") != "mag_one":
        raise CardDomainError("saved_idf_not_magentic")
    prepared = validate_exact_invocation({
        "projectId": saved_idf["projectId"],
        "deckId": saved_idf["deckId"],
        "cardId": saved_idf["targetCardId"],
        "senderCardId": sender_card_id,
        "assignment": inspection["assignment"],
        "exactIdf": saved_idf["contentMarkdown"],
        "cardRevisionId": saved_idf["targetCardRevisionId"],
    })
    return {
        **prepared,
        "savedIdf": saved_idf,
    }


def _saved_idf_run_reference(
    payload: dict[str, Any],
    prepared: dict[str, Any],
) -> tuple[UUID | None, int | None]:
    idf_ref = str(payload.get("savedIdfId") or "").strip()
    revision_value = payload.get("savedIdfRevision")
    if not idf_ref and revision_value is None:
        return None, None
    if not idf_ref or not isinstance(revision_value, int) or revision_value < 1:
        raise CardDomainError("saved_idf_run_reference_invalid")
    idf_id = _uuid(idf_ref, "saved_idf_id")
    loaded = load_saved_idf_revision(prepared["projectId"], str(idf_id), revision_value)["savedIdf"]
    if (
        loaded["deckId"] != prepared["deckId"]
        or loaded["targetCardId"] != prepared["cardContext"]["cardId"]
        or loaded["targetCardRevisionId"] != prepared["cardRevisionId"]
        or loaded["contentMarkdown"] != prepared["exactIdf"]
        or loaded["contentSha256"] != _sha(prepared["exactIdf"])
    ):
        raise CardDomainError("saved_idf_run_content_mismatch")
    return idf_id, revision_value


def begin_prompt_free_run(payload: dict[str, Any]) -> dict[str, Any]:
    prepared = validate_exact_invocation(payload)
    run_id = _required_text(payload.get("runId"), "run_id")
    correlation_id = _required_text(payload.get("correlationId"), "correlation_id")
    saved_idf_id, saved_idf_revision = _saved_idf_run_reference(payload, prepared)
    context = prepared["cardContext"]
    idf_inspection = prepared["idfInspection"]
    owner = prepared["runtimeOwner"]
    native_runtime_request = None
    if owner in {"autogen", "mag_one"}:
        selected_tools = list(context.get("tools") or [])
        exact_idf = prepared["exactIdf"]
        if owner == "mag_one":
            loaded = _load_deck_internal(prepared["projectId"], prepared["deckId"])
            cards = {card["id"]: card for card in loaded["deck"]["nodes"]}
            worker_ids: list[str] = []
            for edge in loaded["deck"]["edges"]:
                if edge["edgeType"] != "magentic_option" or context["cardId"] not in {edge["source"], edge["target"]}:
                    continue
                worker_id = edge["target"] if edge["source"] == context["cardId"] else edge["source"]
                worker = cards.get(worker_id)
                if (
                    worker is not None
                    and worker_id not in worker_ids
                    and _is_magentic_worker_card(worker)
                ):
                    worker_ids.append(worker_id)
            known_tools = {item["canonicalId"] for item in materialize_tool_catalog(tool_manifest())}
            participants = [_autogen_participant(cards[worker_id], known_tools) for worker_id in worker_ids]
            if not participants:
                raise CardDomainError("magentic_runtime_no_connected_participants")
        else:
            participants = [{
                "cardId": context["cardId"],
                "title": context["title"],
                "runtime": context["runtime"],
                "tools": selected_tools,
                "prompt": prepared["providerProjection"]["systemPrompt"],
                "provider": context.get("provider"),
                "accessMode": context.get("accessMode"),
                "providerModelId": context.get("providerModelId") or context.get("modelKey"),
                "reasoningEffort": (context.get("runtimeOptions") or {}).get("reasoningEffort"),
                "temperature": (context.get("runtimeOptions") or {}).get("temperature"),
                "maxTokens": (context.get("runtimeOptions") or {}).get("maxTokens"),
            }]
        card_runtime = context
        native_runtime_request = {
            "session": {
                "sessionId": f"{prepared['deckId']}:{context['cardId']}:{run_id}",
                "projectId": prepared["projectId"],
                "turnId": correlation_id,
                "runId": run_id,
                **(
                    {"parentRunId": str(payload.get("originatingRunId")).strip()}
                    if str(payload.get("originatingRunId") or "").strip()
                    else {}
                ),
                "route": "deck_runtime" if owner == "mag_one" else "single_card",
                "orchestrator": "magentic_one" if owner == "mag_one" else "assistant_agent",
                "modelProvider": context.get("provider"),
                "modelKey": context.get("modelKey"),
                "providerModelId": context.get("providerModelId") or context.get("modelKey"),
                "startedAt": _now().isoformat(),
            },
            # This is an in-memory transport shape for the existing native
            # AutoGen adapter. Its transient identity/hash is never persisted.
            "idf": {
                "idfId": f"transient:{run_id}",
                "projectId": prepared["projectId"],
                "deckId": prepared["deckId"],
                "conversationId": str(payload.get("conversationId") or "active"),
                "runId": run_id,
                "originatingCardId": context["cardId"],
                "version": 1,
                "systemText": idf_inspection["instructionText"],
                "userText": idf_inspection["assignment"],
                "cardContext": card_runtime,
                "dynamicContextMarkdown": str(payload.get("contextMarkdown") or ""),
                "nativeReferences": idf_inspection["nativeReferences"],
                "modelInputMarkdown": exact_idf,
                "contentMarkdown": exact_idf,
                "contentSha256": _sha(exact_idf),
                "createdAt": _now().isoformat(),
            },
            "cardRuntime": card_runtime,
            "participants": participants,
        }
    with connect_postgres() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO ag_catalog.agent_runs (
              run_id, project_id, deck_id, target_card_revision_id,
              runtime_kind, runtime_mode,
              provider, model_key, provider_model_id, access_mode, correlation_id,
              saved_idf_id, saved_idf_revision, state, started_at
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'running',NOW())
            """,
            (
                run_id, prepared["projectId"], prepared["deckId"],
                prepared["cardRevisionId"], context["runtime"]["kind"],
                context["runtime"]["mode"], context.get("provider"),
                context.get("modelKey"), context.get("providerModelId"),
                context.get("accessMode"), correlation_id,
                saved_idf_id, saved_idf_revision,
            ),
        )
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
        "savedIdf": (
            {"idfId": str(saved_idf_id), "revision": saved_idf_revision}
            if saved_idf_id is not None else None
        ),
        "telemetryWritten": telemetry_written,
        "nativeRuntimeRequest": native_runtime_request,
        "hermesTransport": {
            "profile": context["runtime"].get("profile"),
            "mode": context["runtime"]["mode"],
            "systemPrompt": prepared["providerProjection"]["systemPrompt"],
            "message": prepared["exactIdf"],
            "cardContext": context,
            "delegationTargets": prepared.get("delegationTargets") or [],
            "nativeHermesDelegates": prepared.get("nativeHermesDelegates") or [],
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
            context = prepared["cardContext"]
            _age_rows(
                cursor,
                """
                MERGE (run:Run {runId: $runId})
                SET run.projectId=$projectId, run.deckId=$deckId,
                    run.correlationId=$correlationId, run.state='running'
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
                    "cardId": context["cardId"],
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
                        "targetId": context["cardId"],
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


def finish_prompt_free_run(payload: dict[str, Any]) -> dict[str, Any]:
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
                   provider_output_tokens, total_cost_usd,
                   saved_idf_id, saved_idf_revision
            FROM ag_catalog.agent_runs WHERE run_id=%s
            """,
            (run_id,),
        )
        receipt = dict(cursor.fetchone())
    telemetry_written = _observe_run_finish(run_id, state)
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


def _observe_run_finish(run_id: str, state: str) -> bool:
    try:
        with connect_postgres() as connection, connection.cursor(row_factory=dict_row) as cursor:
            _age_rows(
                cursor,
                """
                MATCH (run:Run {runId: $runId})
                SET run.state=$state
                RETURN properties(run)
                """,
                {"runId": run_id, "state": state},
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
