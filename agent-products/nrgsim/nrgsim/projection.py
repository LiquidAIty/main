"""SDK artifact operations: read-only projection or creation of a new empty OSM."""
# Entity: Building Viewport
# Relationship: This file derives display handles from saved OSMs and can initialize a new empty SDK model without overwriting an existing one.
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sys

# Preserve the existing direct-script entry point used by the model session.
if not __package__:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from nrgsim.constructions import inspect_surface_construction

def project(osm: Path, destination: Path) -> dict:
    import openstudio

    loaded = openstudio.osversion.VersionTranslator().loadModel(openstudio.path(str(osm)))
    if not loaded.is_initialized():
        raise RuntimeError("osm_projection_load_failed")
    model = loaded.get()
    translator = openstudio.gltf.GltfForwardTranslator()
    has_geometry = bool(model.getSurfaces() or model.getSubSurfaces() or model.getShadingSurfaces())
    serialized = translator.modelToGLTFString(model) if has_geometry else ""
    # The SDK returns no glTF for an empty model. Preserve that empty state;
    # never substitute geometry from the preceding model.
    gltf = json.loads(serialized) if serialized else None
    if gltf is None and has_geometry:
        raise RuntimeError("sdk_returned_no_geometry_for_nonempty_model")
    errors = [str(message.logMessage()) for message in translator.errors()]
    if errors:
        raise RuntimeError("gltf_translation_failed:" + ";".join(errors))
    objects = {}

    def pointer(obj, **fields):
        handle = str(obj.handle()).strip("{}")
        objects[handle] = {
            "handle": handle, "name": obj.nameString(),
            "type": obj.iddObjectType().valueName().removeprefix("OS_").replace("_", ""),
            **fields,
        }
        return handle

    def optional_handle(value):
        return str(value.get().handle()).strip("{}") if value.is_initialized() else None

    def optional_value(value):
        return value.get() if value.is_initialized() else None

    def vertices(obj, space):
        transform = space.transformation() if space else openstudio.Transformation()
        return [[float(v.x()), float(v.y()), float(v.z())]
                for v in (transform * point for point in obj.vertices())]

    def construction_defaults(scopes):
        values = {}
        for scope in reversed(scopes):
            current = scope.defaultConstructionSet()
            if not current.is_initialized():
                continue
            for group, getter in (("Exterior", "defaultExteriorSurfaceConstructions"),
                                  ("Interior", "defaultInteriorSurfaceConstructions"),
                                  ("Ground", "defaultGroundContactSurfaceConstructions")):
                surfaces = getattr(current.get(), getter)()
                if not surfaces.is_initialized():
                    continue
                for role, field in (("Wall", "wallConstruction"), ("Floor", "floorConstruction"),
                                    ("RoofCeiling", "roofCeilingConstruction")):
                    construction = getattr(surfaces.get(), field)()
                    if construction.is_initialized():
                        values[f"{group}:{role}"] = str(construction.get().handle()).strip("{}")
        return values

    building = pointer(model.getBuilding(), northAxis=model.getBuilding().northAxis(),
                       constructionDefaults=construction_defaults([model.getBuilding()]))
    for story in model.getBuildingStorys():
        pointer(story, elevation=optional_value(story.nominalZCoordinate()),
                height=optional_value(story.nominalFloortoFloorHeight()))
    for space in model.getSpaces():
        floors = [vertices(face, space) for face in space.surfaces() if face.surfaceType() == "Floor"]
        coordinates = [v for face in space.surfaces() for v in vertices(face, space)]
        z = [v[2] for v in coordinates]
        scopes = [space]
        if space.spaceType().is_initialized():
            scopes.append(space.spaceType().get())
        scopes.append(model.getBuilding())
        pointer(space, buildingStory=optional_handle(space.buildingStory()),
                thermalZone=optional_handle(space.thermalZone()), floorArea=space.floorArea(),
                floors=floors, elevation=min(z) if z else None,
                height=max(z) - min(z) if z else None,
                spaceType=optional_handle(space.spaceType()), constructionDefaults=construction_defaults(scopes))
    for zone in model.getThermalZones():
        thermostat = zone.thermostatSetpointDualSetpoint()
        setpoints = {}
        if thermostat.is_initialized():
            for key, getter in (("heating", "heatingSetpointTemperatureSchedule"),
                                ("cooling", "coolingSetpointTemperatureSchedule")):
                schedule = getattr(thermostat.get(), getter)()
                if schedule.is_initialized():
                    constant = schedule.get().to_ScheduleConstant()
                    setpoints[key] = constant.get().value() if constant.is_initialized() else None
        pointer(zone, multiplier=zone.multiplier(), airLoop=optional_handle(zone.airLoopHVAC()),
                thermostat=optional_handle(thermostat), hasEquipment=bool(zone.equipment()),
                idealAirLoads=zone.useIdealAirLoads(), **setpoints)
    for surface in model.getSurfaces():
        space = surface.space().get() if surface.space().is_initialized() else None
        construction = surface.construction()
        editor = None
        if construction.is_initialized() and construction.get().to_Construction().is_initialized():
            editor = inspect_surface_construction(model, str(surface.handle()))
        pointer(surface, space=optional_handle(surface.space()), surfaceType=surface.surfaceType(),
                construction=optional_handle(surface.construction()),
                isConstructionDefaulted=surface.isConstructionDefaulted(), constructionEditor=editor,
                outsideBoundaryCondition=surface.outsideBoundaryCondition(),
                grossArea=surface.grossArea(), netArea=surface.netArea(),
                vertices=vertices(surface, space), windowToWallRatio=surface.windowToWallRatio(),
                adjacentSurface=optional_handle(surface.adjacentSurface()))
    for surface in model.getSubSurfaces():
        space = surface.space().get() if surface.space().is_initialized() else None
        pointer(surface, surface=optional_handle(surface.surface()),
                construction=optional_handle(surface.construction()), grossArea=surface.grossArea(),
                isConstructionDefaulted=surface.isConstructionDefaulted(),
                surfaceType=surface.subSurfaceType(), vertices=vertices(surface, space))
    for material in model.getMaterials():
        opaque = material.to_StandardOpaqueMaterial()
        fields = {}
        if opaque.is_initialized():
            material = opaque.get()
            fields = {"thickness": material.thickness(), "conductivity": material.conductivity(),
                      "density": material.density(), "specificHeat": material.specificHeat(),
                      "roughness": material.roughness()}
        pointer(material, category="Material", **fields)
    for construction in model.getConstructions():
        pointer(construction, isOpaque=construction.isOpaque(), isFenestration=construction.isFenestration(),
                layers=[str(layer.handle()).strip("{}") for layer in construction.layers()])
    for collection in (model.getSpaceTypes(), model.getAirLoopHVACs(), model.getPlantLoops()):
        for obj in collection:
            pointer(obj)
    for load_type, collection, definition_getter, density_getter in (
        ("Lights", model.getLightss(), "lightsDefinition", "wattsperSpaceFloorArea"),
        ("People", model.getPeoples(), "peopleDefinition", "peopleperSpaceFloorArea"),
        ("ElectricEquipment", model.getElectricEquipments(), "electricEquipmentDefinition", "wattsperSpaceFloorArea"),
    ):
        for load in collection:
            definition = getattr(load, definition_getter)()
            density = optional_value(getattr(definition, density_getter)())
            pointer(definition, density=density)
            schedule = load.numberofPeopleSchedule() if load_type == "People" else load.schedule()
            fields = {}
            if load_type == "People" and load.activityLevelSchedule().is_initialized():
                activity = load.activityLevelSchedule().get().to_ScheduleConstant()
                fields["activityLevel"] = activity.get().value() if activity.is_initialized() else None
            pointer(load, definition=str(definition.handle()).strip("{}"), schedule=optional_handle(schedule),
                    space=optional_handle(load.space()), spaceType=optional_handle(load.spaceType()), **fields)
    for schedule in model.getSchedules():
        pointer(schedule)
    bound = []
    for node in (gltf or {}).get("nodes", []):
        extras = node.get("extras", {})
        handle = str(extras.get("handle", "")).strip("{}")
        if handle and handle in objects:
            # Pascal projection identities are the original SDK handles.
            # No Pascal parametric/editor nodes or engineering properties are authored.
            extras.update(pascalId=handle, kind="block")
            node["extras"] = extras
            bound.append(handle)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if gltf is not None:
        destination.write_text(json.dumps(gltf, separators=(",", ":")), encoding="utf-8")
    return {
        "osmSha256": hashlib.sha256(osm.read_bytes()).hexdigest(),
        "sdkVersion": openstudio.openStudioVersion(),
        "building": building, "objects": objects, "selectableHandles": bound,
        "summary": {"spaces": len(model.getSpaces()), "thermalZones": len(model.getThermalZones()),
                    "floorAreaM2": model.getBuilding().floorArea()},
        "warnings": [str(message.logMessage()) for message in translator.warnings()],
    }


if __name__ == "__main__":
    if sys.argv[1] == "--new-empty":
        import openstudio
        destination = Path(sys.argv[2])
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists():
            raise RuntimeError("new_model_destination_exists")
        if not openstudio.model.Model().save(openstudio.path(str(destination)), False):
            raise RuntimeError("empty_model_save_failed")
    else:
        source, target, manifest = map(Path, sys.argv[1:4])
        Path(manifest).write_text(json.dumps(project(source, target), indent=2), encoding="utf-8")
