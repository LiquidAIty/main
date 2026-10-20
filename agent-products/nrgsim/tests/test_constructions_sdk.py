# Entity: Construction Editing Verification
# Relationship: These checks use real OpenStudio models to verify local copies, physical inputs, and preserved shared resources.
from pathlib import Path
import sys
import tempfile
import unittest

import openstudio

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from nrgsim.authoring import apply_authoring
from nrgsim.constructions import edit_surface_construction, inspect_surface_construction


def fixture():
    """Create engineering test inputs from an empty Model; no building file is imported."""
    model = openstudio.model.Model()
    story = apply_authoring(model, {
        "operation": "create_story", "name": "Ground", "elevation": 0, "height": 3,
    })["handle"]
    for name, x in (("East Office", 0), ("West Office", -10)):
        apply_authoring(model, {
            "operation": "draw_space", "name": name, "story": story, "height": 3,
            "points": [[x, 0], [x + 10, 0], [x + 10, 8], [x, 8]], "createThermalZone": True,
        })
    outer = openstudio.model.StandardOpaqueMaterial(model)
    outer.setName("Brick")
    assert outer.setThickness(0.1) and outer.setConductivity(0.72)
    assert outer.setDensity(1800) and outer.setSpecificHeat(840)
    insulation = openstudio.model.MasslessOpaqueMaterial(model)
    insulation.setName("Insulation resistance")
    assert insulation.setThermalResistance(1.5)
    gap = openstudio.model.AirGap(model)
    gap.setName("Air space")
    assert gap.setThermalResistance(0.15)
    lining = openstudio.model.StandardOpaqueMaterial(model)
    lining.setName("Lining")
    assert lining.setThickness(0.0127) and lining.setConductivity(0.16)
    assert lining.setDensity(800) and lining.setSpecificHeat(1090)
    assembly = openstudio.model.Construction(model)
    assembly.setName("Shared wall")
    assert assembly.setLayers([outer, insulation, gap, lining])
    assembly.additionalProperties().setFeature("specification", "Retain construction metadata")
    outer.additionalProperties().setFeature("specification", "Retain material metadata")
    group = openstudio.model.DefaultSurfaceConstructions(model)
    assert group.setWallConstruction(assembly)
    defaults = openstudio.model.DefaultConstructionSet(model)
    assert defaults.setDefaultExteriorSurfaceConstructions(group)
    assert model.getBuilding().setDefaultConstructionSet(defaults)
    exterior = sorted(
        (face for face in model.getSurfaces()
         if face.surfaceType() == "Wall" and face.outsideBoundaryCondition() == "Outdoors"),
        key=lambda face: face.nameString(),
    )
    # A different Surface already has a detailed, explicit override.
    override = assembly.clone(model).to_Construction().get()
    override.setName("Existing detailed wall override")
    assert exterior[-1].setConstruction(override)
    return model, exterior[0], assembly, exterior[-1], override


def edits(before):
    values = ((0, {"thickness": 0.2}), (1, {"thermalResistance": 2.5}),
              (2, {"thermalResistance": 0.18}))
    return [
        {"index": index, "material_handle": before["layers"][index]["handle"],
         "name": f"{before['layers'][index]['name']} local", "properties": properties}
        for index, properties in values
    ]


class ConstructionSdkTests(unittest.TestCase):
    def setUp(self):
        self.model, self.surface, self.original, self.other, self.override = fixture()
        self.handle = str(self.surface.handle()).strip("{}")
        self.before = inspect_surface_construction(self.model, self.handle)

    def apply(self, requested=None):
        return edit_surface_construction(
            self.model, self.handle, self.before["construction"]["handle"],
            edits(self.before) if requested is None else requested, "Local wall",
        )

    def test_inspection_is_read_only_and_reports_real_material_fields(self):
        before = str(self.model)
        result = inspect_surface_construction(self.model, self.handle)
        self.assertEqual(str(self.model), before)
        self.assertTrue(result["isConstructionDefaulted"])
        self.assertEqual([layer["type"] for layer in result["layers"]], [
            "StandardOpaqueMaterial", "MasslessOpaqueMaterial", "AirGap", "StandardOpaqueMaterial",
        ])
        self.assertEqual(set(result["layers"][2]["properties"]), {"thermalResistance"})
        self.assertEqual(result["layers"][0]["properties"]["thickness"]["unit"], "m")

    def test_local_exception_copies_only_changed_layers_and_preserves_originals(self):
        source_layers = [str(layer.handle()) for layer in self.original.layers()]
        result = self.apply()
        changed = self.surface.construction().get().to_Construction().get()
        self.assertTrue(result["originalObjectsUnchanged"])
        self.assertFalse(result["after"]["isConstructionDefaulted"])
        self.assertNotEqual(changed.handle(), self.original.handle())
        self.assertEqual([str(layer.handle()) for layer in self.original.layers()], source_layers)
        for index in range(3):
            self.assertNotEqual(str(changed.layers()[index].handle()), source_layers[index])
        self.assertEqual(str(changed.layers()[3].handle()), source_layers[3])
        self.assertEqual(self.other.construction().get().handle(), self.override.handle())
        self.assertEqual(changed.additionalProperties().getFeatureAsString("specification").get(),
                         "Retain construction metadata")
        self.assertEqual(changed.layers()[0].additionalProperties().getFeatureAsString("specification").get(),
                         "Retain material metadata")
        self.assertEqual(self.original.layers()[0].to_StandardOpaqueMaterial().get().thickness(), 0.1)
        self.assertEqual(changed.layers()[0].to_StandardOpaqueMaterial().get().thickness(), 0.2)
        self.assertEqual(changed.layers()[1].to_MasslessOpaqueMaterial().get().thermalResistance(), 2.5)
        self.assertEqual(changed.layers()[2].to_AirGap().get().thermalResistance(), 0.18)

    def test_invalid_units_bounds_and_fields_do_not_mutate_model(self):
        cases = [
            (0, {"specificHeat": 99}), (0, {"thickness": 0}),
            (0, {"thermalAbsorptance": 1}), (0, {"density": float("nan")}),
            (1, {"thermalResistance": 0.0001}), (2, {"thermalResistance": -1}),
            (2, {"thickness": 0.1}), (0, {"density": True}), (0, {"roughness": "Invented"}),
        ]
        for index, properties in cases:
            with self.subTest(properties=properties):
                before = str(self.model)
                request = [{"index": index, "material_handle": self.before["layers"][index]["handle"],
                            "name": "Rejected", "properties": properties}]
                with self.assertRaises(ValueError):
                    self.apply(request)
                self.assertEqual(str(self.model), before)

    def test_stale_construction_and_layer_handles_are_refused(self):
        before = str(self.model)
        with self.assertRaisesRegex(ValueError, "Construction changed"):
            edit_surface_construction(self.model, self.handle, "stale", edits(self.before), "Rejected")
        request = edits(self.before)
        request[0]["material_handle"] = "stale"
        with self.assertRaisesRegex(ValueError, "Material layer changed"):
            self.apply(request)
        self.assertEqual(str(self.model), before)

    def test_special_material_properties_are_refused_without_dropping_them(self):
        material = self.original.layers()[0].to_StandardOpaqueMaterial().get()
        material.createMaterialPropertyPhaseChangeHysteresis()
        before = str(self.model)
        with self.assertRaisesRegex(ValueError, "associated MaterialProperty"):
            self.apply()
        self.assertEqual(str(self.model), before)

    def test_repeated_material_reference_only_changes_the_requested_occurrence(self):
        layers = list(self.original.layers())
        layers[-1] = layers[0]
        self.assertTrue(self.original.setLayers(layers))
        self.before = inspect_surface_construction(self.model, self.handle)
        result = self.apply(edits(self.before)[:1])
        after_layers = result["after"]["layers"]
        self.assertNotEqual(after_layers[0]["handle"], self.before["layers"][0]["handle"])
        self.assertEqual(after_layers[-1]["handle"], self.before["layers"][-1]["handle"])
        self.assertEqual(after_layers[-1]["properties"]["thickness"]["value"], 0.1)

    def test_interzone_edit_is_refused_without_unmatching_surfaces(self):
        paired = next(face for face in self.model.getSurfaces() if face.adjacentSurface().is_initialized())
        paired.setConstruction(self.original)
        before = str(self.model)
        with self.assertRaisesRegex(ValueError, "both Surface sides"):
            edit_surface_construction(self.model, str(paired.handle()),
                                      self.before["construction"]["handle"], edits(self.before), "Rejected")
        self.assertEqual(str(self.model), before)
        self.assertEqual(sum(face.adjacentSurface().is_initialized() for face in self.model.getSurfaces()), 2)

    def test_save_and_reopen_retains_local_exception_and_shared_layers(self):
        result = self.apply()
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[1] / ".data") as directory:
            path = Path(directory) / "model.osm"
            self.model.save(openstudio.path(str(path)), False)
            reopened = openstudio.model.Model.load(openstudio.path(str(path))).get()
        inspected = inspect_surface_construction(reopened, self.handle)
        self.assertEqual(inspected, result["after"])
        self.assertEqual(reopened.getSurface(self.other.handle()).get().construction().get().handle(),
                         self.override.handle())


if __name__ == "__main__":
    unittest.main()
