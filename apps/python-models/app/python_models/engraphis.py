"""ThinkGraph through Engraphis's public Python service and native MCP tools.

Python rails owns the service. Workspace binding comes from the authenticated
project; neither tool callers nor the browser choose another database or tenant.
"""
from __future__ import annotations

import atexit
import asyncio
import hashlib
import json
from pathlib import Path
import re
import threading
from typing import Any

from .thinkgraph import research_seed
from .thinkgraph_analysis import analyze_graph

DATABASE = Path(__file__).resolve().parents[4] / "db" / "thinkgraph.sqlite"
MODEL = "local:sentence-transformers/all-MiniLM-L6-v2"
MODEL_REVISION = "1110a243fdf4706b3f48f1d95db1a4f5529b4d41"
READ_TOOLS = frozenset({
    "engraphis_recall", "engraphis_recall_context", "engraphis_get_memory",
    "engraphis_timeline", "engraphis_recall_proactive", "engraphis_stats",
})
WRITE_TOOLS = frozenset({
    "engraphis_remember", "engraphis_update_memory", "engraphis_link",
    "engraphis_correct", "engraphis_pin", "engraphis_retire",
})
_service = None
_lock = threading.RLock()
SMART_TOOLS = frozenset({"engraphis_recall_context", "engraphis_get_memory",
                         "engraphis_remember", "engraphis_update_memory"})


def project_id(value: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]+", value):
        raise ValueError("thinkgraph_project_id_invalid")
    return value


def get_service():
    global _service
    with _lock:
        if _service is None:
            from engraphis.service import MemoryService
            from engraphis.mcp_server import set_service
            DATABASE.parent.mkdir(parents=True, exist_ok=True)
            service = MemoryService.create(
                str(DATABASE), embed_model=MODEL, embed_revision=MODEL_REVISION,
                require_immutable_models=True, require_exact_backends=True,
                extractor="none", graph_extractor="none",
                retention_supervisor="none", allow_automatic_critical_retention=False,
            )
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


async def native_tools() -> list[dict]:
    # Listing schemas never loads the embedder or opens the database.
    from engraphis.mcp_server import classic_mcp, smart_mcp
    result = []
    tools = [t for t in await classic_mcp.list_tools() if t.name not in SMART_TOOLS]
    tools.extend(t for t in await smart_mcp.list_tools() if t.name in SMART_TOOLS)
    for tool in tools:
        if tool.name not in READ_TOOLS | WRITE_TOOLS:
            continue
        item = tool.model_dump(exclude_none=True)
        schema = item["inputSchema"]
        for field in ("workspace", "repo", "session_id", "scope"):
            schema.get("properties", {}).pop(field, None)
            if field in schema.get("required", []):
                schema["required"].remove(field)
        schema["additionalProperties"] = False
        if tool.name == "engraphis_recall_context":
            item["annotations"].update(readOnlyHint=True, idempotentHint=True)
        if tool.name in {"engraphis_remember", "engraphis_update_memory"}:
            from .thinkgraph import CognitionRecord
            cognition = CognitionRecord.model_json_schema()
            cognition["properties"].pop("projectScope")
            cognition["required"].remove("projectScope")
            ref = cognition["$defs"]["GraphReference"]
            ref["properties"].pop("projectId")
            ref["required"].remove("projectId")
            schema.setdefault("$defs", {}).update(cognition.pop("$defs"))
            schema["properties"]["cognition"] = cognition
            schema["properties"]["summary"] = {"type": "string", "maxLength": 8000,
                "description": "Your concise summary of this idea for the inspector."}
            schema["properties"]["title"] = {"type": "string", "maxLength": 500,
                "description": "A short, natural label in the conversation's own language."}
        result.append(item)
    return result


async def invoke_tool(project: str, name: str, arguments: dict) -> dict:
    # Native FastMCP synchronous tools execute on their caller's thread. Keep
    # embedding and SQLite work off Python rails' shared HTTP event loop.
    return await asyncio.to_thread(_invoke_tool_sync, project, name, arguments)


def _invoke_tool_sync(project: str, name: str, arguments: dict) -> dict:
    with _lock:
        return asyncio.run(_invoke_tool(project, name, arguments))


async def _invoke_tool(project: str, name: str, arguments: dict) -> dict:
    from engraphis.mcp_server import classic_mcp, smart_mcp
    if name not in READ_TOOLS | WRITE_TOOLS:
        raise ValueError("thinkgraph_tool_unavailable")
    project = project_id(project)
    if any(k in arguments for k in ("workspace", "repo", "session_id", "scope")):
        raise ValueError("thinkgraph_scope_is_owned_by_project")
    arguments = dict(arguments)
    cognition = arguments.pop("cognition", None)
    summary = arguments.pop("summary", None)
    title = arguments.pop("title", None) if name == "engraphis_remember" else None
    if title is not None and (not isinstance(title, str) or len(title) > 500):
        raise ValueError("thinkgraph_title_invalid")
    if cognition is not None or summary is not None:
        if name not in {"engraphis_remember", "engraphis_update_memory"}:
            raise ValueError("thinkgraph_metadata_requires_memory_write")
        from .thinkgraph import validate_cognition
        if cognition is not None:
            cognition = validate_cognition(cognition, project)
        if summary is not None and (not isinstance(summary, str) or len(summary) > 8000):
            raise ValueError("thinkgraph_summary_invalid")
    service = get_service()
    if name == "engraphis_recall_context":
        # Preload uses the native recall implementation without reinforcement or
        # an Engraphis receipt write. AGE observes tool reads at the existing host.
        result = service.recall(workspace=project, response_mode="compact",
            record_receipt=False, reinforce=False, **arguments)
        if not result.get("semantic_support") or result.get("degraded_mode"):
            raise RuntimeError("thinkgraph_semantic_search_unavailable")
        by_id = {r["id"]: r for r in result.pop("memories", [])}
        result["sources"] = [{**source, **{k: by_id.get(source["id"], {}).get(k)
            for k in ("title", "provenance")}} for source in result.pop("packed_sources", [])]
        return result
    if name == "engraphis_update_memory" and (cognition is not None or summary is not None) and not any(
        field in arguments for field in ("title", "mtype", "importance")
    ):
        arguments["title"] = inspect(project, arguments["memory_id"])["memory"]["title"]
    server = smart_mcp if name in SMART_TOOLS else classic_mcp
    response = await server.call_tool(name, {**arguments, "workspace": project})
    # Smart errors are native CallToolResults, not an iterable of text blocks.
    content = response.content if hasattr(response, "content") else response[0] if isinstance(response, tuple) else response
    if getattr(response, "isError", False):
        raise ValueError(" ".join(getattr(block, "text", "") for block in content))
    for block in content:
        if getattr(block, "type", None) == "text":
            text = block.text
            if text.startswith("Error:"):
                raise ValueError(text)
            data = json.loads(text)
            if isinstance(data, dict):
                if data.get("ok") is False or data.get("error"):
                    raise ValueError(json.dumps(data))
                if data.get("semantic_support") is False or data.get("degraded_mode") is True:
                    raise RuntimeError("thinkgraph_semantic_search_unavailable")
                if cognition is not None or summary is not None or title is not None:
                    service = get_service()
                    memory_id = data.get("id") or arguments.get("memory_id")
                    service.inspect(memory_id, workspace=project)
                    record = service.store.get_memory(memory_id)
                    if cognition is not None:
                        record.metadata = {**record.metadata, "cognition": cognition}
                    if summary is not None:
                        record.summary = summary
                    service.store.add_memory(record)
                    if title is not None:
                        # The public edit also updates the native vector and FTS
                        # mirrors. Assigning record.title alone leaves them stale.
                        service.update_memory(memory_id, workspace=project, title=title)
                if name == "engraphis_get_memory":
                    record = inspect(project, data["id"])["memory"]
                    data["metadata"] = record.get("metadata", {})
                return data
    raise RuntimeError("thinkgraph_native_result_invalid")


def inspect(project: str, native_id: str) -> dict:
    service = get_service()
    project = project_id(project)
    result = service.inspect(native_id, workspace=project)
    result["memory"]["metadata"] = service.store.get_memory(native_id).metadata
    # Preserve directional composite identities from the native link store.
    # The public inspector has already authorized the neighboring records.
    neighbors = {link["id"] for link in result["links"]}
    result["nativeLinks"] = [link for link in service.store.get_links(native_id)
        if (link["b"] if link["a"] == native_id else link["a"]) in neighbors]
    return result


def private_operation(project: str, operation: str, arguments: dict) -> dict:
    """Existing reference hydration/evidence attachment, outside model tool grants."""
    from .thinkgraph import validate_cognition
    project = project_id(project)
    native_id = str(arguments.get("nativeId") or "")
    result = inspect(project, native_id)
    native_id = result["memory"]["id"]
    if operation == "inspect":
        return result
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


def _record_node(project: str, record) -> dict:
    cognition = record.metadata.get("cognition") or {}
    return {
        "id": record.id, "canonicalId": record.id, "label": record.title,
        "title": record.title, "type": cognition.get("nodeType") or record.mtype.value,
        "authority": "engraphis", "projectId": project, "mentionCount": 1,
        "properties": {
            "summary": record.summary, "fullContent": record.content,
            "nodeType": cognition.get("nodeType"), "memoryCategory": cognition.get("memoryCategory", record.mtype.value),
            "authoredBy": cognition.get("authoredBy"), "decisionState": cognition.get("decisionState"),
            "questionStatus": cognition.get("questionStatus"), "currentInterest": cognition.get("currentInterest"),
            "answerRefs": cognition.get("answerRefs", []), "relatedRefs": cognition.get("relatedRefs", []),
            "researchSeed": research_seed(record.id, record.title, cognition),
            "createdAt": record.ingested_at, "tags": record.keywords,
        },
        "provenance": {**record.provenance, "references": cognition.get("provenance", [])},
    }


def projection(project: str, native_id: str | None = None) -> dict:
    from engraphis.core.interfaces import SearchFilter
    service = get_service()
    project = project_id(project)
    workspace = service.store.conn.execute("SELECT id FROM workspaces WHERE name=?", (project,)).fetchone()
    records, links = [], []
    if workspace:
        flt = SearchFilter(workspace_id=workspace["id"])
        records = service.store.list_memories(flt, limit=2000, prompt_only=True)
        if native_id:
            selected = service.inspect(native_id, workspace=project)
            ids = {native_id, *(link["id"] for link in selected["links"])}
            records = [r for r in records if r.id in ids]
        ids = {r.id for r in records}
        seen = set()
        for record in records:
            for link in service.store.get_links(record.id, flt=flt):
                key = (link["a"], link["b"], link["relation"])
                if key not in seen and link["a"] in ids and link["b"] in ids:
                    seen.add(key)
                    links.append(link)
    nodes = [_record_node(project, record) for record in records]
    # Engraphis memory links have a composite native identity, not a numeric ID.
    edges = [{
        "id": json.dumps([e["a"], e["b"], e["relation"]], separators=(",", ":")),
        "source": e["a"], "target": e["b"], "predicate": e["relation"], "mentionCount": 1,
        "properties": {"reason": e.get("reason", ""), "layer": e.get("layer")},
        "provenance": {"engine": "engraphis", "nativeKey": [e["a"], e["b"], e["relation"]]},
    } for e in links]
    revision = hashlib.sha256(json.dumps([nodes, edges], sort_keys=True).encode()).hexdigest()
    analysis = analyze_graph(revision, json.dumps({"nodes": sorted(n["id"] for n in nodes),
        "edges": sorted([[e["source"], e["target"], 1] for e in edges])}))
    for node in nodes:
        node["properties"].update(analysis["nodes"][node["id"]])
    return {"schemaVersion": "thinkgraph.engraphis.v1", "authority": "engraphis", "projectId": project,
            "revision": revision, "nodes": nodes, "edges": edges, "analysis": analysis,
            "counts": {"nodes": len(nodes), "edges": len(edges)},
            "embedding": {"state": "ready" if service.stats(workspace=project).get("embedding", {}).get("ready") else "unavailable"},
            "runtime": {"engine": "engraphis", "version": "1.7.1"}}
