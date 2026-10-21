"""Real SDK and stdio MCP acceptance; no mocked model or invented results."""
# Entity: Building Geometry
# Relationship: This file proves block creation, an MCP glazing edit, persistence and render-polygon areas against a saved OSM.

from __future__ import annotations

import argparse
import asyncio
import importlib.util
import json
import math
import sys
import tempfile
from datetime import timedelta
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from openstudio_block import call, create_block, read_geometry


def triangle_area(positions: list[float]) -> float:
    total = 0.0
    for offset in range(0, len(positions), 9):
        a, b, c = [positions[offset + i:offset + i + 3] for i in (0, 3, 6)]
        u, v = [[end[i] - a[i] for i in range(3)] for end in (b, c)]
        cross = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]]
        total += math.sqrt(sum(value * value for value in cross)) / 2
    return total


def check(snapshot: dict, width: float, depth: float, height: float) -> None:
    assert len(snapshot["spaces"]) == 1
    space = snapshot["spaces"][0]
    assert space["thermalZoneHandle"]
    assert math.isclose(space["floorArea"], width * depth, rel_tol=1e-8)
    assert math.isclose(space["volume"], width * depth * height, rel_tol=1e-8)
    faces = [face for face in snapshot["objects"] if face["objectType"] == "Surface"]
    assert len(faces) == 6
    assert sorted(face["surfaceType"] for face in faces) == ["Floor", "RoofCeiling", "Wall", "Wall", "Wall", "Wall"]
    for face in snapshot["objects"]:
        assert math.isclose(triangle_area(face["positions"]), face["netArea"], rel_tol=1e-6, abs_tol=1e-7), face["name"]


async def run(reference: Path, output_parent: Path) -> None:
    # Reuse the already inspected installation configuration, not another runtime or server implementation.
    spec = importlib.util.spec_from_file_location("installed_openstudio_launch", reference / "launch_mcp.py")
    config = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(config)
    output_parent.mkdir(parents=True, exist_ok=True)
    output = Path(tempfile.mkdtemp(prefix="single-zone-", dir=output_parent))
    for name in ("inputs", "runs", "measures"):
        (output / name).mkdir()
    environment = config.environment()
    environment.update({
        "OPENSTUDIO_MCP_INPUT_ROOT": str(output / "inputs"),
        "OPENSTUDIO_MCP_RUN_ROOT": str(output / "runs"),
        "OPENSTUDIO_MCP_MEASURES_DIR": str(output / "measures"),
    })
    server = StdioServerParameters(command=sys.executable, args=["-m", "mcp_server.server"],
                                  cwd=str(reference), env=environment)
    receipt = {"status": "running", "output": str(output), "calls": [], "simulationRun": False}
    receipt_path = output / "receipt.json"
    width, depth, height = 4.57, 4.57, 2.45
    saved = output / "runs" / "block.osm"
    try:
        with (output / "mcp.stderr.log").open("w", encoding="utf-8") as errlog:
            async with stdio_client(server, errlog=errlog) as streams:
                async with ClientSession(*streams, read_timeout_seconds=timedelta(seconds=180)) as session:
                    await session.initialize()
                    tools = {tool.name for tool in (await session.list_tools()).tools}
                    assert {"load_osm_model", "save_osm_model", "create_space_from_floor_print", "create_thermal_zone", "set_window_to_wall_ratio"} <= tools
                    initial = await create_block(session, output / "inputs" / "empty.osm", saved,
                                                 width=width, depth=depth, height=height)
                    check(initial, width, depth, height)
                    (output / "before.json").write_text(json.dumps(initial, indent=2), encoding="utf-8")
                    # Select the actual south wall from the accepted SDK coordinates, never an assumed generated name.
                    wall = next(face for face in initial["objects"] if face["surfaceType"] == "Wall"
                                and all(math.isclose(point[1], -depth / 2, abs_tol=1e-8) for point in face["vertices"]))
                    result = await call(session, "set_window_to_wall_ratio", surface_name=wall["name"], ratio=0.4, sill_height_m=0.5)
                    receipt["calls"].append({"tool": "set_window_to_wall_ratio", "result": result})
                    await call(session, "save_osm_model", osm_path=str(saved))
                    edited = read_geometry(saved)
                    check(edited, width, depth, height)
                    windows = [face for face in edited["objects"] if face["objectType"] == "SubSurface"]
                    assert len(windows) == 1 and windows[0]["parentHandle"] == wall["handle"]
                    assert math.isclose(windows[0]["grossArea"] / wall["grossArea"], 0.4, rel_tol=1e-6)
                    assert initial["revision"] != edited["revision"]
                    assert {face["handle"] for face in initial["objects"]} <= {face["handle"] for face in edited["objects"]}
                    reread = await call(session, "load_osm_model", osm_path=str(saved), version_translate=False)
                    receipt["calls"].append({"tool": "load_osm_model", "result": reread})
                    assert reread["spaces"] == 1 and reread["thermal_zones"] == 1
                    reopened = output / "runs" / "reopened.osm"
                    await call(session, "save_osm_model", osm_path=str(reopened))
                    persisted = read_geometry(reopened)
                    assert persisted["objects"] == edited["objects"]
                    assert persisted["spaces"] == edited["spaces"]
                    (output / "geometry.json").write_text(json.dumps(persisted, indent=2), encoding="utf-8")
                    # The public operation rejects this value; prove the rejected edit did not alter the saved geometry.
                    try:
                        await call(session, "set_window_to_wall_ratio", surface_name=wall["name"], ratio=1.2)
                    except RuntimeError as error:
                        receipt["rejectedEdit"] = {"tool": "set_window_to_wall_ratio", "ratio": 1.2, "error": str(error)}
                    else:
                        raise AssertionError("Invalid WWR was accepted")
                    rejected = output / "runs" / "after-rejected-edit.osm"
                    await call(session, "save_osm_model", osm_path=str(rejected))
                    assert read_geometry(rejected)["objects"] == persisted["objects"]
                    invalid_seed = output / "inputs" / "invalid.osm"
                    try:
                        await create_block(session, invalid_seed, output / "runs" / "invalid.osm",
                                           width=float("nan"), depth=depth, height=height)
                    except ValueError:
                        pass
                    else:
                        raise AssertionError("Invalid dimensions were accepted")
                    assert not invalid_seed.exists()
                    original_bytes = saved.read_bytes()
                    try:
                        await create_block(session, output / "inputs" / "another.osm", saved,
                                           width=width, depth=depth, height=height)
                    except FileExistsError:
                        pass
                    else:
                        raise AssertionError("An existing model was overwritten")
                    assert saved.read_bytes() == original_bytes
                    receipt.update(status="passed", spaces=1, thermalZones=1, surfaces=6, subSurfaces=1,
                                   floorArea=width*depth, volume=width*depth*height, windowToWallRatio=0.4,
                                   geometry=str(output / "geometry.json"), osm=str(reopened),
                                   openstudioVersion=persisted["openstudioVersion"],
                                   preservedSurfaceHandles=True, rejectedEditPreservedGeometry=True,
                                   invalidDimensionsRefused=True, existingModelPreserved=True)
    except BaseException as error:
        receipt.update(status="failed", error=repr(error))
        raise
    finally:
        receipt_path.write_text(json.dumps(receipt, indent=2), encoding="utf-8")
        print(json.dumps({"receipt": str(receipt_path), "status": receipt["status"]}), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference-root", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    args = parser.parse_args()
    asyncio.run(run(args.reference_root, args.output_root))
