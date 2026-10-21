"""Real installed SDK tests against disposable copies of the accepted shoebox."""
# Entity: Building Modeling
# Relationship: Verifies inspector writes, shared-resource isolation and saved OSM readback without changing accepted cases.

import json
import tempfile
import unittest
from pathlib import Path

import openstudio

from input_controls import apply_edits, bindings, enable_fanger, has_fanger, verify_edits

ROOT = Path(__file__).resolve().parents[1]
BASELINE = ROOT / ".local/projects/38bd1429-e8e1-47ff-afef-d940aa8e8040/inputs/baseline.osm"


class InputTests(unittest.TestCase):
    def load(self):
        return openstudio.model.Model.load(str(BASELINE)).get()

    def test_every_published_control_has_real_sdk_write_and_reopen(self):
        model = self.load()
        counts = lambda m: (len(m.getPeoples()), len(m.getLightss()), len(m.getElectricEquipments()),
                            len(m.getHotWaterEquipments()), len(m.getSurfaces()), len(m.getSubSurfaces()))
        report = []
        with tempfile.TemporaryDirectory(prefix="inputs-", dir=ROOT / ".local") as directory:
            for control in bindings(model).values():
                data = control.data
                with self.subTest(label=data["label"], id=data["id"]):
                    candidate = self.load()
                    before = counts(candidate)
                    expected = apply_edits(candidate, [{"id": data["id"], "value": data["value"]}])["expected"]
                    path = Path(directory) / "test.osm"
                    self.assertTrue(candidate.save(str(path), True))
                    reopened = openstudio.model.Model.load(str(path)).get()
                    self.assertEqual(before, counts(reopened))
                    actual = verify_edits(reopened, expected)
                    report.append({"id": data["id"], "label": data["label"], "units": data["units"], "readback": actual[data["id"]]})
        (ROOT / ".local/input-binding-verification.json").write_text(json.dumps(report, indent=2), encoding="utf-8")

    def test_changed_values_reopen_and_preserve_geometry_and_load_counts(self):
        changes = {"Orientation": 30, "Width": 5.2, "Depth": 6, "Height": 3,
                   "Occupancy": 12, "Lighting density": 7, "Equipment density": 10,
                   "Infiltration": .25, "Outdoor air per person": .008,
                   "U-factor": 2, "SHGC": .5, "Thermal resistance": 3,
                   "Overhang projection / window height": .4, "Left fin projection / window width": .2,
                   "Right fin projection / window width": .2,
                   "Timesteps per hour": 12, "Calendar year": 2026}
        report = []
        with tempfile.TemporaryDirectory(prefix="changed-inputs-", dir=ROOT / ".local") as directory:
            for label, value in changes.items():
                with self.subTest(label=label):
                    model = self.load()
                    controls = bindings(model)
                    target = next(control for control in controls.values() if control.data["label"] == label)
                    expected = apply_edits(model, [{"id": target.data["id"], "value": value}])["expected"]
                    path = Path(directory) / "changed.osm"
                    self.assertTrue(model.save(str(path), True))
                    reopened = openstudio.model.Model.load(str(path)).get()
                    report.append({"label": label, "readback": verify_edits(reopened, expected)})
                    self.assertEqual(1, len(reopened.getPeoples()))
                    self.assertEqual(1, len(reopened.getLightss()))
                    self.assertEqual(1, len(reopened.getElectricEquipments()))
            model = self.load()
            target = next(item for item in bindings(model).values() if item.data["group"] == "Occupancy schedule")
            alternative = next(item["value"] for item in target.data["choices"] if item["value"] != target.data["value"])
            expected = apply_edits(model, [{"id": target.data["id"], "value": alternative}])["expected"]
            path = Path(directory) / "schedule.osm"
            model.save(str(path), True)
            report.append({"label": "Occupancy schedule", "readback": verify_edits(openstudio.model.Model.load(str(path)).get(), expected)})
        (ROOT / ".local/changed-input-verification.json").write_text(json.dumps(report, indent=2), encoding="utf-8")

    def test_local_material_copy_and_validation(self):
        model = self.load()
        wall = next(s for s in model.getSurfaces() if s.surfaceType() == "Wall" and s.outsideBoundaryCondition() == "Adiabatic")
        shared = wall.construction().get().handle()
        peers = {str(s.handle()): str(s.construction().get().handle()) for s in model.getSurfaces() if s.handle() != wall.handle()}
        control = next(item for item in bindings(model).values() if item.data["objectHandle"] == str(wall.handle()) and item.data["label"] == "Thickness")
        apply_edits(model, [{"id": control.data["id"], "value": .03}])
        self.assertNotEqual(shared, wall.construction().get().handle())
        self.assertEqual(peers, {str(s.handle()): str(s.construction().get().handle()) for s in model.getSurfaces() if s.handle() != wall.handle()})
        for value in (float("nan"), -1, True):
            with self.assertRaises(ValueError):
                apply_edits(self.load(), [{"id": control.data["id"], "value": value}])

    def test_deferred_hvac_is_not_published(self):
        self.assertFalse(any(item.data["tab"] == "hvac" for item in bindings(self.load()).values()))

    def test_fanger_reuses_people_and_preparation_is_idempotent(self):
        model = self.load()
        enable_fanger(model)
        count = len(model.modelObjects())
        enable_fanger(model)
        self.assertEqual(len(model.modelObjects()), count)
        self.assertEqual(len(model.getPeoples()), 1)
        self.assertTrue(has_fanger(model.getPeoples()[0]))
        control = next(item for item in bindings(model).values() if item.data["label"] == "Air speed")
        changes = apply_edits(model, [{"id": control.data["id"], "value": .3}])
        verify_edits(model, changes["expected"])


if __name__ == "__main__":
    unittest.main()
