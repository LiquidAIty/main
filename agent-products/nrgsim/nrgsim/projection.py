"""SDK artifact operations: read-only projection or creation of a new empty OSM."""
# Entity: Building Viewport
# Relationship: This file derives display handles from saved OSMs and can initialize a new empty SDK model without overwriting an existing one.
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sys


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

    building = pointer(model.getBuilding(), northAxis=model.getBuilding().northAxis())
    for story in model.getBuildingStorys():
        pointer(story)
    for space in model.getSpaces():
        pointer(space, buildingStory=optional_handle(space.buildingStory()),
                thermalZone=optional_handle(space.thermalZone()), floorArea=space.floorArea())
    for zone in model.getThermalZones():
        pointer(zone, multiplier=zone.multiplier())
    for surface in model.getSurfaces():
        pointer(surface, space=optional_handle(surface.space()), surfaceType=surface.surfaceType(),
                construction=optional_handle(surface.construction()),
                outsideBoundaryCondition=surface.outsideBoundaryCondition(),
                grossArea=surface.grossArea(), netArea=surface.netArea())
    for surface in model.getSubSurfaces():
        pointer(surface, surface=optional_handle(surface.surface()),
                construction=optional_handle(surface.construction()), grossArea=surface.grossArea())
    for material in model.getMaterials():
        pointer(material, category="Material")
    for construction in model.getConstructions():
        pointer(construction, layers=[str(layer.handle()).strip("{}") for layer in construction.layers()])
    for collection in (model.getSpaceTypes(),
                       model.getAirLoopHVACs(), model.getPlantLoops(), model.getLightsDefinitions()):
        for obj in collection:
            pointer(obj)
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
