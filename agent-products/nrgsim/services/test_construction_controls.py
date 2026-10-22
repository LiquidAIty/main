"""Actual SDK construction editing, scoped resources and persisted thermal resistance."""
# Entity: Building Modeling
# Relationship: Proves envelope assignment and R-value inputs alter real assemblies without changing other surfaces or saved study cases.
import tempfile
import unittest
from pathlib import Path
import openstudio as os
from floor_geometry import create_core_floor, add_upper_floor, validate_geometry
from input_controls import bindings, apply_edits, verify_edits

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / '.local/projects/38bd1429-e8e1-47ff-afef-d940aa8e8040/inputs/baseline.osm'


class ConstructionTests(unittest.TestCase):
    def model(self):
        model = os.model.Model.load(str(BASE)).get()
        create_core_floor(model); add_upper_floor(model)
        return model

    def reopen(self, model):
        with tempfile.TemporaryDirectory(dir=ROOT / '.local') as folder:
            path = Path(folder) / 'construction.osm'
            self.assertTrue(model.save(str(path), False))
            return os.model.Model.load(str(path)).get()

    def test_building_and_story_selectors_change_only_declared_surfaces(self):
        model = self.model()
        building = model.getBuilding()
        field = f'{building.handle()}:envelope.Wall.Outdoors.construction'
        control = bindings(model)[field].data
        self.assertEqual(len(control['targets']), 8)
        self.assertGreater(control['thermal']['resistance'], 2)
        story = min(model.getBuildingStorys(), key=lambda s: s.nominalZCoordinate().get())
        field = f'{story.handle()}:envelope.Wall.Outdoors.construction'
        targets = set(bindings(model)[field].data['targets'])
        self.assertEqual(len(targets), 4)
        before = {str(s.handle()): str(s.construction().get().handle()) for s in model.getSurfaces()}
        selected = next(item['value'] for item in bindings(model)[field].data['choices'] if item['value'].startswith('library:'))
        partition = next(s.construction().get() for s in model.getSurfaces() if s.surfaceType() == 'Wall' and s.outsideBoundaryCondition() == 'Surface')
        self.assertNotIn(str(partition.handle()), [item['value'] for item in bindings(model)[field].data['choices']])
        with self.assertRaises(ValueError):
            apply_edits(model, [dict(id=field, value=str(partition.handle()))])
        changed = apply_edits(model, [dict(id=field, value=selected)])
        model = self.reopen(model); verify_edits(model, changed['expected']); validate_geometry(model)
        for face in model.getSurfaces():
            self.assertEqual(str(face.construction().get().handle()), changed['expected'][field] if str(face.handle()) in targets else before[str(face.handle())])
        self.assertEqual(bindings(model)[f'{building.handle()}:envelope.Wall.Outdoors.construction'].data['value'], '__mixed__')

    def test_explicit_insulation_and_r_value_reopen_without_shared_resource_change(self):
        model = self.model()
        wall = next(s for s in model.getSurfaces() if s.surfaceType() == 'Wall' and s.outsideBoundaryCondition() == 'Outdoors')
        construction = wall.construction().get().to_Construction().get()
        before = {str(s.handle()): str(s.construction().get().handle()) for s in model.getSurfaces() if s.handle() != wall.handle()}
        original_layers = {str(m.handle()): m.to_OpaqueMaterial().get().thermalResistance() for m in construction.layers()}
        insulation_index = next(i for i,m in enumerate(construction.layers()) if m.to_MasslessOpaqueMaterial().is_initialized())
        field = f'{wall.handle()}:insulationLayer'
        edited = apply_edits(model, [dict(id=field, value=insulation_index)])
        model = self.reopen(model); verify_edits(model, edited['expected'])
        r_field = f'{wall.handle()}:assemblyResistance'
        edited = apply_edits(model, [dict(id=r_field, value=4)])
        model = self.reopen(model); verify_edits(model, edited['expected']); validate_geometry(model)
        self.assertAlmostEqual(bindings(model)[f'{wall.handle()}:construction'].data['thermal']['resistance'], 4)
        self.assertAlmostEqual(bindings(model)[f'{wall.handle()}:construction'].data['thermal']['conductance'], .25)
        self.assertEqual(before, {str(s.handle()): str(s.construction().get().handle()) for s in model.getSurfaces() if s.handle() != wall.handle()})
        for handle, resistance in original_layers.items():
            self.assertAlmostEqual(model.getOpaqueMaterial(os.toUUID(handle)).get().thermalResistance(), resistance)
        for value in (0, -1, float('nan'), True):
            with self.assertRaises(ValueError):
                apply_edits(model, [dict(id=r_field, value=value)])

    def test_no_assumed_insulation_or_glazing_r_value(self):
        model = self.model()
        for face in model.getSurfaces():
            self.assertNotIn(f'{face.handle()}:assemblyResistance', bindings(model))
        window = model.getSubSurfaces()[0]
        self.assertNotIn('thermal', bindings(model)[f'{window.handle()}:construction'].data)

    def test_roof_library_is_real_and_pcm_is_not_an_r_adjustment_layer(self):
        model = self.model(); ident = f'{model.getBuilding().handle()}:envelope.RoofCeiling.Outdoors.construction'
        change = apply_edits(model, [dict(id=ident, value='library:RoofCeiling:Outdoors')])
        model = self.reopen(model); verify_edits(model, change['expected']); validate_geometry(model)
        self.assertGreater(bindings(model)[ident].data['thermal']['resistance'], 5)
        roofs = [s for s in model.getSurfaces() if s.surfaceType() == 'RoofCeiling' and s.outsideBoundaryCondition() == 'Outdoors']
        self.assertEqual(len(roofs), 5)
        assembly = roofs[0].construction().get().to_Construction().get()
        self.assertTrue(assembly.additionalProperties().getFeatureAsString('construction_library').is_initialized())
        layer = next(m.to_StandardOpaqueMaterial().get() for m in assembly.layers() if m.to_StandardOpaqueMaterial().is_initialized())
        layer.createMaterialPropertyPhaseChangeHysteresis()
        index = next(i for i,m in enumerate(assembly.layers()) if m.handle() == layer.handle())
        self.assertNotIn(f'{roofs[0].handle()}:insulationLayer', bindings(model))
        self.assertNotIn(f'{roofs[0].handle()}:assemblyResistance', bindings(model))


if __name__ == '__main__':
    unittest.main()
