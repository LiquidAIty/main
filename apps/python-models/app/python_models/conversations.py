"""Full application conversations stored as Engraphis raw events, never Memories."""
# Graph + less = more: less code that does the same work as more code is more useful.
# Entity names the feature; Relationship explains why this file belongs and what it contributes.
# Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
# Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
# Entity: Main Chat
# Relationship: Preserves ordered message content and attribution in the existing Engraphis event ledger.
# Entity: ThinkGraph
# Relationship: Reads explicit saved message references as source pairs without running an agent or writing Thinks.

from __future__ import annotations

from datetime import datetime, timezone
import json
import re
from uuid import uuid4

from .engraphis import SERVICE_LOCK, get_service, project_id

MESSAGE_ID = re.compile(r"msg_[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}", re.I)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _messages(store, workspace: str, conversation: str) -> list[dict]:
    rows = store.conn.execute(
        "SELECT kind,content FROM events WHERE workspace_id=? "
        "AND kind IN ('conversation_message','conversation_status') "
        "AND json_extract(content,'$.conversationId')=? ORDER BY rowid",
        (workspace, conversation),
    ).fetchall()
    messages = {}
    for row in rows:
        record = json.loads(row["content"])
        if row["kind"] == "conversation_message":
            messages[record["messageId"]] = record
        elif record["messageId"] in messages:
            messages[record["messageId"]].update(status=record["status"], completedAt=record["completedAt"])
    return sorted(messages.values(), key=lambda item: item["seq"])


def _activity(kind: str, participant: dict) -> dict:
    if participant.get("kind") not in {"user", "card"} or not participant.get("label"):
        raise ValueError("conversation_participant_invalid")
    return {
        "kind": kind, "label": participant["label"], "status": participant["kind"],
        **{key: participant[key] for key in ("cardId", "profile", "address") if participant.get(key)},
        **({"ref": participant["cardId"]} if participant.get("cardId") else {}),
    }


def _message(project: str, conversation: str, seq: int, write: dict) -> dict:
    identifier = write.get("messageId") or f"msg_{uuid4()}"
    if not isinstance(identifier, str) or not MESSAGE_ID.fullmatch(identifier):
        raise ValueError("conversation_message_id_invalid")
    if write.get("role") not in {"user", "assistant"} or not isinstance(write.get("content"), str):
        raise ValueError("conversation_message_invalid")
    status = write.get("status", "complete")
    if status not in {"pending", "complete", "error"}:
        raise ValueError("conversation_status_invalid")
    evidence = write.get("linkedEvidenceIds", [])
    if not isinstance(evidence, list) or any(not isinstance(item, str) or not item.strip() for item in evidence):
        raise ValueError("conversation_evidence_ids_invalid")
    evidence = [item.strip() for item in evidence]
    if len(set(evidence)) != len(evidence):
        raise ValueError("conversation_evidence_ids_invalid")
    now = _now()
    return {
        "messageId": identifier, "projectId": project, "conversationId": conversation,
        "parentMessageId": None, "role": write["role"], "content": write["content"],
        "status": status, "createdAt": now, "completedAt": None if status == "pending" else now,
        "providerContinuationRef": write.get("providerContinuationRef"),
        "providerMessageId": write.get("providerMessageId"),
        "linkedPlanDraftId": None, "linkedPlanStepId": None, "linkedArtifactIds": [],
        "linkedEvidenceIds": evidence, "seq": seq,
        "visibleActivities": [_activity("conversation_speaker", write.get("speaker", {}))]
        + ([_activity("conversation_target", write["target"])] if write.get("target") else []),
    }


def _append(service, project: str, kind: str, record: dict) -> None:
    service.record_event(kind, json.dumps(record, ensure_ascii=False, separators=(",", ":")),
                         workspace=project, refs=[record["conversationId"], record["messageId"]])


def conversation_operation(project: str, action: str, arguments: dict):
    """Private storage transport, not an agent tool or processing trigger."""
    project = project_id(project)
    conversation = arguments.get("conversationId")
    if not isinstance(conversation, str) or not conversation.strip():
        raise ValueError("conversation_id_invalid")
    if action not in {"read", "append", "reply", "settle"}:
        raise ValueError("conversation_operation_invalid")
    if arguments.get("seedMessages"):
        raise ValueError("conversation_history_import_disabled")
    with SERVICE_LOCK:
        service = get_service()
        store = service.store
        with store.write_transaction():
            scope = store.conn.execute("SELECT id FROM workspaces WHERE name=?", (project,)).fetchone()
            if scope is None and action == "read":
                return []
            workspace = str(scope["id"]) if scope else store.get_or_create_workspace(project)
            messages = _messages(store, workspace, conversation)
            if action == "read":
                return messages
            if action == "settle":
                message = next((item for item in messages if item["messageId"] == arguments.get("messageId")
                                and item.get("providerMessageId") == arguments.get("providerMessageId")), None)
                if not message or message["status"] != "pending" or arguments.get("status") not in {"complete", "error"}:
                    raise ValueError("conversation_message_settlement_mismatch")
                event = {"conversationId": conversation, "messageId": message["messageId"],
                         "status": arguments["status"], "completedAt": _now()}
                _append(service, project, "conversation_status", event)
                return {**message, "status": event["status"], "completedAt": event["completedAt"]}
            if action == "reply":
                write = arguments.get("message", {})
                provider = write.get("providerMessageId")
                if write.get("role") != "assistant" or not isinstance(provider, str) or not provider.strip() or not write.get("content", "").strip():
                    raise ValueError("conversation_reply_invalid")
                existing = next((item for item in messages if item.get("providerMessageId") == provider.strip()), None)
                if existing is not None:
                    return {"inserted": False, "message": existing}
                writes = [{**write, "providerMessageId": provider.strip(), "status": "complete"}]
            else:
                writes = arguments.get("messages")
                if not isinstance(writes, list) or not writes:
                    raise ValueError("conversation_turn_invalid")
            sequence = max((item["seq"] for item in messages), default=0)
            saved = []
            for offset, write in enumerate(writes, 1):
                record = _message(project, conversation, sequence + offset, write)
                duplicate = store.conn.execute(
                    "SELECT 1 FROM events WHERE workspace_id=? AND kind='conversation_message' "
                    "AND json_extract(content,'$.messageId')=? LIMIT 1", (workspace, record["messageId"]),
                ).fetchone()
                if duplicate:
                    raise ValueError("conversation_message_id_duplicate")
                _append(service, project, "conversation_message", record)
                saved.append(record)
            return {"inserted": True, "message": saved[0]} if action == "reply" else saved


def read_pair(project: str, conversation: str, user_ids: list[str], assistant_id: str) -> dict:
    """Read explicit references; never guess a pair from the most recent message."""
    if (not isinstance(user_ids, list) or not user_ids or len(user_ids) > 32
            or any(not isinstance(value, str) or not value for value in user_ids)
            or len(set(user_ids)) != len(user_ids)):
        raise ValueError("conversation_pair_user_ids_invalid")
    messages = conversation_operation(project, "read", {"conversationId": conversation})
    by_id = {item["messageId"]: item for item in messages}
    users = [by_id.get(identifier) for identifier in user_ids]
    answer = by_id.get(assistant_id)
    if not answer or answer["role"] != "assistant" or answer["status"] != "complete" or any(
        not user or user["role"] != "user" or user["status"] != "complete" or user["seq"] >= answer["seq"]
        or user.get("providerContinuationRef") != answer.get("providerContinuationRef") for user in users
    ):
        raise ValueError("conversation_pair_source_mismatch")
    if [user["seq"] for user in users] != sorted(user["seq"] for user in users):
        raise ValueError("conversation_pair_order_invalid")
    return {
        "projectId": project, "conversationId": conversation,
        "userMessage": "\n\n".join(user["content"] for user in users), "mainResponse": answer["content"],
        "completedAt": answer["completedAt"], "hermesSessionId": answer.get("providerContinuationRef") or "",
    }
