"""Bounded model operations using the installed SDK and unchanged OpenStudio MCP."""
# Entity: Building Modeling
# Relationship: Owns saved baseline/candidate OSM edits and real runs; the shared Python rails serializes each Project's calls.

from __future__ import annotations

import argparse
import asyncio
import hashlib
import importlib.util
import json
import math
import re
import shutil
import subprocess
import sys
import traceback
import uuid
from datetime import timedelta
from pathlib import Path

from results import channels, compare

CASE_IDS = ("baseline", "case1", "case2")


def case_ids(root):
    return (*CASE_IDS, *sorted(path.stem for path in (root / "inputs").glob("case_*.osm")
                             if re.fullmatch(r"case_[0-9a-f]{12}", path.stem)))


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save_json(path: Path, value: dict):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, indent=2, allow_nan=False), encoding="utf-8")
    temporary.replace(path)


def failure_message(error: BaseException) -> str:
    if isinstance(error, BaseExceptionGroup):
        return "; ".join(failure_message(item) for item in error.exceptions)
    return str(error)


def load_model(path: Path):
    import openstudio
    result = openstudio.model.Model.load(str(path))
    if not result.is_initialized():
        raise ValueError("OpenStudio could not reopen the saved model")
    return result.get()


def inspect(path: Path) -> dict:
    from openstudio_block import read_geometry
    from input_controls import projection
    from weather_view import weather_view
    geometry = read_geometry(path)
    model = load_model(path)
    walls = []
    for wall in model.getSurfaces():
        if wall.surfaceType() != "Wall" or wall.outsideBoundaryCondition() != "Outdoors":
            continue
        subs = wall.subSurfaces()
        # The first edit supports one ordinary hosted window, not arbitrary fenestration replacement.
        editable = len(subs) == 1 and subs[0].subSurfaceType() in ("FixedWindow", "OperableWindow")
        walls.append({"handle": str(wall.handle()), "name": wall.nameString(),
                      "ratio": sum(sub.grossArea() for sub in subs) / wall.grossArea(),
                      "editable": editable})
    rooftop = None
    if model.getAirLoopHVACs() and len(model.getSpaces()) == 1:
        from packaged_rooftop import describe
        rooftop = describe(model)
    return {"geometry": geometry, "walls": walls, "controls": projection(model), "weather": weather_view(model), "rooftop": rooftop,
            "requestedOutputs": [{"name": item.variableName(), "key": item.keyValue(), "frequency": item.reportingFrequency()}
                                 for item in model.getOutputVariables()]}


def run_history(root: Path, case_id: str) -> list[dict]:
    runs = []
    for path in sorted((root / "operations").glob("*/receipt.json"), key=lambda path: path.stat().st_mtime, reverse=True):
        record = json.loads(path.read_text())
        if record.get("operation") == "run" and record.get("caseId") == case_id and record.get("status") == "success":
            runs.append(record)
    return runs


def find_run(root: Path, case_id: str, run_id: str) -> dict:
    if case_id not in case_ids(root):
        raise ValueError("Unknown case")
    run = next((item for item in run_history(root, case_id) if item["runId"] == run_id), None)
    if run is None:
        raise ValueError("This case has no such completed run")
    if digest(Path(run['model'])) != run['revision']:
        raise ValueError('Frozen model bytes no longer match the selected run revision')
    return run


def state(root: Path) -> dict:
    from output_controls import available_outputs
    cases = []
    for case_id in case_ids(root):
        path = root / "inputs" / (case_id + ".osm")
        if not path.exists():
            continue
        run_path = root / (case_id + "-run.json")
        run = json.loads(run_path.read_text()) if run_path.exists() else None
        revision = digest(path)
        case_model = load_model(path)
        cases.append({"id": case_id, "name": case_model.getBuilding().nameString(), "revision": revision, "run": run,
                      "availableOutputs": available_outputs(root, case_id, case_model),
                      "history": [{"runId": item["runId"], "revision": item["revision"]} for item in run_history(root, case_id)],
                      "resultsCurrent": bool(run and run.get("revision") == revision), **inspect(path)})
    return {"configured": True, "cases": cases}


async def operation(root: Path, config: dict, request: dict) -> dict:
    mode = request["operation"]
    if mode == "state":
        return state(root)
    if mode == "study_outputs":
        from input_controls import enable_fanger
        from output_controls import set_outputs
        revisions = request.get("revisions", {})
        if set(revisions) != {"baseline", "case1"}:
            raise ValueError("Study outputs require exact baseline and comparison revisions")
        op_dir = root / "operations" / str(uuid.uuid4())
        op_dir.mkdir(parents=True)
        receipt = {"operation": mode, "status": "preparing", "beforeRevisions": revisions, "committed": [], "readback": {}}
        save_json(op_dir / "receipt.json", receipt)
        try:
            for case in ("baseline", "case1"):
                original = root / "inputs" / (case + ".osm")
                if digest(original) != revisions[case]:
                    raise ValueError("A study model changed; reload before selecting outputs")
                shutil.copy2(original, op_dir / (case + "-before.osm"))
                candidate = load_model(original)
                if request.get("fanger") is True:
                    receipt.setdefault("comfort", {})[case] = enable_fanger(candidate)
                engineering = lambda model: {str(obj.handle()): str(obj) for obj in model.modelObjects()
                                             if not obj.to_OutputVariable().is_initialized()}
                configured_engineering = engineering(candidate)
                set_outputs(candidate, root, case, request.get("outputs"))
                staged = op_dir / (case + "-prepared.osm")
                if not candidate.save(str(staged), False):
                    raise ValueError("Could not stage study output requests")
                reopened = load_model(staged)
                actual = sorted((item.variableName(), item.keyValue(), item.reportingFrequency()) for item in reopened.getOutputVariables())
                if actual != sorted((item["name"], item["key"], item["frequency"]) for item in request["outputs"]):
                    raise ValueError("Study output request readback differs")
                # Reporting changes must preserve every existing engineering object.
                if configured_engineering != engineering(reopened):
                    raise ValueError("Output selection changed an engineering object")
                receipt["readback"][case] = actual
            if any(digest(root / "inputs" / (case + ".osm")) != revisions[case] for case in revisions):
                raise ValueError("A study model changed while outputs were prepared")
            receipt["status"] = "publishing"
            save_json(op_dir / "receipt.json", receipt)
            for case in ("baseline", "case1"):
                shutil.copy2(op_dir / (case + "-prepared.osm"), root / "inputs" / (case + ".osm"))
                receipt["committed"].append(case)
                save_json(op_dir / "receipt.json", receipt)
            receipt["status"] = "success"
        except BaseException as error:
            receipt.update(status="failed", error=failure_message(error), traceback=traceback.format_exc())
            raise
        finally:
            save_json(op_dir / "receipt.json", receipt)
        return state(root)
    if mode == "weather_day":
        from weather_view import weather_view
        case_id = request.get("caseId")
        if case_id not in case_ids(root):
            raise ValueError("Unknown case")
        model_path = Path(find_run(root, case_id, request["runId"])["model"]) if request.get("runId") else root / "inputs" / (case_id + ".osm")
        return weather_view(load_model(model_path), request.get("date"))
    if mode in ("inspect_run", "report"):
        run = find_run(root, request.get("caseId"), request.get("runId"))
        if mode == "report":
            return {"html": Path(run["html"]).read_text(encoding="utf-8", errors="replace")}
        return {**inspect(Path(run["model"])), "run": run, "revision": run["revision"]}
    if mode == "compare":
        selected = request.get("cases", [])
        baseline_id = request.get('baselineCaseId', 'baseline')
        if baseline_id not in selected or len(set(selected)) != len(selected) or any(case not in case_ids(root) for case in selected):
            raise ValueError("Invalid comparison cases")
        runs = []
        for case in selected:
            chosen = request.get("runIds", {}).get(case)
            run = find_run(root, case, chosen) if chosen else json.loads((root / (case + "-run.json")).read_text())
            if run["status"] != "success":
                raise ValueError("A selected case has no successful simulation")
            runs.append(run)
        for run in runs:
            if digest(Path(run['model'])) != run['revision']:
                raise ValueError('Frozen model bytes no longer match the selected run revision')
            frozen_model = load_model(Path(run["model"]))
            run["floorArea"] = frozen_model.getBuilding().floorArea()
            run["caseName"] = frozen_model.getBuilding().nameString()
        available = {item["id"]: item for run in runs for item in channels(Path(run["sql"]))}
        channel = available.get(request.get("channel"))
        if not channel:
            raise ValueError("Select an actual SQL channel")
        absent = [run["caseId"] for run in runs if channel["id"] not in {item["id"] for item in channels(Path(run["sql"]))}]
        if absent:
            raise ValueError("Selected output was not recorded in " + ", ".join(absent) + "; rerun with matching output requests")
        return compare(runs, channel, request.get("start"), request.get("end"), baseline_case_id=baseline_id)
    import openstudio
    for folder in ("inputs", "runs", "measures", "operations"):
        (root / folder).mkdir(parents=True, exist_ok=True)
    if mode == "create_case":
        from floor_geometry import create_core_floor, add_upper_floor, validate_geometry
        source_id = request.get("sourceCaseId")
        if source_id not in case_ids(root):
            raise ValueError("Select an existing source case")
        source = root / "inputs" / (source_id + ".osm")
        if digest(source) != request.get("revision"):
            raise ValueError("Source model revision changed; reload before creating a case")
        name = request.get("name")
        if not isinstance(name, str) or not name.strip() or len(name) > 100 or any(ord(c) < 32 for c in name):
            raise ValueError("Give the new case a name of 1–100 characters")
        layout = request.get("layout")
        if layout not in ("copy", "core_perimeter", "upper_floor"):
            raise ValueError("Unsupported case geometry operation")
        op_dir = root / "operations" / str(uuid.uuid4()); op_dir.mkdir()
        new_id = "case_" + uuid.uuid4().hex[:12]
        receipt = dict(operation=mode, sourceCaseId=source_id, beforeRevision=digest(source),
                       caseId=new_id, layout=layout, status="preparing")
        try:
            candidate = load_model(source)
            candidate.getBuilding().setName(name.strip())
            source_run = root / (source_id + '-run.json')
            if source_run.exists():
                prior = json.loads(source_run.read_text())
                candidate.getBuilding().additionalProperties().setFeature('output_dictionary_source',
                    json.dumps(dict(caseId=source_id,runId=prior['runId'])))
            if layout == "core_perimeter":
                receipt["geometry"] = create_core_floor(candidate)
                receipt["reconciled"] = "New floor envelope: source exterior wall and partition assemblies; configured library roof/ground slab replace formerly adiabatic ceiling/floor. Source facade glazing fraction retained on the same orientation. Every Space has copied load densities/schedules and Ideal Loads."
            elif layout == "upper_floor":
                receipt["geometry"] = add_upper_floor(candidate)
                receipt["reconciled"] = "Explicit upper Spaces and conditioning copied from lower floor. The upper copy retains the exterior roof; the newly interstory boundary receives the configured library interior ceiling and its reverse. Other lower assignments retained."
            staged = op_dir / "candidate.osm"
            if not candidate.save(str(staged), False):
                raise ValueError("Could not save new case")
            reopened = load_model(staged)
            if layout != "copy":
                receipt["readback"] = validate_geometry(reopened)
            if digest(source) != request["revision"]:
                raise ValueError("Source model changed during case preparation")
            destination = root / "inputs" / (new_id + ".osm")
            # Exclusive creation: no existing case or frozen simulation input is replaced.
            with destination.open("xb") as target:
                target.write(staged.read_bytes())
            receipt.update(status="success", afterRevision=digest(destination), model=str(destination))
        except BaseException as error:
            receipt.update(status="failed", error=failure_message(error), traceback=traceback.format_exc())
            raise
        finally:
            save_json(op_dir / "receipt.json", receipt)
        return {**state(root), "createdCaseId": new_id}
    if mode == "initialize":
        baseline = root / "inputs" / "baseline.osm"
        if baseline.exists():
            raise ValueError("A baseline already exists; it was not replaced")
        source = Path(config["model"])
        model = load_model(source)
        weather = Path(config["weather"])
        copied_weather = root / "inputs" / weather.name
        shutil.copy2(weather, copied_weather)
        openstudio.model.WeatherFile.setWeatherFile(model, openstudio.EpwFile(str(copied_weather)))
        if not model.save(str(baseline), False):
            raise ValueError("Could not save baseline")
        save_json(root / "source.json", {"source": str(source), "sha256": digest(source),
                  "weather": str(copied_weather), "weatherSha256": digest(copied_weather)})
        return state(root)
    case_id = request.get("caseId")
    if case_id not in case_ids(root):
        raise ValueError("Unknown case")
    path = root / "inputs" / (case_id + ".osm")
    if mode == "clone":
        if case_id == "baseline" or path.exists():
            raise ValueError("An existing case cannot be overwritten")
        source = root / "inputs" / "baseline.osm"
        if digest(source) != request.get("revision"):
            raise ValueError("Baseline revision changed")
        shutil.copy2(source, path)
        return state(root)
    if not path.is_file() or digest(path) != request.get("revision"):
        raise ValueError("Model revision changed; reload before editing or running")
    if mode not in ("glazing", "edit_inputs", "outputs", "run", "packaged_rooftop"):
        raise ValueError("Unsupported operation")
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client
    from openstudio_block import call
    from input_controls import apply_edits, verify_edits
    from output_controls import set_outputs
    reference = Path(config["referenceRoot"])
    spec = importlib.util.spec_from_file_location("installed_openstudio_launch", reference / "launch_mcp.py")
    launcher = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(launcher)
    environment = launcher.environment()
    environment.update(OPENSTUDIO_MCP_INPUT_ROOT=str(root / "inputs"), OPENSTUDIO_MCP_RUN_ROOT=str(root / "runs"),
                       OPENSTUDIO_MCP_MEASURES_DIR=str(root / "measures"))
    op_dir = root / "operations" / str(uuid.uuid4())
    op_dir.mkdir()
    receipt = {"operation": mode, "caseId": case_id, "beforeRevision": digest(path), "status": "running", "stage": "OpenStudio MCP startup"}
    save_json(op_dir / "receipt.json", receipt)
    server = StdioServerParameters(command=sys.executable, args=["-m", "mcp_server.server"],
                                  cwd=str(reference), env=environment)
    try:
        with (op_dir / "mcp.stderr.log").open("w", encoding="utf-8") as errors:
            async with stdio_client(server, errlog=errors) as streams:
                async with ClientSession(*streams, read_timeout_seconds=timedelta(seconds=180)) as session:
                    await session.initialize()
                    receipt["stage"] = "OpenStudio model load"
                    save_json(op_dir / "receipt.json", receipt)
                    await call(session, "load_osm_model", osm_path=str(path), version_translate=False)
                    receipt["stage"] = "Model input validation and save"
                    if mode == "packaged_rooftop":
                        from packaged_rooftop import describe, reconcile_connections
                        if not case_id.startswith('case_'):
                            raise ValueError('Create a separate named copy before testing packaged HVAC')
                        original = load_model(path)
                        zones = original.getThermalZones()
                        if len(zones)!=1 or len(original.getSpaces())!=1 or str(zones[0].handle())!=request.get('zoneHandle'):
                            raise ValueError('Select the sole zone in a separate shoebox copy')
                        zone = zones[0]
                        equipment = list(zone.equipment())
                        if request.get('heatingFuel') not in ('NaturalGas','Electricity') or type(request.get('economizer')) is not bool:
                            raise ValueError('Select NaturalGas or Electricity and an explicit economizer choice')
                        if len(original.getDesignDays())<2:
                            raise ValueError('Source model has no heating/cooling sizing design days')
                        source_limits = None
                        if original.getAirLoopHVACs():
                            if describe(original)['heatingFuel'] != request['heatingFuel']:
                                raise ValueError('Changing heating fuel requires a fresh separate shoebox copy')
                            receipt['recipe'] = {'existingSystem': describe(original)}
                        else:
                            if len(equipment)!=1 or not equipment[0].to_ZoneHVACIdealLoadsAirSystem().is_initialized():
                                raise ValueError('Expected the existing single Ideal Loads system')
                            ideal = equipment[0].to_ZoneHVACIdealLoadsAirSystem().get()
                            source_limits = [ideal.minimumCoolingSupplyAirTemperature(),ideal.maximumHeatingSupplyAirTemperature()]
                            catalogue = await session.list_tools()
                            receipt['toolSchemas'] = [tool.model_dump(mode='json') for tool in catalogue.tools if tool.name in ('remove_zone_equipment','add_baseline_system')]
                            receipt['removedIdealLoads'] = await call(session,'remove_zone_equipment',zone_name=zone.nameString(),equipment_name=equipment[0].nameString())
                            receipt['recipe'] = await call(session,'add_baseline_system',system_type=3,thermal_zone_names=[zone.nameString()],heating_fuel=request['heatingFuel'],cooling_fuel='Electricity',economizer=request['economizer'],system_name='Packaged rooftop DX')
                        candidate = root/'runs'/('candidate-'+op_dir.name+'.osm')
                        await call(session,'save_osm_model',osm_path=str(candidate))
                        edited = load_model(candidate)
                        receipt['sdkConnectionCorrection'] = reconcile_connections(edited, source_limits)
                        if not edited.getControllerOutdoorAirs()[0].setEconomizerControlType('DifferentialDryBulb' if request['economizer'] else 'NoEconomizer'):
                            raise ValueError('Economizer readback could not be set')
                        receipt['readback'] = describe(edited)
                        if receipt['readback']['heatingFuel'] != request['heatingFuel']:
                            raise ValueError('Heating fuel readback differs')
                        # Keep common comfort/environment outputs. Ideal Loads variables
                        # cannot exist after removing that equipment; do not show zeroes.
                        receipt['removedOutputs'] = []
                        for output in list(edited.getOutputVariables()):
                            if output.variableName().startswith('Zone Ideal Loads '):
                                receipt['removedOutputs'].append(output.variableName()); output.remove()
                        edited.save(str(candidate),True)
                        await call(session,'load_osm_model',osm_path=str(candidate),version_translate=False)
                        reopened = root/'runs'/('reopened-'+op_dir.name+'.osm')
                        await call(session,'save_osm_model',osm_path=str(reopened))
                        reopened_model = load_model(reopened)
                        receipt['reopenedReadback'] = describe(reopened_model)
                        if receipt['readback'] != receipt['reopenedReadback']:
                            raise ValueError('Packaged system readback changed after reopen')
                        before_geometry, after_geometry = inspect(path)['geometry'], inspect(reopened)['geometry']
                        if before_geometry['objects'] != after_geometry['objects']:
                            raise ValueError('HVAC recipe changed building geometry')
                        if original.getBuilding().northAxis()!=reopened_model.getBuilding().northAxis():
                            raise ValueError('HVAC recipe changed orientation')
                        if digest(path)!=request['revision']:
                            raise ValueError('Model changed during operation')
                        shutil.copy2(reopened,path)
                        receipt.update(status='success',afterRevision=digest(path),reopened=str(reopened))
                    elif mode in ("edit_inputs", "outputs"):
                        if case_id == "baseline":
                            raise ValueError("Preserve baseline; edit a comparison case")
                        edited = load_model(path)
                        if mode == "edit_inputs":
                            receipt.update(apply_edits(edited, request.get("edits")))
                        else:
                            receipt.update(set_outputs(edited, root, case_id, request.get("outputs")))
                        candidate = root / "runs" / ("candidate-" + op_dir.name + ".osm")
                        if not edited.save(str(candidate), True):
                            raise ValueError("Could not save input edits")
                        await call(session, "load_osm_model", osm_path=str(candidate), version_translate=False)
                        reopened = root / "runs" / ("reopened-" + op_dir.name + ".osm")
                        await call(session, "save_osm_model", osm_path=str(reopened))
                        reopened_model = load_model(reopened)
                        if mode == "edit_inputs":
                            receipt["readback"] = verify_edits(reopened_model, receipt["expected"])
                            if any(s.additionalProperties().hasFeature("floor_region") for s in reopened_model.getSpaces()):
                                from floor_geometry import validate_geometry
                                receipt["geometry"] = validate_geometry(reopened_model)
                        else:
                            actual = sorted((item.variableName(), item.keyValue(), item.reportingFrequency()) for item in reopened_model.getOutputVariables())
                            if actual != sorted((item["name"], item["key"], item["frequency"]) for item in request["outputs"]):
                                raise ValueError("Output request readback differs")
                            receipt["readback"] = actual
                        if digest(path) != request["revision"]:
                            raise ValueError("Model changed during operation")
                        receipt["reopened"] = str(reopened)
                        shutil.copy2(reopened, path)
                        receipt.update(status="success", afterRevision=digest(path))
                    elif mode == "glazing":
                        if case_id == "baseline":
                            raise ValueError("Preserve baseline; create a comparison case before editing")
                        ratio = request.get("ratio")
                        if isinstance(ratio, bool) or not isinstance(ratio, (int, float)) or not math.isfinite(ratio) or not 0 < ratio < 1:
                            raise ValueError("Glazing ratio must be finite and strictly between 0 and 1")
                        before = inspect(path)
                        wall_info = next((w for w in before["walls"] if w["handle"] == request.get("surfaceHandle")), None)
                        if not wall_info or not wall_info["editable"]:
                            raise ValueError("Select an exterior wall with one ordinary window")
                        original = load_model(path)
                        wall = original.getSurface(openstudio.toUUID(wall_info["handle"])).get()
                        window = wall.subSurfaces()[0]
                        if any(shade.additionalProperties().getFeatureAsString("host_subsurface").is_initialized()
                               and shade.additionalProperties().getFeatureAsString("host_subsurface").get() == str(window.handle())
                               for shade in original.getShadingSurfaces()):
                            raise ValueError("Set hosted shading projections to zero before replacing this window's glazing layout")
                        construction = window.construction()
                        if (not construction.is_initialized() or window.shadingControl().is_initialized()
                                or window.windowPropertyFrameAndDivider().is_initialized() or window.multiplier() != 1):
                            raise ValueError("This first control requires an ordinary unmultiplied window with a construction, without frames or shading controls")
                        sill = min(v.z() for v in window.vertices()) - min(v.z() for v in wall.vertices())
                        receipt["request"] = {"tool": "set_window_to_wall_ratio", "surface_name": wall.nameString(),
                                              "ratio": ratio, "sill_height_m": sill}
                        receipt["toolResult"] = await call(session, "set_window_to_wall_ratio",
                            surface_name=wall.nameString(), ratio=ratio, sill_height_m=sill)
                        candidate = root / "runs" / ("candidate-" + op_dir.name + ".osm")
                        await call(session, "save_osm_model", osm_path=str(candidate))
                        edited = load_model(candidate)
                        edited_wall = edited.getSurface(wall.handle()).get()
                        # The recipe recreates windows. Preserve the selected window's actual construction via SDK assignment.
                        accepted_construction = edited.getConstructionBase(construction.get().handle())
                        if not accepted_construction.is_initialized() or len(edited_wall.subSurfaces()) != 1:
                            raise ValueError("Window construction or topology was not preserved")
                        new_window = edited_wall.subSurfaces()[0]
                        if not new_window.setConstruction(accepted_construction.get()):
                            raise ValueError("OpenStudio rejected window construction assignment")
                        new_window.setName(window.nameString())
                        if not edited.save(str(candidate), True):
                            raise ValueError("Could not save edited candidate")
                        await call(session, "load_osm_model", osm_path=str(candidate), version_translate=False)
                        reopened = root / "runs" / ("reopened-" + op_dir.name + ".osm")
                        await call(session, "save_osm_model", osm_path=str(reopened))
                        after = inspect(reopened)
                        actual = next(w["ratio"] for w in after["walls"] if w["handle"] == wall_info["handle"])
                        if not math.isclose(actual, ratio, rel_tol=1e-6):
                            raise ValueError("Saved/reopened glazing ratio did not match")
                        excluded = {str(window.handle()), str(new_window.handle())}
                        unaffected = lambda data: [obj for obj in data["geometry"]["objects"] if obj["handle"] not in excluded and obj["handle"] != wall_info["handle"]]
                        if unaffected(before) != unaffected(after) or before["geometry"]["spaces"] != after["geometry"]["spaces"]:
                            raise ValueError("An unrelated surface or Space changed")
                        reopened_model = load_model(reopened)
                        unchanged_objects = lambda model: {str(obj.handle()): str(obj) for obj in model.modelObjects()
                                                            if str(obj.handle()) not in excluded}
                        if unchanged_objects(original) != unchanged_objects(reopened_model):
                            raise ValueError("An engineering object outside the selected window changed")
                        receipt.update(surfaceHandle=wall_info["handle"], beforeRatio=wall_info["ratio"], afterRatio=actual,
                                       units="fraction", reopened=str(reopened), constructionHandle=str(construction.get().handle()))
                        receipt["unchangedOtherModelObjects"] = len(unchanged_objects(original))
                        if digest(path) != request["revision"]:
                            raise ValueError("Model changed during operation")
                        shutil.copy2(reopened, path)
                        receipt.update(status="success", afterRevision=digest(path))
                    else:
                        frozen = root / "inputs" / (case_id + "-" + op_dir.name + ".osm")
                        shutil.copy2(path, frozen)
                        if digest(frozen)!=request['revision']:
                            raise ValueError('Model changed while its simulation input was frozen')
                        run_model = load_model(frozen)
                        weather = run_model.weatherFile()
                        if not weather.is_initialized() or not weather.get().path().is_initialized():
                            raise ValueError("Model has no weather file")
                        weather_path = Path(str(weather.get().path().get()))
                        if not weather_path.is_file():
                            raise ValueError("Model weather file is unavailable")
                        engine = subprocess.run([environment["ENERGYPLUS_EXE_PATH"], "--version"],
                                                text=True, capture_output=True, check=True).stdout.strip()
                        receipt.update(revision=digest(frozen), model=str(frozen), engine=engine,
                                       floorArea=run_model.getBuilding().floorArea(),
                                       openstudioVersion=openstudio.openStudioVersion(), weatherSha256=digest(weather_path), weather=str(weather_path))
                        receipt["stage"] = "Simulation submission"
                        save_json(op_dir / "receipt.json", receipt)
                        from sizing_controls import prepare_weather_workflow, verify_translated_periods
                        workflow = prepare_weather_workflow(run_model, frozen, weather_path, root, op_dir.name)
                        if workflow:
                            receipt['workflow'] = str(workflow)
                            started = await call(session, 'run_osw', osw_path=str(workflow), epw_path=str(weather_path), name=case_id)
                        else:
                            started = await call(session, "run_simulation", osm_path=str(frozen), epw_path=str(weather_path), name=case_id)
                        receipt["runId"] = started["run_id"]
                        receipt["stage"] = "EnergyPlus simulation"
                        save_json(op_dir / "receipt.json", receipt)
                        while True:
                            status = await call(session, "get_run_status", run_id=started["run_id"])
                            if status["run"]["status"] not in ("running", "queued"):
                                break
                            await asyncio.sleep(60)
                        receipt["run"] = status["run"]
                        receipt["logs"] = await call(session, "get_run_logs", run_id=started["run_id"], stream="energyplus", tail=60)
                        directory = Path(status["run"]["run_dir"]) / "run"
                        receipt.update(sql=str(directory / "eplusout.sql"), html=str(directory / "eplustbl.htm"))
                        if status["run"]["status"] != "success":
                            raise ValueError("EnergyPlus run failed; native logs retained")
                        receipt["nativeEnd"] = (directory / "eplusout.end").read_text()
                        receipt['weatherSizingPeriods'] = verify_translated_periods(run_model, directory/'in.idf') if workflow else []
                        if "Completed Successfully" not in receipt["nativeEnd"]:
                            raise ValueError("Native EnergyPlus completion was not successful")
                        receipt["stage"] = "Simulation result readback"
                        receipt["channels"] = channels(directory / "eplusout.sql")
                        receipt["hashes"] = {name: digest(directory / name) for name in ("in.idf", "eplusout.sql", "eplusout.err")}
                        receipt["status"] = "success"
                        await call(session, "pin_run", run_id=started["run_id"])
                        save_json(root / (case_id + "-run.json"), receipt)
    except BaseException as error:
        receipt.update(status="failed", error=failure_message(error), traceback=traceback.format_exc())
        raise RuntimeError(f"{receipt['stage']} failed: {failure_message(error)}. Operation {op_dir.name}; original results retained.") from error
    finally:
        save_json(op_dir / "receipt.json", receipt)
    return state(root)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--config", type=Path, required=True)
    args = parser.parse_args()
    try:
        result = asyncio.run(operation(args.root, json.loads(args.config.read_text()), json.load(sys.stdin)))
        print("NRGSIM_RESULT=" + json.dumps({"ok": True, "data": result}, allow_nan=False))
    except Exception as error:
        print("NRGSIM_RESULT=" + json.dumps({"ok": False, "error": failure_message(error)}))
        sys.exit(1)
