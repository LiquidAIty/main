"""One serialized upstream OpenStudio session per authenticated Project.

Only application references/revisions are retained here. Engineering data stays
in the upstream model and its OSM. Display documents are disposable SDK reads.
"""
# Entity: Building Model Session
# Relationship: This file serializes human and agent operations against one Project-owned upstream OpenStudio session.
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
from uuid import UUID, uuid4

from mcp import Client, StdioServerParameters
from mcp.types import CallToolResult, Tool

PRODUCT_ROOT = Path(__file__).resolve().parents[1]
INSTALLATION = Path(os.environ.get(
    "NRGSIM_OPENSTUDIO_ROOT",
    str(Path.home() / "Desktop" / "NRGSIM" / "openstudio-reference"),
)).resolve()
PYTHON = INSTALLATION / "runtime" / "mcp-venv" / "Scripts" / "python.exe"
DATA_ROOT = PRODUCT_ROOT / ".data"

# Exact upstream names; the provider schema/description is discovered, not copied.
# Omitted filesystem/package-install/destructive tools are not granted by this proof.
READ_TOOLS = frozenset({
    "get_versions", "get_server_status", "get_building_info", "get_model_summary",
    "list_spaces", "get_space_details", "list_thermal_zones", "get_thermal_zone_details",
    "list_surfaces", "get_surface_details", "list_subsurfaces", "list_model_objects",
    "get_object_fields", "get_construction_details",
    "list_air_loops", "list_plant_loops", "get_air_loop_details", "get_plant_loop_details",
    "get_space_type_details", "get_schedule_details", "get_weather_info",
    "get_run_period", "get_simulation_control", "validate_model",
    "list_weather_files", "get_run_status", "get_run_logs", "get_run_artifacts",
    "extract_summary_metrics", "extract_simulation_errors", "list_output_variables",
    "query_timeseries", "get_skill", "list_skills",
})
WRITE_TOOLS = frozenset({
    "create_new_building", "create_baseline_osm", "create_bar_building",
    "create_typical_building", "set_object_property", "set_window_to_wall_ratio",
    "create_space_from_floor_print", "create_thermal_zone", "match_surfaces",
    "create_schedule_ruleset", "assign_space_type_simple",
    "create_standard_opaque_material", "create_construction",
    "assign_construction_to_surface", "add_layer_to_construction",
    "set_run_period", "set_simulation_control", "add_output_variable", "add_output_meter",
    "change_building_location", "add_design_day", "save_osm_model", "load_osm_model",
    "run_simulation",
})


def payload(result: CallToolResult) -> dict:
    data = result.structured_content
    if not isinstance(data, dict):
        for item in result.content:
            if getattr(item, "type", None) == "text":
                try:
                    data = json.loads(item.text)
                    break
                except (ValueError, TypeError):
                    continue
    if not isinstance(data, dict):
        raise RuntimeError("openstudio_result_not_structured")
    return data


def checked(result: CallToolResult) -> dict:
    data = payload(result)
    if result.is_error or data.get("ok") is False or data.get("error"):
        raise RuntimeError(json.dumps(data, ensure_ascii=False))
    return data


class ProjectSession:
    def __init__(self, project_id: str):
        self.project_id = str(UUID(project_id))
        self.root = DATA_ROOT / self.project_id
        self.root.mkdir(parents=True, exist_ok=True)
        self.state_path = self.root / "project.json"
        self.state = json.loads(self.state_path.read_text("utf-8")) if self.state_path.exists() else {
            "projectId": self.project_id, "activeModel": None, "models": [],
            "revision": 0, "selection": None,
        }
        self.lock = asyncio.Lock()
        self.client = None
        self.tools: dict[str, Tool] = {}
        self.owner = None
        self.ready = asyncio.Event()
        self.stop = asyncio.Event()
        self.startup_error = None
        self.operations: set[asyncio.Task] = set()

    def persist(self):
        temporary = self.state_path.with_suffix(".tmp")
        temporary.write_text(json.dumps(self.state, indent=2), encoding="utf-8")
        temporary.replace(self.state_path)

    @property
    def working(self):
        directory = self.root / "runs" / "models"
        directory.mkdir(parents=True, exist_ok=True)
        return directory / "working.osm"

    async def start(self):
        if self.owner is None:
            self.owner = asyncio.create_task(self._own_client())
        await self.ready.wait()
        if self.startup_error:
            raise RuntimeError(self.startup_error)

    async def _own_client(self):
        # Do not forward host credentials into engineering subprocesses.
        env = {key: os.environ[key] for key in (
            "PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE",
            "APPDATA", "LOCALAPPDATA",
        ) if key in os.environ}
        env.update(NRGSIM_OPENSTUDIO_ROOT=str(INSTALLATION), NRGSIM_PROJECT_ROOT=str(self.root))
        try:
            async with Client(StdioServerParameters(
                command=str(PYTHON), args=[str(Path(__file__).with_name("launch.py"))],
                cwd=str(INSTALLATION), env=env,
            ), mode="legacy", read_timeout_seconds=600) as client:
                self.client = client
                page = await client.list_tools()
                self.tools = {tool.name: Tool.model_validate(tool) for tool in page.tools}
                if page.next_cursor:
                    raise RuntimeError("openstudio_catalog_pagination_unhandled")
                if self.state["activeModel"] and self.working.exists():
                    checked(await self.raw("load_osm_model", {"osm_path": str(self.working)}))
                self.ready.set()
                await self.stop.wait()
        except Exception as error:
            self.startup_error = f"{type(error).__name__}: {error}"
            self.ready.set()
        finally:
            self.client = None

    async def close(self):
        if self.operations:
            await asyncio.gather(*tuple(self.operations), return_exceptions=True)
        self.stop.set()
        if self.owner:
            await self.owner

    async def raw(self, name: str, arguments: dict) -> CallToolResult:
        if self.client is None or self.startup_error:
            raise RuntimeError("openstudio_session_unavailable")
        try:
            return await self.client.call_tool(name, arguments, read_timeout_seconds=600)
        except Exception as error:
            # The tool may still be executing upstream after a lost response.
            # Refuse further operations rather than guessing that it rolled back.
            self.startup_error = f"openstudio_session_uncertain:{type(error).__name__}"
            raise

    async def _checkpoint(self):
        checked(await self.raw("save_osm_model", {"osm_path": str(self.working)}))
        if not self.state["activeModel"]:
            model_id = str(uuid4())
            self.state["activeModel"] = model_id
            self.state["models"].append({"id": model_id, "label": "New Building"})
        self.state["revision"] += 1
        self.persist()

    async def call(self, name: str, arguments: dict, *, actor: str) -> CallToolResult:
        await self.start()
        if name not in self.tools or name not in READ_TOOLS | WRITE_TOOLS:
            raise ValueError("openstudio_operation_not_available")
        operation = asyncio.create_task(self._call_serialized(name, arguments, actor))
        self.operations.add(operation)
        operation.add_done_callback(self._operation_finished)
        # A disconnected outer caller must not release the edit lock while the
        # upstream operation is still changing its model. Finish its checkpoint.
        return await asyncio.shield(operation)

    def _operation_finished(self, operation: asyncio.Task):
        self.operations.discard(operation)
        if not operation.cancelled():
            operation.exception()  # Observe errors even if the outer caller disconnected.

    async def _call_serialized(self, name: str, arguments: dict, actor: str) -> CallToolResult:
        async with self.lock:
            result = await self.raw(name, arguments)
            data = payload(result)
            if data.get("ok") is False or data.get("error"):
                result = result.model_copy(update={"is_error": True})
            self.audit(name, arguments, data, actor)
            # Save/read back even a partially failed engineering mutation if a
            # model exists. Do not manufacture success or silently roll it back.
            if name in WRITE_TOOLS and name != "run_simulation":
                try:
                    await self._checkpoint()
                except Exception:
                    if not result.is_error and data.get("ok") is not False:
                        raise
            return result

    def audit(self, operation, arguments, result, actor):
        with (self.root / "operations.jsonl").open("a", encoding="utf-8") as stream:
            stream.write(json.dumps({
                "at": datetime.now(timezone.utc).isoformat(), "actor": actor,
                "modelId": self.state["activeModel"], "revision": self.state["revision"],
                "operation": operation, "arguments": arguments, "result": result,
            }, ensure_ascii=False, default=str) + "\n")

    async def view(self):
        await self.start()
        async with self.lock:
            if not self.state["activeModel"]:
                return {**self.state, "projection": None}
            manifest = self.root / "display.json"
            revision_path = self.root / "display-revision.txt"
            if not manifest.exists() or not revision_path.exists() or revision_path.read_text() != str(self.state["revision"]):
                proc = await asyncio.create_subprocess_exec(
                    str(PYTHON), str(Path(__file__).with_name("projection.py")),
                    str(self.working), str(self.root / "display.gltf"), str(manifest),
                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
                )
                _, stderr = await proc.communicate()
                if proc.returncode:
                    raise RuntimeError("openstudio_projection_failed:" + stderr.decode(errors="replace")[-3000:])
                revision_path.write_text(str(self.state["revision"]))
            projection = json.loads(manifest.read_text("utf-8"))
            if self.state["selection"] not in projection["objects"]:
                self.state["selection"] = None
                self.persist()
            return {**self.state, "projection": projection}

    async def human(self, action: str, args: dict, revision: int | None):
        await self.start()
        async with self.lock:
            if revision is not None and revision != self.state["revision"]:
                raise ValueError("model_changed_refresh_before_edit")
            if action == "new":
                if self.state["activeModel"]:
                    previous = self.working.parent / f'{self.state["activeModel"]}.osm'
                    checked(await self.raw("save_osm_model", {"osm_path": str(previous)}))
                    entry = next(item for item in self.state["models"] if item["id"] == self.state["activeModel"])
                    entry.update(savedAt=datetime.now(timezone.utc).isoformat(),
                                 sha256=hashlib.sha256(previous.read_bytes()).hexdigest())
                model_id = str(uuid4())
                path = self.working.parent / f"{model_id}.osm"
                proc = await asyncio.create_subprocess_exec(
                    str(PYTHON), str(Path(__file__).with_name("projection.py")), "--new-empty", str(path),
                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
                )
                _, stderr = await proc.communicate()
                if proc.returncode:
                    raise RuntimeError("new_model_failed:" + stderr.decode(errors="replace")[-2000:])
                checked(await self.raw("load_osm_model", {"osm_path": str(path)}))
                self.state["activeModel"] = model_id
                self.state["selection"] = None
                self.state["models"].append({"id": model_id, "label": str(args.get("label") or "New Building")[:160]})
                await self._checkpoint()
                return dict(self.state)
            if action == "select":
                if (self.root / "display-revision.txt").read_text() != str(self.state["revision"]):
                    raise ValueError("display_binding_stale_refresh_model")
                manifest = json.loads((self.root / "display.json").read_text("utf-8"))
                handle = args.get("handle")
                if handle is not None and handle not in manifest["objects"]:
                    raise ValueError("selection_not_in_active_model")
                self.state["selection"] = handle
                self.persist()
                return dict(self.state)
            if action == "edit":
                if not isinstance(revision, int) or isinstance(revision, bool):
                    raise ValueError("model_revision_required")
                if set(args) != {"object_type", "object_handle", "property_name", "value"}:
                    raise ValueError("inspector_arguments_invalid")
                # Deliberately small, SI/degree-labelled first inspector contract.
                supported = {("ThermalZone", "multiplier"),
                             ("LightsDefinition", "wattsperSpaceFloorArea")}
                if (args.get("object_type"), args.get("property_name")) not in supported:
                    raise ValueError("inspector_property_not_supported")
                if args.get("object_handle") != self.state["selection"]:
                    raise ValueError("inspector_selection_changed")
                value = args.get("value")
                if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                    raise ValueError("finite_numeric_value_required")
                if args["object_type"] == "ThermalZone" and (value < 1 or int(value) != value):
                    raise ValueError("zone_multiplier_requires_positive_integer")
                if args["object_type"] == "LightsDefinition" and value < 0:
                    raise ValueError("lighting_power_density_must_be_nonnegative")
                result = checked(await self.raw("set_object_property", args))
                await self._checkpoint()
                readback = checked(await self.raw("get_object_fields", {
                    "object_type": args["object_type"], "object_handle": args["object_handle"],
                }))
                self.audit("set_object_property", args, {"result": result, "readback": readback}, "human")
                return {"result": result, "readback": readback, "revision": self.state["revision"]}
            if action == "save":
                if not self.state["activeModel"]:
                    raise ValueError("no_active_model")
                path = self.working.parent / f'{self.state["activeModel"]}.osm'
                checked(await self.raw("save_osm_model", {"osm_path": str(path)}))
                entry = next(item for item in self.state["models"] if item["id"] == self.state["activeModel"])
                entry.update(label=str(args.get("label") or entry["label"])[:160],
                             savedAt=datetime.now(timezone.utc).isoformat(),
                             sha256=hashlib.sha256(path.read_bytes()).hexdigest())
                self.persist()
                return dict(entry)
            if action == "reopen":
                model_id = str(args.get("modelId") or "")
                if not any(item["id"] == model_id for item in self.state["models"]):
                    raise ValueError("unknown_saved_model")
                current = next((item for item in self.state["models"]
                                if item["id"] == self.state["activeModel"]), None)
                if current and self.working.exists() and current.get("sha256") != hashlib.sha256(self.working.read_bytes()).hexdigest():
                    raise ValueError("save_active_model_before_reopening")
                path = self.working.parent / f"{model_id}.osm"
                checked(await self.raw("load_osm_model", {"osm_path": str(path)}))
                self.state["activeModel"] = model_id
                self.state["selection"] = None
                await self._checkpoint()
                return dict(self.state)
            raise ValueError("unknown_modeling_action")


_sessions: dict[str, ProjectSession] = {}


def session(project_id: str) -> ProjectSession:
    key = str(UUID(project_id))
    if key not in _sessions:
        _sessions[key] = ProjectSession(key)
    return _sessions[key]


async def close_sessions():
    await asyncio.gather(*(entry.close() for entry in _sessions.values()))
    _sessions.clear()
