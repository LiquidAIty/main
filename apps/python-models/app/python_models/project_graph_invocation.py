"""Project graph context bound to native admissions and existing source events."""
# Graph + less = more: less code that does the same work as more code is more useful.
# Entity names the feature; Relationship explains why this file belongs and what it contributes.
# Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
# Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
# Entity: Project Knowledge Graph
# Relationship: This file reads the admitted Project map and freezes selected graph context and research origins in the existing account-scoped source-event ledger.
# Entity: Authentication
# Relationship: This file resolves executing native admissions against saved application events and authenticated ownership to determine Project scope and research mode.
# Entity: KnowGraph
# Relationship: This file prepares stable Main-directed or committed-Think research references for the existing KnowGraph delivery path without invoking the researcher.

from __future__ import annotations

from contextvars import ContextVar
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re
import sqlite3

from .engraphis import SERVICE_LOCK, get_service, project_principal

CURRENT_GRAPH_INVOCATION = ContextVar("project_graph_invocation", default=None)
REQUEST_MARKER = "PROJECT_RESEARCH_REQUEST:"
ROOT = Path(__file__).resolve().parents[4]


def rails_context(operation: str, **payload) -> dict:
    """Use the running source owner; MCP must not cold-load another embedding engine."""
    import os
    from urllib.request import Request
    from urllib.error import HTTPError
    from app import mcp_auth
    from app.backend_operation_transport import open_backend_request, validated_backend_origin
    origin = validated_backend_origin(os.environ.get("PYTHON_RAILS_URL", ""))
    request = Request(origin + "/knowgraph/research/context", method="POST",
        headers={"Content-Type": "application/json", "X-LiquidAIty-Internal-MCP-Secret": mcp_auth.INTERNAL_MCP_SECRET},
        data=json.dumps({"operation": operation, **payload}).encode())
    try:
        with open_backend_request(request, timeout_seconds=15) as response:
            return json.loads(response.read())
    except HTTPError as error:
        raise ValueError(json.loads(error.read()).get("detail", "research_context_unavailable")) from None


async def graph_context_tool(operation: str, **arguments):
    import asyncio
    from app import mcp_auth
    scope = CURRENT_GRAPH_INVOCATION.get()
    if scope is None:
        raise ValueError("graph_invocation_required")
    arguments.pop("projectId", None)  # Rails re-resolves it from the same native admission.
    return await asyncio.to_thread(rails_context, operation,
        principal=mcp_auth.internal_mcp_principal(), admissionId=scope["nativeAdmissionId"], arguments=arguments)


def local_context_operation(operation: str, payload: dict) -> dict:
    if operation == "names":
        from .canonical_entity_directory import build_canonical_entity_directory
        if project_principal(payload["projectId"])["id"] != payload["ownerUserId"]:
            raise ValueError("research_project_owner_changed")
        return build_canonical_entity_directory(payload["projectId"])
    scope = resolve_native_invocation(payload["principal"], payload["admissionId"])
    if operation == "resolve":
        return scope
    token = CURRENT_GRAPH_INVOCATION.set(scope)
    try:
        if operation == "read_map":
            return read_map(projectId=scope["projectId"])
        if operation == "prepare_research":
            arguments = payload.get("arguments") or {}
            if set(arguments) - {"entityNames", "thinkIds", "focus", "context"}:
                raise ValueError("research_arguments_invalid")
            return prepare_research(projectId=scope["projectId"], **arguments)
        raise ValueError("research_operation_invalid")
    finally:
        CURRENT_GRAPH_INVOCATION.reset(token)


def native_admission(profile: str, admission_id: str) -> dict:
    """Read Hermes' actual admission; never infer identity from recent chat text."""
    if not re.fullmatch(r"[a-zA-Z0-9_-]+", profile) or not re.fullmatch(r"(?:[0-9a-f]{32}|bot:[A-Za-z0-9_-]{1,160})", admission_id):
        raise ValueError("graph_native_admission_invalid")
    path = ROOT / "HermesLatest" / ".hermes" / "profiles" / profile / "state.db"
    with sqlite3.connect(path.as_uri() + "?mode=ro", uri=True) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute(
            "SELECT admission_id,target_session_id,payload_json,status FROM session_admissions "
            "WHERE (admission_id=? OR request_id=?) AND status='started'",
            (admission_id, admission_id),
        ).fetchall()
    if len(rows) != 1:
        raise ValueError("graph_native_admission_not_executing")
    row = rows[0]
    return {**dict(row), "payload": json.loads(row["payload_json"])}


def _event(store, kind: str, field: str, value: str):
    # Fields and kinds come only from the literal callers below.
    rows = store.conn.execute(
        f"SELECT content FROM events WHERE kind=? AND json_extract(content,'$.{field}')=? LIMIT 2",
        (kind, value),
    ).fetchall()
    if len(rows) != 1:
        raise ValueError("graph_invocation_reference_unavailable_or_ambiguous")
    return json.loads(rows[0]["content"])


def resolve_native_invocation(principal: dict, admission_id: str) -> dict:
    if principal.get("kind") != "card-runtime" or principal.get("profile") not in {"main", "knowgraph"}:
        raise ValueError("graph_invocation_profile_not_authorized")
    profile = principal["profile"]
    native = native_admission(profile, admission_id)
    # A profile credential authenticates owner/profile only. The immutable application
    # event below, not the credential's mutable Project selection, supplies this turn's scope.
    service = get_service(principal["projectId"])
    with SERVICE_LOCK:
        text = str(native["payload"].get("text") or "")
        descriptor = native["payload"].get("local_automation_v1") or {}
        author = descriptor.get("turn_author")
        marker = text.partition(REQUEST_MARKER)
        if profile == "knowgraph" and marker[1]:
            request_id = marker[2].partition("\n")[0].strip()
            if not re.fullmatch(r"[0-9a-f]{64}", request_id):
                raise ValueError("research_request_reference_invalid")
            request = _event(service.store, "graph_research_request", "requestId", request_id)
            expected_author = "bot:main" if request["mode"] == "main" else None
            actual_author = author.get("id") if isinstance(author, dict) else None
            if actual_author != expected_author or not text.endswith(_research_message(request)):
                raise ValueError("research_request_caller_mismatch")
            result = deepcopy(request)
        else:
            if author is not None:
                raise ValueError("graph_unscoped_bot_delivery")
            record = _event(service.store, "conversation_message", "providerMessageId",
                            f"hermes:{profile}:admission:{native['admission_id']}")
            if record.get("role") != "user" or record.get("providerContinuationRef") != native["target_session_id"]:
                raise ValueError("graph_conversation_admission_mismatch")
            result = {"projectId": record["projectId"], "mode": "main", "thinkIds": [],
                      "entityNames": [], "focus": record["content"], "context": "",
                      "requestId": admission_id, "ownerUserId": principal["ownerUserId"]}
        if (result["ownerUserId"] != principal["ownerUserId"]
                or project_principal(result["projectId"])["id"] != principal["ownerUserId"]):
            raise ValueError("graph_invocation_owner_mismatch")
    return {**result, "profile": profile, "nativeAdmissionId": native["admission_id"],
            "nativeSessionId": native["target_session_id"]}


def read_map(*, projectId: str) -> dict:
    invocation = CURRENT_GRAPH_INVOCATION.get()
    if invocation is None or invocation["projectId"] != projectId:
        raise ValueError("graph_invocation_required")
    return _map_packet(invocation)


def _map_packet(invocation: dict) -> dict:
    from .project_entity_map import build_project_entity_map, append_project_entity_map
    projectId = invocation["projectId"]
    graph = deepcopy(invocation.get("map") or build_project_entity_map(projectId))
    # Zero-weight labels carry no candidate information and need not consume
    # the native message budget. Preserve the recorded provider map unchanged.
    for relationship in graph["relationships"]:
        state = relationship.get("state")
        if isinstance(state, dict) and isinstance(state.get("distribution"), dict):
            state["distribution"] = {label: weight for label, weight in state["distribution"].items()
                                     if not (type(weight) in (int, float) and weight == 0)}
    context = {"ownerUserId": invocation["ownerUserId"], "projectId": projectId,
               "conversationId": projectId, "pairReference": invocation["requestId"],
               "text": append_project_entity_map("", graph), "counts": graph["counts"],
               "mapSha256": graph["sha256"], "readDurationMs": graph.get("readDurationMs", 0)}
    return {"projectMapContext": context,
            "research": {key: invocation[key] for key in
                         ("requestId", "mode", "thinkIds", "entityNames", "focus", "context")},
            "selectedContext": invocation.get("selectedContext", [])}


def _research_message(request: dict) -> str:
    # The native delivery carries its actual task, using the same prepared
    # envelope as ThinkGraph. The recorded request still owns write authority.
    packet = _map_packet(request)
    context = packet.pop("projectMapContext")
    return REQUEST_MARKER + request["requestId"] + "\n" + json.dumps({
        "input": json.dumps(packet, ensure_ascii=False, separators=(",", ":")), "projectMapContext": context,
    }, ensure_ascii=False, separators=(",", ":"))


def prepare_research(*, projectId: str, entityNames: list[str], thinkIds: list[str],
                     focus: str, context: str = "", automatic_pair: str | None = None) -> dict:
    """Freeze one research request, not a task queue or another graph."""
    from .project_entity_map import build_project_entity_map
    from .conversations import read_source_exchanges
    from .engraphis_operations import inspect
    from .knowgraph_exact_reads import read_knowgraph_entity_knows
    invocation = CURRENT_GRAPH_INVOCATION.get()
    if automatic_pair is None and (invocation is None or invocation["profile"] != "main"
                                   or invocation["projectId"] != projectId):
        raise ValueError("research_main_invocation_required")
    if (not isinstance(entityNames, list) or not isinstance(thinkIds, list)
            or len(entityNames) > 12 or len(thinkIds) > 12 or not (entityNames or thinkIds)
            or any(not isinstance(value, str) or not value for value in [*entityNames, *thinkIds])
            or not isinstance(focus, str) or not focus.strip() or len(focus) > 16000
            or not isinstance(context, str) or len(context) > 16000):
        raise ValueError("research_selection_invalid")
    owner = project_principal(projectId)["id"]
    identity = {"projectId": projectId, "mode": "automatic" if automatic_pair else "main",
                "sourceRequest": automatic_pair or invocation["nativeAdmissionId"],
                "entityNames": list(dict.fromkeys(entityNames)), "thinkIds": list(dict.fromkeys(thinkIds)),
                "focus": focus.strip(), "context": context}
    request_id = hashlib.sha256(json.dumps(identity, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    service = get_service(projectId)
    with SERVICE_LOCK:
        existing = service.store.conn.execute(
            "SELECT content FROM events WHERE kind='graph_research_request' AND json_extract(content,'$.requestId')=?",
            (request_id,),
        ).fetchone()
        if existing:
            return {"requestId": request_id, "message": _research_message(json.loads(existing["content"]))}
    graph = build_project_entity_map(projectId)
    by_name = {item["canonicalName"]: item for item in graph["entities"]}
    selected = []
    names = list(identity["entityNames"])
    for memory_id in identity["thinkIds"]:
        memory = inspect(projectId, "engraphisMemoryId", memory_id)["memory"]
        think = memory.get("metadata", {}).get("structured_extraction", {}).get("think")
        if not isinstance(think, dict) or think.get("entity") not in by_name:
            raise ValueError("research_think_not_current")
        names.append(think["entity"])
        selected.append({"thinkId": memory_id, "think": think,
                         "sources": read_source_exchanges(projectId, memory_id)["sources"]})
    for name in dict.fromkeys(names):
        if name not in by_name:
            raise ValueError("research_entity_not_current")
        entity = by_name[name]
        if entity.get("graphitiEntityId"):
            selected.append({"entityName": name, "knows": read_knowgraph_entity_knows(
                projectId, entity["graphitiEntityId"], limit=2)})
    request = {**identity, "entityNames": list(dict.fromkeys(names)), "requestId": request_id,
               "ownerUserId": owner, "map": graph, "selectedContext": selected}
    from .data_anchor_contract import GRAPH_CONTEXT_BYTE_LIMIT
    message = _research_message(request)
    if len(message) > 16000:  # Hermes message_agent's existing hard limit.
        raise ValueError("research_context_exceeds_native_message_limit")
    if len(message.encode()) > min(GRAPH_CONTEXT_BYTE_LIMIT, 60000):
        raise ValueError("research_context_limit_exceeded")
    with SERVICE_LOCK, service.store.write_transaction():
        existing = service.store.conn.execute(
            "SELECT content FROM events WHERE kind='graph_research_request' AND json_extract(content,'$.requestId')=?",
            (request_id,),
        ).fetchone()
        if not existing:
            service.record_event("graph_research_request", json.dumps(request, ensure_ascii=False),
                                 workspace=projectId, refs=[request_id, *identity["thinkIds"]])
    return {"requestId": request_id, "message": message}


def operation_definitions(external):
    from functools import partial
    from .operation_definition import OperationDefinition
    definitions = []
    for name, handler, properties, required, access in (
        ("read_map", partial(graph_context_tool, "read_map"), {}, [], "read"),
        ("prepare_research", partial(graph_context_tool, "prepare_research"), {
            "entityNames": {"type": "array", "maxItems": 12, "items": {"type": "string", "minLength": 1}},
            "thinkIds": {"type": "array", "maxItems": 12, "items": {"type": "string", "minLength": 1}},
            "focus": {"type": "string", "minLength": 1, "maxLength": 16000},
            "context": {"type": "string", "maxLength": 16000},
        }, ["entityNames", "thinkIds", "focus"], "write"),
    ):
        definitions.append(OperationDefinition(
            canonical_id="project_graph." + name,
            title="Read invocation Project map" if access == "read" else "Prepare scoped research context",
            description=("Read the current native admission's authorized compact Project map and selected research context."
                         if access == "read" else
                         "Prepare an immutable research reference for Main's existing message_agent call. Does not invoke an agent or write graph knowledge."),
            parameters_schema={"type": "object", "properties": {
                "projectId": {"type": "string", "minLength": 1}, **properties},
                "required": ["projectId", *required], "additionalProperties": False},
            output_schema={"type": "object"}, handler=handler, available=True, publishers=external,
            access=access, namespace="project_graph", grant_eligible=True,
            grant_profiles=frozenset({"main", "knowgraph"} if access == "read" else {"main"}),
            annotations={"readOnlyHint": access == "read", "destructiveHint": False,
                         "idempotentHint": True, "openWorldHint": False},
            server_injected_arguments=frozenset({"projectId"}),
            dispatcher_context_arguments=frozenset({"projectId"}),
        ))
    return definitions


def prepare_automatic_research(project: str, pair: str, think_id: str) -> dict:
    from .saved_cards import project_research_policy
    from .engraphis_operations import inspect
    if not project_research_policy(project)["enabled"]:
        return {"enabled": False}
    memory = inspect(project, "engraphisMemoryId", think_id)["memory"]
    metadata = memory.get("metadata") or {}
    think = metadata.get("structured_extraction", {}).get("think", {})
    origin = metadata.get("thinkgraph_origin", {})
    if (origin.get("completed_pair_reference") != pair or think.get("researchRequested") is not True
            or memory.get("valid_to") is not None or memory.get("expired_at") is not None):
        raise ValueError("automatic_research_committed_think_required")
    return {"enabled": True, **prepare_research(projectId=project, entityNames=[think["entity"]],
        thinkIds=[think_id], focus=think["summary"], context=think.get("detail", ""), automatic_pair=pair)}
