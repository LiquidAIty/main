# Entity: Construction Editing Verification
# Relationship: This executes the packaged measure in an isolated SDK process and reads the resulting OSM without starting application services.
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import openstudio

PRODUCT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PRODUCT))
from nrgsim.package_measure import package
from nrgsim.projection import project
from test_constructions_sdk import edits, fixture
from nrgsim.constructions import inspect_surface_construction


class PackagedAuthoringTests(unittest.TestCase):
    def test_packaged_measure_edits_real_layers_and_projection_retains_types(self):
        model, surface, construction, other, override = fixture()
        original = inspect_surface_construction(model, str(surface.handle()))
        request = {"operation": "set_construction_layers", "handle": original["surface"]["handle"],
                   "expectedConstruction": original["construction"]["handle"],
                   "name": "Packaged wall exception", "edits": edits(original)}
        with tempfile.TemporaryDirectory(dir=PRODUCT / ".data") as directory:
            root = Path(directory)
            package(root / "measure")
            self.assertTrue(model.save(openstudio.path(str(root / "input.osm")), False))
            # No repository imports in this child: only the actual packaged measure.
            script = """
import importlib.util, json, pathlib, sys, openstudio
root = pathlib.Path(sys.argv[1])
spec = importlib.util.spec_from_file_location('packaged_editor', root / 'measure/measure.py')
entry = importlib.util.module_from_spec(spec)
spec.loader.exec_module(entry)
model = openstudio.model.Model.load(openstudio.path(str(root / 'input.osm'))).get()
measure = entry.BuildingAuthoring()
runner = openstudio.measure.OSRunner(openstudio.WorkflowJSON())
arguments = openstudio.measure.convertOSArgumentVectorToMap(measure.arguments(model))
argument = arguments['operation_json'].clone()
assert argument.setValue(sys.argv[2])
arguments['operation_json'] = argument
assert measure.run(model, runner, arguments), str(runner.result())
assert runner.result().value().valueName() == 'Success'
assert model.save(openstudio.path(str(root / 'accepted.osm')), False)
"""
            result = subprocess.run([sys.executable, "-I", "-B", "-c", script, str(root), json.dumps(request)],
                                    cwd=root, capture_output=True, text=True, timeout=60)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            projection = project(root / "accepted.osm", root / "display.gltf")
            selected = projection["objects"][original["surface"]["handle"]]
            editor = selected["constructionEditor"]
            self.assertFalse(editor["isConstructionDefaulted"])
            self.assertEqual([layer["type"] for layer in editor["layers"]], [
                "StandardOpaqueMaterial", "MasslessOpaqueMaterial", "AirGap", "StandardOpaqueMaterial"])
            self.assertEqual(editor["layers"][0]["properties"]["thickness"]["value"], 0.2)
            self.assertEqual(editor["layers"][1]["properties"]["thermalResistance"]["value"], 2.5)
            self.assertEqual(editor["layers"][2]["properties"]["thermalResistance"]["value"], 0.18)
            reopened = openstudio.model.Model.load(openstudio.path(str(root / "accepted.osm"))).get()
            self.assertEqual(reopened.getSurface(other.handle()).get().construction().get().handle(), override.handle())


if __name__ == "__main__":
    unittest.main()
