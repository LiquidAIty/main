# Entity: OpenStudio Runtime Verification
# Relationship: This opt-in proof exercises the unchanged upstream MCP package against a new, isolated model.
"""Run explicitly with the application's Python environment; never touches saved Projects."""
import asyncio
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time
from uuid import uuid4

from mcp import Client

PRODUCT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PRODUCT))
from nrgsim.launch import IMAGE, server_parameters

SDK_PYTHON = (
    Path.home() / "Desktop/NRGSIM/openstudio-reference/runtime/mcp-venv/Scripts/python.exe"
)


async def main():
    root = PRODUCT / ".data" / str(uuid4())
    for folder in ("inputs", "runs", "measures"):
        (root / folder).mkdir(parents=True)
    subprocess.run([
        str(SDK_PYTHON), str(PRODUCT / "nrgsim/projection.py"), "--new-empty",
        str(root / "inputs/empty.osm"),
    ], check=True, timeout=60)
    measure = root / "measures/local/custom/building_authoring"
    subprocess.run([
        str(SDK_PYTHON), str(PRODUCT / "nrgsim/package_measure.py"), str(measure),
    ], check=True, timeout=60)
    image = json.loads(subprocess.check_output(
        ["docker", "image", "inspect", IMAGE], text=True, timeout=30,
    ))[0]
    receipt = {
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "image": IMAGE, "imageId": image["Id"], "digests": image["RepoDigests"],
        "root": str(root), "steps": [], "ok": False,
    }
    async def call(client, name, args):
        started = time.monotonic()
        reply = await client.call_tool(name, args, read_timeout_seconds=360)
        value = reply.structured_content
        if not isinstance(value, dict):
            value = json.loads(next(item.text for item in reply.content if item.type == "text"))
        receipt["steps"].append({
            "tool": name, "arguments": args, "seconds": time.monotonic() - started, "result": value,
        })
        print(json.dumps({"tool": name, "seconds": round(time.monotonic() - started, 2),
                          "result": value}), flush=True)
        if reply.is_error or value.get("ok") is False or value.get("error"):
            raise RuntimeError(f"{name}: {value}")
        return value

    try:
        async with Client(server_parameters(root),
                          mode="legacy", read_timeout_seconds=360) as client:
            tools = await client.list_tools()
            receipt["toolCount"] = len(tools.tools)
            await call(client, "get_versions", {})
            await call(client, "load_osm_model", {"osm_path": "/inputs/empty.osm"})
            created = await call(client, "create_measure", {
                "name": "runtime_dependency_probe", "language": "Python",
                "description": "Verify real measure execution on an isolated empty model.",
                "run_body": (
                    "        model.getBuilding().setName('Runtime dependency proof')\n"
                    "        runner.registerFinalCondition('Building name changed')\n"
                    "        return True"
                ),
            })
            assert created.get("validation", {}).get("syntax_ok") is True, created
            applied = await call(client, "apply_measure", {"measure_dir": created["measure_dir"]})
            assert applied["runner_messages"]["result"] == "Success", applied
            # Detailed Building info divides by zero in upstream 1.2.1 for an
            # empty model. The summary reads the same authoritative name safely.
            building = await call(client, "get_model_summary", {})
            assert building["summary"]["building_name"] == "Runtime dependency proof", building
            edited = await call(client, "apply_measure", {
                "measure_dir": "/measures/local/custom/building_authoring",
                "arguments": {"operation_json": json.dumps({
                    "operation": "create_story", "name": "Ground Floor", "elevation": 0, "height": 3,
                })},
            })
            assert edited["runner_messages"]["result"] == "Success", edited
            story = json.loads(edited["runner_messages"]["final_condition"])
            await call(client, "apply_measure", {
                "measure_dir": "/measures/local/custom/building_authoring",
                "arguments": {"operation_json": json.dumps({
                    "operation": "draw_space", "name": "Office", "story": story["handle"],
                    "points": [[0, 0], [10, 0], [10, 8], [0, 8]], "height": 3,
                    "createThermalZone": True,
                })},
            })
            await call(client, "get_model_summary", {})
            await call(client, "save_osm_model", {"osm_path": "/runs/dependency-proof.osm"})
            saved = root / "runs/dependency-proof.osm"
            receipt["savedOsm"] = {"path": str(saved),
                                   "sha256": hashlib.sha256(saved.read_bytes()).hexdigest()}
            await call(client, "load_osm_model", {"osm_path": "/runs/dependency-proof.osm"})
            spaces = await call(client, "list_spaces", {})
            assert len(spaces["spaces"]) == 1, spaces
            assert spaces["spaces"][0]["floor_area_m2"] == 80, spaces
            assert spaces["spaces"][0]["thermal_zone"], spaces
            receipt["ok"] = True
    except Exception as error:
        receipt["error"] = str(error)
        raise
    finally:
        receipt["completedAt"] = datetime.now(timezone.utc).isoformat()
        evidence = root / "runtime-proof.json"
        evidence.write_text(json.dumps(receipt, indent=2), encoding="utf-8")
        print(json.dumps({"ok": receipt["ok"], "evidence": str(evidence)}), flush=True)


if __name__ == "__main__":
    asyncio.run(main())
