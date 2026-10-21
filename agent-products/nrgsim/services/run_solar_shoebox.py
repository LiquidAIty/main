"""Run the real No-PCM solar shoebox through the existing OpenStudio MCP."""
# Entity: Building Simulation
# Relationship: This file prepares one explicit candidate, submits it to upstream MCP, and retains native EnergyPlus results and input provenance.

from __future__ import annotations

import argparse
import asyncio
import hashlib
import importlib.util
import json
import shutil
import subprocess
import sys
import tempfile
from datetime import timedelta
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from openstudio_block import call, read_geometry
from solar_shoebox import prepare_solar_shoebox


async def run(args) -> None:
    spec = importlib.util.spec_from_file_location("installed_openstudio_launch", args.reference_root / "launch_mcp.py")
    config = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(config)
    args.output_root.mkdir(parents=True, exist_ok=True)
    output = Path(tempfile.mkdtemp(prefix="solar-shoebox-", dir=args.output_root))
    for name in ("inputs", "runs", "measures"):
        (output / name).mkdir()
    environment = config.environment()
    environment.update({
        "OPENSTUDIO_MCP_INPUT_ROOT": str(output / "inputs"),
        "OPENSTUDIO_MCP_RUN_ROOT": str(output / "runs"),
        "OPENSTUDIO_MCP_MEASURES_DIR": str(output / "measures"),
    })
    weather = output / "inputs" / args.weather.name
    shutil.copy2(args.weather, weather)
    candidate = output / "inputs" / "solar-shoebox.osm"
    receipt = {"status": "preparing", "output": str(output), "calls": []}
    publish = lambda: (output / "receipt.json").write_text(json.dumps(receipt, indent=2), encoding="utf-8")
    publish()
    print(json.dumps({"output": str(output)}), flush=True)
    try:
        receipt["recipe"] = prepare_solar_shoebox(args.model, candidate, args.legacy_root, weather, args.design_days,
                                                  conditioned=not args.passive)
        receipt["modelSha256"] = hashlib.sha256(candidate.read_bytes()).hexdigest()
        receipt["engine"] = subprocess.run([environment["ENERGYPLUS_EXE_PATH"], "--version"],
                                           capture_output=True, text=True, check=True).stdout.strip()
        receipt["enginePath"] = environment["ENERGYPLUS_EXE_PATH"]
        receipt["openstudioVersion"] = read_geometry(candidate)["openstudioVersion"]
        (output / "geometry.json").write_text(json.dumps(read_geometry(candidate), indent=2), encoding="utf-8")
        publish()
        server = StdioServerParameters(command=sys.executable, args=["-m", "mcp_server.server"],
                                      cwd=str(args.reference_root), env=environment)
        with (output / "mcp.stderr.log").open("w", encoding="utf-8") as errlog:
            async with stdio_client(server, errlog=errlog) as streams:
                async with ClientSession(*streams, read_timeout_seconds=timedelta(seconds=180)) as session:
                    await session.initialize()
                    await call(session, "load_osm_model", osm_path=str(candidate), version_translate=False)
                    # The native engine remains final validation authority, including free-floating models without HVAC.
                    validation = await session.call_tool("validate_model", {})
                    receipt["validation"] = validation.model_dump(mode="json")
                    name = "solar-shoebox-office-" + ("passive" if args.passive else "ideal-loads") + "-no-pcm"
                    started = await call(session, "run_simulation", osm_path=str(candidate), epw_path=str(weather), name=name)
                    receipt["calls"].append({"tool": "run_simulation", "result": started})
                    receipt["status"] = "running"
                    publish()
                    run_id = started["run_id"]
                    print(json.dumps({"run_id": run_id, "status": "running"}), flush=True)
                    while True:
                        await asyncio.sleep(60)
                        status = await call(session, "get_run_status", run_id=run_id)
                        receipt["run"] = status["run"]
                        publish()
                        if status["run"]["status"] not in {"queued", "running"}:
                            break
                    receipt["artifacts"] = await call(session, "get_run_artifacts", run_id=run_id)
                    receipt["logs"] = await call(session, "get_run_logs", run_id=run_id, stream="energyplus", tail=80)
                    if status["run"]["status"] != "success":
                        raise RuntimeError("EnergyPlus run failed; native logs retained in receipt")
                    await call(session, "pin_run", run_id=run_id)
                    run_dir = Path(status["run"]["run_dir"]) / "run"
                    html = run_dir / "eplustbl.htm"
                    end = run_dir / "eplusout.end"
                    if not html.is_file() or not end.is_file() or "Completed Successfully" not in end.read_text():
                        raise RuntimeError("Missing native successful completion or HTML output")
                    receipt["nativeEnd"] = end.read_text().strip()
                    receipt["html"] = str(html)
                    receipt["status"] = "success"
                    receipt["outputHashes"] = {name: hashlib.sha256((run_dir / name).read_bytes()).hexdigest()
                                               for name in ("in.idf", "eplusout.sql", "eplusout.err", "eplusout.end", "eplustbl.htm")}
    except BaseException as error:
        receipt.update(status="failed", error=repr(error))
        raise
    finally:
        publish()
        print(json.dumps({"receipt": str(output / "receipt.json"), "status": receipt["status"], "html": receipt.get("html")}), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    for option in ("reference-root", "output-root", "model", "legacy-root", "weather", "design-days"):
        parser.add_argument("--" + option, type=Path, required=True)
    parser.add_argument("--passive", action="store_true", help="Free-floating: no active conditioning or automatic natural ventilation")
    asyncio.run(run(parser.parse_args()))
