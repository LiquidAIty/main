"""Bounded floor operations on real OSM objects; geometry is the only dimension store."""
# Entity: Building Geometry
# Relationship: Creates core/perimeter floor cases and edits their existing vertices while preserving model assignments and matched boundaries.

from __future__ import annotations

import math
import openstudio as os

TOL = 1e-6


def checked(result):
    if result is False:
        raise ValueError("OpenStudio rejected the geometry operation")


def optional(value):
    return value.get() if value.is_initialized() else None


def points(face):
    transform = face.space().get().transformation()
    return [(p.x(), p.y(), p.z()) for p in transform * face.vertices()]


def extent(spaces):
    vertices = [p for space in spaces for surface in space.surfaces() for p in points(surface)]
    if not vertices:
        raise ValueError("The selected floor has no geometry")
    return [[min(p[i] for p in vertices), max(p[i] for p in vertices)] for i in range(3)]


def floor_dimensions(story):
    spaces = story.spaces()
    bounds = extent(spaces)
    core = next((space for space in spaces if optional(space.additionalProperties().getFeatureAsString("floor_region")) == "Core"), None)
    if core is None:
        raise ValueError("This floor was not authored by the core/perimeter operation")
    inner = extent([core])
    return dict(width=bounds[0][1] - bounds[0][0], depth=bounds[1][1] - bounds[1][0],
                coreWidth=inner[0][1] - inner[0][0], coreDepth=inner[1][1] - inner[1][0],
                elevation=bounds[2][0], height=bounds[2][1] - bounds[2][0])


def clone_conditioning(source, model, name):
    equipment = list(source.equipment())
    if source.multiplier() != 1 or len(equipment) != 1 or not equipment[0].to_ZoneHVACIdealLoadsAirSystem().is_initialized():
        raise ValueError("Floor creation requires one unmultiplied Ideal Loads system per source zone")
    zone = source.clone(model).to_ThermalZone().get()
    zone.setName(name)
    checked(zone.setMultiplier(1))
    zone.autocalculateVolume()
    zone.autocalculateCeilingHeight()
    if zone.equipment():
        raise ValueError("Unexpected equipment on cloned zone")
    system = equipment[0].clone(model).to_ZoneHVACIdealLoadsAirSystem().get()
    system.setName(name + " Ideal Loads")
    checked(system.addToThermalZone(zone))
    if not zone.thermostatSetpointDualSetpoint().is_initialized():
        raise ValueError("The source zone has no thermostat")
    return zone


def set_boundary(face, boundary):
    checked(face.setOutsideBoundaryCondition(boundary))
    checked(face.setSunExposure("SunExposed" if boundary == "Outdoors" else "NoSun"))
    checked(face.setWindExposure("WindExposed" if boundary == "Outdoors" else "NoWind"))


def reverse_construction(face, adjacent):
    construction = optional(face.construction())
    if construction is None or not construction.to_Construction().is_initialized():
        raise ValueError("Matched boundary requires an explicit layered construction")
    layered = construction.to_Construction().get()
    layers = list(layered.layers())
    other = optional(adjacent.construction())
    if other and other.to_Construction().is_initialized() and [x.handle() for x in other.to_Construction().get().layers()] == [x.handle() for x in reversed(layers)]:
        return
    reversed_layers = os.model.MaterialVector(list(reversed(layers)))
    reverse = os.model.Construction(face.model())
    reverse.setName(layered.nameString() + " · opposite side")
    checked(reverse.setLayers(reversed_layers))
    checked(adjacent.setConstruction(reverse))


def match_boundaries(model):
    os.model.matchSurfaces(os.model.SpaceVector(model.getSpaces()))
    done = set()
    for face in model.getSurfaces():
        adjacent = optional(face.adjacentSurface())
        if adjacent:
            checked(face.setSunExposure("NoSun")); checked(face.setWindExposure("NoWind"))
            if str(face.handle()) not in done:
                if face.surfaceType() == "Floor" and adjacent.surfaceType() == "RoofCeiling":
                    face, adjacent = adjacent, face
                reverse_construction(face, adjacent)
                done.update((str(face.handle()), str(adjacent.handle())))


def create_core_floor(model):
    """Explicitly replace only a NEW copy's shoebox geometry; its original case is untouched."""
    if len(model.getSpaces()) != 1 or len(model.getThermalZones()) != 1:
        raise ValueError("Create a core/perimeter floor from one existing shoebox Space")
    original = model.getSpaces()[0]
    source_zone = original.thermalZone().get()
    if original.shadingSurfaceGroups():
        raise ValueError("Floor generation does not yet reconcile existing hosted shading")
    bounds = extent([original])
    vertices={p for face in original.surfaces() for p in points(face)}
    if len(original.surfaces())!=6 or len(vertices)!=8 or any(len({round(p[a],6) for p in vertices})!=2 for a in range(3)):
        raise ValueError("The source must be an axis-aligned rectangular shoebox; arbitrary footprints are not replaced")
    x0, x3 = bounds[0]; y0, y3 = bounds[1]; z0, z1 = bounds[2]
    x1, x2 = x0 + (x3-x0)/4, x3 - (x3-x0)/4
    y1, y2 = y0 + (y3-y0)/4, y3 - (y3-y0)/4
    surfaces = list(original.surfaces())
    exterior = next((s for s in surfaces if s.surfaceType() == "Wall" and s.outsideBoundaryCondition() == "Outdoors"), None)
    partition = next((s for s in surfaces if s.surfaceType() == "Wall" and s.outsideBoundaryCondition() == "Adiabatic"), None)
    floor = next(s for s in surfaces if s.surfaceType() == "Floor")
    roof = next(s for s in surfaces if s.surfaceType() == "RoofCeiling")
    if exterior is None or partition is None:
        raise ValueError("Source shoebox must establish exterior and partition constructions")
    assemblies = {"Wall": exterior.construction().get(), "Partition": partition.construction().get(),
                  "Floor": floor.construction().get(), "RoofCeiling": roof.construction().get()}
    # The shoebox's adiabatic ceiling/floor are not exterior assemblies. Only
    # the new floor case receives the explicitly configured library resources.
    from construction_library import import_assembly
    if roof.outsideBoundaryCondition() != 'Outdoors':
        assemblies['RoofCeiling'] = import_assembly(model, 'RoofCeiling', 'Outdoors')
    if floor.outsideBoundaryCondition() != 'Ground':
        assemblies['Floor'] = import_assembly(model, 'Floor', 'Ground')
    windows = list(exterior.subSurfaces())
    if len(windows) > 1 or any(s.subSurfaces() for s in surfaces if s.handle() != exterior.handle()):
        raise ValueError("This floor recipe supports the shoebox's one facade window")
    if windows and (windows[0].multiplier()!=1 or windows[0].shadingControl().is_initialized() or windows[0].windowPropertyFrameAndDivider().is_initialized()):
        raise ValueError("Floor creation cannot reconcile this window's multiplier, frame or shading control")
    story = os.model.BuildingStory(model); story.setName("Floor 1")
    checked(story.setNominalZCoordinate(z0)); checked(story.setNominalFloortoFloorHeight(z1-z0))
    polygons = {
        "Core": [(x1,y1),(x2,y1),(x2,y2),(x1,y2)],
        "South": [(x0,y0),(x3,y0),(x2,y1),(x1,y1)],
        "East": [(x3,y0),(x3,y3),(x2,y2),(x2,y1)],
        "North": [(x3,y3),(x0,y3),(x1,y2),(x2,y2)],
        "West": [(x0,y3),(x0,y0),(x1,y1),(x1,y2)],
    }
    for region, polygon in polygons.items():
        space = original.clone(model).to_Space().get()
        space.setName("Floor 1 · " + region)
        for surface in list(space.surfaces()):
            surface.remove()
        space.setTransformation(os.Transformation())
        checked(space.setBuildingStory(story))
        space.additionalProperties().setFeature("floor_region", region)
        space.autocalculateFloorArea(); space.autocalculateVolume(); space.autocalculateCeilingHeight()
        checked(space.setThermalZone(clone_conditioning(source_zone, model, space.nameString() + " zone")))
        generated = os.model.Space.fromFloorPrint(os.Point3dVector([os.Point3d(x,y,z0) for x,y in reversed(polygon)]), z1-z0, model)
        if not generated.is_initialized():
            raise ValueError("OpenStudio rejected the floor polygon")
        temporary = generated.get()
        for face in list(temporary.surfaces()):
            world = temporary.transformation() * face.vertices()
            checked(face.setSpace(space)); checked(face.setVertices(world))
            kind = face.surfaceType()
            face.setName(space.nameString() + " · " + kind + " " + str(len(space.surfaces())))
            coords = points(face)
            external = kind == "Wall" and any(all(abs(p[axis]-edge) < TOL for p in coords) for axis in (0,1) for edge in bounds[axis])
            checked(face.setConstruction(assemblies["Partition" if kind == "Wall" and not external else kind]))
            set_boundary(face, "Ground" if kind == "Floor" else "Outdoors")
            # Retain the source facade direction and glazing fraction, not invented windows on every orientation.
            if external and windows and abs(face.outwardNormal().dot(exterior.outwardNormal())-1) < TOL:
                ratio = windows[0].grossArea()/exterior.grossArea()
                window = face.setWindowToWallRatio(ratio)
                if not window.is_initialized():
                    raise ValueError("Could not preserve source facade glazing fraction")
                window = window.get(); checked(window.setConstruction(windows[0].construction().get()))
                window.setName(space.nameString() + " window")
        temporary.remove()
        # Give each copied load an identifiable result key; definitions and schedules remain shared until a local edit.
        for load in [*space.people(), *space.lights(), *space.electricEquipment(), *space.hotWaterEquipment()]:
            load.setName(space.nameString() + " · " + load.iddObjectType().valueName().removeprefix("OS_"))
    original.remove()
    for system in list(source_zone.equipment()):
        system.remove()
    source_zone.remove()
    match_boundaries(model)
    return validate_geometry(model)


def add_upper_floor(model):
    stories = model.getBuildingStorys()
    if len(stories) != 1:
        raise ValueError("This operation adds an aligned second floor to one existing floor")
    lower = stories[0]; dims = floor_dimensions(lower)
    upper = os.model.BuildingStory(model); upper.setName("Floor 2")
    checked(upper.setNominalZCoordinate(dims["elevation"]+dims["height"]))
    checked(upper.setNominalFloortoFloorHeight(dims["height"]))
    zone_map = {}
    for original in list(lower.spaces()):
        source_zone = original.thermalZone().get()
        key = str(source_zone.handle())
        if key not in zone_map:
            zone_map[key] = clone_conditioning(source_zone, model, "Floor 2 · " + source_zone.nameString())
        space = original.clone(model).to_Space().get()
        space.additionalProperties().setFeature('source_geometry_handle',str(original.handle()))
        fingerprint=lambda face: tuple((round(p.x(),8),round(p.y(),8),round(p.z(),8)) for p in face.vertices())
        source_faces={fingerprint(face):face for surface in original.surfaces() for face in [surface,*surface.subSurfaces()]}
        cloned_handles={}
        for face in [item for surface in space.surfaces() for item in [surface,*surface.subSurfaces()]]:
            source_face=source_faces.get(fingerprint(face))
            if source_face is None:
                raise ValueError('Could not identify the source face of the cloned floor')
            cloned_handles[str(source_face.handle())]=str(face.handle())
            face.additionalProperties().setFeature('source_geometry_handle',str(source_face.handle()))
        for group in space.shadingSurfaceGroups():
            for shade in group.shadingSurfaces():
                host=optional(shade.additionalProperties().getFeatureAsString('host_subsurface'))
                if host:
                    if host not in cloned_handles:
                        raise ValueError('The cloned shade has no corresponding hosted opening')
                    shade.additionalProperties().setFeature('host_subsurface',cloned_handles[host])
        space.setName("Floor 2 · " + optional(original.additionalProperties().getFeatureAsString("floor_region")))
        checked(space.setBuildingStory(upper)); checked(space.setThermalZone(zone_map[key]))
        checked(space.setZOrigin(space.zOrigin()+dims["height"]))
        for face in space.surfaces():
            face.resetAdjacentSurface()
            set_boundary(face, "Outdoors")
            face.setName(space.nameString()+" · "+face.surfaceType()+" "+str(face.handle())[:8])
        for load in [*space.people(), *space.lights(), *space.electricEquipment(), *space.hotWaterEquipment()]:
            load.setName(space.nameString()+" · "+load.iddObjectType().valueName().removeprefix("OS_"))
    # Preserve the roof on the upper copy, but reconcile the lower roof's new
    # interstory role before matching and reversing its paired upper-floor layers.
    from construction_library import import_assembly
    ceiling = import_assembly(model, 'RoofCeiling', 'Surface')
    for space in lower.spaces():
        for face in space.surfaces():
            if face.surfaceType() == 'RoofCeiling' and face.outsideBoundaryCondition() == 'Outdoors':
                checked(face.setConstruction(ceiling))
    match_boundaries(model)
    return validate_geometry(model)


def remap(value, old, new):
    for i in range(len(old)-1):
        if value <= old[i+1]+TOL or i == len(old)-2:
            return new[i]+(value-old[i])*(new[i+1]-new[i])/(old[i+1]-old[i])
    raise ValueError("Invalid coordinate mapping")


def resize_floor(model, story, key, value):
    """Keep object identities. Aligned stories share XY; Z edits maintain contiguous floors."""
    dims = floor_dimensions(story)
    old = dict(dims); dims[key] = value
    if not 0 < dims["coreWidth"] < dims["width"] or not 0 < dims["coreDepth"] < dims["depth"]:
        raise ValueError("Core dimensions must be positive and smaller than the footprint")
    stories = sorted(model.getBuildingStorys(), key=lambda s: floor_dimensions(s)["elevation"])
    if key in ("width", "depth", "coreWidth", "coreDepth"):
        axis = 0 if key in ("width", "coreWidth") else 1
        outer_key, inner_key = ("width","coreWidth") if axis == 0 else ("depth","coreDepth")
        bounds = extent(story.spaces())[axis]; center = sum(bounds)/2
        before = [bounds[0], center-old[inner_key]/2, center+old[inner_key]/2, bounds[1]]
        after = [center-dims[outer_key]/2, center-dims[inner_key]/2, center+dims[inner_key]/2, center+dims[outer_key]/2]
    else:
        axis = 2
        levels = [floor_dimensions(s)["elevation"] for s in stories]
        levels.append(floor_dimensions(stories[-1])["elevation"]+floor_dimensions(stories[-1])["height"])
        before = levels; after = list(levels); index = next(i for i,s in enumerate(stories) if s.handle() == story.handle())
        if key == "height":
            for i in range(index+1,len(after)):
                after[i] += value-old["height"]
        elif key == "elevation":
            # The first elevation moves the building; an upper elevation moves its shared boundary and the roof together.
            for i in range(index,len(after)):
                after[i] += value-old["elevation"]
        else:
            raise ValueError("Unsupported floor dimension")
        if any(b-a < .5 for a,b in zip(after,after[1:])):
            raise ValueError("Every floor must retain at least 0.5 m height")
    for space in model.getSpaces():
        transform = space.transformation(); inverse = transform.inverse()
        face_maps={}
        for surface in space.surfaces():
            coordinates=list(transform * surface.vertices())
            values=[(p.x(),p.y(),p.z())[axis] for p in coordinates]
            low,high=min(values),max(values)
            face_maps[str(surface.handle())]=(low,high,remap(low,before,after),remap(high,before,after))

        def hosted(value, surface_handle):
            low,high,new_low,new_high=face_maps[surface_handle]
            if low==new_low and high==new_high:
                return value
            return value+new_low-low if high-low < TOL else new_low+(value-low)*(new_high-new_low)/(high-low)

        faces=[item for surface in space.surfaces() for item in [surface,*surface.subSurfaces()]]
        original_vertices={str(face.handle()):list(transform * face.vertices()) for face in faces}
        for face in faces:
            vertices = []
            for vertex in original_vertices[str(face.handle())]:
                p = [vertex.x(),vertex.y(),vertex.z()]
                # Openings follow their host's affine change. An internal core
                # edit leaves an unchanged exterior host/window exactly intact.
                p[axis] = hosted(p[axis],str(face.surface().get().handle())) if isinstance(face,os.model.SubSurface) else remap(p[axis],before,after)
                vertices.append(inverse * os.Point3d(*p))
            checked(face.setVertices(os.Point3dVector(vertices)))
        for group in space.shadingSurfaceGroups():
            transform_shade=group.buildingTransformation(); inverse_shade=transform_shade.inverse()
            for shade in group.shadingSurfaces():
                host=optional(shade.additionalProperties().getFeatureAsString('host_subsurface'))
                surface_handle=str(model.getSubSurface(os.toUUID(host)).get().surface().get().handle()) if host else None
                vertices=[]
                for vertex in transform_shade * shade.vertices():
                    p=[vertex.x(),vertex.y(),vertex.z()]
                    p[axis]=hosted(p[axis],surface_handle) if surface_handle else remap(p[axis],before,after)
                    vertices.append(inverse_shade * os.Point3d(*p))
                checked(shade.setVertices(os.Point3dVector(vertices)))
    for item in stories:
        current=floor_dimensions(item)
        checked(item.setNominalZCoordinate(current["elevation"])); checked(item.setNominalFloortoFloorHeight(current["height"]))
    validate_geometry(model)


def assign_zone(space, target):
    old = space.thermalZone().get()
    if old.handle() == target.handle():
        return
    # Assignment deliberately adopts the target zone's thermostat/system. Remove
    # only the now-empty source zone and its conditioning, never another Space.
    checked(space.setThermalZone(target))
    if not old.spaces():
        for equipment in list(old.equipment()):
            equipment.remove()
        old.remove()


def separate_zone(space):
    source=space.thermalZone().get()
    if len(source.spaces()) < 2:
        raise ValueError('This Space already has a separate Thermal Zone')
    checked(space.setThermalZone(clone_conditioning(source,space.model(),space.nameString()+' zone')))


def validate_geometry(model):
    spaces=list(model.getSpaces()); bounds=extent(spaces)
    pairs=set(); external=ground=roof=0
    # Recipe floors are convex prisms. Reject actual overlapping XY area when
    # their vertical intervals intersect, not merely duplicated object names.
    footprints=[]
    for space in spaces:
        floors=[face for face in space.surfaces() if face.surfaceType()=="Floor"]
        if len(floors)!=1:
            raise ValueError("Floor editing currently requires one convex floor face per Space")
        footprints.append((space, list(reversed([(p[0],p[1]) for p in points(floors[0])])), extent([space])[2]))
    for i,(space,polygon,z) in enumerate(footprints):
        for other,clip,oz in footprints[i+1:]:
            if min(z[1],oz[1])-max(z[0],oz[0]) <= TOL:
                continue
            intersection=polygon
            for a,b in zip(clip,clip[1:]+clip[:1]):
                cross=lambda p: (b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0])
                output=[]
                for p,q in zip(intersection,intersection[1:]+intersection[:1]):
                    cp,cq=cross(p),cross(q)
                    if cp >= -TOL:
                        output.append(p)
                    if (cp > TOL and cq < -TOL) or (cp < -TOL and cq > TOL):
                        t=cp/(cp-cq); output.append((p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1])))
                intersection=output
                if not intersection:
                    break
            area=abs(sum(p[0]*q[1]-q[0]*p[1] for p,q in zip(intersection,intersection[1:]+intersection[:1])))/2
            if area > TOL:
                raise ValueError("Spaces overlap: "+space.nameString()+" / "+other.nameString())
    for space in spaces:
        if not space.isEnclosedVolume() or space.floorArea() <= 0 or space.volume() <= 0:
            raise ValueError("Space is not an enclosed positive volume: "+space.nameString())
        zone=optional(space.thermalZone())
        if zone is None or zone.multiplier()!=1 or space.multiplier()!=1:
            raise ValueError("Each Space needs an explicit unmultiplied Thermal Zone")
        systems=list(zone.equipment())
        if len(systems)!=1 or not systems[0].to_ZoneHVACIdealLoadsAirSystem().is_initialized() or not zone.thermostatSetpointDualSetpoint().is_initialized():
            raise ValueError("Geometry cases require one Ideal Loads system and thermostat per occupied zone")
        for face in space.surfaces():
            adjacent=optional(face.adjacentSurface()); coords=points(face)
            if adjacent:
                if optional(adjacent.adjacentSurface()) is None or adjacent.adjacentSurface().get().handle()!=face.handle():
                    raise ValueError("Boundary is not reciprocal")
                key=lambda seq: sorted(tuple(round(x,6) for x in p) for p in seq)
                if key(coords)!=key(points(adjacent)) or face.outwardNormal().dot(adjacent.outwardNormal()) > -1+TOL:
                    raise ValueError("Matched boundary geometry differs")
                if face.outsideBoundaryCondition()!="Surface":
                    raise ValueError("Interior boundary is exposed")
                pairs.add(tuple(sorted((str(face.handle()),str(adjacent.handle())))))
            elif face.surfaceType()=="Floor":
                if face.outsideBoundaryCondition()!="Ground" or any(abs(p[2]-bounds[2][0])>TOL for p in coords):
                    raise ValueError("Unmatched floor is not on the ground boundary")
                ground+=1
            elif face.surfaceType()=="RoofCeiling":
                if face.outsideBoundaryCondition()!="Outdoors" or any(abs(p[2]-bounds[2][1])>TOL for p in coords):
                    raise ValueError("Unmatched ceiling is not the top roof")
                roof+=1
            else:
                if face.outsideBoundaryCondition()!="Outdoors" or not any(all(abs(p[a]-edge)<TOL for p in coords) for a in (0,1) for edge in bounds[a]):
                    raise ValueError("Interior wall is unmatched")
                external+=1
    stories=[]
    for story in model.getBuildingStorys():
        dims=floor_dimensions(story); area=sum(s.floorArea() for s in story.spaces())
        if not math.isclose(area,dims["width"]*dims["depth"],rel_tol=1e-7):
            raise ValueError("Space areas do not account for the floor footprint")
        stories.append(dict(handle=str(story.handle()),name=story.nameString(),floorArea=area,**dims))
    return dict(stories=stories,spaces=len(spaces),zones=len(model.getThermalZones()),floorArea=sum(s.floorArea() for s in spaces),overlapArea=0,
                matchedPairs=len(pairs),exteriorWalls=external,groundFaces=ground,roofFaces=roof)
