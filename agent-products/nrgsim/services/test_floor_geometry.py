"""Real SDK tests on disposable floor cases, never the accepted baseline."""
# Entity: Building Geometry
# Relationship: Proves floor topology, scoped edits, assignment preservation and OSM reopen against the installed SDK.
import tempfile
import unittest
from pathlib import Path
import openstudio as os
from floor_geometry import create_core_floor, add_upper_floor, validate_geometry, floor_dimensions
from input_controls import apply_edits, bindings, verify_edits

ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'.local/projects/38bd1429-e8e1-47ff-afef-d940aa8e8040/inputs/baseline.osm'


class FloorTests(unittest.TestCase):
    def floor(self):
        model=os.model.Model.load(str(BASE)).get()
        create_core_floor(model)
        return model

    def reopen(self, model):
        with tempfile.TemporaryDirectory(dir=ROOT/'.local',prefix='floor-test-') as folder:
            path=Path(folder)/'model.osm'
            self.assertTrue(model.save(str(path),False))
            return os.model.Model.load(str(path)).get()

    def test_one_and_two_floor_topology_and_loads(self):
        model=self.floor(); first=validate_geometry(self.reopen(model))
        self.assertEqual((first['spaces'],first['zones'],first['matchedPairs']), (5,5,8))
        self.assertAlmostEqual(first['floorArea'],20.8849)
        lower={str(s.handle()):str(s.construction().get().handle()) for s in model.getSurfaces() if s.surfaceType()!='RoofCeiling'}
        add_upper_floor(model); model=self.reopen(model); second=validate_geometry(model)
        self.assertEqual((second['spaces'],second['zones'],second['matchedPairs']), (10,10,21))
        self.assertAlmostEqual(second['floorArea'],first['floorArea']*2)
        self.assertEqual((second['groundFaces'],second['roofFaces']), (5,5))
        self.assertEqual(lower,{str(s.handle()):str(s.construction().get().handle()) for s in model.getSurfaces() if str(s.handle()) in lower})
        for ceiling in model.getSurfaces():
            if ceiling.surfaceType()=='RoofCeiling' and ceiling.adjacentSurface().is_initialized():
                self.assertIn('Typical Interior Ceiling',ceiling.construction().get().nameString())
                self.assertEqual(list(ceiling.construction().get().to_Construction().get().layers()),list(reversed(ceiling.adjacentSurface().get().construction().get().to_Construction().get().layers())))
        self.assertEqual((len(model.getPeoples()),len(model.getLightss()),len(model.getElectricEquipments()),len(model.getZoneHVACIdealLoadsAirSystems())),(10,10,10,10))
        self.assertTrue(all(z.multiplier()==1 for z in model.getThermalZones()))

    def test_dimensions_preserve_every_identity_assignment_and_override(self):
        model=self.floor(); add_upper_floor(model)
        surface=next(s for s in model.getSurfaces() if s.surfaceType()=='Wall' and s.outsideBoundaryCondition()=='Outdoors')
        material=next(b for b in bindings(model).values() if b.data['objectHandle']==str(surface.handle()) and b.data['label']=='Thickness')
        apply_edits(model,[dict(id=material.data['id'],value=.03)])
        identities=lambda m: {str(o.handle()) for o in m.modelObjects()}
        assignments=lambda m: {str(s.handle()):(str(s.construction().get().handle()),str(s.space().get().handle())) for s in [*m.getSurfaces(),*m.getSubSurfaces()]}
        original_ids,original_assignments=identities(model),assignments(model)
        story=sorted(model.getBuildingStorys(),key=lambda s:floor_dimensions(s)['elevation'])[0]
        for key,value in [('width',12),('depth',10),('coreWidth',6),('coreDepth',4),('height',3.5),('elevation',.4)]:
            change=apply_edits(model,[dict(id=f'{story.handle()}:{key}',value=value)])
            model=self.reopen(model); verify_edits(model,change['expected']); validate_geometry(model)
            self.assertEqual(identities(model),original_ids)
            self.assertEqual(assignments(model),original_assignments)
        self.assertAlmostEqual(validate_geometry(model)['floorArea'],240)

    def test_zone_assignment_and_local_inputs(self):
        model=self.floor(); spaces=list(model.getSpaces()); moved,target=spaces[:2]
        people=len(model.getPeoples()); lights=len(model.getLightss())
        result=apply_edits(model,[dict(id=f'{moved.handle()}:thermalZone',value=str(target.thermalZone().get().handle()))])
        model=self.reopen(model); verify_edits(model,result['expected']); validate_geometry(model)
        self.assertEqual(len(model.getThermalZones()),4)
        self.assertEqual((len(model.getPeoples()),len(model.getLightss())),(people,lights))
        split=apply_edits(model,[dict(id=f'{moved.handle()}:thermalZone',value='__new__')])
        model=self.reopen(model); verify_edits(model,split['expected']); validate_geometry(model)
        self.assertEqual(len(model.getThermalZones()),5)
        self.assertEqual((len(model.getPeoples()),len(model.getLightss())),(people,lights))
        controls=[b for b in bindings(model).values() if b.data['label']=='Lighting density']
        chosen=next(b for b in controls if str(moved.handle()) in b.data['scopes'])
        before={b.data['id']:b.data['value'] for b in controls}
        result=apply_edits(model,[dict(id=chosen.data['id'],value=7)])
        model=self.reopen(model); verify_edits(model,result['expected'])
        for b in bindings(model).values():
            if b.data['id'] in before and b.data['id']!=chosen.data['id']:
                self.assertEqual(b.data['value'],before[b.data['id']])

    def test_invalid_core_and_broken_boundary_refused(self):
        model=self.floor(); story=model.getBuildingStorys()[0]
        with self.assertRaises(ValueError):
            apply_edits(model,[dict(id=f'{story.handle()}:coreWidth',value=100)])
        face=next(s for s in model.getSurfaces() if s.adjacentSurface().is_initialized())
        face.resetAdjacentSurface()
        with self.assertRaises(ValueError):
            validate_geometry(model)
        overlapping=self.floor(); overlapping.getSpaces()[0].clone(overlapping)
        with self.assertRaisesRegex(ValueError,'Spaces overlap'):
            validate_geometry(overlapping)

    def test_internal_wall_edit_preserves_the_paired_layer_order(self):
        model=self.floor()
        face=next(s for s in model.getSurfaces() if s.adjacentSurface().is_initialized())
        paired=face.adjacentSurface().get()
        unaffected={str(s.handle()):str(s.construction().get().handle()) for s in model.getSurfaces() if s.handle() not in (face.handle(),paired.handle())}
        control=next(c for c in bindings(model).values() if c.data['objectHandle']==str(face.handle()) and c.data['label']=='Thickness')
        apply_edits(model,[dict(id=control.data['id'],value=.02)])
        model=self.reopen(model); validate_geometry(model)
        first=model.getSurface(face.handle()).get().construction().get().to_Construction().get()
        second=model.getSurface(paired.handle()).get().construction().get().to_Construction().get()
        self.assertEqual([m.handle() for m in first.layers()],list(reversed([m.handle() for m in second.layers()])))
        self.assertEqual(unaffected,{str(s.handle()):str(s.construction().get().handle()) for s in model.getSurfaces() if str(s.handle()) in unaffected})

    def test_upper_floor_rebinds_hosted_shades_to_its_own_windows(self):
        model=self.floor()
        shade=next(c for c in bindings(model).values() if c.data['label']=='Overhang projection / window height')
        apply_edits(model,[dict(id=shade.data['id'],value=.4)])
        add_upper_floor(model); model=self.reopen(model)
        self.assertEqual(len(model.getShadingSurfaces()),2)
        for shade in model.getShadingSurfaces():
            host=shade.additionalProperties().getFeatureAsString('host_subsurface').get()
            window=model.getSubSurface(os.toUUID(host)).get()
            self.assertEqual(shade.shadingSurfaceGroup().get().space().get().handle(),window.space().get().handle())
        upper=max(model.getBuildingStorys(),key=lambda s:floor_dimensions(s)['elevation'])
        apply_edits(model,[dict(id=f'{upper.handle()}:height',value=3.2)])
        validate_geometry(self.reopen(model))

    def test_core_edit_does_not_stretch_exterior_windows_or_hosted_shades(self):
        model=self.floor(); story=model.getBuildingStorys()[0]
        shade=next(c for c in bindings(model).values() if c.data['label']=='Overhang projection / window height')
        apply_edits(model,[dict(id=shade.data['id'],value=.4)])
        vertices=lambda m: {str(face.handle()):[(v.x(),v.y(),v.z()) for v in face.vertices()] for face in [*m.getSubSurfaces(),*m.getShadingSurfaces()]}
        original=vertices(model)
        apply_edits(model,[dict(id=f'{story.handle()}:coreWidth',value=3),dict(id=f'{story.handle()}:coreDepth',value=3)])
        model=self.reopen(model); validate_geometry(model)
        after=vertices(model)
        self.assertEqual(set(after),set(original))
        for handle,coordinates in original.items():
            for actual,expected in zip(after[handle],coordinates):
                for a,b in zip(actual,expected):
                    self.assertAlmostEqual(a,b,places=8)


if __name__=='__main__':
    unittest.main()
