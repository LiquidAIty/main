"""Canonical conversation events, prepared chunk snapshots, and Engraphis source indexing."""
# Graph + less = more: less code that does the same work as more code is more useful.
# Entity names the feature; Relationship explains why this file belongs and what it contributes.
# Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
# Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
# Entity: Main Chat
# Relationship: Preserves ordered conversation content and attribution, reading completed Main bodies as one exact persisted Hermes turn before committing them to Engraphis.
# Entity: ThinkGraph
# Relationship: Prepares immutable source chunks in the Engraphis conversation ledger, indexes those same chunks after extraction, and resolves exact citations without creating Thinks or Entity nodes.

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import re
from uuid import NAMESPACE_URL, uuid4, uuid5

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
    now = write.get("_createdAt") or _now()
    return {
        "messageId": identifier, "projectId": project, "conversationId": conversation,
        "parentMessageId": None, "role": write["role"], "content": write["content"],
        "status": status, "createdAt": now, "completedAt": None if status == "pending" else now,
        "providerContinuationRef": write.get("providerContinuationRef"),
        "providerMessageId": write.get("providerMessageId"),
        **({"hermesSource": write["_hermesSource"]} if write.get("_hermesSource") else {}),
        "linkedPlanDraftId": None, "linkedPlanStepId": None, "linkedArtifactIds": [],
        "linkedEvidenceIds": evidence, "seq": seq,
        "visibleActivities": [_activity("conversation_speaker", write.get("speaker", {}))]
        + ([_activity("conversation_target", write["target"])] if write.get("target") else []),
    }


def _append(service, project: str, kind: str, record: dict) -> None:
    service.record_event(kind, json.dumps(record, ensure_ascii=False, separators=(",", ":")),
                         workspace=project, refs=[record["conversationId"], record["messageId"]])


def conversation_operation(project: str, action: str, arguments: dict):
    """Private storage and post-commit delivery through the existing conversation doorway."""
    project = project_id(project)
    conversation = arguments.get("conversationId")
    if not isinstance(conversation, str) or not conversation.strip():
        raise ValueError("conversation_id_invalid")
    if action not in {"read", "append", "reply", "settle", "process"}:
        raise ValueError("conversation_operation_invalid")
    if arguments.get("seedMessages"):
        raise ValueError("conversation_history_import_disabled")
    if action == "process":
        from .thinkgraph_automatic import process_completed_conversation
        users = arguments.get("userMessageIds")
        assistant = arguments.get("assistantMessageId")
        read_pair(project, conversation, users, assistant)
        wanted = {*users, assistant}
        saved = [item for item in conversation_operation(project, "read", {"conversationId": conversation})
                 if item["messageId"] in wanted]
        if any(not item.get("hermesSource") for item in saved):
            raise ValueError("conversation_database_source_required")
        return process_completed_conversation(project, arguments, saved)
    canonical = None
    if action == "append":
        from .thinkgraph_automatic import database_turn_writes
        canonical = database_turn_writes(project, arguments)
        if canonical == []:
            return []
    with SERVICE_LOCK:
        service = get_service(project)
        store = service.store
        with store.write_transaction():
            scope = store.conn.execute("SELECT id FROM workspaces WHERE name=?", (project,)).fetchone()
            if scope is None and action == "read":
                return []
            workspace = str(scope["id"]) if scope else store.get_or_create_workspace(project)
            messages = _messages(store, workspace, conversation)
            recovered = {}
            if canonical is not None:
                prior = next((item for item in messages if
                              item.get("providerMessageId") == canonical[0]["providerMessageId"]), None)
                if prior and prior.get("hermesSource"):
                    return []  # The same committed admission cannot start another processing pass.
                if prior:
                    # Resume an explicitly identified pair saved before database-owned intake.
                    # Preserve its visible IDs/order and the original append-only source events.
                    by_id = {item["messageId"]: item for item in messages}
                    for write in canonical:
                        old = by_id.get(write["messageId"])
                        if (not old or old["role"] != write["role"] or old.get("hermesSource")
                                or old.get("providerContinuationRef") != write["providerContinuationRef"]):
                            raise ValueError("conversation_recovery_reference_required")
                        recovered[write["messageId"]] = old
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
                writes = canonical if canonical is not None else arguments.get("messages")
                if not isinstance(writes, list) or not writes:
                    raise ValueError("conversation_turn_invalid")
            sequence = max((item["seq"] for item in messages), default=0)
            saved = []
            for offset, write in enumerate(writes, 1):
                record = _message(project, conversation, sequence + offset, write)
                if canonical is not None:
                    record.update(createdAt=write["_savedAt"], completedAt=write["_savedAt"],
                                  hermesSource=write["_hermesSource"])
                    if record["messageId"] in recovered:
                        record["seq"] = recovered[record["messageId"]]["seq"]
                duplicate = store.conn.execute(
                    "SELECT 1 FROM events WHERE workspace_id=? AND kind='conversation_message' "
                    "AND json_extract(content,'$.messageId')=? LIMIT 1", (workspace, record["messageId"]),
                ).fetchone()
                if duplicate and record["messageId"] not in recovered:
                    raise ValueError("conversation_message_id_duplicate")
                _append(service, project, "conversation_message", record)
                saved.append(record)
            return {"inserted": True, "message": saved[0]} if action == "reply" else saved


def record_state_db_pair(
    project: str,
    *,
    profile: str,
    session_id: str,
    user_row: dict,
    assistant_row: dict,
) -> list[dict]:
    """Record one exact committed Hermes pair in Engraphis, idempotently.

    The caller supplies rows read directly from one profile's ``state.db``.  No
    browser or TypeScript message body is accepted on this path.
    """

    def message_id(row_id: int) -> str:
        return "msg_" + str(uuid5(
            NAMESPACE_URL,
            f"hermes:{profile}:{session_id}:row:{row_id}",
        ))

    def saved_at(value: object) -> str:
        return datetime.fromtimestamp(
            float(value), timezone.utc,
        ).isoformat(timespec="milliseconds").replace("+00:00", "Z")

    conversation = str(session_id or "").strip()
    profile = str(profile or "").strip().lower()
    if not conversation or not profile:
        raise ValueError("hermes_pair_identity_invalid")
    rows = (user_row, assistant_row)
    if any(
        type(row.get("id")) is not int
        or row["id"] <= 0
        or row.get("role") != role
        or not isinstance(row.get("content"), str)
        or not row["content"].strip()
        for row, role in zip(rows, ("user", "assistant"), strict=True)
    ):
        raise ValueError("hermes_pair_rows_invalid")
    identifiers = [message_id(row["id"]) for row in rows]
    existing = conversation_operation(project, "read", {"conversationId": conversation})
    found = [item for item in existing if item["messageId"] in identifiers]
    if found:
        if len(found) != 2:
            raise ValueError("hermes_pair_partial_write")
        by_id = {item["messageId"]: item for item in found}
        if any(
            by_id[identifier]["content"] != row["content"]
            or by_id[identifier]["role"] != row["role"]
            for identifier, row in zip(identifiers, rows, strict=True)
        ):
            raise ValueError("hermes_pair_content_changed")
        return sorted(found, key=lambda item: item["seq"])
    user_id, assistant_id = identifiers
    return conversation_operation(project, "append", {
        "conversationId": conversation,
        "messages": [
            {
                "messageId": user_id,
                "role": "user",
                "content": user_row["content"],
                "speaker": {"kind": "user", "label": "You"},
                "target": {
                    "kind": "card", "label": "Main",
                    "cardId": "card_main_chat", "profile": profile,
                },
                "status": "complete",
                "providerContinuationRef": conversation,
                "providerMessageId": f"hermes:{profile}:row:{user_row['id']}",
                "_createdAt": saved_at(user_row.get("timestamp")),
                "_hermesSource": {"profile": profile, "rowId": user_row["id"]},
            },
            {
                "messageId": assistant_id,
                "role": "assistant",
                "content": assistant_row["content"],
                "speaker": {
                    "kind": "card", "label": "Main",
                    "cardId": "card_main_chat", "profile": profile,
                },
                "status": "complete",
                "providerContinuationRef": conversation,
                "providerMessageId": f"hermes:{profile}:row:{assistant_row['id']}",
                "_createdAt": saved_at(assistant_row.get("timestamp")),
                "_hermesSource": {"profile": profile, "rowId": assistant_row["id"]},
            },
        ],
    })


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
        "sourceReferences": [{"conversationId": conversation,
                              "userMessageIds": list(user_ids), "assistantMessageId": assistant_id}],
    }


def source_references(project: str, source: dict) -> list[dict]:
    """Resolve explicit references, or a unique legacy source hash; never guess from recency."""
    references = source.get("sourceReferences")
    if isinstance(references, list):
        return references
    conversation = source.get("conversationId")
    if not conversation or not source.get("user_sha256") or not source.get("main_sha256"):
        return []
    messages = conversation_operation(project, "read", {"conversationId": conversation})
    digest = lambda text: hashlib.sha256(text.encode("utf-8")).hexdigest()
    users = [item for item in messages if item["role"] == "user"
             and digest(item["content"]) == source["user_sha256"]]
    answers = [item for item in messages if item["role"] == "assistant"
               and digest(item["content"]) == source["main_sha256"]
               and item.get("completedAt") == source.get("completedAt")]
    candidates = [{"conversationId": conversation, "userMessageIds": [user["messageId"]],
                   "assistantMessageId": answer["messageId"]}
                  for user in users for answer in answers
                  if user["seq"] < answer["seq"] and user["status"] == answer["status"] == "complete"
                  and user.get("providerContinuationRef") == answer.get("providerContinuationRef")
                  == source.get("hermesSessionId")]
    return candidates if len(candidates) == 1 else []


def source_chunks(project: str, references: list[dict], *, prepare: bool = False) -> list[dict]:
    """Prepare once in the Engraphis conversation ledger, then reuse exact chunks without embedding."""
    from engraphis.backends.extractor import ChunkingExtractor

    messages: dict[str, dict] = {}
    for reference in references:
        read_pair(project, reference["conversationId"], reference["userMessageIds"], reference["assistantMessageId"])
        wanted = {*reference["userMessageIds"], reference["assistantMessageId"]}
        for message in conversation_operation(project, "read", {"conversationId": reference["conversationId"]}):
            if message["messageId"] in wanted:
                messages[message["messageId"]] = message
    result = []
    service = get_service(project)
    with SERVICE_LOCK, service.store.write_transaction():
        workspace = service.store.conn.execute("SELECT id FROM workspaces WHERE name=?", (project,)).fetchone()
        for message in messages.values():
            digest = hashlib.sha256(message["content"].encode("utf-8")).hexdigest()
            row = service.store.conn.execute(
                "SELECT content FROM events WHERE workspace_id=? AND kind='conversation_chunks' "
                "AND json_extract(content,'$.messageId')=?", (workspace["id"], message["messageId"]),
            ).fetchone()
            if row:
                snapshot = json.loads(row["content"])
                if snapshot["sourceSha256"] != digest:
                    raise ValueError("source_chunk_original_changed")
                chunks = snapshot["chunks"]
            elif prepare:
                extracted = ChunkingExtractor(max_chunks=max(200, len(message["content"]))).extract(message["content"])
                chunks = [{"id": f"{message['messageId']}:{index}", "index": index, "count": len(extracted),
                           "heading": chunk.title, "content": chunk.content, "metadata": chunk.metadata,
                           "sha256": hashlib.sha256(chunk.content.encode("utf-8")).hexdigest()}
                          for index, chunk in enumerate(extracted)]
                _append(service, project, "conversation_chunks", {
                    "conversationId": message["conversationId"], "messageId": message["messageId"],
                    "sourceSha256": digest, "chunks": chunks,
                })
            else:
                raise ValueError("source_chunks_not_prepared")
            result.extend({**chunk, "messageId": message["messageId"],
                           "conversationId": message["conversationId"], "role": message["role"],
                           "createdAt": message["createdAt"],
                           "sourceReferences": [ref for ref in references if message["messageId"] in
                                                [*ref["userMessageIds"], ref["assistantMessageId"]]]}
                          for chunk in chunks)
    return result


def read_source_exchanges(project: str, memory_id: str, *, include_exchange: bool = False) -> dict:
    """Hydrate canonical messages only on demand, after exact owner/Project memory validation."""
    from .engraphis import project_principal

    service = get_service(project)
    with SERVICE_LOCK:
        workspace = service.store.conn.execute("SELECT id FROM workspaces WHERE name=?", (project,)).fetchone()
        memory = service.store.get_memory(memory_id)
        if workspace is None or memory is None or memory.workspace_id != workspace["id"]:
            raise ValueError("source_memory_not_in_project")
        metadata = memory.metadata or {}
        origin = metadata.get("thinkgraph_origin") or {}
        source = origin.get("source_pair", {})
        cited = origin.get("source_chunks", [])
        if "source_index" in metadata:
            source = {"sourceReferences": metadata["source_index"].get("sourceReferences", [])}
            cited = [{"id": metadata["source_index"]["key"],
                      "sha256": hashlib.sha256(memory.content.encode("utf-8")).hexdigest()}]
        references = source_references(project, source)
    sources = []
    for reference in references:
        try:
            pair = read_pair(project, reference["conversationId"], reference["userMessageIds"], reference["assistantMessageId"])
            messages = conversation_operation(project, "read", {"conversationId": reference["conversationId"]})
            wanted = set([*reference["userMessageIds"], reference["assistantMessageId"]])
            chunks = []
            for citation in cited:
                if citation["id"].rsplit(":", 1)[0] not in wanted:
                    continue
                row = service.store.conn.execute(
                    "SELECT id FROM memories WHERE workspace_id=? AND claim_kind='conversation_source' "
                    "AND json_extract(metadata,'$.source_index.key')=? AND expired_at IS NULL AND valid_to IS NULL",
                    (workspace["id"], citation["id"]),
                ).fetchone()
                indexed = service.store.get_memory(row["id"]) if row else None
                if indexed is None or hashlib.sha256(indexed.content.encode("utf-8")).hexdigest() != citation["sha256"]:
                    chunks.append({"id": citation["id"], "status": "unavailable"})
                    continue
                item = indexed.metadata["source_index"]
                chunks.append({"id": citation["id"], "memoryId": indexed.id, "status": "available",
                               "content": indexed.content, "heading": item.get("heading"),
                               "messageId": item["messageId"], "role": item["role"],
                               "createdAt": next(message["createdAt"] for message in messages if message["messageId"] == item["messageId"]),
                               "index": item["chunk"], "count": item["chunks"]})
            order = {message["messageId"]: message["seq"] for message in messages}
            chunks.sort(key=lambda item: (order.get(item["id"].rsplit(":", 1)[0], 0),
                                         int(item["id"].rsplit(":", 1)[1])))
            sources.append({"status": "available", **reference, "completedAt": pair["completedAt"],
                            "chunks": chunks,
                            **({"messages": [item for item in messages if item["messageId"] in wanted]}
                               if include_exchange else {})})
        except (ValueError, KeyError):
            sources.append({"status": "unavailable", **reference})
    return {"projectId": project, "ownerUserId": project_principal(project)["id"],
            "memoryId": memory_id, "sources": sources,
            "status": "available" if sources and all(s["status"] == "available" for s in sources) else "unavailable"}


def register_source_pair(project: str, pair: str, reference: dict) -> None:
    """Record only source pointers in the existing event ledger, once per exact pair."""
    read_pair(project, reference["conversationId"], reference["userMessageIds"], reference["assistantMessageId"])
    service = get_service(project)
    record = {"pairReference": pair, **reference}
    with SERVICE_LOCK, service.store.write_transaction():
        workspace = service.store.conn.execute("SELECT id FROM workspaces WHERE name=?", (project,)).fetchone()
        row = service.store.conn.execute(
            "SELECT content FROM events WHERE workspace_id=? AND kind='conversation_pair' "
            "AND json_extract(content,'$.pairReference')=?", (workspace["id"], pair),
        ).fetchone()
        if row:
            if json.loads(row["content"]) != record:
                raise ValueError("conversation_pair_reference_conflict")
            return
        service.record_event("conversation_pair", json.dumps(record, ensure_ascii=False),
                             workspace=project, refs=[pair, *reference["userMessageIds"], reference["assistantMessageId"]])


def index_source_chunks(project: str, chunks: list[dict]) -> dict:
    """Embed the same chunks used for extraction through the existing Engraphis writer."""
    from engraphis.core.engine import MAX_FACTS_PER_BATCH
    from engraphis.core.interfaces import FactSpec, MemoryType, Scope
    from .engraphis import THINKGRAPH_INTAKE_LOCK

    service = get_service(project)
    with THINKGRAPH_INTAKE_LOCK:
        workspace = service.store.conn.execute("SELECT id FROM workspaces WHERE name=?", (project,)).fetchone()
        if workspace is None:
            return {"indexed": 0, "existing": 0, "chunks": 0}
        existing = {str(row["source_key"]): row for row in service.store.conn.execute(
            "SELECT content,valid_to,expired_at,json_extract(metadata,'$.source_index.key') AS source_key FROM memories "
            "WHERE workspace_id=? AND claim_kind='conversation_source'", (workspace["id"],),
        ).fetchall()}
        specs = []
        total = 0
        skipped = 0
        for chunk in chunks:
            key = chunk["id"]
            total += 1
            if key in existing:
                if existing[key]["valid_to"] is not None or existing[key]["expired_at"] is not None:
                    raise ValueError("source_chunk_index_not_current")
                if existing[key]["content"] != chunk["content"]:
                    raise ValueError("source_chunk_content_changed")
                skipped += 1
                continue
            specs.append(FactSpec(
                    content=chunk["content"], title=chunk["heading"],
                    mtype=MemoryType.EPISODIC, claim_kind="conversation_source",
                    subject_key=key,
                    metadata={"source_index": {"key": key, "conversationId": chunk["conversationId"],
                              "messageId": chunk["messageId"], "role": chunk["role"], "heading": chunk["heading"],
                              "chunk": chunk["index"], "chunks": chunk["count"], "sourceReferences": chunk["sourceReferences"]},
                              **chunk["metadata"], "consolidation_exempt": True},
                    provenance={"source": f"conversation:{key}", "trusted": False,
                                "trust_origin": "canonical_conversation", "review_state": "pending"},
            ))
        written = []
        for offset in range(0, len(specs), MAX_FACTS_PER_BATCH):
            batch = specs[offset:offset + MAX_FACTS_PER_BATCH]

            def existing_batch():
                keys = [spec.metadata["source_index"]["key"] for spec in batch]
                rows = service.store.conn.execute(
                    "SELECT id,json_extract(metadata,'$.source_index.key') AS source_key FROM memories "
                    "WHERE workspace_id=? AND json_extract(metadata,'$.source_index.key') IN ("
                    + ",".join("?" for _ in keys) + ")", (workspace["id"], *keys),
                ).fetchall()
                if not rows:
                    return None
                found = {row["source_key"]: row["id"] for row in rows}
                if len(found) != len(keys):
                    raise RuntimeError("source_index_changed_retry_read")
                return [{"id": found[key], "op": "noop"} for key in keys]

            written.extend(service.engine.remember_many(
                batch, workspace_id=workspace["id"],
                scope=Scope.WORKSPACE, resolve_conflicts=False, _automatic_graph_enrichment=False,
                _transactional_validator=existing_batch,
            ))
        return {"indexed": sum(item.get("op") == "add" for item in written),
                "existing": skipped + sum(item.get("op") == "noop" for item in written), "chunks": total,
                "embedding": service.engine.embedding_space,
                "quarantined": sum(item.get("op") == "quarantined" for item in written),
                "operations": [item.get("op") for item in written]}


def index_source_exchanges(project: str, conversation: str) -> dict:
    """Explicit historical indexing; ordinary intake indexes only after extraction."""
    service = get_service(project)
    workspace = service.store.conn.execute("SELECT id FROM workspaces WHERE name=?", (project,)).fetchone()
    if workspace is None:
        return {"indexed": 0, "existing": 0, "chunks": 0}
    origins = service.store.conn.execute(
        "SELECT DISTINCT json_extract(metadata,'$.thinkgraph_origin') AS origin FROM memories "
        "WHERE workspace_id=? AND json_extract(metadata,'$.thinkgraph_origin.source_pair.conversationId')=?",
        (workspace["id"], conversation),
    ).fetchall()
    for row in origins:
        origin = json.loads(row["origin"])
        refs = source_references(project, origin["source_pair"])
        if len(refs) == 1:
            register_source_pair(project, origin["completed_pair_reference"], refs[0])
    pairs = [json.loads(row["content"]) for row in service.store.conn.execute(
        "SELECT content FROM events WHERE workspace_id=? AND kind='conversation_pair' "
        "AND json_extract(content,'$.conversationId')=?", (workspace["id"], conversation),
    ).fetchall()]
    return index_source_chunks(project, source_chunks(project, pairs, prepare=True))


def search_source_exchanges(project: str, query: str, limit: int = 5) -> dict:
    """Engraphis semantic recall returns derived chunks with canonical source pointers."""
    if (not isinstance(query, str) or not query.strip() or len(query) > 16000
            or isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 20):
        raise ValueError("source_search_invalid")
    service = get_service(project)
    workspace = service.store.conn.execute("SELECT id FROM workspaces WHERE name=?", (project,)).fetchone()
    if workspace is None:
        return {"projectId": project, "matches": [], "embedding": service.engine.embedding_space}
    from engraphis.core.interfaces import MemoryType
    result = service.engine.recall(query, workspace_id=workspace["id"],
                                   mtypes=[MemoryType.EPISODIC], k=100, token_budget=8000,
                                   include_untrusted=True, reinforce=False)
    if result.degraded_mode or not result.semantic_support or not result.vector_search_ready:
        raise RuntimeError("source_semantic_retrieval_unavailable")
    matches = []
    for hit in result.chunks:
        memory = service.store.get_memory(hit["id"])
        if memory is None or memory.workspace_id != workspace["id"]:
            continue
        source = (memory.metadata or {}).get("source_index")
        if not isinstance(source, dict):
            continue
        matches.append({"memoryId": memory.id, "excerpt": memory.content, "source": source})
        if len(matches) == limit:
            break
    return {"projectId": project, "matches": matches, "embedding": service.engine.embedding_space}
