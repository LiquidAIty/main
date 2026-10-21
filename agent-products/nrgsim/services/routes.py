"""Internal Python rails entry for the project-owned modeling workspace."""
# Entity: Building Modeling
# Relationship: Serializes each Project's deterministic operations in the installed OpenStudio Python environment, without another HTTP or MCP host.

from __future__ import annotations

import asyncio
import hashlib
import json
import subprocess
import threading
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, HTTPException

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "workspace.local.json"
router = APIRouter()
_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()
FIELDS = {
    "state": set(), "initialize": set(), "clone": {"caseId", "revision"},
    "glazing": {"caseId", "revision", "surfaceHandle", "ratio"},
    "edit_inputs": {"caseId", "revision", "edits"}, "outputs": {"caseId", "revision", "outputs"},
    "study_outputs": {"revisions", "outputs", "fanger"},
    "inspect_run": {"caseId", "runId"}, "report": {"caseId", "runId"},
    "weather_day": {"caseId", "runId", "date"},
    "run": {"caseId", "revision"}, "compare": {"cases", "channel", "start", "end", "runIds"},
}


def execute(project_id: str, payload: dict):
    if str(UUID(project_id)) != project_id:
        raise ValueError("Invalid Project identity")
    mode = payload.get("operation")
    if mode not in FIELDS or set(payload) - FIELDS[mode] - {"operation"}:
        raise ValueError("Unsupported operation or request fields")
    if not CONFIG.is_file():
        if mode == "state":
            return {"configured": False, "cases": []}
        raise ValueError("OpenStudio workspace is not configured")
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    if project_id != config.get("projectId"):
        if mode == "state":
            return {"configured": False, "cases": []}
        raise ValueError("This Project has no modeling workspace configured")
    root = ROOT / ".local" / "projects" / project_id
    if mode == "state":
        if not (root / "inputs" / "baseline.osm").exists():
            return {"configured": True, "cases": []}
        cache_path = root / "state.json"
        if cache_path.exists():
            cached = json.loads(cache_path.read_text(encoding="utf-8"))
            # A derived viewport cache is reusable only for the exact saved OSM bytes.
            # It owns no engineering values and is refreshed by the SDK after changes.
            source_stamp = max(path.stat().st_mtime for path in (ROOT / "services").glob("*.py"))
            case_ids = {path.stem for path in (root / "inputs").glob("*.osm") if path.stem in ("baseline", "case1", "case2")}
            run_stamp = max((path.stat().st_mtime for path in root.glob("*-run.json")), default=0)
            if (cache_path.stat().st_mtime >= max(source_stamp, run_stamp)
                    and {case["id"] for case in cached["cases"]} == case_ids
                    and all(hashlib.sha256((root / "inputs" / (case["id"] + ".osm")).read_bytes()).hexdigest() == case["revision"] for case in cached["cases"])):
                return cached
    with _locks_guard:
        lock = _locks.setdefault(project_id, threading.Lock())
    with lock:
        python = Path(config["referenceRoot"]) / "runtime" / "mcp-venv" / "Scripts" / "python.exe"
        if not python.is_file():
            raise ValueError("Configured OpenStudio Python installation is unavailable")
        process = subprocess.run(
            [str(python), "-X", "utf8", str(ROOT / "services" / "workspace_operations.py"),
             "--root", str(root), "--config", str(CONFIG)],
            input=json.dumps(payload, allow_nan=False), text=True, encoding="utf-8", capture_output=True,
            timeout=900, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        replies = [line[len("NRGSIM_RESULT="):] for line in process.stdout.splitlines()
                   if line.startswith("NRGSIM_RESULT=")]
        if len(replies) != 1:
            raise RuntimeError("OpenStudio operation ended without a result; inspect its retained operation log")
        response = json.loads(replies[0])
        if process.returncode or not response.get("ok"):
            raise ValueError(response.get("error", "OpenStudio operation failed"))
        if mode not in ("compare", "inspect_run", "report", "weather_day"):
            cache = root / "state.json"
            temporary = root / "state.tmp"
            temporary.write_text(json.dumps(response["data"], allow_nan=False), encoding="utf-8")
            temporary.replace(cache)
        return response["data"]


@router.post("/nrgsim/projects/{project_id}")
async def workspace_operation(project_id: str, payload: dict):
    try:
        return await asyncio.to_thread(execute, project_id, payload)
    except (ValueError, FileNotFoundError) as error:
        raise HTTPException(409, detail=str(error)) from error
    except (RuntimeError, subprocess.TimeoutExpired) as error:
        raise HTTPException(502, detail=str(error)) from error
