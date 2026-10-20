"""Package the checked-in editor using the public OpenStudio BCLMeasure API."""
# Entity: Building Authoring
# Relationship: This creates a standard private measure package; it never loads or modifies a building model.
import json
from pathlib import Path
import shutil
import sys


def package(destination: Path):
    import openstudio

    product = Path(__file__).resolve().parents[1]
    destination = destination.resolve()
    if not destination.is_relative_to((product / ".data").resolve()):
        raise ValueError("Measure package must stay inside the building product's private data")
    entry = product / "measures" / "building_authoring" / "measure.py"
    sources = [Path(__file__).with_name(filename)
               for filename in ("__init__.py", "authoring.py", "constructions.py")]
    for source in (entry, *sources):
        compile(source.read_text("utf-8"), str(source), "exec")
    if not destination.exists():
        destination.parent.mkdir(parents=True, exist_ok=True)
        measure = openstudio.BCLMeasure(
            "Building Authoring", "BuildingAuthoring", openstudio.toPath(str(destination)),
            "Whole Building.Space Types", openstudio.MeasureType("ModelMeasure"),
            "Apply typed building edits.", "SDK geometry and engineering inputs; SI units.",
            openstudio.MeasureLanguage("Python"),
        )
        if not measure.save():
            raise RuntimeError("OpenStudio could not save the measure package")
    resources = destination / "resources" / "nrgsim"
    resources.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(entry, destination / "measure.py")
    for source in sources:
        shutil.copyfile(source, resources / source.name)
    return {"measure_dir": str(destination)}


if __name__ == "__main__":
    print(json.dumps(package(Path(sys.argv[1]))))
