"""Attach NRGSIM to the existing MCP host; preserve upstream tool identities."""
# Entity: OpenStudio Connection
# Relationship: This adapter publishes native tool contracts and joins authenticated human requests to the same Project session.
from __future__ import annotations

import copy
import hmac
import os
from pathlib import Path
import sys

from mcp.types import CallToolResult, Tool

from app.python_models.operation_definition import OperationDefinition
from app.python_models.tool_registry import replace_discovered_external_operations

_PRODUCT = Path(__file__).resolve().parents[3] / "agent-products" / "nrgsim"
if str(_PRODUCT) not in sys.path:
    sys.path.insert(0, str(_PRODUCT))
from nrgsim.session import ProjectSession, READ_TOOLS, WRITE_TOOLS, checked, close_sessions, session


async def discover_tools() -> list[Tool]:
    discovery = ProjectSession("00000000-0000-0000-0000-000000000000")
    try:
        await discovery.start()
        return [tool for name, tool in discovery.tools.items() if name in READ_TOOLS | WRITE_TOOLS]
    finally:
        await discovery.close()


def register_tools(tools: list[Tool]) -> list[Tool]:
    definitions = []
    projected = []
    for tool in tools:
        name = tool.name
        readonly = name in READ_TOOLS
        data = tool.model_dump(by_alias=True, exclude_none=True)
        annotations = dict(data.get("annotations") or {})
        if "readOnlyHint" in annotations and annotations["readOnlyHint"] is not readonly:
            raise RuntimeError(f"openstudio_access_policy_mismatch:{name}")
        defaults = {
            "readOnlyHint": readonly, "destructiveHint": not readonly,
            "idempotentHint": readonly, "openWorldHint": False,
        }
        for key, value in defaults.items():
            annotations.setdefault(key, value)

        async def invoke(*, _name=name, _authenticatedProjectId="", **arguments):
            project = session(_authenticatedProjectId)
            result = await project.call(_name, arguments, actor="agent")
            # Application selection is context, not another engineering payload.
            data = result.model_dump(by_alias=True, exclude_none=True)
            data["_meta"] = {**data.get("_meta", {}), "nrgsim": {
                key: project.state[key] for key in ("projectId", "activeModel", "revision", "selection")
            }}
            return CallToolResult.model_validate(data)

        definitions.append(OperationDefinition(
            canonical_id=name, description=tool.description or "",
            parameters_schema=copy.deepcopy(tool.input_schema), handler=invoke,
            available=True, publishers=frozenset({"external-mcp"}), access="read" if readonly else "write",
            namespace="openstudio", grant_eligible=True, external_source_id="openstudio",
            output_schema=copy.deepcopy(tool.output_schema), title=tool.title or name,
            annotations=annotations, dispatcher_context_arguments=frozenset({"_authenticatedProjectId"}),
            dispatcher_owner="app.mcp_openstudio_provider",
        ))
        data["annotations"] = annotations
        data["_meta"] = {**data.get("_meta", {}), "liquidaitySource": {
            "sourceId": "openstudio", "namespace": "openstudio", "providerToolName": name,
            "connectionKind": "external-mcp",
        }}
        projected.append(Tool.model_validate(data))
    replace_discovered_external_operations("openstudio", definitions)
    return projected


async def human_endpoint(request):
    """Backend-owned Project check precedes this existing process-secret seam."""
    from starlette.responses import FileResponse, JSONResponse

    expected = os.environ.get("LIQUIDAITY_INTERNAL_MCP_SECRET", "").strip()
    supplied = request.headers.get("x-liquidaity-internal-mcp-secret", "")
    if len(expected) < 32 or not hmac.compare_digest(expected, supplied):
        return JSONResponse({"ok": False, "error": "internal_authorization_required"}, status_code=403)
    try:
        project = session(request.path_params["project_id"])
        action = request.path_params["action"]
        if request.method == "GET" and action == "state":
            return JSONResponse(await project.view())
        if request.method == "GET" and action == "display":
            view = await project.view()
            if not (view.get("projection") or {}).get("selectableHandles"):
                return JSONResponse({"ok": False, "error": "active_model_has_no_display_geometry"}, status_code=409)
            return FileResponse(project.root / "display.gltf", media_type="model/gltf+json",
                                headers={"Cache-Control": "no-store"})
        if request.method != "POST":
            return JSONResponse({"ok": False, "error": "action_not_supported"}, status_code=400)
        body = await request.json()
        args = body.get("arguments") or {}
        if action == "properties":
            handle = str(args.get("handle") or "")
            view = await project.view()
            obj = (view.get("projection") or {}).get("objects", {}).get(handle)
            if not obj:
                raise ValueError("object_not_in_active_model")
            if obj["type"] == "Building":
                # Upstream generic object lookup does not support SDK unique
                # objects by handle. Use its existing typed read, unchanged.
                result = checked(await project.call("get_building_info", {}, actor="human"))
                return JSONResponse({
                    "ok": True, "type": "Building", "name": obj["name"], "handle": handle,
                    "properties": {key: {"value": value, "type": type(value).__name__}
                                   for key, value in result.items()}, "setters": [],
                })
            result = checked(await project.call("get_object_fields", {
                "object_type": "Material" if obj.get("category") == "Material" else obj["type"],
                "object_handle": handle,
            }, actor="human"))
            return JSONResponse(result)
        if action not in {"new", "select", "edit", "author", "save", "reopen"}:
            raise ValueError("action_not_supported")
        return JSONResponse(await project.human(action, args, body.get("revision")))
    except ValueError as error:
        return JSONResponse({"ok": False, "error": str(error)}, status_code=409)
    except Exception as error:
        return JSONResponse({"ok": False, "error": str(error)}, status_code=502)


async def close():
    await close_sessions()
