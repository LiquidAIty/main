"""OpenStudio SDK editing logic, executed by the upstream ModelMeasure runner."""
# Entity: Building Authoring
# Relationship: These operations modify the ModelMeasure's SDK model; the upstream apply_measure tool owns staging and publication into the active session.
import math
from .constructions import edit_surface_construction


def apply_authoring(model, request):
    import openstudio

    def number(value, label, minimum=None, maximum=None):
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ValueError(f"{label} must be a finite number")
        if minimum is not None and value < minimum:
            raise ValueError(f"{label} must be at least {minimum}")
        if maximum is not None and value > maximum:
            raise ValueError(f"{label} must be at most {maximum}")
        return float(value)

    def name(value):
        if not isinstance(value, str) or not value.strip() or len(value) > 160:
            raise ValueError("A name of 1–160 characters is required")
        return value.strip()

    def require(result, message):
        if result is False:
            raise ValueError(message)

    def handle(obj):
        return str(obj.handle()).strip("{}")

    def resolve(identifier, kind):
        obj = model.getModelObject(openstudio.toUUID(str(identifier)))
        if not obj.is_initialized():
            raise ValueError("The selected object is no longer in this model")
        typed = getattr(obj.get(), f"to_{kind}")()
        if not typed.is_initialized():
            raise ValueError(f"The selected object is not a {kind}")
        return typed.get()

    def surface(identifier):
        obj = model.getModelObject(openstudio.toUUID(str(identifier)))
        if not obj.is_initialized():
            raise ValueError("The selected surface is no longer in this model")
        for kind in ("Surface", "SubSurface"):
            typed = getattr(obj.get(), f"to_{kind}")()
            if typed.is_initialized():
                return typed.get()
        raise ValueError("Select a Surface or SubSurface")

    def match():
        spaces = openstudio.model.SpaceVector()
        for space in model.getSpaces():
            spaces.append(space)
        openstudio.model.intersectSurfaces(spaces)
        openstudio.model.matchSurfaces(spaces)

    def assign_default(target, construction, role, boundary_group):
        role_setter = {"Wall": "setWallConstruction", "Floor": "setFloorConstruction",
                       "RoofCeiling": "setRoofCeilingConstruction"}.get(role)
        group_access = {
            "Exterior": ("defaultExteriorSurfaceConstructions", "setDefaultExteriorSurfaceConstructions"),
            "Interior": ("defaultInteriorSurfaceConstructions", "setDefaultInteriorSurfaceConstructions"),
            "Ground": ("defaultGroundContactSurfaceConstructions", "setDefaultGroundContactSurfaceConstructions"),
        }.get(boundary_group)
        if not role_setter or not group_access:
            raise ValueError("Choose a construction role and boundary group")
        current = target.defaultConstructionSet()
        defaults = (current.get().clone(model).to_DefaultConstructionSet().get()
                    if current.is_initialized() else openstudio.model.DefaultConstructionSet(model))
        defaults.setName(f"{target.nameString()} Construction Defaults")
        existing = getattr(defaults, group_access[0])()
        group = (existing.get().clone(model).to_DefaultSurfaceConstructions().get()
                 if existing.is_initialized() else openstudio.model.DefaultSurfaceConstructions(model))
        require(getattr(group, role_setter)(construction), "Construction role assignment was rejected")
        require(getattr(defaults, group_access[1])(group), "Construction defaults were rejected")
        require(target.setDefaultConstructionSet(defaults), "Construction scope assignment failed")

    operation = request.get("operation")
    target = None
    if operation == "create_story":
        story_name = name(request.get("name"))
        elevation = number(request.get("elevation"), "Elevation")
        height = number(request.get("height"), "Height", 0.1)
        if model.getBuildingStoryByName(story_name).is_initialized():
            raise ValueError("A Building Story with that name already exists")
        target = openstudio.model.BuildingStory(model)
        target.setName(story_name)
        require(target.setNominalZCoordinate(elevation), "Elevation was rejected")
        require(target.setNominalFloortoFloorHeight(height), "Height was rejected")
    elif operation == "draw_space":
        space_name = name(request.get("name"))
        height = number(request.get("height"), "Height", 0.1)
        story = resolve(request.get("story"), "BuildingStory")
        points = request.get("points")
        if not isinstance(points, list) or not 3 <= len(points) <= 256:
            raise ValueError("A footprint requires 3–256 vertices")
        xy = []
        for point in points:
            if not isinstance(point, list) or len(point) != 2:
                raise ValueError("Footprint vertices must contain x and y in metres")
            xy.append((number(point[0], "x"), number(point[1], "y")))
        if len(set(xy)) != len(xy):
            raise ValueError("A footprint cannot repeat a vertex")
        if model.getSpaceByName(space_name).is_initialized():
            raise ValueError("A Space with that name already exists")
        zone_id = request.get("thermalZone")
        zone = resolve(zone_id, "ThermalZone") if zone_id else None
        if zone is None and request.get("createThermalZone") is not True:
            raise ValueError("Choose a Thermal Zone or explicitly create one")
        elevation = story.nominalZCoordinate()
        if not elevation.is_initialized():
            raise ValueError("The Building Story needs an elevation")
        polygon = openstudio.Point3dVector()
        for x, y in xy:
            polygon.append(openstudio.Point3d(x, y, elevation.get()))
        normal = openstudio.getOutwardNormal(polygon)
        if not normal.is_initialized():
            raise ValueError("The footprint has no valid area")
        if normal.get().z() > 0:
            polygon = openstudio.reverse(polygon)
        created = openstudio.model.Space.fromFloorPrint(polygon, height, model)
        if not created.is_initialized():
            raise ValueError("OpenStudio rejected the footprint")
        target = created.get()
        target.setName(space_name)
        require(target.setBuildingStory(story), "Building Story assignment failed")
        if zone is None:
            zone = openstudio.model.ThermalZone(model)
            zone.setName(f"{space_name} Thermal Zone")
        require(target.setThermalZone(zone), "Thermal Zone assignment failed")
        counts = {}
        for face in target.surfaces():
            kind = face.surfaceType()
            counts[kind] = counts.get(kind, 0) + 1
            face.setName(f"{space_name} {kind} {counts[kind]}")
        match()
        if not target.isEnclosedVolume():
            raise ValueError("The new Space is not enclosed")
    elif operation == "rename":
        target = model.getModelObject(openstudio.toUUID(str(request.get("handle"))))
        if not target.is_initialized():
            raise ValueError("The selected object is no longer in this model")
        target = target.get()
        require(target.setName(name(request.get("name"))).is_initialized(), "Name was rejected")
    elif operation == "set_field":
        # Explicit public SDK setters: no arbitrary Python, field or method execution.
        setters = {
            ("Building", "northAxis"): ("setNorthAxis", -360, 360),
            ("BuildingStory", "nominalZCoordinate"): ("setNominalZCoordinate", None, None),
            ("BuildingStory", "nominalFloortoFloorHeight"): ("setNominalFloortoFloorHeight", 0.1, None),
            ("ThermalZone", "multiplier"): ("setMultiplier", 1, None),
            ("LightsDefinition", "wattsperSpaceFloorArea"): ("setWattsperSpaceFloorArea", 0, None),
            ("PeopleDefinition", "peopleperSpaceFloorArea"): ("setPeopleperSpaceFloorArea", 0, None),
            ("ElectricEquipmentDefinition", "wattsperSpaceFloorArea"): ("setWattsperSpaceFloorArea", 0, None),
        }
        kind, field = request.get("type"), request.get("field")
        if (kind, field) not in setters:
            raise ValueError("This field has no supported editor")
        setter, minimum, maximum = setters[(kind, field)]
        value = number(request.get("value"), field, minimum, maximum)
        target = model.getBuilding() if kind == "Building" else resolve(request.get("handle"), kind)
        if handle(target) != request.get("handle"):
            raise ValueError("The selected object does not match this field")
        if kind == "ThermalZone":
            if value != int(value):
                raise ValueError("Multiplier must be a whole number")
            value = int(value)
        require(getattr(target, setter)(value), f"{field} was rejected")
    elif operation == "assign_construction":
        target = surface(request.get("handle"))
        face = target.to_Surface()
        if face.is_initialized() and (face.get().adjacentSurface().is_initialized()
                                      or face.get().outsideBoundaryCondition() == "Surface"):
            raise ValueError("Interzone construction assignment requires a coordinated edit of both Surface sides")
        if request.get("construction") is None:
            target.resetConstruction()
        else:
            construction = resolve(request.get("construction"), "ConstructionBase")
            require(target.setConstruction(construction), "Construction assignment was rejected")
    elif operation == "assign_default_construction":
        kind = request.get("type")
        if kind not in {"Building", "Space"}:
            raise ValueError("Construction defaults belong to a Building or Space")
        target = model.getBuilding() if kind == "Building" else resolve(request.get("handle"), kind)
        if handle(target) != request.get("handle"):
            raise ValueError("The selected object does not match this construction scope")
        assign_default(target, resolve(request.get("construction"), "ConstructionBase"),
                       request.get("surfaceRole"), request.get("boundaryGroup"))
    elif operation == "set_construction_layers":
        target = resolve(request.get("handle"), "Surface")
        edit_surface_construction(model, handle(target), request.get("expectedConstruction"),
                                  request.get("edits"), request.get("name"))
    elif operation == "assign_thermal_zone":
        target = resolve(request.get("handle"), "Space")
        zone_id = request.get("thermalZone")
        if zone_id:
            zone = resolve(zone_id, "ThermalZone")
        else:
            zone_name = name(request.get("name"))
            if model.getThermalZoneByName(zone_name).is_initialized():
                raise ValueError("A Thermal Zone with that name already exists")
            zone = openstudio.model.ThermalZone(model)
            zone.setName(zone_name)
        # Reassign only this Space. The old Zone and its HVAC remain intact.
        require(target.setThermalZone(zone), "Thermal Zone assignment failed")
    elif operation == "set_space_load":
        target = resolve(request.get("handle"), "Space")
        load_kinds = {
            "Lights": ("lights", "LightsDefinition", "lightsDefinition", "setLightsDefinition", "setWattsperSpaceFloorArea"),
            "People": ("people", "PeopleDefinition", "peopleDefinition", "setPeopleDefinition", "setPeopleperSpaceFloorArea"),
            "ElectricEquipment": ("electricEquipment", "ElectricEquipmentDefinition",
                                  "electricEquipmentDefinition", "setElectricEquipmentDefinition", "setWattsperSpaceFloorArea"),
        }
        kind = request.get("kind")
        if kind not in load_kinds:
            raise ValueError("Unsupported load type")
        collection, definition_type, getter, assign, setter = load_kinds[kind]
        density = number(request.get("density"), "Load density", 0)
        schedule = (model.alwaysOnDiscreteSchedule() if request.get("schedule") == "always_on"
                    else resolve(request.get("schedule"), "Schedule"))
        activity = number(request["activityLevel"], "Activity level", 0) if "activityLevel" in request else None
        source_id = request.get("load")
        if kind == "People" and not source_id and activity is None:
            raise ValueError("A new People load requires an explicit activity level")
        if source_id:
            source = resolve(source_id, kind)
            direct = source.space()
            inherited = source.spaceType()
            source_definition = getattr(source, getter)()
            if direct.is_initialized() and direct.get().handle() == target.handle():
                loads = [source]
            elif (inherited.is_initialized() and target.spaceType().is_initialized()
                  and inherited.get().handle() == target.spaceType().get().handle()):
                private_type = target.spaceType().get().clone(model).to_SpaceType().get()
                private_type.setName(f"{target.nameString()} Space Type")
                require(target.setSpaceType(private_type), "Local Space Type assignment failed")
                # SDK SpaceType.clone copies instances while retaining definition references.
                loads = [item for item in getattr(private_type, collection)()
                         if getattr(item, getter)().handle() == source_definition.handle()]
                if not loads:
                    raise ValueError("The selected inherited load was not preserved by the SDK clone")
            else:
                raise ValueError("The selected load does not apply to this Space")
            definition = getattr(source_definition.clone(model), f"to_{definition_type}")().get()
            definition.setName(f"{target.nameString()} {kind} Definition")
            for load in loads:
                require(getattr(load, assign)(definition), "Local load definition assignment failed")
        else:
            definition = getattr(openstudio.model, definition_type)(model)
            definition.setName(f"{target.nameString()} {kind} Definition")
            load = getattr(openstudio.model, kind)(definition)
            load.setName(f"{target.nameString()} {kind}")
            require(load.setSpace(target), "Load assignment failed")
            loads = [load]
        require(getattr(definition, setter)(density), "Load density was rejected")
        for load in loads:
            method = "setNumberofPeopleSchedule" if kind == "People" else "setSchedule"
            require(getattr(load, method)(schedule), "Load schedule was rejected")
            if kind == "People" and activity is not None:
                activity_schedule = openstudio.model.ScheduleConstant(model)
                activity_schedule.setName(f"{target.nameString()} Activity")
                require(activity_schedule.setValue(activity), "Activity level was rejected")
                require(load.setActivityLevelSchedule(activity_schedule), "Activity schedule assignment failed")
    elif operation == "set_hvac":
        target = resolve(request.get("handle"), "Space")
        if not target.thermalZone().is_initialized():
            raise ValueError("Assign a Thermal Zone before adding HVAC")
        zone = target.thermalZone().get()
        heating = number(request.get("heating"), "Heating setpoint", 5, 40)
        cooling = number(request.get("cooling"), "Cooling setpoint", 10, 45)
        if heating >= cooling:
            raise ValueError("The heating setpoint must be below the cooling setpoint")
        system = request.get("system")
        if system not in {"03", "existing"}:
            raise ValueError("Unsupported HVAC system")
        if system == "03" and (zone.airLoopHVAC().is_initialized() or zone.equipment()):
            raise ValueError("This Thermal Zone already has HVAC; its system was not replaced")
        thermostat = openstudio.model.ThermostatSetpointDualSetpoint(model)
        thermostat.setName(f"{zone.nameString()} Thermostat")
        for label, value, setter in (
            ("Heating", heating, "setHeatingSetpointTemperatureSchedule"),
            ("Cooling", cooling, "setCoolingSetpointTemperatureSchedule"),
        ):
            schedule = openstudio.model.ScheduleConstant(model)
            schedule.setName(f"{zone.nameString()} {label}")
            require(schedule.setValue(value), "Setpoint was rejected")
            require(getattr(thermostat, setter)(schedule), "Setpoint schedule was rejected")
        require(zone.setThermostatSetpointDualSetpoint(thermostat), "Thermostat assignment failed")
        if system == "03":
            air_loop = openstudio.model.addSystemType3(model).to_AirLoopHVAC().get()
            require(air_loop.addBranchForZone(zone), "Air Loop branch assignment failed")
            for manager in air_loop.supplyOutletNode().setpointManagers():
                single_zone = manager.to_SetpointManagerSingleZoneReheat()
                if single_zone.is_initialized():
                    require(single_zone.get().setControlZone(zone), "HVAC control zone assignment failed")
                    single_zone.get().setMinimumSupplyAirTemperature(14)
                    single_zone.get().setMaximumSupplyAirTemperature(40)
        require(zone.setUseIdealAirLoads(False), "Ideal loads setting was rejected")
    elif operation == "set_window_ratio":
        target = resolve(request.get("handle"), "Surface")
        ratio = number(request.get("ratio"), "Window-to-wall ratio", 0.01, 0.95)
        sill = number(request.get("sillHeight"), "Sill height", 0)
        if target.surfaceType() != "Wall" or target.outsideBoundaryCondition() != "Outdoors":
            raise ValueError("Window-to-wall ratio requires an exterior wall")
        if target.subSurfaces() and request.get("replaceOpenings") is not True:
            raise ValueError("Existing openings require explicit replacement")
        result = target.setWindowToWallRatio(ratio, sill, True)
        if not result.is_initialized():
            raise ValueError("The requested window does not fit this wall")
    elif operation == "set_space_height":
        target = resolve(request.get("handle"), "Space")
        height = number(request.get("height"), "Height", 0.1)
        faces = list(target.surfaces())
        points = [vertex for face in faces for vertex in face.vertices()]
        if not points:
            raise ValueError("The Space has no geometry")
        bottom, top = min(v.z() for v in points), max(v.z() for v in points)
        if top - bottom < 0.01:
            raise ValueError("The Space has no valid height")
        if any(face.adjacentSurface().is_initialized() for face in faces):
            raise ValueError("Resize shared geometry together; this edit would separate adjacent Spaces")
        for face in faces:
            for obj in [face, *face.subSurfaces()]:
                vertices = openstudio.Point3dVector()
                for v in obj.vertices():
                    vertices.append(openstudio.Point3d(v.x(), v.y(), bottom + (v.z() - bottom) * height / (top - bottom)))
                require(obj.setVertices(vertices), "OpenStudio rejected the resized geometry")
        if not target.isEnclosedVolume():
            raise ValueError("The edited Space is not enclosed")
    else:
        raise ValueError("Unknown building operation")
    return {
        "operation": operation, "handle": handle(target),
        "spaces": len(model.getSpaces()), "stories": len(model.getBuildingStorys()),
        "zones": len(model.getThermalZones()),
    }
