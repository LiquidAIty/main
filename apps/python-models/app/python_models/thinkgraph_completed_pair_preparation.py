"""Completed User/Main pair identity, duplicate reads, and non-writing preparation."""

from __future__ import annotations

import hashlib
import json
from typing import Any

from .engraphis import (
    THINKGRAPH_INTAKE_LOCK,
    get_service,
    graph_revision,
    project_id,
    validated_think_metadata,
)
from .thinkgraph_completed_pair_extraction import llm_structured_contract


def _subject_directory_for_project(project: str) -> dict[str, Any]:
    from app.python_models.canonical_subject_directory import (
        build_canonical_subject_directory,
    )

    return build_canonical_subject_directory(project)


def text_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def source_pair(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        key: payload[key]
        for key in (
            "projectId", "deckId", "conversationId", "runId", "cardId",
            "hermesSessionId", "completedAt",
        )
        if payload.get(key)
    } | {
        "user_sha256": text_hash(payload["userMessage"]),
        "main_sha256": text_hash(payload["mainResponse"]),
    }


def pair_reference(payload: dict[str, Any]) -> str:
    encoded = json.dumps(
        source_pair(payload), ensure_ascii=False, sort_keys=True,
        separators=(",", ":"),
    )
    return f"pair_{text_hash(encoded)}"


def existing_source_pair_thinks(
    store: Any,
    *,
    workspace_id: str,
    pair_reference: str,
) -> list[Any]:
    rows = store.conn.execute(
        "SELECT id FROM memories WHERE workspace_id=? "
        "AND valid_to IS NULL AND expired_at IS NULL "
        "ORDER BY COALESCE(ingested_at,0) DESC, id DESC",
        (workspace_id,),
    ).fetchall()
    matches: list[tuple[int, Any]] = []
    for row in rows:
        memory = store.get_memory(str(row["id"]))
        think = validated_think_metadata(memory) if memory is not None else None
        metadata = memory.metadata if memory is not None else {}
        origin = (
            metadata.get("thinkgraph_origin")
            if isinstance(metadata, dict) else None
        )
        if (
            think is not None
            and isinstance(origin, dict)
            and origin.get("completed_pair_reference") == pair_reference
        ):
            raw_index = origin.get("fact_index")
            fact_index = (
                raw_index
                if isinstance(raw_index, int) and raw_index >= 0
                else 1_000_000
            )
            matches.append((fact_index, memory))
    return [memory for _index, memory in sorted(
        matches,
        key=lambda item: (item[0], str(item[1].id)),
    )]


def validate_completed_pair_payload(payload: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("thinkgraph_completed_pair_payload_invalid")
    allowed = {
        "projectId", "deckId", "conversationId", "runId", "cardId",
        "hermesSessionId", "completedAt", "userMessage", "mainResponse",
    }
    if set(payload) - allowed:
        raise ValueError("thinkgraph_completed_pair_payload_invalid")
    cleaned = dict(payload)
    for key in allowed:
        if key in cleaned and not isinstance(cleaned[key], str):
            raise ValueError("thinkgraph_completed_pair_payload_invalid")
    cleaned["projectId"] = project_id(str(cleaned.get("projectId") or ""))
    cleaned["userMessage"] = str(cleaned.get("userMessage") or "")
    cleaned["mainResponse"] = str(cleaned.get("mainResponse") or "")
    if not cleaned["userMessage"].strip() or not cleaned["mainResponse"].strip():
        raise ValueError("thinkgraph_completed_pair_text_required")
    return cleaned


def prepare_completed_pair(payload: dict[str, Any]) -> dict[str, Any]:
    """Prepare one saved-Card extraction without pre-writing a second Memory."""
    payload = validate_completed_pair_payload(payload)
    project = payload["projectId"]
    pair_text = f"USER:\n{payload['userMessage']}\n\nMAIN:\n{payload['mainResponse']}"
    service = get_service()
    with THINKGRAPH_INTAKE_LOCK:
        workspace_id = service.store.get_or_create_workspace(project)
        revision_before = graph_revision(service.store, workspace_id)
        pair_reference_value = pair_reference(payload)
        existing = existing_source_pair_thinks(
            service.store,
            workspace_id=workspace_id,
            pair_reference=pair_reference_value,
        )
        if existing:
            return {
                "ok": True,
                "projectId": project,
                "thinkMemoryIds": [memory.id for memory in existing],
                "pairReference": pair_reference_value,
                "intakeOperation": "noop",
                "structuredExtractionRequired": False,
                "revision": revision_before,
                "revisionChanged": False,
                "preparation": {
                    "status": "duplicate_noop",
                },
            }
        subject_directory = _subject_directory_for_project(project)
        enrichment_input = {
            "exact_user_message": payload["userMessage"],
            "exact_main_response": payload["mainResponse"],
            "canonical_subject_directory": subject_directory,
        }
        enrichment_schema, enrichment_prompt = llm_structured_contract(
            pair_text,
            enrichment_input,
        )
        return {
            "ok": True,
            "projectId": project,
            "pairReference": pair_reference_value,
            "intakeOperation": "pending",
            "structuredExtractionRequired": True,
            "revision": revision_before,
            "revisionChanged": False,
            "preparation": {"status": "completed_without_graph_mutation"},
            "enrichmentMode": "llm_structured",
            "enrichmentSchema": enrichment_schema,
            "enrichmentPrompt": enrichment_prompt,
            "enrichmentInput": enrichment_input,
            "canonicalSubjectDirectory": subject_directory,
        }
