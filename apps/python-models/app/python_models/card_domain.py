"""Stable Card/deck authority and transient IDF preparation.

PostgreSQL owns stable Project, Deck, Card revision, grants, facets, layout, and
prompt-free Run identities. AGE owns Card relationships. Dynamic communication
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
    "coder_card": "coderCards",
}
KNOWN_RUNTIME_OPTION_FIELDS = {
    "tools", "nativeTools", "skills", "toolsets", "mcpConnectionIds", "coderCards",
    "profile", "profileSnapshot", "profileConflictResolution", "hermesFacet", "autogenFacet",
    "provider", "modelKey", "providerModelId", "accessMode", "reasoningEffort",
    "temperature", "maxTokens", "maxTurns", "executionMode", "enabled", "binding",
}
KNOWN_CARD_FIELDS = {
    "id", "kind", "templateId", "title", "subtitle", "role", "status",
    "parentGraphId", "prompt", "outputContract", "runtimeType",
    "runtimeBinding", "runtimeOptions", "provider", "providerModelId",
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


def _resolve_project(cursor: Any, project_id: str) -> dict[str, Any]:
    cursor.execute(
        """
        SELECT id, code, project_type, agent_io_schema
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
    hermes = _json_object(options.get("hermesFacet"), "hermes_facet")
    snapshot = _json_object(options.get("profileSnapshot"), "profile_snapshot")
    autogen_value = options.get("autogenFacet")
    autogen = _json_object(autogen_value, "autogen_facet")
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
        "runtimeType": _required_text(card.get("runtimeType"), "runtime_type"),
        "runtimeBinding": card.get("runtimeBinding") or options.get("binding"),
        "provider": options.get("provider") or card.get("provider"),
        "modelKey": options.get("modelKey"),
        "providerModelId": options.get("providerModelId") or card.get("providerModelId"),
        "accessMode": options.get("accessMode"),
        "reasoningEffort": options.get("reasoningEffort"),
        "temperature": options.get("temperature"),
        "maxTokens": options.get("maxTokens"),
        "maxTurns": options.get("maxTurns"),
        "executionMode": options.get("executionMode"),
        "enabled": card.get("enabled", options.get("enabled", True)) is not False,
        "enabledLocation": (
            "card" if "enabled" in card
            else "runtime-options" if "enabled" in options
            else "default"
        ),
        "runtimeExtensions": extensions,
        "grants": grants,
        "hermesFacet": {
            "profileName": options.get("profile"),
            "profileHomeRef": hermes.get("profileHomeRef"),
            "instructions": str(hermes.get("instructions") or ""),
            "snapshotModel": snapshot.get("model"),
            "snapshotGateway": snapshot.get("gateway"),
            "conflictResolution": options.get("profileConflictResolution"),
            "detailsPresent": "hermesFacet" in options,
        } if options.get("profile") else None,
        "autogenFacet": {
            "assistantName": autogen.get("assistantName") or str(card.get("id") or ""),
            "systemMessage": str(autogen.get("systemMessage") or ""),
            "terminationMode": autogen.get("terminationMode"),
            "maxTurns": autogen.get("maxTurns"),
        } if isinstance(autogen_value, dict) else None,
        "presentationProperties": {
            key: value for key, value in card.items() if key not in KNOWN_CARD_FIELDS
        },
    }
    if stable["kind"] != "agent":
        raise CardDomainError("card_kind_unsupported")
    if stable["runtimeType"] not in {"assistant_agent", "magentic_one"}:
        raise CardDomainError("runtime_type_unsupported")
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
          runtime_type, runtime_binding, provider, model_key, provider_model_id,
          access_mode, reasoning_effort, temperature, max_tokens, max_turns,
          execution_mode, enabled, enabled_location, runtime_extension_config, revision_sha256
        ) VALUES (
          %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
          %s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s
        )
        """,
        (
            revision_id, project_id, deck_id, stable["cardId"], revision_number,
            stable["templateId"], stable["kind"], stable["title"], stable["subtitle"],
            stable["role"], stable["status"], stable["parentGraphId"], stable["basePrompt"],
            _sha(stable["basePrompt"]), stable["stableOutputContract"], stable["runtimeType"],
            stable["runtimeBinding"], stable["provider"], stable["modelKey"],
            stable["providerModelId"], stable["accessMode"], stable["reasoningEffort"],
            stable["temperature"], stable["maxTokens"], stable["maxTurns"],
            stable["executionMode"], stable["enabled"], stable["enabledLocation"],
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
    hermes = stable["hermesFacet"]
    if hermes:
        cursor.execute(
            """
            INSERT INTO ag_catalog.hermes_card_facets (
              revision_id, profile_name, profile_home_ref, instruction_text,
              instruction_sha256, snapshot_model, snapshot_gateway, conflict_resolution
              , details_present
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """,
            (
                revision_id, hermes["profileName"], hermes["profileHomeRef"],
                hermes["instructions"], _sha(hermes["instructions"]),
                hermes["snapshotModel"], hermes["snapshotGateway"],
                hermes["conflictResolution"], hermes["detailsPresent"],
            ),
        )
    autogen = stable["autogenFacet"]
    if autogen:
        cursor.execute(
            """
            INSERT INTO ag_catalog.autogen_card_facets (
              revision_id, assistant_name, system_message, system_message_sha256,
              termination_mode, max_turns
            ) VALUES (%s,%s,%s,%s,%s,%s)
            """,
            (
                revision_id, autogen["assistantName"], autogen["systemMessage"],
                _sha(autogen["systemMessage"]), autogen["terminationMode"],
                autogen["maxTurns"],
            ),
        )
    return revision_id


def cutover_legacy_deck(project_ref: str, deck_id: str) -> dict[str, Any]:
    """One explicit, idempotent cutover. Never called during application startup."""
    with connect_postgres(autocommit=False) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            project = _resolve_project(cursor, project_ref)
            project_id = str(project["id"])
            cursor.execute(
                "SELECT 1 FROM ag_catalog.agent_decks WHERE project_id=%s AND deck_id=%s",
                (project_id, deck_id),
            )
            if cursor.fetchone() is not None:
                connection.rollback()
                return {"ok": True, "changed": False, "projectId": project_id, "deckId": deck_id}
            schema = project.get("agent_io_schema") or {}
            state = schema.get("v3_state") if isinstance(schema, dict) else None
            decks = state.get("decks") if isinstance(state, dict) else None
            deck = decks.get(deck_id) if isinstance(decks, dict) else None
            meta = state.get("meta") if isinstance(state, dict) else None
            deck_meta = ((meta or {}).get("decks") or {}).get(deck_id) if isinstance(meta, dict) else None
            if not isinstance(deck, dict) or not isinstance(deck_meta, dict):
                raise CardDomainError("legacy_deck_not_found")

            cursor.execute(
                """
                INSERT INTO ag_catalog.deck_legacy_snapshots (
                  project_id, deck_id, source_revision, snapshot_json
                ) VALUES (%s,%s,%s,%s::jsonb)
                ON CONFLICT (project_id, deck_id, source_revision) DO NOTHING
                """,
                (
                    project_id,
                    deck_id,
                    _required_text(deck_meta.get("revision"), "deck_revision"),
                    _canonical_json(deck),
                ),
            )

            cursor.execute(
                """
                INSERT INTO ag_catalog.agent_decks (
                  project_id, deck_id, name, workspace_root, document_version, revision, saved_at
                ) VALUES (%s,%s,%s,%s,%s,%s,%s)
                """,
                (
                    project_id, deck_id, _required_text(deck.get("name"), "deck_name"),
                    deck.get("workspaceRoot"), int(deck.get("version") or 1),
                    _required_text(deck_meta.get("revision"), "deck_revision"),
                    deck_meta.get("savedAt") or _now(),
                ),
            )
            for ordinal, template in enumerate(deck.get("promptTemplates") or []):
                cursor.execute(
                    """
                    INSERT INTO ag_catalog.deck_prompt_templates
                      (project_id, deck_id, template_id, ordinal, content)
                    VALUES (%s,%s,%s,%s,%s)
                    """,
                    (
                        project_id, deck_id, _required_text(template.get("id"), "template_id"),
                        ordinal, str(template.get("content") or ""),
                    ),
                )
            node_ids = {_required_text(card.get("id"), "card_id") for card in deck.get("nodes") or []}
            for ordinal, card in enumerate(deck.get("nodes") or []):
                card_id = _required_text(card.get("id"), "card_id")
                cursor.execute(
                    "INSERT INTO ag_catalog.agent_cards (project_id, deck_id, card_id) VALUES (%s,%s,%s)",
                    (project_id, deck_id, card_id),
                )
                revision_id = _insert_revision(cursor, project_id, deck_id, card, 1)
                cursor.execute(
                    "UPDATE ag_catalog.agent_cards SET current_revision_id=%s WHERE project_id=%s AND deck_id=%s AND card_id=%s",
                    (revision_id, project_id, deck_id, card_id),
                )
                position = _json_object(card.get("position"), "card_position")
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
                        card.get("parentGraphId"), card.get("status"),
                        _canonical_json(_stable_card(card)["presentationProperties"]),
                    ),
                )
                _ensure_age_card(cursor, project_id, deck_id, card_id)
            for ordinal, edge in enumerate(deck.get("edges") or []):
                core = _edge_core(edge)
                if core["source"] not in node_ids or core["target"] not in node_ids:
                    raise CardDomainError(f"edge_endpoint_missing:{core['id']}")
                _upsert_age_edge(cursor, project_id, deck_id, edge, ordinal)
        connection.commit()
    return {
        "ok": True,
        "changed": True,
        "projectId": project_id,
        "deckId": deck_id,
        "cards": len(deck.get("nodes") or []),
        "edges": len(deck.get("edges") or []),
    }


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
               membership.display_status, membership.presentation_config,
               hermes.profile_name, hermes.profile_home_ref, hermes.instruction_text,
               hermes.snapshot_model, hermes.snapshot_gateway, hermes.conflict_resolution,
               hermes.details_present,
               autogen.assistant_name, autogen.system_message,
               autogen.termination_mode, autogen.max_turns AS autogen_max_turns
        FROM ag_catalog.agent_cards AS card
        JOIN ag_catalog.agent_card_revisions AS revision
          ON revision.revision_id = card.current_revision_id
        JOIN ag_catalog.deck_card_memberships AS membership
          ON membership.project_id=card.project_id AND membership.deck_id=card.deck_id
         AND membership.card_id=card.card_id
        LEFT JOIN ag_catalog.hermes_card_facets AS hermes
          ON hermes.revision_id=revision.revision_id
        LEFT JOIN ag_catalog.autogen_card_facets AS autogen
          ON autogen.revision_id=revision.revision_id
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
            ("executionMode", "execution_mode"),
        ):
            if row.get(column) is not None:
                options[key] = row[column]
        if row.get("profile_name"):
            options["profile"] = row["profile_name"]
            options["profileSnapshot"] = {
                "name": row["profile_name"],
                "model": row.get("snapshot_model") or "",
                "gateway": row.get("snapshot_gateway") or "",
            }
            if row.get("conflict_resolution"):
                options["profileConflictResolution"] = row["conflict_resolution"]
            if row.get("details_present"):
                options["hermesFacet"] = {
                    "profileHomeRef": row.get("profile_home_ref"),
                    "instructions": row.get("instruction_text") or "",
                }
        if row.get("assistant_name"):
            options["autogenFacet"] = {
                "assistantName": row["assistant_name"],
                "systemMessage": row.get("system_message") or "",
                "terminationMode": row.get("termination_mode"),
                "maxTurns": row.get("autogen_max_turns"),
            }
        presentation = dict(row.get("presentation_config") or {})
        node = {
            **presentation,
            "id": row["card_id"], "kind": row["kind"], "title": row["title"],
            "prompt": row["base_prompt"], "status": row.get("status") or row.get("display_status"),
            "position": {"x": float(row["position_x"]), "y": float(row["position_y"])},
            "subtitle": row.get("subtitle"), "templateId": row["template_id"],
            "runtimeType": row["runtime_type"], "parentGraphId": row.get("parent_graph_id"),
            "runtimeBinding": row.get("runtime_binding"), "runtimeOptions": options,
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
    binding = str(card.get("runtimeBinding") or "")
    options = _json_object(card.get("runtimeOptions"), "runtime_options")
    if binding == "local_coder":
        return "coder"
    if card.get("runtimeType") == "magentic_one":
        return "mag_one"
    if options.get("profile"):
        return "hermes"
    if card.get("runtimeType") == "assistant_agent":
        return "autogen"
    raise CardDomainError("card_runtime_owner_unavailable")


def _card_enabled(card: dict[str, Any]) -> bool:
    options = card.get("runtimeOptions")
    option_enabled = options.get("enabled") if isinstance(options, dict) else None
    return card.get("enabled") is not False and option_enabled is not False


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
            or target_id == card_id
            or target_id in seen
            or target is None
            or target.get("kind") != "agent"
            or target.get("runtimeType") != "assistant_agent"
            or str(target.get("parentGraphId") or "").strip()
            or not _card_enabled(target)
        ):
            continue
        seen.add(target_id)
        direct.append({
            "cardId": target_id,
            "title": str(target.get("title") or target_id),
            "runtimeBinding": str(target.get("runtimeBinding") or ""),
        })
    return direct


def _normalized_native_references(value: Any) -> list[dict[str, Any]]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise CardDomainError("native_references_invalid")
    normalized: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for item in value:
        if not isinstance(item, dict) or set(item) - {"authority", "nativeId", "required"}:
            raise CardDomainError("native_reference_invalid")
        authority = _required_text(item.get("authority"), "native_reference_authority")
        native_id = _required_text(item.get("nativeId"), "native_reference_id")
        identity = (authority, native_id)
        if identity in seen:
            raise CardDomainError("native_reference_duplicate")
        seen.add(identity)
        normalized.append({
            "authority": authority,
            "nativeId": native_id,
            "required": item.get("required") is True,
        })
    return normalized


def _resolve_hermes_profile(
    options: dict[str, Any],
    provider: str,
    model_key: str,
    provider_model_id: str,
) -> dict[str, Any]:
    profile = _required_text(options.get("profile"), "hermes_profile")
    snapshot = _json_object(options.get("profileSnapshot"), "profile_snapshot")
    snapshot_model = str(snapshot.get("model") or "").strip()
    snapshot_gateway = str(snapshot.get("gateway") or "").strip().lower()
    resolution = "card" if options.get("profileConflictResolution") == "card" else "hermes"
    conflicts: list[str] = []
    profile_provider = (
        "openrouter" if snapshot_gateway == "openrouter"
        else "openai" if snapshot_gateway in {"openai", "openai-codex"}
        else ""
    )
    if snapshot_gateway and not profile_provider:
        conflicts.append(f"profile_gateway_unresolved:{snapshot_gateway}")
    elif profile_provider and profile_provider != provider:
        conflicts.append(f"profile_provider_conflict:{profile_provider}:{provider}")
    if snapshot_model and snapshot_model not in {provider_model_id, model_key}:
        conflicts.append(f"profile_model_conflict:{snapshot_model}:{provider_model_id}")
    if resolution == "hermes" and any(
        not conflict.startswith("profile_model_conflict:") for conflict in conflicts
    ):
        raise CardDomainError("hermes_profile_conflict_unresolved")
    return {
        "profile": profile,
        "profileSnapshot": {
            "name": str(snapshot.get("name") or profile),
            "model": snapshot_model,
            "gateway": snapshot_gateway,
        },
        "profileConflicts": conflicts,
        "profileConflictResolution": resolution,
        "providerModelId": snapshot_model if resolution == "hermes" and snapshot_model else provider_model_id,
        "modelKey": f"hermes-profile:{profile}" if resolution == "hermes" and snapshot_model else model_key,
    }


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
        required_edge = "magentic_control" if card.get("runtimeType") == "magentic_one" else "flow"
        authorized = any(
            edge["source"] == sender_id
            and edge["target"] == card_id
            and edge["edgeType"] == required_edge
            for edge in loaded["deck"]["edges"]
        )
        if sender_id not in cards or not authorized:
            raise CardDomainError("card_invocation_edge_authority_required")
    options = _json_object(card.get("runtimeOptions"), "runtime_options")
    ceiling = _string_list(options.get("tools"), "tools")
    requested_tools = _string_list(payload.get("tools"), "tools") if payload.get("tools") is not None else ceiling
    if not set(requested_tools).issubset(set(ceiling)):
        raise CardDomainError("invocation_tool_ceiling_exceeded")
    owner = _runtime_owner(card)
    facet = options.get("hermesFacet") if owner == "hermes" else options.get("autogenFacet")
    facet = facet if isinstance(facet, dict) else {}
    facet_instructions = str(
        facet.get("instructions") if owner == "hermes" else facet.get("systemMessage") or ""
    )
    common_prompt = str(card.get("prompt") or "")
    system_text = common_prompt + ("\n\n" + facet_instructions if facet_instructions else "")
    dynamic_context = str(payload.get("contextMarkdown") or "")
    output_requirements = str(payload.get("outputRequirements") or card.get("outputContract") or "")
    references = _normalized_native_references(payload.get("nativeReferences"))
    provider = str(options.get("provider") or "")
    model_key = str(options.get("modelKey") or "")
    provider_model_id = str(options.get("providerModelId") or model_key)
    if not provider or not model_key or not provider_model_id:
        raise CardDomainError("card_model_configuration_incomplete")
    profile_config = (
        _resolve_hermes_profile(options, provider, model_key, provider_model_id)
        if owner == "hermes"
        else None
    )
    card_context = {
        "cardId": card_id, "title": card["title"], "prompt": common_prompt,
        "runtimeType": card["runtimeType"], "accessMode": str(options.get("accessMode") or ""),
        "runtimeBinding": str(card.get("runtimeBinding") or ""),
        "provider": provider,
        "modelKey": profile_config["modelKey"] if profile_config else model_key,
        "providerModelId": profile_config["providerModelId"] if profile_config else provider_model_id,
        "executionMode": str(options.get("executionMode") or "single"),
        "tools": requested_tools,
        "nativeTools": _string_list(options.get("nativeTools"), "native_tools"),
        "skills": _string_list(options.get("skills"), "skills"),
        "toolsets": _string_list(options.get("toolsets"), "toolsets"),
        "mcpConnectionIds": _string_list(options.get("mcpConnectionIds"), "mcp_connection_ids"),
        "coderCardIds": _string_list(options.get("coderCards"), "coder_cards"),
        "directSubagents": _direct_subagents(card_id, cards, loaded["deck"]["edges"]),
        "runtimeOptions": {
            "reasoningEffort": options.get("reasoningEffort"),
            "temperature": options.get("temperature"),
            "maxTokens": options.get("maxTokens"),
            "maxTurns": options.get("maxTurns"),
        },
    }
    if card_context["directSubagents"] and "card.run_assistant_agent" not in card_context["tools"]:
        # The saved FLOW relationships are the second authority ceiling for
        # direct delegation. Exposing the one mechanical delegation tool does
        # not grant access to any Card outside those exact relationships.
        card_context["tools"].append("card.run_assistant_agent")
    if profile_config:
        card_context.update(profile_config)
        card_context["savedCardRuntime"] = {
            "provider": provider,
            "modelKey": model_key,
            "providerModelId": provider_model_id,
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
        "runtimeFacet": {"owner": owner, "instructions": facet_instructions},
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
        if str(card.get("runtimeBinding") or "") == "main_chat"
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
        if card["id"] in target_ids and card.get("runtimeType") == "magentic_one"
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
    magentic = [card for card in cards.values() if card.get("runtimeType") == "magentic_one"]
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
        if card.get("runtimeType") != "assistant_agent" or card.get("runtimeBinding") in {"main_chat", "hermes_steward"}:
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
    binding = str(card.get("runtimeBinding") or "")
    facet = options.get("autogenFacet") if isinstance(options.get("autogenFacet"), dict) else {}
    facet_prompt = str(facet.get("systemMessage") or "")
    prompt = str(card.get("prompt") or "") + ("\n\n" + facet_prompt if facet_prompt else "")
    participant_tools = ["run_local_coder"] if binding == "local_coder" else selected_tools
    inner_tools = [tool for tool in selected_tools if tool != "run_local_coder"] if binding == "local_coder" else []
    return {
        "cardId": card["id"],
        "title": card.get("title") or card["id"],
        "runtimeType": "assistant_agent",
        "runtimeBinding": binding or None,
        "executionMode": str(options.get("executionMode") or "single"),
        "tools": participant_tools,
        "prompt": prompt,
        "provider": provider,
        "accessMode": access_mode,
        "providerModelId": model,
        "reasoningEffort": options.get("reasoningEffort"),
        "innerMcpTools": inner_tools,
        "temperature": options.get("temperature"),
        "maxTokens": options.get("maxTokens"),
    }


def validate_exact_invocation(payload: dict[str, Any]) -> dict[str, Any]:
    exact_idf = _required_text(payload.get("exactIdf"), "exact_idf")
    expected_revision = _required_text(payload.get("cardRevisionId"), "card_revision_id")
    preview = materialize_invocation(payload)
    if preview["cardRevisionId"] != expected_revision:
        raise CardDomainError("card_revision_changed")
    _validate_exact_idf(preview, exact_idf)
    return {
        **preview,
        "exactIdf": exact_idf,
        "providerProjection": {
            **preview["providerProjection"],
            "message": exact_idf,
        },
        "validatedForDispatch": True,
    }


def _validate_exact_idf(preview: dict[str, Any], exact_idf: str) -> None:
    """Protect stable Card authority while allowing temporary prose edits."""
    islands = validate_idf_islands(exact_idf)
    expected_system = str(preview["providerProjection"]["systemPrompt"])
    system_values = [island["content"] for island in islands.get("SYSTEM", [])]
    if system_values != ([expected_system] if expected_system else []):
        raise CardDomainError("exact_idf_stable_prompt_changed")
    contexts = []
    for island in islands.get("JSON", []):
        value = json.loads(island["content"])
        if value.get("type") == "resolved-card-invocation":
            contexts.append(value.get("cardContext"))
    if contexts != [preview["cardContext"]]:
        raise CardDomainError("exact_idf_card_authority_changed")


def begin_prompt_free_run(payload: dict[str, Any]) -> dict[str, Any]:
    prepared = validate_exact_invocation(payload)
    run_id = _required_text(payload.get("runId"), "run_id")
    correlation_id = _required_text(payload.get("correlationId"), "correlation_id")
    context = prepared["cardContext"]
    owner = prepared["runtimeOwner"]
    native_runtime_request = None
    if owner in {"autogen", "coder", "mag_one"}:
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
                    and worker.get("runtimeType") == "assistant_agent"
                    and worker.get("runtimeBinding") not in {"main_chat", "hermes_steward"}
                    and _card_enabled(worker)
                ):
                    worker_ids.append(worker_id)
            known_tools = {item["canonicalId"] for item in materialize_tool_catalog(tool_manifest())}
            participants = [_autogen_participant(cards[worker_id], known_tools) for worker_id in worker_ids]
            if not participants:
                raise CardDomainError("magentic_runtime_no_connected_participants")
        else:
            participant_tools = ["run_local_coder"] if owner == "coder" else selected_tools
            inner_tools = [tool for tool in selected_tools if tool != "run_local_coder"] if owner == "coder" else []
            participants = [{
                "cardId": context["cardId"],
                "title": context["title"],
                "runtimeType": "assistant_agent",
                "runtimeBinding": context.get("runtimeBinding") or None,
                "executionMode": context.get("executionMode") or "single",
                "tools": participant_tools,
                "prompt": prepared["providerProjection"]["systemPrompt"],
                "provider": context.get("provider"),
                "accessMode": context.get("accessMode"),
                "providerModelId": context.get("providerModelId") or context.get("modelKey"),
                "reasoningEffort": (context.get("runtimeOptions") or {}).get("reasoningEffort"),
                "innerMcpTools": inner_tools,
                "temperature": (context.get("runtimeOptions") or {}).get("temperature"),
                "maxTokens": (context.get("runtimeOptions") or {}).get("maxTokens"),
            }]
        card_runtime = {
            "cardId": context["cardId"],
            "title": context["title"],
            "runtimeType": "magentic_one" if owner == "mag_one" else "assistant_agent",
            "runtimeBinding": context.get("runtimeBinding") or None,
            "executionMode": context.get("executionMode") or "single",
            "prompt": prepared["providerProjection"]["systemPrompt"],
            "provider": context.get("provider"),
            "accessMode": context.get("accessMode"),
            "modelKey": context.get("modelKey"),
            "providerModelId": context.get("providerModelId") or context.get("modelKey"),
            "runtimeOptions": {
                **(context.get("runtimeOptions") or {}),
                "deckId": prepared["deckId"],
            },
            "participants": participants,
        }
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
                "systemText": prepared["providerProjection"]["systemPrompt"],
                "userText": _required_text(payload.get("assignment"), "assignment"),
                "cardContext": card_runtime,
                "dynamicContextMarkdown": str(payload.get("contextMarkdown") or ""),
                "nativeReferences": payload.get("nativeReferences") or [],
                "modelInputMarkdown": exact_idf,
                "contentMarkdown": exact_idf,
                "contentSha256": _sha(exact_idf),
                "createdAt": _now().isoformat(),
            },
            "cardRuntime": card_runtime,
        }
    with connect_postgres() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO ag_catalog.agent_runs (
              run_id, project_id, deck_id, target_card_revision_id, runtime_type,
              provider, model_key, provider_model_id, access_mode, correlation_id,
              state, started_at
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'running',NOW())
            """,
            (
                run_id, prepared["projectId"], prepared["deckId"],
                prepared["cardRevisionId"], context["runtimeType"], context.get("provider"),
                context.get("modelKey"), context.get("providerModelId"),
                context.get("accessMode"), correlation_id,
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
        "telemetryWritten": telemetry_written,
        "nativeRuntimeRequest": native_runtime_request,
        "hermesTransport": {
            "profile": context.get("profile"),
            "systemPrompt": prepared["providerProjection"]["systemPrompt"],
            "message": prepared["exactIdf"],
            "cardContext": context,
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
            for tool_id in context.get("tools") or []:
                _age_rows(
                    cursor,
                    """
                    MATCH (run:Run {runId: $runId})
                    MERGE (tool:Tool {toolId: $toolId})
                    MERGE (run)-[edge:USED_TOOL]->(tool)
                    RETURN properties(edge)
                    """,
                    {"runId": run_id, "toolId": tool_id},
                    "value agtype",
                )
            for reference in _normalized_native_references(payload.get("nativeReferences")):
                _age_rows(
                    cursor,
                    """
                    MATCH (run:Run {runId: $runId})
                    MERGE (native:NativeReference {
                      authority: $authority, nativeId: $nativeId
                    })
                    MERGE (run)-[edge:USED]->(native)
                    RETURN properties(edge)
                    """,
                    {
                        "runId": run_id,
                        "authority": reference["authority"],
                        "nativeId": reference["nativeId"],
                    },
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
                   runtime_type, provider, model_key, provider_model_id,
                   access_mode, correlation_id, provider_thread_ref,
                   provider_turn_ref, state, started_at, finished_at,
                   error_code, error_summary, provider_input_tokens,
                   provider_output_tokens, total_cost_usd
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
