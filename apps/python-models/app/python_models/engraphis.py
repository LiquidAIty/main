"""ThinkGraph through Engraphis's public Python service and native MCP tools.

Python rails owns the service. Workspace binding comes from the authenticated
project; neither tool callers nor the browser choose another database or tenant.
"""
from __future__ import annotations

import atexit
import asyncio
import hashlib
import json
import os
from contextvars import ContextVar
from pathlib import Path
import re
import threading
from typing import Any

DATABASE = Path(__file__).resolve().parents[4] / "db" / "thinkgraph.sqlite"
MODEL = "local:sentence-transformers/all-MiniLM-L6-v2"
MODEL_REVISION = "1110a243fdf4706b3f48f1d95db1a4f5529b4d41"
READ_TOOLS = frozenset(['engraphis_code_impact', 'engraphis_code_path', 'engraphis_conflict_review', 'engraphis_context_savings', 'engraphis_discover_actions', 'engraphis_execute_read', 'engraphis_export_code_graph', 'engraphis_export_receipts', 'engraphis_get_memory', 'engraphis_recall_context', 'engraphis_recall_proactive', 'engraphis_receipts', 'engraphis_search_code', 'engraphis_stats', 'engraphis_timeline', 'engraphis_verify_receipts', 'engraphis_why'])
WRITE_TOOLS = frozenset(['engraphis_answer', 'engraphis_check_update', 'engraphis_consolidate', 'engraphis_correct', 'engraphis_end_session', 'engraphis_execute_action', 'engraphis_forget', 'engraphis_index_repo', 'engraphis_ingest', 'engraphis_ingest_postgres_schema', 'engraphis_link', 'engraphis_link_symbol', 'engraphis_pin', 'engraphis_proactive_context', 'engraphis_promote', 'engraphis_recall', 'engraphis_recall_grounded', 'engraphis_record_event', 'engraphis_remember', 'engraphis_remember_many', 'engraphis_retire', 'engraphis_secure_erase', 'engraphis_session', 'engraphis_start_session', 'engraphis_update_memory'])
_service = None
_lock = threading.RLock()
_extraction_scope = ContextVar("thinkgraph_extraction_scope", default=None)


class AccountExtractionClient:
    """Engraphis LLM protocol using the saved ThinkGraph account selection."""
    provider = "openai-codex"

    @property
    def model(self):
        binding = _extraction_scope.get()
        return binding.get("model", "") if binding else ""

    def extract_json(self, prompt: str, schema: dict):
        from engraphis.backends.extractor import StructuredLLMExtractor
        return json.loads(self.chat(
            [{"role": "user", "content": prompt}],
            system=StructuredLLMExtractor._SYSTEM_PROMPT + "\nJSON schema:\n"
            + json.dumps(schema, ensure_ascii=False),
        ))

    def chat(self, messages, system=""):
        import httpx
        from .card_domain import load_deck
        binding = _extraction_scope.get()
        if not binding:
            raise ValueError("thinkgraph_extraction_scope_missing")
        saved = load_deck(binding["projectId"], binding["deckId"])
        cards = [card for card in saved["deck"]["nodes"] if card.get("runtime") == {
            "kind": "hermes", "mode": "delegate", "profile": "thinkgraph"}]
        if len(cards) != 1:
            raise ValueError("thinkgraph_extraction_model_binding_missing")
        options = cards[0].get("runtimeOptions", {})
        if options.get("provider") != "openai" or options.get("accessMode") != "chatgpt-account":
            raise ValueError("thinkgraph_extraction_account_selection_required")
        model = options.get("providerModelId")
        if not isinstance(model, str) or not model:
            raise ValueError("thinkgraph_extraction_model_missing")
        secret = os.environ.get("LIQUIDAITY_INTERNAL_MCP_SECRET", "")
        if len(secret) < 32:
            raise ValueError("thinkgraph_extraction_transport_unavailable")
        binding["model"] = model
        response = httpx.post(
            os.environ.get("MAIN_BACKEND_URL", "http://127.0.0.1:4000").rstrip("/")
            + "/api/thinkgraph/extraction-completion",
            headers={"x-internal-secret": secret}, timeout=135,
            json={"profile": "thinkgraph", "model": model,
                  "reasoningEffort": options.get("reasoningEffort", "low"),
                  "messages": [{"role": "system", "content": system}, *messages]},
        )
        response.raise_for_status()
        result = response.json()
        if result.get("provider") != self.provider or result.get("model") != model:
            raise ValueError("thinkgraph_extraction_model_mismatch")
        binding["completion"] = {key: result.get(key) for key in ("model", "provider", "responseModel", "usage")}
        return result["content"]

def project_id(value: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]+", value):
        raise ValueError("thinkgraph_project_id_invalid")
    return value


def get_service():
    global _service
    with _lock:
        if _service is None:
            from engraphis.service import MemoryService
            from engraphis.backends.extractor import StructuredLLMExtractor
            from engraphis.mcp_server import set_service
            DATABASE.parent.mkdir(parents=True, exist_ok=True)
            service = MemoryService.create(
                str(DATABASE), embed_model=MODEL, embed_revision=MODEL_REVISION,
                require_immutable_models=True, require_exact_backends=True,
                extractor="none",
                retention_supervisor="none", allow_automatic_critical_retention=False,
            )
            service.engine.extractor = StructuredLLMExtractor(AccountExtractionClient())
            set_service(service)
            _service = service
        return _service


def close_engine():
    global _service
    with _lock:
        if _service is not None:
            _service.close()
            _service = None


atexit.register(close_engine)


async def _tool_catalog():
    from engraphis.mcp_server import classic_mcp, smart_mcp
    catalog = {tool.name: (smart_mcp, tool) for tool in await smart_mcp.list_tools()}
    # The individually named interface keeps the full argument set for shared names.
    catalog.update({tool.name: (classic_mcp, tool) for tool in await classic_mcp.list_tools()})
    return catalog


async def native_tools() -> list[dict]:
    result = []
    for _, tool in (await _tool_catalog()).values():
        item = tool.model_dump(exclude_none=True)
        schema = item["inputSchema"]
        schema.get("properties", {}).pop("workspace", None)
        if "workspace" in schema.get("required", []):
            schema["required"].remove("workspace")
        schema["additionalProperties"] = False
        if tool.name == "engraphis_recall_context":
            item["annotations"].update(readOnlyHint=True, idempotentHint=True)
        result.append(item)
    return result


async def invoke_tool(project: str, name: str, arguments: dict) -> dict:
    # Native FastMCP synchronous tools execute on their caller's thread. Keep
    # embedding and SQLite work off Python rails' shared HTTP event loop.
    return await asyncio.to_thread(_invoke_tool_sync, project, name, arguments)


def _invoke_tool_sync(project: str, name: str, arguments: dict) -> dict:
    with _lock:
        token = _extraction_scope.set({"projectId": project_id(project), "deckId": "deck_builder"})
        try:
            return asyncio.run(_invoke_tool(project, name, arguments))
        finally:
            _extraction_scope.reset(token)


async def _invoke_tool(project: str, name: str, arguments: dict) -> dict:
    catalog = await _tool_catalog()
    if name not in catalog:
        raise ValueError("thinkgraph_tool_unavailable")
    project = project_id(project)
    if "workspace" in arguments:
        raise ValueError("thinkgraph_scope_is_owned_by_project")
    server, tool = catalog[name]
    arguments = dict(arguments)
    if "workspace" in tool.inputSchema.get("properties", {}):
        arguments["workspace"] = project
    if name in {"engraphis_execute_read", "engraphis_execute_action"}:
        from engraphis.mcp_server import _resolve_capability
        capability = _resolve_capability(arguments.get("capability_id"), arguments.get("schema_digest"))
        if capability is not None and "workspace" in capability.input_schema.get("properties", {}):
            nested = dict(arguments.get("arguments") or {})
            if "workspace" in nested and nested["workspace"] != project:
                raise ValueError("thinkgraph_scope_is_owned_by_project")
            nested["workspace"] = project
            arguments["arguments"] = nested
    service = get_service()
    if name == "engraphis_recall_context":
        from engraphis.mcp_server import _apply_response_budget
        max_response_tokens = arguments.pop("max_response_tokens", None)
        result = service.recall(response_mode="compact", record_receipt=False,
                                reinforce=False, **arguments)
        if not result.get("semantic_support") or result.get("degraded_mode"):
            raise RuntimeError("thinkgraph_semantic_search_unavailable")
        by_id = {record["id"]: record for record in result.pop("memories", [])}
        result["sources"] = [{**source, **{key: by_id.get(source["id"], {}).get(key)
            for key in ("title", "provenance")}} for source in result.pop("packed_sources", [])]
        return _apply_response_budget(result, max_response_tokens)
    response = await server.call_tool(name, arguments)
    content = response.content if hasattr(response, "content") else response[0] if isinstance(response, tuple) else response
    if getattr(response, "isError", False):
        raise ValueError(" ".join(getattr(block, "text", "") for block in content))
    for block in content:
        if getattr(block, "type", None) == "text":
            if block.text.startswith("Error:"):
                raise ValueError(block.text)
            data = json.loads(block.text)
            if isinstance(data, dict):
                if data.get("ok") is False or data.get("error"):
                    raise ValueError(json.dumps(data))
                return data
    raise RuntimeError("thinkgraph_result_invalid")


def inspect(project: str, native_id: str) -> dict:
    service = get_service()
    project = project_id(project)
    if not native_id.startswith("mem_"):
        return {"entity": service.graph_entity(native_id, workspace=project,
                    include_weak_cooccurrence=False)}
    result = service.inspect(native_id, workspace=project)
    result["memory"]["metadata"] = service.store.get_memory(native_id).metadata
    # Preserve directional composite identities from the native link store.
    # The public inspector has already authorized the neighboring records.
    neighbors = {link["id"] for link in result["links"]}
    result["nativeLinks"] = [link for link in service.store.get_links(native_id)
        if (link["b"] if link["a"] == native_id else link["a"]) in neighbors]
    return result


def private_operation(project: str, operation: str, arguments: dict) -> dict:
    """Application operations outside model tool grants."""
    from .thinkgraph import validate_cognition
    project = project_id(project)
    native_id = str(arguments.get("nativeId") or "")
    if operation == "retire":
        with _lock:
            return get_service().retire(native_id, workspace=project,
                reason="Removed in ThinkGraph", actor="user")
    if operation == "delete_workspace":
        if arguments != {"confirmed": True}:
            raise ValueError("thinkgraph_workspace_delete_requires_confirmation")
        with _lock:
            return get_service().delete_workspace(project)
    result = inspect(project, native_id)
    if operation == "inspect":
        return result
    if "memory" not in result:
        raise ValueError("native_thinkgraph_question_required")
    native_id = result["memory"]["id"]
    if operation != "attach_answer":
        raise ValueError("thinkgraph_operation_unavailable")
    with _lock:
        service = get_service()
        record = service.store.get_memory(native_id)
        cognition = dict(record.metadata.get("cognition") or {})
        if cognition.get("memoryCategory") != "question":
            raise ValueError("native_thinkgraph_question_required")
        evidence = arguments["evidence"]
        refs = list(cognition.get("answerRefs", []))
        if evidence not in refs:
            refs.append(evidence)
        cognition.update(answerRefs=refs, questionStatus=arguments["status"])
        record.metadata = {**record.metadata, "cognition": validate_cognition(cognition, project)}
        service.store.add_memory(record)
        return inspect(project, native_id)


def projection(project: str, native_id: str | None = None) -> dict:
    service = get_service()
    project = project_id(project)
    # Engraphis supplies the scene. This adapter only adds display field aliases
    # and resolves evidence IDs returned by the engine.
    scene = service.graph_scene(workspace=project, level="complete", presentation="quality",
        include_memory_nodes=False, include_weak_cooccurrence=False)
    supporting = {}
    # The engine's stored memory/entity incidences also cover isolated entities.
    # Hydrate these existing links; do not infer evidence from labels or text here.
    entity_members = {node["id"]: node.get("member_ids", [node["id"]]) for node in scene["nodes"]}
    incidences = service.store.list_memory_entities(entity_ids=list(dict.fromkeys(
        member for members in entity_members.values() for member in members)))
    entity_evidence = {node_id: list(dict.fromkeys(
        row["memory_id"] for row in incidences if row["entity_id"] in members))
        for node_id, members in entity_members.items()}
    evidence_groups = [edge.get("support_memory_ids", []) for edge in scene["edges"]]
    evidence_groups.extend(entity_evidence.values())
    for memory_ids in evidence_groups:
        for mid in memory_ids:
            if mid not in supporting:
                memory = inspect(project, mid)["memory"]
                supporting[mid] = {"id": mid, "title": memory["title"],
                    "summary": memory.get("summary") or memory["content"],
                    "provenance": memory.get("provenance", {})}
                if native_id:
                    # Full text belongs to selection, not the initial graph download.
                    supporting[mid]["content"] = memory["content"]
    nodes = [{**n, "canonicalId": n["id"],
              "title": n["label"], "type": n["type"], "authority": "engraphis",
              "projectId": project, "mentionCount": n.get("support_count", 0),
              "properties": {**n.get("properties", {}), "x": n["x"], "y": n["y"], "nodeType": n["type"],
                  "communityId": n.get("community_id"),
                  "evidence": [supporting[mid] for mid in dict.fromkeys(
                      [*entity_evidence[n["id"]], *(mid for e in scene["edges"] if n["id"] in (e["source"], e["target"])
                      for mid in e.get("support_memory_ids", []))]
                  ) if mid in supporting]}}
             for n in scene["nodes"]]
    edges = [{
        **e,
        "predicate": e["relation"], "mentionCount": e.get("support_count", 0),
        "properties": {**e.get("properties", {}), "layer": e.get("layer"), "strength": e.get("strength"),
            "directed": e.get("directed", True),
            "evidence": [supporting[mid] for mid in e.get("support_memory_ids", []) if mid in supporting]},
    } for e in scene["edges"]]
    revision = hashlib.sha256(json.dumps([nodes, edges], sort_keys=True).encode()).hexdigest()
    return {"schemaVersion": "thinkgraph.engraphis.v1", "authority": "engraphis", "projectId": project,
            "revision": revision, "nodes": nodes, "edges": edges, "scene": scene,
            "counts": {"nodes": len(nodes), "edges": len(edges)},
            "truncated": scene["meta"]["truncated"],
            "embedding": {"state": "ready" if service.stats(workspace=project).get("embedding", {}).get("ready") else "unavailable"},
            "runtime": {"engine": "engraphis", "version": "1.7.1"}}
