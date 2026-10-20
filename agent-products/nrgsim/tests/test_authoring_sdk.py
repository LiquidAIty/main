# Entity: Building Authoring Verification
# Relationship: These tests use real OpenStudio SDK objects created from an empty model, not templates or mocked engineering results.
from pathlib import Path
import sys
import tempfile
import unittest

import openstudio

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from nrgsim.authoring import apply_authoring
from nrgsim.projection import project


class AuthoringSdkTests(unittest.TestCase):
    def setUp(self):
        self.model = openstudio.model.Model()
        self.story = apply_authoring(self.model, {
            "operation": "create_story", "name": "Ground", "elevation": 0, "height": 3,
        })["handle"]

    def draw(self, name="Office", x=0):
        return apply_authoring(self.model, {
            "operation": "draw_space", "name": name, "story": self.story,
            "points": [[x, 0], [x + 10, 0], [x + 10, 8], [x, 8]],
            "height": 3, "createThermalZone": True,
        })

    def test_draws_enclosed_space_and_assigns_real_story_and_zone(self):
        result = self.draw()
        space = self.model.getSpace(openstudio.toUUID(result["handle"])).get()
        self.assertEqual(space.floorArea(), 80)
        self.assertEqual(space.volume(), 240)
        self.assertTrue(space.isEnclosedVolume())
        self.assertEqual(str(space.buildingStory().get().handle()).strip("{}"), self.story)
        self.assertTrue(space.thermalZone().is_initialized())
        self.assertEqual(len(space.surfaces()), 6)

    def test_adjacent_spaces_have_reciprocal_surface_pairs(self):
        self.draw()
        self.draw("West", -10)
        pairs = [s for s in self.model.getSurfaces() if s.outsideBoundaryCondition() == "Surface"]
        self.assertEqual(len(pairs), 2)
        for face in pairs:
            self.assertEqual(face.adjacentSurface().get().adjacentSurface().get().handle(), face.handle())

    def test_height_edit_keeps_existing_surface_handles(self):
        result = self.draw()
        space = self.model.getSpace(openstudio.toUUID(result["handle"])).get()
        before = {str(face.handle()) for face in space.surfaces()}
        apply_authoring(self.model, {"operation": "set_space_height", "handle": result["handle"], "height": 4})
        self.assertEqual(space.volume(), 320)
        self.assertEqual(before, {str(face.handle()) for face in space.surfaces()})

    def test_invalid_story_does_not_create_a_space(self):
        with self.assertRaises(ValueError):
            apply_authoring(self.model, {
                "operation": "draw_space", "name": "Invalid", "story": "00000000-0000-0000-0000-000000000000",
                "points": [[0, 0], [10, 0], [10, 8], [0, 8]], "height": 3,
                "createThermalZone": True,
            })
        self.assertEqual(len(self.model.getSpaces()), 0)

    def test_local_construction_edit_preserves_other_surface_assignment(self):
        result = self.draw()
        space = self.model.getSpace(openstudio.toUUID(result["handle"])).get()
        walls = [face for face in space.surfaces() if face.surfaceType() == "Wall"]
        material = openstudio.model.StandardOpaqueMaterial(self.model)
        board = openstudio.model.StandardOpaqueMaterial(self.model)
        old = openstudio.model.Construction(self.model)
        old.setLayers([material, board])
        walls[0].setConstruction(old)
        walls[1].setConstruction(old)
        apply_authoring(self.model, {
            "operation": "set_construction_layers", "handle": str(walls[0].handle()).strip("{}"),
            "name": "Wall exception", "expectedConstruction": str(old.handle()).strip("{}"),
            "edits": [{"index": 0, "material_handle": str(material.handle()).strip("{}"),
                       "name": "Local insulation", "properties": {"thickness": 0.12}}],
        })
        self.assertEqual(walls[1].construction().get().handle(), old.handle())
        changed = walls[0].construction().get().to_Construction().get()
        self.assertNotEqual(changed.handle(), old.handle())
        self.assertEqual(len(changed.layers()), 2)
        self.assertEqual(changed.layers()[1].handle(), board.handle())
        self.assertAlmostEqual(changed.layers()[0].to_StandardOpaqueMaterial().get().thickness(), 0.12)

    def test_zone_assignment_preserves_old_zone_and_its_hvac(self):
        first, second = self.draw(), self.draw("Other", 30)
        space = self.model.getSpace(openstudio.toUUID(first["handle"])).get()
        other = self.model.getSpace(openstudio.toUUID(second["handle"])).get()
        old_zone = space.thermalZone().get()
        apply_authoring(self.model, {"operation": "set_hvac", "handle": first["handle"],
                                     "system": "03", "heating": 20, "cooling": 24})
        loop = old_zone.airLoopHVAC().get().handle()
        destination = other.thermalZone().get()
        apply_authoring(self.model, {"operation": "assign_thermal_zone", "handle": first["handle"],
                                     "thermalZone": str(destination.handle()).strip("{}")})
        self.assertEqual(space.thermalZone().get().handle(), destination.handle())
        self.assertEqual(len(destination.spaces()), 2)
        self.assertEqual(len(self.model.getThermalZones()), 2)
        self.assertEqual(old_zone.airLoopHVAC().get().handle(), loop)
        self.assertEqual(len(old_zone.spaces()), 0)

    def test_new_zone_assignment_creates_a_real_zone_without_removing_old_one(self):
        space_id = self.draw()["handle"]
        result = apply_authoring(self.model, {"operation": "assign_thermal_zone", "handle": space_id,
                                              "name": "Meeting rooms"})
        self.assertEqual(result["handle"], space_id)
        self.assertEqual(len(self.model.getThermalZones()), 2)
        space = self.model.getSpace(openstudio.toUUID(space_id)).get()
        self.assertEqual(space.thermalZone().get().nameString(), "Meeting rooms")

    def test_people_density_edit_preserves_existing_activity_schedule(self):
        space_id = self.draw()["handle"]
        apply_authoring(self.model, {"operation": "set_space_load", "handle": space_id, "kind": "People",
                                     "density": 0.1, "schedule": "always_on", "activityLevel": 110})
        person = self.model.getPeoples()[0]
        activity = person.activityLevelSchedule().get().handle()
        apply_authoring(self.model, {"operation": "set_space_load", "handle": space_id, "kind": "People",
                                     "load": str(person.handle()).strip("{}"), "density": 0.08, "schedule": "always_on"})
        self.assertEqual(person.activityLevelSchedule().get().handle(), activity)
        self.assertEqual(person.peopleDefinition().peopleperSpaceFloorArea().get(), 0.08)

    def test_local_inherited_lighting_edit_does_not_change_another_space(self):
        first, second = self.draw(), self.draw("Other", 30)
        space = self.model.getSpace(openstudio.toUUID(first["handle"])).get()
        other = self.model.getSpace(openstudio.toUUID(second["handle"])).get()
        space_type = openstudio.model.SpaceType(self.model)
        definition = openstudio.model.LightsDefinition(self.model)
        definition.setWattsperSpaceFloorArea(10)
        load = openstudio.model.Lights(definition)
        load.setSpaceType(space_type)
        space.setSpaceType(space_type)
        other.setSpaceType(space_type)
        apply_authoring(self.model, {
            "operation": "set_space_load", "handle": first["handle"], "kind": "Lights",
            "load": str(load.handle()).strip("{}"), "density": 7, "schedule": "always_on",
        })
        self.assertEqual(definition.wattsperSpaceFloorArea().get(), 10)
        self.assertEqual(other.spaceType().get().handle(), space_type.handle())
        self.assertEqual(space.spaceType().get().lights()[0].lightsDefinition().wattsperSpaceFloorArea().get(), 7)

    def test_hvac_and_projection_read_back_actual_inputs(self):
        result = self.draw()
        apply_authoring(self.model, {
            "operation": "set_space_load", "handle": result["handle"], "kind": "People",
            "density": 0.08, "schedule": "always_on", "activityLevel": 120,
        })
        apply_authoring(self.model, {
            "operation": "set_hvac", "handle": result["handle"], "system": "03", "heating": 20, "cooling": 24,
        })
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.model.save(openstudio.path(str(root / "input.osm")), False)
            projection = project(root / "input.osm", root / "display.gltf")
        objects = projection["objects"]
        space = objects[result["handle"]]
        zone = objects[space["thermalZone"]]
        self.assertEqual(zone["heating"], 20)
        self.assertEqual(zone["cooling"], 24)
        self.assertTrue(zone["airLoop"])
        self.assertEqual(space["height"], 3)
        self.assertEqual(len(space["floors"]), 1)
        self.assertTrue(any(obj.get("density") == 0.08 for obj in objects.values()))


if __name__ == "__main__":
    unittest.main()
