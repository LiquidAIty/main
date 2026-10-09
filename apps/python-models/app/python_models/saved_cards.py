"""PostgreSQL Project, deck, saved-Card revision, save, and delete authority."""

from __future__ import annotations

import re
from typing import Any
from uuid import uuid4

from psycopg.rows import dict_row

from app.python_models import agentgraph_topology
from app.python_models.postgres import connect_postgres
from app.python_models.saved_card_contract import (
    CardDomainError,
    GRANT_FIELDS,
    canonical_json,
    card_runtime,
    is_magnetic_taskgraph_runtime,
    json_object,
    utc_now,
    required_text,
    sha256_text,
    stable_card_record,
    validate_immutable_runtime_profile,
    validate_new_card_revision,
)

def resolve_project_record(cursor: Any, project_id: str) -> dict[str, Any]:
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
    profiles: set[str] = set()
    for node in nodes:
        if not isinstance(node, dict):
            raise CardDomainError("deck_document_invalid")
        card_id = required_text(node.get("id"), "card_id")
        if card_id in node_ids:
            raise CardDomainError(f"card_id_duplicate:{card_id}")
        node_ids.add(card_id)
        runtime = card_runtime(node)
        if runtime.get("kind") == "hermes":
            profile = runtime["profile"].strip().lower()
            if profile in profiles:
                raise CardDomainError(f"card_profile_duplicate:{profile}")
            profiles.add(profile)

    edge_ids: set[str] = set()
    edge_keys: set[tuple[str, ...]] = set()
    cards = {node["id"]: node for node in nodes}
    for edge in edges:
        if not isinstance(edge, dict):
            raise CardDomainError("deck_document_invalid")
        core = agentgraph_topology.parse_card_edge(edge)
        if core["id"] in edge_ids:
            raise CardDomainError(f"edge_id_duplicate:{core['id']}")
        edge_ids.add(core["id"])
        if core["source"] not in node_ids or core["target"] not in node_ids:
            raise CardDomainError(f"edge_endpoint_missing:{core['id']}")
        endpoints = (core["source"], core["target"])
        if core["edgeType"] == "magentic_option":
            if sum(is_magnetic_taskgraph_runtime(card_runtime(cards[key]))
                   for key in endpoints) != 1:
                raise CardDomainError(
                    f"edge_magnetic_taskgraph_endpoint_required:{core['id']}"
                )
            endpoints = tuple(sorted(endpoints))
        key = (core["edgeType"], *endpoints)
        if key in edge_keys:
            raise CardDomainError(f"edge_connection_duplicate:{core['id']}")
        edge_keys.add(key)

    template_ids: set[str] = set()
    for template in templates:
        if not isinstance(template, dict):
            raise CardDomainError("deck_document_invalid")
        template_id = required_text(template.get("id"), "template_id")
        if template_id in template_ids:
            raise CardDomainError(f"template_id_duplicate:{template_id}")
        template_ids.add(template_id)
    return nodes, edges, templates

def _validated_project_code_folder(value: Any) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise CardDomainError("builder_project_code_folder_invalid")
    folder = value.strip()
    if not folder:
        return None
    reserved = re.fullmatch(
        r"(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?",
        folder,
        flags=re.IGNORECASE,
    )
    if (
        len(folder) > 100
        or folder in {".", ".."}
        or "/" in folder
        or "\\" in folder
        or re.search(r'[<>:"|?*\x00-\x1f]', folder)
        or folder.endswith((".", " "))
        or reserved is not None
    ):
        raise CardDomainError("builder_project_code_folder_invalid")
    return folder

def _lock_and_validate_hermes_profile_bindings(
    cursor: Any,
    cards: list[dict[str, Any]],
) -> None:
    """Serialize and enforce the permanent global Hermes profile binding.

    The same stable Card identity may be present in multiple Projects, but it
    always keeps one Hermes profile and that profile can never become authority
    for another Card identity. Lock both sides before reading either binding so
    concurrent saves cannot establish opposite mappings.
    """
    bindings = {
        card_runtime(card)["profile"].strip().lower(): required_text(
            card.get("id"), "card_id",
        )
        for card in cards
        if card_runtime(card).get("kind") == "hermes"
    }
    lock_keys = {f"card-profile:{profile}" for profile in bindings} | {
        f"card-id:{card_id}" for card_id in bindings.values()
    }
    for lock_key in sorted(lock_keys):
        cursor.execute(
            "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))",
            (lock_key,),
        )
    for profile in sorted(bindings):
        card_id = bindings[profile]
        cursor.execute(
            """
            SELECT current_card.card_id
            FROM ag_catalog.agent_cards AS current_card
            JOIN ag_catalog.agent_card_revisions AS current_revision
              ON current_revision.revision_id=current_card.current_revision_id
            WHERE current_revision.runtime_kind='hermes'
              AND LOWER(current_revision.runtime_profile)=%s
              AND current_card.card_id<>%s
            ORDER BY current_card.card_id
            LIMIT 1
            """,
            (profile, card_id),
        )
        if cursor.fetchone() is not None:
            raise CardDomainError(f"card_profile_duplicate:{profile}")
        cursor.execute(
            """
            SELECT LOWER(current_revision.runtime_profile) AS runtime_profile
            FROM ag_catalog.agent_cards AS current_card
            JOIN ag_catalog.agent_card_revisions AS current_revision
              ON current_revision.revision_id=current_card.current_revision_id
            WHERE current_revision.runtime_kind='hermes'
              AND current_card.card_id=%s
              AND LOWER(current_revision.runtime_profile)<>%s
            ORDER BY current_revision.runtime_profile
            LIMIT 1
            """,
            (card_id, profile),
        )
        if cursor.fetchone() is not None:
            raise CardDomainError(f"card_profile_mismatch:{card_id}")

def _insert_revision(
    cursor: Any,
    project_id: str,
    deck_id: str,
    card: dict[str, Any],
    revision_number: int,
) -> str:
    validate_new_card_revision(card)
    stable = stable_card_record(card)
    revision_id = str(uuid4())
    revision_sha = sha256_text(canonical_json(stable))
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
            sha256_text(stable["basePrompt"]), stable["stableOutputContract"], stable["runtime"]["kind"],
            stable["runtime"]["mode"], stable["runtime"].get("profile"),
            stable["provider"], stable["modelKey"],
            stable["providerModelId"], stable["accessMode"], None, None, None, None,
            stable["enabled"], stable["enabledLocation"],
            canonical_json(stable["runtimeExtensions"]), revision_sha,
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

def load_saved_deck_with_cursor(
    cursor: Any,
    project_ref: str,
    deck_id: str,
    *,
    include_internal: bool = False,
) -> dict[str, Any]:
    project = resolve_project_record(cursor, project_ref)
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
            "projectCodeFolder": deck_row.get("project_code_folder"),
            "nodes": nodes, "edges": agentgraph_topology.load_card_relationships(cursor, project_id, deck_id),
            "promptTemplates": templates,
        },
        "meta": {
            "deckRevision": deck_row["revision"],
            "deckSavedAt": deck_row["saved_at"].isoformat(),
        },
    }

def load_deck(project_ref: str, deck_id: str) -> dict[str, Any]:
    with connect_postgres() as connection, connection.cursor(row_factory=dict_row) as cursor:
        # Revision IDs/hashes are public optimistic-edit provenance, not credentials.
        # Inspect/create/update must return the same revision used by persistence.
        return load_saved_deck_with_cursor(cursor, project_ref, deck_id, include_internal=True)

def _create_new_deck_with_cursor(
    cursor: Any, *, project_id: str, deck_id: str,
    document: dict[str, Any], project_code_folder: str | None,
    expected_revision: str | None, incoming_nodes: list[dict[str, Any]],
    incoming_edges: list[dict[str, Any]], incoming_templates: list[dict[str, Any]],
) -> None:
    if expected_revision:
        raise CardDomainError("deck_conflict")
    agentgraph_topology.validate_card_topology(incoming_nodes, incoming_edges)
    revision = str(uuid4())
    saved_at = utc_now()
    cursor.execute(
        """
        INSERT INTO ag_catalog.agent_decks (
          project_id, deck_id, name, project_code_folder, document_version,
          revision, saved_at, updated_at
        ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
        """,
        (
            project_id, deck_id, required_text(document.get("name"), "deck_name"),
            project_code_folder, int(document.get("version") or 1),
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
        position = json_object(node.get("position"), "card_position")
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
                canonical_json(stable_card_record(node)["presentationProperties"]),
            ),
        )
        agentgraph_topology.ensure_card_vertex(cursor, project_id, deck_id, card_id)
    for ordinal, edge in enumerate(incoming_edges):
        agentgraph_topology.upsert_card_relationship(cursor, project_id, deck_id, edge, ordinal)


def _update_existing_deck_with_cursor(
    cursor: Any, *, project_ref: str, project_id: str, deck_id: str,
    document: dict[str, Any], project_code_folder: str | None,
    expected_revision: str | None, incoming_nodes: list[dict[str, Any]],
    incoming_edges: list[dict[str, Any]], incoming_templates: list[dict[str, Any]],
) -> None:
    current = load_saved_deck_with_cursor(cursor, project_ref, deck_id, include_internal=True)
    if expected_revision and current["meta"]["deckRevision"] != expected_revision:
        raise CardDomainError("deck_conflict")
    agentgraph_topology.validate_card_topology(incoming_nodes, incoming_edges)
    current_by_id = {node["id"]: node for node in current["deck"]["nodes"]}
    incoming_by_id = {
        required_text(node.get("id"), "card_id"): node
        for node in incoming_nodes
    }
    if set(current_by_id) - set(incoming_by_id):
        raise CardDomainError("card_deletion_requires_explicit_operation")
    propagated_decks: set[tuple[str, str]] = set()
    for ordinal, node in enumerate(incoming_nodes):
        card_id = node["id"]
        previous = current_by_id.get(card_id)
        # Project creation and saved-Card attachment may establish the
        # relational membership first while reusing an existing immutable
        # Card revision.  AGE owns only this Project-local canvas presence,
        # so ensure the scoped vertex on every save, not only when a new
        # Card definition is inserted.
        agentgraph_topology.ensure_card_vertex(cursor, project_id, deck_id, card_id)
        if previous is None:
            cursor.execute(
                "INSERT INTO ag_catalog.agent_cards (project_id, deck_id, card_id) VALUES (%s,%s,%s)",
                (project_id, deck_id, card_id),
            )
            revision_number = 1
            revision_id = _insert_revision(cursor, project_id, deck_id, node, revision_number)
            cursor.execute(
                "UPDATE ag_catalog.agent_cards SET current_revision_id=%s WHERE project_id=%s AND deck_id=%s AND card_id=%s",
                (revision_id, project_id, deck_id, card_id),
            )
        else:
            next_stable = stable_card_record(node)
            previous_stable = stable_card_record(previous)
            validate_immutable_runtime_profile(previous_stable, next_stable)
            if canonical_json(next_stable) == canonical_json(previous_stable):
                revision_id = previous["_cardRevisionId"]
                cursor.execute(
                    "UPDATE ag_catalog.agent_cards SET current_revision_id=%s WHERE project_id=%s AND deck_id=%s AND card_id=%s",
                    (revision_id, project_id, deck_id, card_id),
                )
            else:
                previous_revision_id = str(previous["_cardRevisionId"])
                cursor.execute(
                    """
                    SELECT revision.project_id::text, revision.deck_id,
                           revision.card_id,
                           MAX(lineage.revision_number) AS latest_revision_number
                    FROM ag_catalog.agent_card_revisions AS revision
                    JOIN ag_catalog.agent_card_revisions AS lineage
                      ON lineage.project_id=revision.project_id
                     AND lineage.deck_id=revision.deck_id
                     AND lineage.card_id=revision.card_id
                    WHERE revision.revision_id=%s
                    GROUP BY revision.project_id, revision.deck_id, revision.card_id
                    """,
                    (previous_revision_id,),
                )
                revision_owner = cursor.fetchone()
                if revision_owner is None:
                    raise CardDomainError("card_revision_not_found")
                revision_id = _insert_revision(
                    cursor,
                    str(revision_owner["project_id"]),
                    str(revision_owner["deck_id"]),
                    node,
                    int(revision_owner["latest_revision_number"]) + 1,
                )
                cursor.execute(
                    """
                    UPDATE ag_catalog.agent_cards
                    SET current_revision_id=%s
                    WHERE card_id=%s AND current_revision_id=%s
                    RETURNING project_id::text, deck_id
                    """,
                    (revision_id, card_id, previous_revision_id),
                )
                advanced_decks = {
                    (str(row["project_id"]), str(row["deck_id"]))
                    for row in cursor.fetchall()
                }
                if not advanced_decks:
                    raise CardDomainError("card_revision_stale")
                propagated_decks.update(advanced_decks)
        position = json_object(node.get("position"), "card_position")
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
                canonical_json(stable_card_record(node)["presentationProperties"]),
            ),
        )
    current_edges = {edge["id"]: edge for edge in current["deck"]["edges"]}
    next_edges = {
        agentgraph_topology.parse_card_edge(edge)["id"]: edge
        for edge in incoming_edges
    }
    for edge_id, edge in current_edges.items():
        next_edge = next_edges.get(edge_id)
        changed_identity = next_edge is not None and any(
            agentgraph_topology.parse_card_edge(edge)[field]
            != agentgraph_topology.parse_card_edge(next_edge)[field]
            for field in ("source", "target", "edgeType")
        )
        if next_edge is None or changed_identity:
            agentgraph_topology.delete_card_relationship(cursor, project_id, deck_id, edge)
    for ordinal, edge in enumerate(incoming_edges):
        agentgraph_topology.upsert_card_relationship(cursor, project_id, deck_id, edge, ordinal)
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
            (
                project_id,
                deck_id,
                template["id"],
                ordinal,
                str(template.get("content") or ""),
            ),
        )
    propagated_decks.discard((project_id, deck_id))
    for propagated_project_id, propagated_deck_id in propagated_decks:
        propagated_at = utc_now()
        cursor.execute(
            """
            UPDATE ag_catalog.agent_decks
            SET revision=%s, saved_at=%s, updated_at=%s
            WHERE project_id=%s AND deck_id=%s
            """,
            (
                str(uuid4()), propagated_at, propagated_at,
                propagated_project_id, propagated_deck_id,
            ),
        )
    revision = str(uuid4())
    saved_at = utc_now()
    cursor.execute(
        """
        UPDATE ag_catalog.agent_decks SET name=%s, project_code_folder=%s,
          document_version=%s, revision=%s, saved_at=%s, updated_at=%s
        WHERE project_id=%s AND deck_id=%s
        """,
        (
            required_text(document.get("name"), "deck_name"), project_code_folder,
            int(document.get("version") or 1), revision, saved_at, saved_at,
            project_id, deck_id,
        ),
    )


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
    project_code_folder = _validated_project_code_folder(
        document.get("projectCodeFolder"),
    )
    with connect_postgres(autocommit=False) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            project = resolve_project_record(cursor, project_ref)
            project_id = str(project["id"])
            _lock_and_validate_hermes_profile_bindings(cursor, incoming_nodes)
            cursor.execute(
                "SELECT 1 FROM ag_catalog.agent_decks WHERE project_id=%s AND deck_id=%s FOR UPDATE",
                (project_id, deck_id),
            )
            deck_exists = cursor.fetchone() is not None
            if not deck_exists:
                _create_new_deck_with_cursor(
                    cursor, project_id=project_id, deck_id=deck_id,
                    document=document, project_code_folder=project_code_folder,
                    expected_revision=expected_revision, incoming_nodes=incoming_nodes,
                    incoming_edges=incoming_edges, incoming_templates=incoming_templates,
                )
                connection.commit()
                return load_deck(project_id, deck_id)
            _update_existing_deck_with_cursor(
                cursor, project_ref=project_ref, project_id=project_id, deck_id=deck_id,
                document=document, project_code_folder=project_code_folder,
                expected_revision=expected_revision, incoming_nodes=incoming_nodes,
                incoming_edges=incoming_edges, incoming_templates=incoming_templates,
            )
        connection.commit()
    return load_deck(project_id, deck_id)
