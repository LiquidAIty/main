"""Private, source-backed user context in the account's existing Engraphis store."""
# Graph + less = more: less code that does the same work as more code is more useful.
# Entity names the feature; Relationship explains why this file belongs and what it contributes.
# Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
# Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
# Entity: ThinkGraph
# Relationship: Stores the current extraction's explicit user context through native memory deduplication, without Entity creation or another model call.
# Entity: Personal Context
# Relationship: Enforces account and declared scope, retains canonical source references, and exposes native correction history outside the Project canvas.

from __future__ import annotations

import json
from datetime import datetime
from time import time
from copy import deepcopy
from typing import Any

from engraphis.core.interfaces import FactSpec, MemoryType, Scope
from engraphis.core.poisoning import prompt_eligible

from .engraphis import SERVICE_LOCK, get_service, project_principal
from .thinkgraph_completed_pair_preparation import source_pair


def pair_context_ids(service: Any, workspace_id: str, pair: str) -> list[str]:
    row = service.store.conn.execute(
        "SELECT content FROM events WHERE workspace_id=? AND kind='personal_context_source' "
        "AND json_extract(content,'$.pairReference')=? LIMIT 1", (workspace_id, pair),
    ).fetchone()
    return json.loads(row["content"])["memoryIds"] if row else []


def save_personal_context(service: Any, completed: dict, pair: str, entries: list[dict]) -> list[str]:
    """Validate user-only evidence before the native atomic batch and idempotency receipt."""
    if not entries:
        return []
    from .conversations import conversation_operation

    project = completed["projectId"]
    owner = project_principal(project)["id"]
    references = completed.get("sourceReferences") or []
    user_ids = {identifier for ref in references for identifier in ref["userMessageIds"]}
    messages = conversation_operation(project, "read", {"conversationId": completed["conversationId"]})
    users = [item for item in messages if item["messageId"] in user_ids and item["role"] == "user"]
    if any(not any(entry["quote"] in user["content"] for user in users) for entry in entries):
        raise ValueError("personal_context_requires_exact_user_statement")
    workspace_id = service.store.get_or_create_workspace(project)
    existing = pair_context_ids(service, workspace_id, pair)
    if existing:
        return existing
    specs = [FactSpec(
        content=entry["content"], title=entry["kind"].title(), mtype=MemoryType.SEMANTIC,
        claim_kind=entry["kind"],
        subject_key=f"personal_context:{entry['scope']}:{completed['conversationId'] if entry['scope'] == 'temporary' else ''}:{entry['subject']}",
        valid_from=datetime.fromisoformat(completed["completedAt"].replace("Z", "+00:00")).timestamp(),
        metadata={"personal_context": {**entry, "ownerUserId": owner, "projectId": project,
                  "conversationId": completed["conversationId"], "pairReference": pair,
                  "source_pair": source_pair(completed)}, "consolidation_exempt": True},
        provenance={"source": f"user-statement:{pair}:{index}", "trusted": True,
                    "trust_origin": "source_verified_user_statement", "review_state": "approved"},
    ) for index, entry in enumerate(entries)]

    def record_sources(results: list[dict]) -> None:
        identifiers = []
        for result in results:
            memory = service.store.get_memory(result.get("id", ""))
            if memory is None or not (memory.metadata or {}).get("personal_context"):
                raise ValueError("personal_context_store_failed")
            identifiers.append(memory.id)
        service.record_event("personal_context_source", json.dumps({
            "pairReference": pair, "memoryIds": identifiers, "source_pair": source_pair(completed),
            "source_chunks": {identifier: entry.get("source_chunks", [])
                              for identifier, entry in zip(identifiers, entries, strict=True)},
        }, ensure_ascii=False), workspace=project, refs=[pair, *identifiers])

    results = service.engine.remember_many(
        specs, workspace_id=workspace_id, scope=Scope.WORKSPACE, resolve_conflicts=True,
        _automatic_graph_enrichment=False, _transactional_finalizer=record_sources,
    )
    return [item["id"] for item in results]


def read_personal_context(project: str, *, conversation: str = "", inspect_all: bool = False) -> dict:
    """Read only this account's applicable records; temporary records are inspectable, not standing context."""
    service = get_service(project)
    owner = project_principal(project)["id"]
    with SERVICE_LOCK:
        rows = service.store.conn.execute(
            "SELECT id FROM memories WHERE valid_to IS NULL AND expired_at IS NULL "
            "AND json_extract(metadata,'$.personal_context.ownerUserId')=? ORDER BY ingested_at DESC,id",
            (owner,),
        ).fetchall()
        records = []
        for row in rows:
            memory = service.store.get_memory(row["id"])
            data = (memory.metadata or {}).get("personal_context", {})
            applicable = data.get("scope") == "personal" or (
                data.get("projectId") == project and data.get("scope") == "project")
            temporary = (data.get("scope") == "temporary" and data.get("projectId") == project
                         and (not conversation or data.get("conversationId") == conversation))
            eligible = prompt_eligible(memory.provenance, memory.metadata)
            if not (applicable and (eligible or inspect_all)) and not (inspect_all and temporary):
                continue
            records.append({"memoryId": memory.id, "content": memory.content,
                            "subject": data["subject"],
                            "kind": data["kind"], "scope": data["scope"], "quote": data["quote"],
                            "availableForContext": bool(eligible and applicable),
                            "projectId": data["projectId"], "conversationId": data["conversationId"],
                            "ingestedAt": memory.ingested_at,
                            "supersedes": (memory.metadata or {}).get("supersedes", []),
                            "sourceReferences": data.get("source_pair", {}).get("sourceReferences", [])})
        return {"projectId": project, "records": records}


def correct_personal_context(project: str, memory_id: str, content: str) -> dict:
    """Human correction uses Engraphis's existing replacement/history operation."""
    if not isinstance(content, str) or not content.strip() or len(content) > 4000:
        raise ValueError("personal_context_content_invalid")
    service = get_service(project)
    with SERVICE_LOCK:
        memory = service.store.get_memory(memory_id)
        data = (memory.metadata or {}).get("personal_context", {}) if memory else {}
        if data.get("ownerUserId") != project_principal(project)["id"]:
            raise ValueError("personal_context_owner_mismatch")
        if data.get("scope") != "personal" and data.get("projectId") != project:
            raise ValueError("personal_context_project_mismatch")
        if memory.valid_to is not None or memory.expired_at is not None:
            raise ValueError("personal_context_revision_changed")
        metadata = deepcopy(memory.metadata)
        metadata.pop("supersedes", None)
        metadata["personal_context"]["correctedByUser"] = True
        metadata["provenance"] = {"source": "private_memory_control", "trusted": True,
                                  "trust_origin": "authenticated_user_correction", "review_state": "approved"}

        def still_current():
            current = service.store.get_memory(memory_id)
            if current is None or current.valid_to is not None or current.expired_at is not None:
                raise ValueError("personal_context_revision_changed")
            return None

        return service.engine.remember_many([FactSpec(
            content=content, title=memory.title, mtype=memory.mtype,
            subject_key=memory.subject_key, claim_kind=memory.claim_kind,
            valid_from=time(), metadata=metadata,
        )], workspace_id=memory.workspace_id, scope=memory.scope,
            resolve_conflicts=True, _automatic_graph_enrichment=False,
            _transactional_validator=still_current)[0]
