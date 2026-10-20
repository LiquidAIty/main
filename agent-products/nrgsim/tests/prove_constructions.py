# Entity: Construction Editing Verification
# Relationship: This opt-in check exercises the real MCP measure and compares exact SDK objects across save and process restart.
"""Run with the application Python; all generated files stay in a private NRGSIM test directory."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from uuid import uuid4

PRODUCT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PRODUCT))


def sdk_phase(phase: str, root: Path) -> dict:
    import openstudio
    from nrgsim.constructions import inspect_surface_construction
    from test_constructions_sdk import edits, fixture

    if phase == "prepare":
        model, surface, original, other, override = fixture()
        before = inspect_surface_construction(model, str(surface.handle()))
        assert model.save(openstudio.path(str(root / "inputs/before.osm")), False)
        return {
            "sdkVersion": openstudio.openStudioVersion(),
            "before": before,
            "arguments": {
                "surface_handle": before["surface"]["handle"],
                "expected_construction_handle": before["construction"]["handle"],
                "layer_edits_json": json.dumps(edits(before)),
                "construction_name": "East wall local assembly",
            },
        }
    if phase not in {"inspect", "verify"}:
        raise ValueError("Unknown SDK proof phase")

    def load(relative):
        loaded = openstudio.model.Model.load(openstudio.path(str(root / relative)))
        assert loaded.is_initialized(), relative
        return loaded.get()

    def objects(model):
        return {str(obj.handle()): str(obj.toIdfObject()) for obj in model.getModelObjects()}

    request = json.loads((root / "request.json").read_text("utf-8"))
    handle = request["arguments"]["surface_handle"]
    accepted = load("runs/accepted.osm")
    if phase == "inspect":
        return inspect_surface_construction(accepted, handle)
    before_model = load("inputs/before.osm")
    rejected = load("runs/after-rejection.osm")
    reopened = load("runs/reopened.osm")
    before = inspect_surface_construction(before_model, handle)
    after = inspect_surface_construction(accepted, handle)
    source_objects, accepted_objects = objects(before_model), objects(accepted)
    selected_handle = str(openstudio.toUUID(handle))
    for key, original in source_objects.items():
        if key != selected_handle:
            assert accepted_objects.get(key) == original, f"Original object changed: {key}"
    assert before["isConstructionDefaulted"] and not after["isConstructionDefaulted"]
    assert before["construction"]["handle"] != after["construction"]["handle"]
    assert [layer["type"] for layer in after["layers"]] == [layer["type"] for layer in before["layers"]]
    assert after["layers"][0]["properties"]["thickness"]["value"] == 0.2
    assert after["layers"][1]["properties"]["thermalResistance"]["value"] == 2.5
    assert after["layers"][2]["properties"]["thermalResistance"]["value"] == 0.18
    assert after["layers"][3]["handle"] == before["layers"][3]["handle"]
    assert accepted_objects == objects(rejected), "Rejected edit changed the active model"
    assert accepted_objects == objects(reopened), "Process restart changed the saved model"
    assert len(reopened.getSpaces()) == len(reopened.getThermalZones()) == 2
    assert sum(face.adjacentSurface().is_initialized() for face in reopened.getSurfaces()) == 2
    return {
        "before": before, "after": after,
        "unchangedOriginalObjects": len(source_objects) - 1,
        "rejectedEditPreservedModel": True,
        "restartPreservedModel": True,
        "spaces": 2, "thermalZones": 2, "pairedSurfaceSides": 2,
        "simulationPerformed": False,
    }


async def main():
    from nrgsim.construction_measure import install
    from nrgsim.launch import IMAGE
    from nrgsim.session import PYTHON, ProjectSession, checked, payload

    session = ProjectSession(str(uuid4()))
    root = session.root
    (root / "inputs").mkdir()
    receipt = {"startedAt": datetime.now(timezone.utc).isoformat(), "image": IMAGE,
               "kind": "real-mcp-construction-proof", "steps": [], "ok": False}

    def sdk(phase):
        result = subprocess.run([str(PYTHON), "-B", str(Path(__file__)), phase, str(root)],
                                capture_output=True, text=True, check=True, timeout=60)
        return json.loads(result.stdout)

    async def call(name, arguments, *, expect_failure=False):
        reply = await session.call(name, arguments, actor="development-proof")
        data = payload(reply)
        receipt["steps"].append({"tool": name, "arguments": arguments,
                                 "isError": reply.is_error, "result": data})
        if expect_failure:
            assert reply.is_error or data.get("ok") is False or data.get("error"), data
            assert "thickness" in json.dumps(data), data
        else:
            checked(reply)
        print(json.dumps({"tool": name, "expectedFailure": expect_failure,
                          "result": data.get("runner_messages", {}).get("result", data.get("ok"))}), flush=True)
        return data

    try:
        request = sdk("prepare")
        (root / "request.json").write_text(json.dumps(request, indent=2), encoding="utf-8")
        receipt["versions"] = await call("get_versions", {})
        await call("load_osm_model", {"osm_path": str(root / "inputs/before.osm")})
        measure = await install(session)
        receipt["measure"] = measure
        result = await call("apply_measure", {"measure_dir": measure, "arguments": request["arguments"]})
        assert result["runner_messages"]["result"] == "Success", result
        outcome = json.loads(result["runner_messages"]["final_condition"])
        await call("save_osm_model", {"osm_path": str(root / "runs/accepted.osm")})
        readback = sdk("inspect")
        assert outcome["surface"] == readback["surface"]["handle"]
        assert outcome["construction"] == readback["construction"]["handle"]
        receipt["readback"] = readback
        invalid = {
            **request["arguments"],
            "expected_construction_handle": readback["construction"]["handle"],
            "layer_edits_json": json.dumps([{
                "index": 0, "material_handle": readback["layers"][0]["handle"],
                "name": "Rejected zero thickness", "properties": {"thickness": 0},
            }]),
        }
        await call("apply_measure", {"measure_dir": measure, "arguments": invalid}, expect_failure=True)
        await call("save_osm_model", {"osm_path": str(root / "runs/after-rejection.osm")})
        await session.close()
        session = ProjectSession(session.project_id)
        await call("save_osm_model", {"osm_path": str(root / "runs/reopened.osm")})
        receipt["verified"] = sdk("verify")
        receipt["snapshots"] = [
            {"path": str(root / path), "sha256": hashlib.sha256((root / path).read_bytes()).hexdigest()}
            for path in ("inputs/before.osm", "runs/accepted.osm", "runs/after-rejection.osm", "runs/reopened.osm")
        ]
        receipt["ok"] = True
    except Exception as error:
        receipt["error"] = f"{type(error).__name__}: {error}"
        if isinstance(error, subprocess.CalledProcessError):
            receipt["diagnostics"] = error.stderr
        raise
    finally:
        await session.close()
        receipt["completedAt"] = datetime.now(timezone.utc).isoformat()
        destination = root / "construction-proof.json"
        destination.write_text(json.dumps(receipt, indent=2), encoding="utf-8")
        print(json.dumps({"ok": receipt["ok"], "evidence": str(destination)}), flush=True)


if __name__ == "__main__":
    if len(sys.argv) == 3:
        print(json.dumps(sdk_phase(sys.argv[1], Path(sys.argv[2]))))
    elif len(sys.argv) == 1:
        asyncio.run(main())
    else:
        raise SystemExit("Run without arguments using the application Python environment")
