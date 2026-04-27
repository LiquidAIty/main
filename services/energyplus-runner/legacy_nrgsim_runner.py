"""Preserved NRGSIM jEPlus runner.

This module modernizes the legacy `nrgsim/scripts/runsimulation.py` mapping
without wiring it into the current frontend. Dry-run mode is intentionally
usable without Java, JESS, jEPlus, or EnergyPlus installed.
"""

from __future__ import annotations

import argparse
import csv
import json
import shutil
import subprocess
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Iterable


JOBLIST_COLUMN_ORDER = [
    "job_id",
    "weather_file_index",
    "model_file_index",
    "height",
    "depth",
    "width",
    "window_glazing_ratio",
    "overhang",
    "left_fin",
    "right_fin",
    "orientation",
    "wall_type",
    "window_type",
    "infiltration_rate",
    "insulation_level",
    "pcm_material",
    "occupancy_type",
    "cooling_setpoint",
    "heating_setpoint",
    "site",
]


@dataclass(frozen=True)
class LegacyNrgSimRequest:
    job_id: str
    weather_file: str
    model_file: str
    terrain: str
    orientation: float
    width: float
    height: float
    depth: float
    occupancy_type: str
    win_gr: float
    cooling_sp: float
    heating_sp: float
    insulation_level: float
    infiltration_rate: float
    m_value: str
    q_value: str
    window_type: str
    wall_type: str
    left_fin: float
    right_fin: float
    overhang: float

    @classmethod
    def from_mapping(cls, data: dict[str, Any]) -> "LegacyNrgSimRequest":
        def pick(*names: str, default: Any = None) -> Any:
            for name in names:
                if name in data and data[name] is not None:
                    return data[name]
            if default is not None:
                return default
            raise KeyError(f"missing required legacy NRGSIM field: {names[0]}")

        return cls(
            job_id=str(pick("JobID", "job_id", default="job1")),
            weather_file=str(pick("WeatherFile", "weather_file", default="")),
            model_file=str(pick("ModelFile", "model_file", default="")),
            terrain=str(pick("Terrain", "terrain", default="City")),
            orientation=float(pick("Orientation", "orientation")),
            width=float(pick("Width", "width")),
            height=float(pick("Height", "height")),
            depth=float(pick("Depth", "depth")),
            occupancy_type=str(pick("OccupancyType", "occupancy_type")),
            win_gr=float(pick("WinGR", "win_gr")),
            cooling_sp=float(pick("CoolingSP", "cooling_sp")),
            heating_sp=float(pick("HeatingSP", "heating_sp")),
            insulation_level=float(pick("InsulationLevel", "insulation_level")),
            infiltration_rate=float(pick("InfiltrationRate", "infiltration_rate")),
            m_value=str(pick("Mvalue", "MValue", "m_value")),
            q_value=str(pick("Qvalue", "QValue", "q_value")),
            window_type=str(pick("WindowType", "window_type")),
            wall_type=str(pick("WallType", "wall_type")),
            left_fin=float(pick("LFin", "FinLeft", "left_fin")),
            right_fin=float(pick("RFin", "FinRight", "right_fin")),
            overhang=float(pick("Overhang", "overhang")),
        )


@dataclass(frozen=True)
class LegacyRunnerPaths:
    template_dir: Path
    simulations_dir: Path
    jess_client_dir: Path
    results_dir: Path | None = None


@dataclass(frozen=True)
class LegacyRunResult:
    simulation_id: str
    simulation_dir: Path
    joblist_path: Path
    results_dir: Path
    results_file: Path
    rows: list[list[Any]]
    dry_run: bool
    executed: bool


def _sample_payload() -> dict[str, Any]:
    return {
        "JobID": "sample",
        "WeatherFile": "",
        "ModelFile": "",
        "Terrain": "City",
        "Orientation": 180,
        "Width": 4.572,
        "Height": 2.4511,
        "Depth": 4.572,
        "OccupancyType": "Office",
        "WinGR": 40,
        "CoolingSP": 25,
        "HeatingSP": 21,
        "InsulationLevel": 3,
        "InfiltrationRate": 1,
        "Mvalue": "51",
        "Qvalue": "25",
        "WindowType": "GenericWindow",
        "WallType": "SteelFramed",
        "LFin": 0.2,
        "RFin": 0.2,
        "Overhang": 0.5,
    }


def _pcm_material(request: LegacyNrgSimRequest) -> str:
    return f"M{request.m_value}Q{request.q_value}"


def _joblist_row(
    job_id: str,
    request: LegacyNrgSimRequest,
    pcm_material: str,
) -> list[Any]:
    return [
        job_id,
        0,
        0,
        request.height,
        request.depth,
        request.width,
        request.win_gr,
        request.overhang,
        request.left_fin,
        request.right_fin,
        request.orientation,
        request.wall_type,
        request.window_type,
        request.infiltration_rate,
        request.insulation_level,
        pcm_material,
        request.occupancy_type,
        request.cooling_sp,
        request.heating_sp,
        "City",
    ]


def createSimulationDirectory(
    simulation_id: str,
    paths: LegacyRunnerPaths,
    *,
    copy_template: bool = True,
) -> Path:
    simulation_dir = paths.simulations_dir / simulation_id
    if simulation_dir.exists():
        shutil.rmtree(simulation_dir)
    if copy_template:
        shutil.copytree(paths.template_dir, simulation_dir)
    else:
        simulation_dir.mkdir(parents=True, exist_ok=True)
    return simulation_dir.resolve()


def convertDataToCSV(request: LegacyNrgSimRequest | dict[str, Any]) -> list[list[Any]]:
    if isinstance(request, dict):
        request = LegacyNrgSimRequest.from_mapping(request)
    return [
        _joblist_row("job1", request, _pcm_material(request)),
        _joblist_row("job0", request, "WallAirGap"),
    ]


def createJobListFile(
    simulation_dir: Path,
    request: LegacyNrgSimRequest | dict[str, Any],
) -> Path:
    output_file = simulation_dir / "joblist.csv"
    output_file.parent.mkdir(parents=True, exist_ok=True)
    with output_file.open("w", newline="", encoding="utf-8") as csvfile:
        writer = csv.writer(
            csvfile,
            delimiter=",",
            quotechar="'",
            quoting=csv.QUOTE_MINIMAL,
        )
        writer.writerows(convertDataToCSV(request))
    return output_file


def copySupportingFiles(
    simulation_dir: Path,
    request: LegacyNrgSimRequest | dict[str, Any],
) -> Path | None:
    if isinstance(request, dict):
        request = LegacyNrgSimRequest.from_mapping(request)
    if not request.weather_file:
        return None
    source = Path(request.weather_file).expanduser().resolve()
    target = simulation_dir / "in.epw"
    shutil.copyfile(source, target)
    return target


def executeSimulation(
    simulation_dir: Path,
    results_dir: Path,
    paths: LegacyRunnerPaths,
) -> int:
    jar_path = paths.jess_client_dir / "JESS_Client.jar"
    cfg_path = paths.jess_client_dir / "client.cfg"
    log_cfg_path = paths.jess_client_dir / "log4j.cfg"
    return subprocess.call(
        [
            "java",
            "-jar",
            str(jar_path),
            "-cfg",
            str(cfg_path),
            "-log",
            str(log_cfg_path),
            "-job",
            str(simulation_dir),
            "-type",
            "JEPLUS_PROJECT",
            "-subset",
            "LIST_FILE",
            "-subset_param",
            "joblist.csv",
            "-output",
            str(results_dir),
        ],
        cwd=paths.jess_client_dir,
    )


def runSimulation(
    simulation_id: str,
    request: LegacyNrgSimRequest | dict[str, Any],
    paths: LegacyRunnerPaths,
    *,
    dry_run: bool = False,
    write_joblist: bool = True,
) -> LegacyRunResult:
    if isinstance(request, dict):
        request = LegacyNrgSimRequest.from_mapping(request)

    simulation_dir = createSimulationDirectory(
        simulation_id,
        paths,
        copy_template=not dry_run,
    )
    results_dir = (paths.results_dir or (simulation_dir / "output")).resolve()
    results_file = results_dir / "AllDerivedResults.csv"
    rows = convertDataToCSV(request)
    joblist_path = simulation_dir / "joblist.csv"

    if write_joblist:
        createJobListFile(simulation_dir, request)

    if not dry_run:
        copySupportingFiles(simulation_dir, request)
        executeSimulation(simulation_dir, results_dir, paths)

    return LegacyRunResult(
        simulation_id=simulation_id,
        simulation_dir=simulation_dir,
        joblist_path=joblist_path,
        results_dir=results_dir,
        results_file=results_file,
        rows=rows,
        dry_run=dry_run,
        executed=not dry_run,
    )


def _default_paths(repo_root: Path, simulations_dir: Path | None) -> LegacyRunnerPaths:
    return LegacyRunnerPaths(
        template_dir=repo_root / "jEPlus" / "Box",
        simulations_dir=simulations_dir or (repo_root / "simulations"),
        jess_client_dir=repo_root / "jess_client",
        results_dir=None,
    )


def _result_to_json(result: LegacyRunResult) -> dict[str, Any]:
    data = asdict(result)
    for key in ["simulation_dir", "joblist_path", "results_dir", "results_file"]:
        data[key] = str(data[key])
    data["joblist_column_order"] = JOBLIST_COLUMN_ORDER
    return data


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Preserved NRGSIM jEPlus runner")
    parser.add_argument("--simulation-id", default="sample")
    parser.add_argument("--payload-json")
    parser.add_argument("--payload-file", type=Path)
    parser.add_argument("--sample", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--write-joblist", action="store_true")
    parser.add_argument("--template-dir", type=Path)
    parser.add_argument("--simulations-dir", type=Path)
    parser.add_argument("--jess-client-dir", type=Path)
    parser.add_argument("--results-dir", type=Path)
    args = parser.parse_args(list(argv) if argv is not None else None)

    repo_root = Path.cwd()
    paths = _default_paths(repo_root, args.simulations_dir)
    if args.template_dir:
        paths = LegacyRunnerPaths(
            template_dir=args.template_dir,
            simulations_dir=paths.simulations_dir,
            jess_client_dir=paths.jess_client_dir,
            results_dir=paths.results_dir,
        )
    if args.jess_client_dir or args.results_dir:
        paths = LegacyRunnerPaths(
            template_dir=paths.template_dir,
            simulations_dir=paths.simulations_dir,
            jess_client_dir=args.jess_client_dir or paths.jess_client_dir,
            results_dir=args.results_dir,
        )

    if args.sample:
        payload = _sample_payload()
    elif args.payload_file:
        payload = json.loads(args.payload_file.read_text(encoding="utf-8"))
    elif args.payload_json:
        payload = json.loads(args.payload_json)
    else:
        parser.error("provide --sample, --payload-file, or --payload-json")

    result = runSimulation(
        args.simulation_id,
        payload,
        paths,
        dry_run=args.dry_run,
        write_joblist=args.write_joblist or not args.dry_run,
    )
    print(json.dumps(_result_to_json(result), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
