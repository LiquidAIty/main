"""Exact provider graph references observed during one saved Card Run."""

# Entity: Run Ledger
# Relationship: This file records an exact Graphiti Know readback as an ordinary Run artifact and returns only its provider identities.
# Entity: KnowGraph
# Relationship: This file accepts only a successful first-class Know readback in the authenticated Project scope; it never parses answer prose or writes graph data.
# Entity: AgentGraph
# Relationship: This file emits one artifact observation only after the relational Run reference is persisted.

from __future__ import annotations

import json
from typing import Any

from mcp.types import CallToolResult
from psycopg.rows import dict_row

from app.python_models import agentgraph_run_observations
from app.python_models.postgres import connect_postgres
from app.python_models.saved_card_contract import CardDomainError, sha256_text


_ARTIFACT_KIND = "graphiti-know-reference"
_MEDIA_TYPE = "application/vnd.liquidaity.graph-reference+json"
_PROVENANCE_TOOL = "graphiti.get_know"


def _know_readback(result: Any) -> dict[str, str] | None:
    if not isinstance(result, CallToolResult) or result.is_error is True:
        return None
    structured = result.structured_content
    if not isinstance(structured, dict):
        return None
    payload = structured.get("result")
    payload = payload if isinstance(payload, dict) else structured
    know = payload.get("know")
    if not isinstance(know, dict):
        return None
    reference = {
        "graphitiEpisodeId": str(know.get("uuid") or "").strip(),
        "graphitiEntityId": str(know.get("entity_uuid") or "").strip(),
        "groupId": str(know.get("group_id") or "").strip(),
        "contentSha256": str(know.get("content_hash") or "").strip().lower(),
    }
    if (
        not reference["graphitiEpisodeId"]
        or not reference["graphitiEntityId"]
        or len(reference["contentSha256"]) != 64
        or any(character not in "0123456789abcdef" for character in reference["contentSha256"])
    ):
        return None
    return reference


def record_graphiti_know_readback(
    *,
    result: Any,
    run_id: str,
    project_id: str,
    card_id: str,
) -> dict[str, str] | None:
    """Persist one exact durable Know readback for its authenticated Run."""

    reference = _know_readback(result)
    if reference is None:
        return None
    from app.mcp_provider_operations import graphiti_project_group_id

    if reference["groupId"] != graphiti_project_group_id(project_id):
        raise CardDomainError("run_graph_reference_project_mismatch")
    artifact_id = (
        "know:" + sha256_text(f"{run_id}\0{reference['graphitiEpisodeId']}")[:24]
    )
    provenance = json.dumps({
        "tool": _PROVENANCE_TOOL,
        "graphitiEntityId": reference["graphitiEntityId"],
    }, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    with connect_postgres() as connection, connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """
            SELECT project_id, card_id, state
            FROM ag_catalog.agent_runs
            WHERE run_id=%s
            FOR SHARE
            """,
            (run_id,),
        )
        run = cursor.fetchone()
        if (
            run is None
            or str(run["project_id"]) != project_id
            or str(run["card_id"]) != card_id
            or str(run["state"]) not in {"pending", "running"}
        ):
            raise CardDomainError("run_graph_reference_authority_mismatch")
        cursor.execute(
            """
            INSERT INTO ag_catalog.run_artifacts (
              artifact_id, producing_run_id, artifact_kind, locator,
              media_type, content_sha256, provenance_ref, size_bytes
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,NULL)
            ON CONFLICT (artifact_id) DO NOTHING
            """,
            (
                artifact_id,
                run_id,
                _ARTIFACT_KIND,
                reference["graphitiEpisodeId"],
                _MEDIA_TYPE,
                reference["contentSha256"],
                provenance,
            ),
        )
        cursor.execute(
            """
            SELECT artifact_id, producing_run_id, artifact_kind, locator,
                   media_type, content_sha256, provenance_ref
            FROM ag_catalog.run_artifacts
            WHERE artifact_id=%s
            """,
            (artifact_id,),
        )
        stored = cursor.fetchone()
        if (
            stored is None
            or str(stored["producing_run_id"]) != run_id
            or str(stored["artifact_kind"]) != _ARTIFACT_KIND
            or str(stored["locator"]) != reference["graphitiEpisodeId"]
            or str(stored["media_type"]) != _MEDIA_TYPE
            or str(stored["content_sha256"]) != reference["contentSha256"]
            or str(stored["provenance_ref"]) != provenance
        ):
            raise CardDomainError("run_graph_reference_readback_mismatch")
    agentgraph_run_observations.observe_artifact(
        run_id,
        artifact_id,
        _ARTIFACT_KIND,
        reference["graphitiEpisodeId"],
        reference["contentSha256"],
        None,
    )
    return {
        "graphitiEpisodeId": reference["graphitiEpisodeId"],
        "graphitiEntityId": reference["graphitiEntityId"],
    }


def graph_references_for_run(cursor: Any, run_id: str) -> list[dict[str, str]]:
    cursor.execute(
        """
        SELECT locator, provenance_ref
        FROM ag_catalog.run_artifacts
        WHERE producing_run_id=%s AND artifact_kind=%s
        ORDER BY created_at, artifact_id
        """,
        (run_id, _ARTIFACT_KIND),
    )
    references: list[dict[str, str]] = []
    for row in cursor.fetchall():
        try:
            provenance = json.loads(str(row["provenance_ref"] or ""))
        except (TypeError, ValueError, json.JSONDecodeError):
            raise CardDomainError("run_graph_reference_invalid")
        episode_id = str(row["locator"] or "").strip()
        entity_id = str(
            provenance.get("graphitiEntityId")
            if isinstance(provenance, dict) else ""
        ).strip()
        if (
            not episode_id
            or not entity_id
            or provenance.get("tool") != _PROVENANCE_TOOL
        ):
            raise CardDomainError("run_graph_reference_invalid")
        references.append({
            "graphitiEpisodeId": episode_id,
            "graphitiEntityId": entity_id,
        })
    return references
