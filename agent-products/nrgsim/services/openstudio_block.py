"""A single-zone block built through an existing OpenStudio MCP session."""
# Entity: Building Geometry
# Relationship: This file uses public OpenStudio MCP operations and projects saved SDK geometry for Three.js without owning another model.

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
from typing import Any

import openstudio
from mcp import ClientSession


async def call(session: ClientSession, tool_name: str, **arguments: Any) -> dict:
    """Preserve upstream names and reject both protocol and operation failures."""
    result = await session.call_tool(tool_name, arguments)
    texts = [item.text for item in result.content if item.type == "text"]
    if result.isError:
        raise RuntimeError(f"{tool_name}: {' '.join(texts)}")
    payload = json.loads(texts[0]) if texts else result.structuredContent
    if not isinstance(payload, dict) or payload.get("ok") is not True:
        raise RuntimeError(f"{tool_name}: {payload!r}")
    return payload


def empty_model(path: Path) -> None:
    """Bootstrap a new current-version OSM, never an example or an overwrite."""
    if path.exists():
        raise FileExistsError(path)
    model = openstudio.model.Model()
    model.getBuilding().setName("Building 1")
    if not model.save(str(path), False):
        raise RuntimeError(f"OpenStudio could not save {path}")


async def create_block(
    session: ClientSession, seed: Path, output: Path,
    *, width: float, depth: float, height: float,
) -> dict:
    """Create geometry in metres. The caller owns the session and output paths."""
    if any(not math.isfinite(value) or value <= 0 for value in (width, depth, height)):
        raise ValueError("Block dimensions must be finite positive metres")
    if output.exists() or output.resolve() == seed.resolve():
        raise FileExistsError(output)
    empty_model(seed)
    await call(session, "load_osm_model", osm_path=str(seed), version_translate=False)
    try:
        await call(
            session, "create_space_from_floor_print", name="Block 1",
            floor_vertices=[[-width / 2, -depth / 2], [width / 2, -depth / 2],
                            [width / 2, depth / 2], [-width / 2, depth / 2]],
            floor_to_ceiling_height=height,
        )
        await call(session, "create_thermal_zone", name="Zone 1", space_names=["Block 1"])
        await call(session, "save_osm_model", osm_path=str(output))
    except Exception:
        # This function starts a new document; a failed build returns its session to that empty seed.
        await call(session, "load_osm_model", osm_path=str(seed), version_translate=False)
        raise
    return read_geometry(output)


def _point(point: Any) -> list[float]:
    return [point.x(), point.y(), point.z()]


def read_geometry(path: Path) -> dict:
    """Derived, read-only payload. OSM XYZ metres remain Z-up in the recovered viewer."""
    source = path.read_bytes()
    loaded = openstudio.model.Model.load(str(path))
    if not loaded.is_initialized():
        raise ValueError(f"Invalid OpenStudio model: {path}")
    model = loaded.get()
    objects: list[dict] = []
    spaces: list[dict] = []
    all_vertices: list[list[float]] = []
    for space in model.getSpaces():
        transform = space.siteTransformation()
        zone = space.thermalZone()
        spaces.append({
            "handle": str(space.handle()), "name": space.nameString(),
            "floorArea": space.floorArea(), "volume": space.volume(),
            "thermalZoneHandle": str(zone.get().handle()) if zone.is_initialized() else None,
            "storyHandle": str(space.buildingStory().get().handle()) if space.buildingStory().is_initialized() else None,
            "thermalZoneName": zone.get().nameString() if zone.is_initialized() else None,
            "conditioning": [e.iddObjectType().valueName().removeprefix("OS_") for e in zone.get().equipment()] if zone.is_initialized() else [],
        })
        for surface in space.surfaces():
            for face in [surface, *surface.subSurfaces()]:
                is_surface = isinstance(face, openstudio.model.Surface)
                # SDK triangulation accepts clockwise XY polygons; keep Space transforms separate.
                plane = openstudio.Transformation.alignFace(face.vertices())
                to_plane = plane.inverse()
                holes = openstudio.Point3dVectorVector()
                if is_surface:
                    for opening in surface.subSurfaces():
                        holes.append(openstudio.reverse(to_plane * opening.vertices()))
                triangles = openstudio.computeTriangulation(
                    openstudio.reverse(to_plane * face.vertices()), holes,
                )
                if not triangles:
                    raise ValueError(f"Cannot triangulate {face.nameString()}")
                vertices = [_point(transform * vertex) for vertex in face.vertices()]
                positions = []
                for triangle in triangles:
                    if openstudio.getOutwardNormal(triangle).get().z() < 0:
                        triangle = openstudio.reverse(triangle)
                    positions.extend(coordinate for vertex in triangle
                                     for coordinate in _point(transform * (plane * vertex)))
                construction = face.construction()
                objects.append({
                    "handle": str(face.handle()), "name": face.nameString(),
                    "objectType": "Surface" if is_surface else "SubSurface",
                    "surfaceType": face.surfaceType() if is_surface else face.subSurfaceType(),
                    "boundary": surface.outsideBoundaryCondition(),
                    "adjacentHandle": str(surface.adjacentSurface().get().handle()) if surface.adjacentSurface().is_initialized() else None,
                    "spaceHandle": str(space.handle()),
                    "parentHandle": str(space.handle()) if is_surface else str(surface.handle()),
                    "constructionHandle": str(construction.get().handle()) if construction.is_initialized() else None,
                    "vertices": vertices, "positions": positions,
                    "grossArea": face.grossArea(),
                    "netArea": face.netArea() if is_surface else face.grossArea(),
                })
                all_vertices.extend(vertices)
        for group in space.shadingSurfaceGroups():
            for shade in group.shadingSurfaces():
                transform = group.siteTransformation()
                plane = openstudio.Transformation.alignFace(shade.vertices())
                triangles = openstudio.computeTriangulation(openstudio.reverse(plane.inverse() * shade.vertices()), openstudio.Point3dVectorVector())
                if not triangles:
                    raise ValueError(f"Cannot triangulate {shade.nameString()}")
                host = shade.additionalProperties().getFeatureAsString("host_subsurface")
                vertices = [_point(transform * vertex) for vertex in shade.vertices()]
                objects.append({"handle": str(shade.handle()), "name": shade.nameString(), "objectType": "ShadingSurface",
                                "surfaceType": "Shading", "spaceHandle": str(space.handle()),
                                "parentHandle": host.get() if host.is_initialized() else str(space.handle()),
                                "vertices": vertices, "positions": [value for triangle in triangles for vertex in triangle for value in _point(transform * (plane * vertex))],
                                "grossArea": shade.grossArea(), "netArea": shade.grossArea()})
                all_vertices.extend(vertices)
    if any(not math.isfinite(value) for point in all_vertices for value in point):
        raise ValueError("OpenStudio returned non-finite geometry")
    if path.read_bytes() != source:
        raise RuntimeError("The OSM changed during geometry readback")
    return {
        "modelId": str(model.getBuilding().handle()),
        "name": model.getBuilding().nameString(),
        "revision": hashlib.sha256(source).hexdigest(),
        "openstudioVersion": openstudio.openStudioVersion(), "units": "m",
        "site": {"latitude": model.getSite().latitude(), "longitude": model.getSite().longitude(),
                 "timeZone": model.getSite().timeZone(), "northAxis": model.getBuilding().northAxis()},
        "spaces": sorted(spaces, key=lambda item: (item["name"], item["handle"])),
        "stories": [{"handle": str(story.handle()), "name": story.nameString()} for story in sorted(model.getBuildingStorys(), key=lambda item: item.nominalZCoordinate().get() if item.nominalZCoordinate().is_initialized() else float('inf'))],
        "floorArea": model.getBuilding().floorArea(),
        "objects": sorted(objects, key=lambda item: item["handle"]),
        "bounds": None if not all_vertices else {
            "min": [min(point[axis] for point in all_vertices) for axis in range(3)],
            "max": [max(point[axis] for point in all_vertices) for axis in range(3)],
        },
    }
