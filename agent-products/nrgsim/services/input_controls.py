"""Contextual inspector bindings to existing OpenStudio objects, not another model."""
# Entity: Building Modeling
# Relationship: Reads and validates supported SDK fields; local construction exceptions copy and reassign real resources.

from __future__ import annotations

import calendar
import math
from dataclasses import dataclass
from typing import Callable

import openstudio as os


def value_of(value):
    if hasattr(value, "is_initialized"):
        return value.get() if value.is_initialized() else None
    return value


def checked(result):
    if result is False:
        raise ValueError("OpenStudio rejected this value")


def has_fanger(people):
    definition = people.peopleDefinition()
    return any(value_of(definition.getThermalComfortModelType(index)) == "Fanger" for index in range(definition.numThermalComfortModelTypes()))


def enable_fanger(model):
    """Restore the archived Office assumptions with the owner's approved zone-average MRT."""
    if len(model.getPeoples()) != 1:
        raise ValueError("Comfort preparation requires the existing single Office People instance")
    people = model.getPeoples()[0]
    if not has_fanger(people):
        checked(people.peopleDefinition().pushThermalComfortModelType("Fanger"))
    for getter, setter, name, unit, value in (
        ("workEfficiencySchedule", "setWorkEfficiencySchedule", "WorkEfficiency", "Dimensionless", 0.0),
        ("airVelocitySchedule", "setAirVelocitySchedule", "AirVolicity", "Velocity", .2),
    ):
        if value_of(getattr(people, getter)()) is None:
            limits = os.model.ScheduleTypeLimits(model)
            limits.setName(name + " limits")
            checked(limits.setUnitType(unit))
            checked(limits.setNumericType("Continuous"))
            limits.setLowerLimitValue(0)
            if unit == "Dimensionless":
                limits.setUpperLimitValue(1)
            schedule = os.model.ScheduleConstant(model)
            schedule.setName(name)
            checked(schedule.setScheduleTypeLimits(limits))
            checked(schedule.setValue(value))
            checked(getattr(people, setter)(schedule))
    if not people.clothingInsulationSchedule().is_initialized() and not people.clothingInsulationCalculationMethodSchedule().is_initialized():
        checked(people.setClothingInsulationCalculationMethod("DynamicClothingModelASHRAE55"))
    return {"model": "Fanger", "meanRadiantTemperature": "ZoneAveraged (EnergyPlus default; owner-approved replacement for legacy AngleFactor)",
            "clothingMethod": people.clothingInsulationCalculationMethod(), "legacySource": "jEPlus-master/Facade/Base.imf and include/Office.idf"}


@dataclass
class Binding:
    data: dict
    write: Callable

    def apply(self, value):
        if self.data.get("choices") is not None:
            if not any(type(value) is type(item["value"]) and value == item["value"] for item in self.data["choices"]):
                raise ValueError("Choose an available model value")
        elif self.data["kind"] == "boolean":
            if type(value) is not bool:
                raise ValueError("Expected an enabled/disabled value")
        else:
            if type(value) not in (int, float) or not math.isfinite(value):
                raise ValueError("Expected a finite number")
            if value < self.data["min"] or value > self.data["max"]:
                raise ValueError(f"Value must be between {self.data['min']} and {self.data['max']} {self.data['units']}")
            if self.data.get("integer") and int(value) != value:
                raise ValueError("Expected a whole number")
            if self.data.get("integer"):
                value = int(value)
        checked(self.write(value))


def bindings(model) -> dict[str, Binding]:
    """Only supported fields actually present in the document are published."""
    result = {}
    building = model.getBuilding()
    building_scope = [str(building.handle())]
    spaces = model.getSpaces()
    if len(spaces) != 1 or len(model.getThermalZones()) != 1:
        raise ValueError("These restored input controls currently support one Space and one Thermal Zone")

    def field(obj, key, label, tab, group, scopes, getter, setter, units="", low=0, high=1,
              step=.01, choices=None, boolean=False, integer=False, control_id=None):
        current = value_of(getter())
        if current is None:
            return  # An unset optional value is not zero.
        ident = control_id or f"{obj.handle()}:{key}"
        if choices is not None:
            choices = [{"value": item, "label": str(item)} if not isinstance(item, dict) else item for item in choices]
        data = dict(id=ident, objectHandle=str(obj.handle()), field=key, label=label, tab=tab,
                    group=group, scopes=scopes, value=current, units=units, min=low, max=high,
                    step=step, integer=integer, kind="boolean" if boolean else "number", choices=choices)
        data["detail"] = key.split(".")[-1] in {
            "fractionRadiant", "sensibleHeatFraction", "returnAirFraction", "fractionVisible", "fractionLatent", "fractionLost",
            "constantTermCoefficient", "temperatureTermCoefficient", "velocityTermCoefficient", "velocitySquaredTermCoefficient",
            "density", "specificHeat", "solarAbsorptance", "thermalAbsorptance", "visibleAbsorptance", "roughness",
        }
        # Preserve the original shoebox's useful slider travel. Exact numeric
        # entries retain the broader validated SDK range.
        slider_limits = {"width": 21.336, "depth": 21.336, "height": 8,
                         "spaceFloorAreaperPerson": 50, "airChangesperHour": 5,
                         "thickness": .3, "thermalResistance": 10, "uFactor": 6,
                         "overhang": 1, "left_fin": .5, "right_fin": .5}
        slider_max = slider_limits.get(key.split(".")[-1], high)
        if key == "wattsperSpaceFloorArea":
            slider_max = 30 if tab == "lighting" else 50
        data["sliderMax"] = max(slider_max, current) if type(current) in (int, float) else high
        result[ident] = Binding(data, setter)

    def number(obj, getter, setter, label, tab, group, scopes, units, low, high, step=.01):
        field(obj, getter, label, tab, group, scopes, getattr(obj, getter), getattr(obj, setter), units, low, high, step)

    number(building, "northAxis", "setNorthAxis", "Orientation", "site", "Building", building_scope, "deg", 0, 360, 1)
    site = model.getSite()
    for getter, setter, label, units, low, high in (
        ("latitude", "setLatitude", "Latitude", "deg", -90, 90),
        ("longitude", "setLongitude", "Longitude", "deg", -180, 180),
        ("timeZone", "setTimeZone", "Time zone", "UTC hours", -12, 14),
        ("elevation", "setElevation", "Elevation", "m", -500, 9000),
    ):
        number(site, getter, setter, label, "site", "Simulation location", building_scope, units, low, high)

    # The original width/depth/height controls are explicitly a rectangle tool.
    if len(spaces) == 1:
        space = spaces[0]
        surfaces = space.surfaces()
        vertices = {(v.x(), v.y(), v.z()) for surface in surfaces for v in surface.vertices()}
        axes = [sorted({point[axis] for point in vertices}) for axis in range(3)]
        rectangular = len(surfaces) == 6 and len(vertices) == 8 and all(len(axis) == 2 for axis in axes)
        if rectangular and all(not surface.adjacentSurface().is_initialized() for surface in surfaces):
            for axis, label in enumerate(("Width", "Depth", "Height")):
                old = axes[axis][1] - axes[axis][0]

                def resize(value, axis=axis, old=old):
                    origin = axes[axis][0]
                    items = [face for surface in surfaces for face in [surface, *surface.subSurfaces()]]
                    items += [shade for group in space.shadingSurfaceGroups() for shade in group.shadingSurfaces()]
                    for face in items:
                        points = []
                        for vertex in face.vertices():
                            p = [vertex.x(), vertex.y(), vertex.z()]
                            p[axis] = origin + (p[axis] - origin) * value / old
                            points.append(os.Point3d(*p))
                        checked(face.setVertices(os.Point3dVector(points)))
                field(space, label.lower(), label, "geometry", "Shoebox", building_scope + [str(space.handle())],
                      lambda old=old: old, resize, "m", .5, 100, .05)

    def schedule(owner, getter, setter, label, tab, scopes, units="fraction"):
        assigned = value_of(getattr(owner, getter)())
        if assigned is None:
            return
        limits = value_of(assigned.scheduleTypeLimits())
        choices = []
        for candidate in model.getSchedules():
            candidate_limits = value_of(candidate.scheduleTypeLimits())
            if limits is None or candidate_limits is None or candidate_limits.unitType() != limits.unitType():
                continue
            choices.append({"value": str(candidate.handle()), "label": candidate.nameString()})
        field(owner, getter, label, tab, label, scopes,
              lambda: str(assigned.handle()),
              lambda value: getattr(owner, setter)(model.getSchedule(os.toUUID(value)).get()),
              choices=choices)

    for space in spaces:
        scopes = building_scope + [str(space.handle())]
        loads = (
            (space.people(), "peopleDefinition", "setPeopleDefinition", "activity", "People",
             [("spaceFloorAreaperPerson", "setSpaceFloorAreaperPerson", "Occupancy", "m²/person", .1, 1000),
              ("fractionRadiant", "setFractionRadiant", "Radiant fraction", "fraction", 0, 1),
              ("sensibleHeatFraction", "setSensibleHeatFraction", "Sensible heat fraction", "fraction", 0, 1)]),
            (space.lights(), "lightsDefinition", "setLightsDefinition", "lighting", "Lighting",
             [("wattsperSpaceFloorArea", "setWattsperSpaceFloorArea", "Lighting density", "W/m²", 0, 200),
              ("returnAirFraction", "setReturnAirFraction", "Return air fraction", "fraction", 0, 1),
              ("fractionRadiant", "setFractionRadiant", "Radiant fraction", "fraction", 0, 1),
              ("fractionVisible", "setFractionVisible", "Visible fraction", "fraction", 0, 1)]),
            (space.electricEquipment(), "electricEquipmentDefinition", "setElectricEquipmentDefinition", "activity", "Equipment",
             [("wattsperSpaceFloorArea", "setWattsperSpaceFloorArea", "Equipment density", "W/m²", 0, 1000),
              ("fractionLatent", "setFractionLatent", "Latent fraction", "fraction", 0, 1),
              ("fractionRadiant", "setFractionRadiant", "Radiant fraction", "fraction", 0, 1),
              ("fractionLost", "setFractionLost", "Lost fraction", "fraction", 0, 1)]),
            (space.hotWaterEquipment(), "hotWaterEquipmentDefinition", "setHotWaterEquipmentDefinition", "activity", "Hot-water internal gains",
             [("wattsperPerson", "setWattsperPerson", "Gain per person", "W/person", 0, 1000),
              ("fractionLatent", "setFractionLatent", "Latent fraction", "fraction", 0, 1),
              ("fractionRadiant", "setFractionRadiant", "Radiant fraction", "fraction", 0, 1),
              ("fractionLost", "setFractionLost", "Lost fraction", "fraction", 0, 1)]),
        )
        for items, definition_getter, definition_setter, tab, group, specs in loads:
            for load in items:
                definition = getattr(load, definition_getter)()
                for getter, setter, label, units, low, high in specs:
                    def edit(value, load=load, definition=definition, definition_setter=definition_setter, setter=setter):
                        # A local load edit must not alter another instance sharing its definition.
                        clone = definition.clone(model)
                        typed = getattr(clone, "to_" + definition.__class__.__name__)().get()
                        checked(getattr(typed, setter)(value))
                        checked(getattr(load, definition_setter)(typed))
                    field(load, getter, label, tab, group, scopes, getattr(definition, getter), edit, units, low, high)
                if definition_getter == "peopleDefinition":
                    schedule(load, "numberofPeopleSchedule", "setNumberofPeopleSchedule", "Occupancy schedule", tab, scopes)
                    schedule(load, "activityLevelSchedule", "setActivityLevelSchedule", "Metabolic activity", tab, scopes, "W/person")
                    def comfort_enabled(enabled, load=load):
                        if enabled:
                            enable_fanger(model)
                        else:
                            definition = load.peopleDefinition()
                            for index in reversed(range(definition.numThermalComfortModelTypes())):
                                if value_of(definition.getThermalComfortModelType(index)) == "Fanger":
                                    checked(definition.eraseThermalComfortModelType(index))
                    field(load, "fanger", "Fanger PMV/PPD", tab, "Comfort", scopes,
                          lambda load=load: has_fanger(load), comfort_enabled, boolean=True)
                    if has_fanger(load):
                        for getter, setter, label, units, maximum in (("workEfficiencySchedule", "setWorkEfficiencySchedule", "Work efficiency", "fraction", 1),
                                ("airVelocitySchedule", "setAirVelocitySchedule", "Air speed", "m/s", 3)):
                            assigned = value_of(getattr(load, getter)())
                            constant = value_of(assigned.to_ScheduleConstant()) if assigned else None
                            if constant:
                                def edit_constant(value, constant=constant, load=load, setter=setter):
                                    local = constant.clone(model).to_ScheduleConstant().get()
                                    checked(local.setValue(value))
                                    checked(getattr(load, setter)(local))
                                field(load, getter + ".value", label, tab, "Comfort", scopes, constant.value, edit_constant, units, 0, maximum, .01)
                else:
                    schedule(load, "schedule", "setSchedule", group + " schedule", tab, scopes)
        for infiltration in space.spaceInfiltrationDesignFlowRates():
            for getter, setter, label, units, low, high in (
                ("airChangesperHour", "setAirChangesperHour", "Infiltration", "ACH", 0, 20),
                ("constantTermCoefficient", "setConstantTermCoefficient", "Constant coefficient", "", 0, 10),
                ("temperatureTermCoefficient", "setTemperatureTermCoefficient", "Temperature coefficient", "1/K", 0, 10),
                ("velocityTermCoefficient", "setVelocityTermCoefficient", "Wind coefficient", "s/m", 0, 10),
                ("velocitySquaredTermCoefficient", "setVelocitySquaredTermCoefficient", "Wind squared coefficient", "s²/m²", 0, 10),
            ):
                number(infiltration, getter, setter, label, "activity", "Infiltration", scopes, units, low, high)
            schedule(infiltration, "schedule", "setSchedule", "Infiltration schedule", "activity", scopes)
        outside = value_of(space.designSpecificationOutdoorAir())
        if outside:
            # This is a named shared OA specification, also referenced by the Ideal Loads system.
            field(outside, "outdoorAirMethod", "Combination method", "activity", "Outdoor air · " + outside.nameString(), scopes,
                  outside.outdoorAirMethod, outside.setOutdoorAirMethod, choices=["Sum", "Maximum"])
            for getter, setter, label, units, low, high in (
                ("outdoorAirFlowperPerson", "setOutdoorAirFlowperPerson", "Outdoor air per person", "m³/s-person", 0, .1),
                ("outdoorAirFlowperFloorArea", "setOutdoorAirFlowperFloorArea", "Outdoor air per floor area", "m³/s-m²", 0, .1),
                ("outdoorAirFlowRate", "setOutdoorAirFlowRate", "Outdoor air flow", "m³/s", 0, 100),
                ("outdoorAirFlowAirChangesperHour", "setOutdoorAirFlowAirChangesperHour", "Outdoor air changes", "ACH", 0, 20),
            ):
                number(outside, getter, setter, label, "activity", "Outdoor air · " + outside.nameString(), scopes, units, low, high, .0001)
    for face in [*model.getSurfaces(), *model.getSubSurfaces()]:
        opening = isinstance(face, os.model.SubSurface)
        scopes = [str(face.handle())]
        tab = "openings" if opening else "construction"
        if opening and face.subSurfaceType() in ("FixedWindow", "OperableWindow"):
            shading_controls(model, face, field)
        construction = value_of(face.construction())
        if not construction:
            continue
        choices = [{"value": str(item.handle()), "label": item.nameString()} for item in model.getConstructions()
                   if item.isFenestration() == construction.isFenestration()]
        field(face, "construction", "Construction", tab, "Assembly", scopes,
              lambda construction=construction: str(construction.handle()),
              lambda value, face=face: face.setConstruction(model.getConstruction(os.toUUID(value)).get()), choices=choices)
        layered = value_of(construction.to_Construction())
        if not layered:
            continue
        for index, material in enumerate(layered.layers()):
            types = [
                ("StandardOpaqueMaterial", [("thickness", "setThickness", "Thickness", "m", .0001, 5),
                  ("conductivity", "setConductivity", "Conductivity", "W/m-K", .001, 500),
                  ("density", "setDensity", "Density", "kg/m³", .1, 30000),
                  ("specificHeat", "setSpecificHeat", "Specific heat", "J/kg-K", 100, 10000),
                  ("solarAbsorptance", "setSolarAbsorptance", "Solar absorptance", "fraction", 0, 1),
                  ("thermalAbsorptance", "setThermalAbsorptance", "Thermal absorptance", "fraction", 0, 1),
                  ("visibleAbsorptance", "setVisibleAbsorptance", "Visible absorptance", "fraction", 0, 1)]),
                ("MasslessOpaqueMaterial", [("thermalResistance", "setThermalResistance", "Thermal resistance", "m²-K/W", .001, 100),
                  ("solarAbsorptance", "setSolarAbsorptance", "Solar absorptance", "fraction", 0, 1),
                  ("thermalAbsorptance", "setThermalAbsorptance", "Thermal absorptance", "fraction", 0, 1),
                  ("visibleAbsorptance", "setVisibleAbsorptance", "Visible absorptance", "fraction", 0, 1)]),
                ("AirGap", [("thermalResistance", "setThermalResistance", "Thermal resistance", "m²-K/W", .001, 100)]),
                ("SimpleGlazing", [("uFactor", "setUFactor", "U-factor", "W/m²-K", .01, 20),
                  ("solarHeatGainCoefficient", "setSolarHeatGainCoefficient", "SHGC", "fraction", .001, .999),
                  ("visibleTransmittance", "setVisibleTransmittance", "Visible transmittance", "fraction", .001, .999)]),
            ]
            for kind, specs in types:
                typed = value_of(getattr(material, "to_" + kind)())
                if not typed:
                    continue
                for getter, setter, label, units, low, high in specs:
                    def local_material(value, face=face, layered=layered, index=index, material=material, kind=kind, setter=setter):
                        local_construction = layered.clone(model).to_Construction().get()
                        local_layer = getattr(material.clone(model), "to_" + kind)().get()
                        checked(getattr(local_layer, setter)(value))
                        checked(local_construction.setLayer(index, local_layer))
                        checked(face.setConstruction(local_construction))
                    field(face, f"layer.{index}.{getter}", label, tab, f"Layer {index + 1} · {material.nameString()}", scopes,
                          getattr(typed, getter), local_material, units, low, high, .01,
                          control_id=f"{face.handle()}:layer.{index}.{getter}")

    simulation = model.getSimulationControl()
    for getter, setter, label in (
        ("doZoneSizingCalculation", "setDoZoneSizingCalculation", "Zone sizing"),
        ("doSystemSizingCalculation", "setDoSystemSizingCalculation", "System sizing"),
        ("doPlantSizingCalculation", "setDoPlantSizingCalculation", "Plant sizing"),
        ("runSimulationforSizingPeriods", "setRunSimulationforSizingPeriods", "Run design days"),
        ("runSimulationforWeatherFileRunPeriods", "setRunSimulationforWeatherFileRunPeriods", "Run weather period"),
    ):
        field(simulation, getter, label, "simulation", "Simulation", building_scope, getattr(simulation, getter), getattr(simulation, setter), boolean=True)
    timestep = model.getTimestep()
    field(timestep, "numberOfTimestepsPerHour", "Timesteps per hour", "simulation", "Simulation", building_scope,
          timestep.numberOfTimestepsPerHour, timestep.setNumberOfTimestepsPerHour,
          choices=[1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 60])
    period = model.getRunPeriod()
    for getter, setter, label, high in (("getBeginMonth", "setBeginMonth", "Start month", 12),
                                       ("getBeginDayOfMonth", "setBeginDayOfMonth", "Start day", 31),
                                       ("getEndMonth", "setEndMonth", "End month", 12),
                                       ("getEndDayOfMonth", "setEndDayOfMonth", "End day", 31)):
        field(period, getter, label, "simulation", "Run period", building_scope, getattr(period, getter), getattr(period, setter), low=1, high=high, step=1, integer=True)
    year = model.getYearDescription()
    field(year, "calendarYear", "Calendar year", "simulation", "Run period", building_scope,
          year.calendarYear, year.setCalendarYear, low=1900, high=2200, step=1, integer=True)
    return result


def shading_controls(model, window, field):
    """Hosted rectangular shades are actual SDK ShadingSurfaces; ratios are derived."""
    wall = value_of(window.surface())
    if wall is None or wall.outsideBoundaryCondition() != "Outdoors":
        return
    normal = wall.outwardNormal()
    if abs(normal.z()) > 1e-6 or len(window.vertices()) != 4:
        return
    ux, uy = -normal.y(), normal.x()
    vertices = window.vertices()
    horizontal = [v.x() * ux + v.y() * uy for v in vertices]
    vertical = [v.z() for v in vertices]
    left, right, bottom, top = min(horizontal), max(horizontal), min(vertical), max(vertical)
    wall_distance = vertices[0].x() * normal.x() + vertices[0].y() * normal.y()
    if any(min(abs(u-left), abs(u-right)) > 1e-6 for u in horizontal) or any(min(abs(z-bottom), abs(z-top)) > 1e-6 for z in vertical):
        return

    def point(u, z, depth=0):
        return os.Point3d(u * ux + (wall_distance + depth) * normal.x(),
                          u * uy + (wall_distance + depth) * normal.y(), z)

    for kind, label in (("overhang", "Overhang projection / window height"),
                        ("left_fin", "Left fin projection / window width"),
                        ("right_fin", "Right fin projection / window width")):
        shades = []
        for shade in model.getShadingSurfaces():
            props = shade.additionalProperties()
            if value_of(props.getFeatureAsString("host_subsurface")) == str(window.handle()) and value_of(props.getFeatureAsString("shading_kind")) == kind:
                shades.append(shade)
        if len(shades) > 1:
            continue
        span = top - bottom if kind == "overhang" else right - left
        ratio = max((v.x() * normal.x() + v.y() * normal.y() - wall_distance for v in shades[0].vertices()), default=0) / span if shades else 0

        def edit(value, shades=shades, kind=kind, span=span):
            depth = value * span
            if depth == 0:
                for shade in shades:
                    shade.remove()
                return
            if kind == "overhang":
                points = [point(right, top), point(left, top), point(left, top, depth), point(right, top, depth)]
            else:
                edge = left if kind == "left_fin" else right
                points = [point(edge, bottom), point(edge, top), point(edge, top, depth), point(edge, bottom, depth)]
            if shades:
                checked(shades[0].setVertices(os.Point3dVector(points)))
            else:
                group = os.model.ShadingSurfaceGroup(model)
                checked(group.setSpace(wall.space().get()))
                shade = os.model.ShadingSurface(os.Point3dVector(points), model)
                checked(shade.setShadingSurfaceGroup(group))
                shade.setName(window.nameString() + " " + kind.replace("_", " "))
                shade.additionalProperties().setFeature("host_subsurface", str(window.handle()))
                shade.additionalProperties().setFeature("shading_kind", kind)
        field(window, kind, label, "openings", "Shading", [str(window.handle()), str(wall.handle()), *[str(shade.handle()) for shade in shades]],
              lambda ratio=ratio: ratio, edit, "ratio", 0, 2, .01)


def validate_model(model):
    period = model.getRunPeriod()
    year = value_of(model.getYearDescription().calendarYear()) or 2001
    for month, day in ((period.getBeginMonth(), period.getBeginDayOfMonth()), (period.getEndMonth(), period.getEndDayOfMonth())):
        if day > calendar.monthrange(year, month)[1]:
            raise ValueError("Run period contains an invalid calendar date")
    for load in model.getLightss():
        d = load.lightsDefinition()
        if d.returnAirFraction() + d.fractionRadiant() + d.fractionVisible() > 1 + 1e-9:
            raise ValueError("Lighting heat fractions exceed one")
    for load in [*model.getElectricEquipments(), *model.getHotWaterEquipments()]:
        d = load.electricEquipmentDefinition() if isinstance(load, os.model.ElectricEquipment) else load.hotWaterEquipmentDefinition()
        if d.fractionLatent() + d.fractionRadiant() + d.fractionLost() > 1 + 1e-9:
            raise ValueError("Equipment heat fractions exceed one")


def projection(model):
    return [binding.data for binding in bindings(model).values()]


def apply_edits(model, edits):
    if not isinstance(edits, list) or not edits or len(edits) > 100:
        raise ValueError("Supply one to one hundred explicit input edits")
    ids = [edit.get("id") for edit in edits]
    if len(set(ids)) != len(ids):
        raise ValueError("Duplicate control edits")
    before, expected = {}, {}
    for edit in edits:
        control = bindings(model).get(edit.get("id"))
        if control is None:
            raise ValueError("This input is not supported in the current model")
        before[edit["id"]] = control.data["value"]
        control.apply(edit.get("value"))
        expected[edit["id"]] = edit["value"]
    validate_model(model)
    return {"before": before, "expected": expected}


def verify_edits(model, expected):
    controls = bindings(model)
    actual = {}
    for key, value in expected.items():
        read = controls[key].data["value"]
        if isinstance(value, (float, int)) and not isinstance(value, bool):
            if not math.isclose(read, value, rel_tol=1e-7, abs_tol=1e-9):
                raise ValueError("Saved input readback differs from the requested value")
        elif read != value:
            raise ValueError("Saved input readback differs from the requested value")
        actual[key] = read
    return actual
