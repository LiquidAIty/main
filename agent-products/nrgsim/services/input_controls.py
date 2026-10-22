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


def enable_fanger(model, people=None):
    """Restore the archived Office assumptions with the owner's approved zone-average MRT."""
    if people is None and len(model.getPeoples()) != 1:
        raise ValueError("Comfort preparation requires the existing single Office People instance")
    people = people or model.getPeoples()[0]
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

    def field(obj, key, label, tab, group, scopes, getter, setter, units="", low=0, high=1,
              step=.01, choices=None, boolean=False, integer=False, control_id=None):
        current = value_of(getter())
        if current is None:
            return  # An unset optional value is not zero.
        ident = control_id or f"{obj.handle()}:{key}"
        if ident in result:
            result[ident].data['scopes'] = list(dict.fromkeys(result[ident].data['scopes'] + scopes))
            return result[ident]
        if len(spaces) > 1:
            scoped_space = next((s for s in spaces if str(s.handle()) in scopes), None)
            if scoped_space and not isinstance(obj, os.model.DesignSpecificationOutdoorAir):
                group = scoped_space.nameString() + " · " + group
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
        return result[ident]

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

    from floor_geometry import floor_dimensions, resize_floor, assign_zone, separate_zone
    for story in model.getBuildingStorys():
        if not any(value_of(s.additionalProperties().getFeatureAsString("floor_region")) == "Core" for s in story.spaces()):
            continue
        dimensions = floor_dimensions(story)
        for key, label in (("width", "Footprint width"), ("depth", "Footprint depth"), ("coreWidth", "Core width"),
                           ("coreDepth", "Core depth"), ("elevation", "Floor elevation"), ("height", "Floor height")):
            upper = dimensions['width']-.01 if key=='coreWidth' else dimensions['depth']-.01 if key=='coreDepth' else 500
            shared_xy = len(model.getBuildingStorys()) > 1 and key in ('width','depth','coreWidth','coreDepth')
            control_scopes = [str(s.handle()) for s in model.getBuildingStorys()] if shared_xy else [str(story.handle())]
            owner = min(model.getBuildingStorys(), key=lambda item: floor_dimensions(item)['elevation']) if shared_xy else story
            field(owner, key, label, "geometry", "Aligned floors" if shared_xy else story.nameString(), building_scope + control_scopes,
                  lambda key=key, dimensions=dimensions: dimensions[key],
                  lambda value, story=story, key=key: resize_floor(model, story, key, value),
                  "m", -100 if key == "elevation" else .5, upper, .05)

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
        if limits is None:
            return
        unit = limits.unitType()
        ranges = {'Dimensionless': ('fraction',0,1), 'Temperature': ('°C',-50,100),
                  'ActivityLevel': ('W/person',0,1000), 'Velocity': ('m/s',0,20)}
        if unit not in ranges:
            return
        unit_label, lower, upper = ranges[unit]
        lower = value_of(limits.lowerLimitValue()) if limits.lowerLimitValue().is_initialized() else lower
        upper = value_of(limits.upperLimitValue()) if limits.upperLimitValue().is_initialized() else upper
        compact = value_of(assigned.to_ScheduleCompact())
        constant = value_of(assigned.to_ScheduleConstant())
        if constant:
            def edit_constant(value):
                local = constant.clone(model).to_ScheduleConstant().get()
                checked(local.setValue(value)); checked(getattr(owner, setter)(local))
            field(owner, getter+'.value', label+' value', tab, label, scopes, constant.value,
                  edit_constant, unit_label, lower, upper, .01, integer=limits.numericType() == 'Discrete')
        elif compact:
            # Retain every native Through/For/Until/Interpolate token. Only its
            # actual numeric values are editable; never flatten a varying profile.
            through = day = until = ''
            for index, group in enumerate(compact.extensibleGroups()):
                text = value_of(group.getString(0)) or ''
                if ':' not in text:
                    numeric = group.getDouble(0)
                    if not numeric.is_initialized():
                        continue
                    def edit_entry(value, index=index):
                        local = compact.clone(model).to_ScheduleCompact().get()
                        checked(local.extensibleGroups()[index].setDouble(0, value))
                        checked(getattr(owner, setter)(local))
                    control = field(owner, getter+f'.entry.{index}', ' · '.join(x for x in (through, day, until) if x) or label+' value', tab,
                          label, scopes,
                          lambda value=numeric.get(): value, edit_entry, unit_label, lower, upper, .01,
                          integer=limits.numericType() == 'Discrete')
                    control.data['detail'] = True
                else:
                    if text.lower().startswith('through:'): through = text
                    elif text.lower().startswith('for:'): day = text
                    elif text.lower().startswith('until:'): until = text

    for space in spaces:
        scopes = building_scope + [str(space.handle())]
        if len(spaces) > 1 and space.thermalZone().is_initialized():
            field(space, "thermalZone", "Thermal zone", "geometry", "Assignment", [str(space.handle())],
                  lambda space=space: str(space.thermalZone().get().handle()),
                  lambda value, space=space: separate_zone(space) if value == '__new__' else assign_zone(space, model.getThermalZone(os.toUUID(value)).get()),
                  choices=[{"value": str(zone.handle()), "label": zone.nameString()} for zone in model.getThermalZones()]
                    + ([{"value": "__new__", "label": "New separate zone"}] if len(space.thermalZone().get().spaces()) > 1 else []))
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
                            local = load.peopleDefinition().clone(model).to_PeopleDefinition().get()
                            checked(load.setPeopleDefinition(local))
                            enable_fanger(model, load)
                        else:
                            definition = load.peopleDefinition().clone(model).to_PeopleDefinition().get()
                            checked(load.setPeopleDefinition(definition))
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
            oa_group = "Shared outdoor air · " + outside.nameString()
            field(outside, "outdoorAirMethod", "Combination method", "activity", oa_group, scopes,
                  outside.outdoorAirMethod, outside.setOutdoorAirMethod, choices=["Sum", "Maximum"])
            for getter, setter, label, units, low, high in (
                ("outdoorAirFlowperPerson", "setOutdoorAirFlowperPerson", "Outdoor air per person", "m³/s-person", 0, .1),
                ("outdoorAirFlowperFloorArea", "setOutdoorAirFlowperFloorArea", "Outdoor air per floor area", "m³/s-m²", 0, .1),
                ("outdoorAirFlowRate", "setOutdoorAirFlowRate", "Outdoor air flow", "m³/s", 0, 100),
                ("outdoorAirFlowAirChangesperHour", "setOutdoorAirFlowAirChangesperHour", "Outdoor air changes", "ACH", 0, 20),
            ):
                number(outside, getter, setter, label, "activity", oa_group, scopes, units, low, high, .0001)
    # Building/floor/Space selectors deliberately edit the exact displayed set.
    # A mixed assignment remains mixed until the user explicitly chooses a replacement.
    envelope_groups = [('Wall', 'Outdoors', 'Exterior walls'), ('RoofCeiling', 'Outdoors', 'Roof'),
                       ('Floor', 'Ground', 'Ground floor'), ('Wall', 'Surface', 'Interior walls'),
                       ('RoofCeiling', 'Surface', 'Interstory ceilings'), ('Floor', 'Surface', 'Interstory floors'),
                       ('Wall', 'Adiabatic', 'Adiabatic walls'), ('RoofCeiling', 'Adiabatic', 'Adiabatic ceilings'),
                       ('Floor', 'Adiabatic', 'Adiabatic floors'), ('Floor', 'Outdoors', 'Exposed floors'),
                       ('Wall', 'Ground', 'Ground-contact walls')]
    owners = [(building, list(model.getSurfaces()))]
    owners += [(story, [face for space in story.spaces() for face in space.surfaces()]) for story in model.getBuildingStorys()]
    owners += [(space, list(space.surfaces())) for space in spaces]
    for owner, faces in owners:
        for surface_type, boundary, label in envelope_groups:
            selected = [face for face in faces if face.surfaceType() == surface_type and face.outsideBoundaryCondition() == boundary]
            if selected:
                construction_fields(model, owner, selected, field, 'construction', label,
                                    f'envelope.{surface_type}.{boundary}', [str(owner.handle())])
    for face in [*model.getSurfaces(), *model.getSubSurfaces()]:
        opening = isinstance(face, os.model.SubSurface)
        scopes = [str(face.handle())]
        tab = "openings" if opening else "construction"
        if opening and face.subSurfaceType() in ("FixedWindow", "OperableWindow"):
            shading_controls(model, face, field)
        construction = value_of(face.construction())
        if not construction:
            continue
        construction_fields(model, face, [face], field, tab, 'Assembly', '', scopes)
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
                        assign_construction(face, local_construction)
                    field(face, f"layer.{index}.{getter}", label, tab, f"Layer {index + 1} · {material.nameString()}", scopes,
                          getattr(typed, getter), local_material, units, low, high, .01,
                          control_id=f"{face.handle()}:layer.{index}.{getter}")

    for zone in model.getThermalZones():
        scopes = building_scope + [str(space.handle()) for space in zone.spaces()]
        thermostat = value_of(zone.thermostatSetpointDualSetpoint())
        if thermostat:
            schedule(thermostat,'heatingSetpointTemperatureSchedule','setHeatingSetpointTemperatureSchedule','Heating schedule','hvac',scopes,'C')
            schedule(thermostat,'coolingSetpointTemperatureSchedule','setCoolingSetpointTemperatureSchedule','Cooling schedule','hvac',scopes,'C')
        for equipment in zone.equipment():
            system = value_of(equipment.to_ZoneHVACIdealLoadsAirSystem())
            if system is None: continue
            group = zone.nameString() + ' · Ideal Loads'
            for getter,setter,label,units,low,high in (
                ('maximumHeatingSupplyAirTemperature','setMaximumHeatingSupplyAirTemperature','Heating supply limit','°C',5,100),
                ('minimumCoolingSupplyAirTemperature','setMinimumCoolingSupplyAirTemperature','Cooling supply limit','°C',0,50),
                ('maximumHeatingSupplyAirHumidityRatio','setMaximumHeatingSupplyAirHumidityRatio','Heating humidity limit','kg/kg',0,.1),
                ('minimumCoolingSupplyAirHumidityRatio','setMinimumCoolingSupplyAirHumidityRatio','Cooling humidity limit','kg/kg',0,.1),
            ):
                number(system,getter,setter,label,'hvac',group,scopes,units,low,high)
            for getter,setter,label in (
                ('demandControlledVentilationType','setDemandControlledVentilationType','Demand-controlled ventilation'),
                ('outdoorAirEconomizerType','setOutdoorAirEconomizerType','Economizer'),
                ('heatRecoveryType','setHeatRecoveryType','Heat recovery'),
            ):
                field(system,getter,label,'hvac',group,scopes,getattr(system,getter),getattr(system,setter),
                      choices=list(getattr(os.model.ZoneHVACIdealLoadsAirSystem,getter+'Values')()))
            if system.heatRecoveryType() != 'None':
                number(system,'sensibleHeatRecoveryEffectiveness','setSensibleHeatRecoveryEffectiveness','Sensible recovery effectiveness','hvac',group,scopes,'fraction',0,1)
            if system.heatRecoveryType() == 'Enthalpy':
                number(system,'latentHeatRecoveryEffectiveness','setLatentHeatRecoveryEffectiveness','Latent recovery effectiveness','hvac',group,scopes,'fraction',0,1)
            for getter,setter,label in (
                ('availabilitySchedule','setAvailabilitySchedule','System availability'),
                ('heatingAvailabilitySchedule','setHeatingAvailabilitySchedule','Heating availability'),
                ('coolingAvailabilitySchedule','setCoolingAvailabilitySchedule','Cooling availability'),
            ):
                schedule(system,getter,setter,label,'hvac',scopes)

    if len(model.getAirLoopHVACs()) == 1 and len(spaces) == 1:
        # Only the independently verified single-zone packaged equipment is exposed.
        from packaged_rooftop import describe
        describe(model)
        scopes = building_scope + [str(spaces[0].handle())]
        fan = model.getFanConstantVolumes()[0]
        for getter, setter, label, units, low, high in (
            ('pressureRise','setPressureRise','Fan pressure rise','Pa',1,3000),
            ('fanEfficiency','setFanEfficiency','Fan efficiency','fraction',.01,1),
            ('motorEfficiency','setMotorEfficiency','Motor efficiency','fraction',.01,1),
        ):
            number(fan,getter,setter,label,'hvac','Supply fan',scopes,units,low,high)
        cooling = model.getCoilCoolingDXSingleSpeeds()[0]
        number(cooling,'ratedCOP','setRatedCOP','Rated cooling COP','hvac','DX cooling',scopes,'W/W',.1,20)
        for heating in model.getCoilHeatingGass():
            number(heating,'gasBurnerEfficiency','setGasBurnerEfficiency','Gas burner efficiency','hvac','Heating',scopes,'fraction',.01,1)
        loop = model.getAirLoopHVACs()[0]
        supply_manager = model.getSetpointManagerSingleZoneReheats()[0]
        number(supply_manager,'minimumSupplyAirTemperature','setMinimumSupplyAirTemperature','Minimum supply temperature','hvac','Supply limits',scopes,'°C',-99,99)
        number(supply_manager,'maximumSupplyAirTemperature','setMaximumSupplyAirTemperature','Maximum supply temperature','hvac','Supply limits',scopes,'°C',-99,99)
        schedule(loop,'availabilitySchedule','setAvailabilitySchedule','System availability','hvac',scopes)
        controller = loop.airLoopHVACOutdoorAirSystem().get().getControllerOutdoorAir()
        field(controller,'economizer','Economizer','hvac','Outdoor air',scopes,controller.getEconomizerControlType,
              controller.setEconomizerControlType,choices=['NoEconomizer','DifferentialDryBulb'])
        sizing = model.getSizingParameters()
        number(sizing,'heatingSizingFactor','setHeatingSizingFactor','Heating sizing factor','hvac','Sizing',scopes,'ratio',.1,3)
        number(sizing,'coolingSizingFactor','setCoolingSizingFactor','Cooling sizing factor','hvac','Sizing',scopes,'ratio',.1,3)
        system_sizing = loop.sizingSystem()
        for getter,setter,label,units,low,high in (
            ('centralHeatingMaximumSystemAirFlowRatio','setCentralHeatingMaximumSystemAirFlowRatio','Heating design airflow ratio','fraction',0,1),
            ('centralHeatingDesignSupplyAirTemperature','setCentralHeatingDesignSupplyAirTemperature','Central heating design supply temperature','°C',-50,100),
            ('centralCoolingDesignSupplyAirTemperature','setCentralCoolingDesignSupplyAirTemperature','Central cooling design supply temperature','°C',-50,100),
        ):
            number(system_sizing,getter,setter,label,'hvac','System sizing',scopes,units,low,high)
        zone_sizing = model.getThermalZones()[0].sizingZone()
        for mode in ('Heating','Cooling'):
            # Temperature and temperature-difference are distinct native methods.
            # Do not expose an inactive absolute-temperature field as an effectful control.
            if getattr(zone_sizing,'zone'+mode+'DesignSupplyAirTemperatureInputMethod')() == 'SupplyAirTemperature':
                number(zone_sizing,'zone'+mode+'DesignSupplyAirTemperature','setZone'+mode+'DesignSupplyAirTemperature',
                       'Zone '+mode.lower()+' design supply temperature','hvac','Zone sizing',scopes,'°C',-50,100)
        for getter,setter,label in (('allOutdoorAirinCooling','setAllOutdoorAirinCooling','Size cooling for 100% outdoor air'),
                                    ('allOutdoorAirinHeating','setAllOutdoorAirinHeating','Size heating for 100% outdoor air')):
            field(system_sizing,getter,label,'hvac','Sizing',scopes,getattr(system_sizing,getter),getattr(system_sizing,setter),boolean=True)

    simulation = model.getSimulationControl()
    from sizing_controls import publish_weather_sizing
    publish_weather_sizing(model, field, building_scope)
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


def construction_fields(model, owner, faces, field, tab, group, prefix, scopes):
    """Real assembly assignment and SDK insulation-layer adjustment at an explicit scope."""
    constructions = [value_of(face.construction()) for face in faces]
    if any(item is None for item in constructions):
        return
    identities = {str(item.handle()) for item in constructions}
    common = constructions[0] if len(identities) == 1 else None
    fenestration = constructions[0].isFenestration()
    surface = faces[0]
    opening = isinstance(surface, os.model.SubSurface)
    kind = surface.subSurfaceType() if opening else surface.surfaceType()
    boundary = surface.surface().get().outsideBoundaryCondition() if opening else surface.outsideBoundaryCondition()
    matching = {str(face.construction().get().handle()) for face in (model.getSubSurfaces() if opening else model.getSurfaces())
                if face.construction().is_initialized()
                and (face.subSurfaceType() if opening else face.surfaceType()) == kind
                and (face.surface().get().outsideBoundaryCondition() if opening else face.outsideBoundaryCondition()) == boundary}
    choices = [{'value': str(item.handle()), 'label': item.nameString()}
               for item in sorted(model.getConstructions(), key=lambda item: item.nameString())
               if str(item.handle()) in matching | identities and (item.isFenestration() if fenestration else item.isOpaque())]
    if not opening:
        from construction_library import option, import_assembly
        library = option(kind, boundary)
        if library:
            choices.append(library)
    if not common:
        choices.insert(0, {'value': '__mixed__', 'label': f'Mixed · {len(identities)} assemblies'})
    key = lambda suffix: prefix + '.' + suffix if prefix else suffix
    def assign(value):
        if value == '__mixed__':
            raise ValueError('Choose a real assembly to replace the mixed assignments')
        construction = import_assembly(model, kind, boundary) if value.startswith('library:') and not opening else model.getConstruction(os.toUUID(value)).get()
        for face in faces:
            assign_construction(face, construction)
    control = field(owner, key('construction'), 'Construction', tab, group, scopes,
                    lambda: str(common.handle()) if common else '__mixed__', assign, choices=choices)
    control.data['targets'] = [str(face.handle()) for face in faces]
    control.data['scopeLabel'] = f'{len(faces)} surface' + ('s' if len(faces) != 1 else '')
    if not common or not common.isOpaque() or common.isGreenRoof():
        return
    layered = value_of(common.to_Construction())
    conductance = value_of(common.thermalConductance())
    if layered is None or conductance is None or not math.isfinite(conductance) or conductance <= 0:
        return
    resistance = 1 / conductance
    layers = list(layered.layers())
    def pcm(material):
        typed = value_of(material.to_StandardOpaqueMaterial()) or value_of(material.to_MasslessOpaqueMaterial())
        return typed is not None and (typed.materialPropertyPhaseChange().is_initialized() or typed.materialPropertyPhaseChangeHysteresis().is_initialized())
    control.data['thermal'] = dict(resistance=resistance, conductance=conductance, resistanceIP=resistance * 5.678263337,
        basis='Base conductivity only · no films, bridges or latent storage' if any(pcm(material) for material in layers) else 'Layers only · no films or thermal bridges')
    if any(pcm(material) for material in layers):
        return  # A steady assembly-R slider must not stand in for PCM performance.
    def adjustable(material):
        standard = value_of(material.to_StandardOpaqueMaterial())
        if pcm(material):
            return False
        return standard is not None or material.to_MasslessOpaqueMaterial().is_initialized()
    editable = [(i, material) for i, material in enumerate(layers) if adjustable(material)]
    insulation = value_of(layered.insulation())
    index = next((i for i, material in editable if insulation and material.handle() == insulation.handle()), -1)
    def set_insulation(value):
        local = layered.clone(model).to_Construction().get()
        if value == -1:
            local.resetInsulation()
        else:
            checked(local.setInsulation(local.layers()[value].to_OpaqueMaterial().get()))
        for face in faces:
            assign_construction(face, local)
    if editable:
        selector = field(owner, key('insulationLayer'), 'R-value adjustment layer', tab, group, scopes,
                         lambda: index, set_insulation,
                         choices=[{'value': -1, 'label': 'Select a layer…'}] + [
                             {'value': i, 'label': f'{i+1} · {material.nameString()}'} for i, material in editable])
        selector.data['detail'] = index >= 0
    if index < 0:
        return
    material = layers[index].to_OpaqueMaterial().get()
    other_resistance = resistance - material.thermalResistance()
    def set_resistance(value):
        # Clone both the assembly and the selected layer: shared resources must not change.
        local = layered.clone(model).to_Construction().get()
        local_layer = material.clone(model).to_OpaqueMaterial().get()
        checked(local.setLayer(index, local_layer)); checked(local.setInsulation(local_layer))
        checked(local.setConductance(1 / value))
        for face in faces:
            assign_construction(face, local)
    field(owner, key('assemblyResistance'), 'Assembly R-value · no films', tab, group, scopes,
          lambda: resistance, set_resistance, 'm²·K/W', other_resistance + .001, max(100, resistance), .01)


def assign_construction(face, construction):
    checked(face.setConstruction(construction))
    if isinstance(face, os.model.Surface) and face.adjacentSurface().is_initialized():
        from floor_geometry import reverse_construction
        reverse_construction(face, face.adjacentSurface().get())


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


def daily_schedule(schedule):
    """Exact bounded validation of the existing full-year AllDays thermostat form."""
    constant = value_of(schedule.to_ScheduleConstant())
    if constant: return [(1440, constant.value())]
    compact = value_of(schedule.to_ScheduleCompact())
    if compact is None: return None
    through = days = 0; end = None; points = []
    for group in compact.extensibleGroups():
        token = (value_of(group.getString(0)) or '').replace(' ','').lower()
        if ':' not in token:
            numeric = group.getDouble(0)
            if not numeric.is_initialized(): return None
            if end is None: return None
            points.append((end,numeric.get())); end = None
            continue
        if token in ('through:12/31', 'through:31dec'): through += 1
        elif token == 'for:alldays': days += 1
        elif token.startswith('until:'):
            hour, minute = token.removeprefix('until:').split(':')
            end = int(hour)*60+int(minute)
        else: return None
    if through != 1 or days != 1 or not points or points[-1][0] != 1440:
        return None
    return points


def validate_model(model):
    for zone in model.getThermalZones():
        thermostat = value_of(zone.thermostatSetpointDualSetpoint())
        if thermostat:
            heat = value_of(thermostat.heatingSetpointTemperatureSchedule())
            cool = value_of(thermostat.coolingSetpointTemperatureSchedule())
            heating, cooling = daily_schedule(heat) if heat else None, daily_schedule(cool) if cool else None
            if heating and cooling:
                for minute in sorted({end for end,_ in heating+cooling}):
                    heating_value = next(value for end,value in heating if end >= minute)
                    cooling_value = next(value for end,value in cooling if end >= minute)
                    if heating_value > cooling_value:
                        raise ValueError('Heating setpoint exceeds cooling setpoint in ' + zone.nameString())
    for system in model.getZoneHVACIdealLoadsAirSystems():
        if system.minimumCoolingSupplyAirTemperature() >= system.maximumHeatingSupplyAirTemperature():
            raise ValueError('Ideal Loads cooling supply limit must be below the heating supply limit')
    for manager in model.getSetpointManagerSingleZoneReheats():
        if manager.minimumSupplyAirTemperature() >= manager.maximumSupplyAirTemperature():
            raise ValueError('Minimum supply temperature must be below maximum supply temperature')
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
        expected[edit["id"]] = bindings(model)[edit['id']].data['value'] if control.data['field']=='thermalZone' and edit['value']=='__new__' else edit["value"]
    validate_model(model)
    # A later, explicit layer/R edit makes a local construction copy. Verify that
    # resolved assignment after reopening, not the former shared resource handle.
    final = bindings(model)
    for ident in expected:
        if final[ident].data['field'].endswith('construction'):
            expected[ident] = final[ident].data['value']
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
