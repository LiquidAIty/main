"""The owner's solar-shoebox boundary conditions and Office / No-PCM baseline."""
# Entity: Building Loads
# Relationship: This file reads the owner's Office/IMF inputs and assigns real OpenStudio schedules, loads, constructions and weather to a new candidate.

from __future__ import annotations

import hashlib
import re
from pathlib import Path

import openstudio as os


def source_fields(path: Path, object_type: str, name: str, substitutions: dict | None = None) -> list[str]:
    """Read one known simple archival IDF object, not a general IDF/IMF converter."""
    text = re.sub(r"!.*", "", path.read_text(encoding="utf-8-sig"))
    for token, value in (substitutions or {}).items():
        text = text.replace(token, str(value))
    matches = re.finditer(r"^\s*" + re.escape(object_type) + r"\s*,(.*?);", text, re.M | re.S | re.I)
    for match in matches:
        fields = [field.strip() for field in match.group(1).split(",")]
        if fields[0].casefold() == name.casefold():
            if any('"' in field or "@@" in field for field in fields):
                raise ValueError(f"Unsupported/unexpanded source object: {name}")
            return fields
    raise ValueError(f"Missing {object_type}: {name}")


def prepare_solar_shoebox(source: Path, destination: Path, legacy: Path, epw: Path, ddy: Path, *, conditioned: bool = True) -> dict:
    if destination.exists():
        raise FileExistsError(destination)
    loaded = os.model.Model.load(str(source))
    if not loaded.is_initialized():
        raise ValueError("Cannot load block OSM")
    model = loaded.get()
    if len(model.getSpaces()) != 1 or len(model.getThermalZones()) != 1:
        raise ValueError("The office recipe requires the single-zone block")
    space, zone = model.getSpaces()[0], model.getThermalZones()[0]
    if model.getPeoples() or model.getLightss() or model.getElectricEquipments():
        raise ValueError("Existing loads must not be duplicated")
    model.getBuilding().setName("Solar shoebox - Office - No PCM")
    base, office = legacy / "Base.imf", legacy / "include" / "Office.idf"
    materials = legacy / "include" / "MaterialsConstructions.idf"

    def checked(result, description):
        if result is False:
            raise ValueError(f"OpenStudio rejected {description}")

    def schedule(name: str, unit="Dimensionless"):
        values = source_fields(base, "Schedule:Compact", name,
                               {"@@HeatingSetPoint@@": 21, "@@CoolingSetPoint@@": 24})
        limits = os.model.ScheduleTypeLimits(model)
        limits.setName(name + " limits")
        limits.setNumericType("Continuous")
        if unit != "Temperature":
            limits.setLowerLimitValue(0)
        if unit == "Dimensionless":
            limits.setUpperLimitValue(1)
        checked(limits.setUnitType(unit), "schedule units")
        result = os.model.ScheduleCompact(model)
        result.setName(name)
        result.setScheduleTypeLimits(limits)
        for value in values[2:]:
            if value.lower().startswith("until "):
                value = "Until: " + value[6:]
            if result.pushExtensibleGroup([value]).numFields() != 1:
                raise ValueError("Schedule field was not accepted")
        return result

    people_source = source_fields(office, "People", "Office")
    people_definition = os.model.PeopleDefinition(model)
    people_definition.setName("Office people")
    people_definition.setSpaceFloorAreaperPerson(float(people_source[6]))
    people_definition.setFractionRadiant(float(people_source[7]))
    people_definition.setSensibleHeatFraction(float(people_source[8]))
    people = os.model.People(people_definition)
    people.setSpace(space)
    checked(people.setNumberofPeopleSchedule(schedule(people_source[2])), "occupancy schedule")
    checked(people.setActivityLevelSchedule(schedule(people_source[9], "ActivityLevel")), "activity schedule")

    lights_source = source_fields(office, "Lights", "Office")
    lights_definition = os.model.LightsDefinition(model)
    lights_definition.setName("Office lighting")
    lights_definition.setWattsperSpaceFloorArea(float(lights_source[5]))
    lights_definition.setReturnAirFraction(float(lights_source[7]))
    lights_definition.setFractionRadiant(float(lights_source[8]))
    lights_definition.setFractionVisible(float(lights_source[9]))
    lights = os.model.Lights(lights_definition)
    lights.setSpace(space)
    checked(lights.setSchedule(schedule(lights_source[2])), "lighting schedule")

    equipment_source = source_fields(office, "ElectricEquipment", "Office")
    equipment_definition = os.model.ElectricEquipmentDefinition(model)
    equipment_definition.setName("Office equipment")
    equipment_definition.setWattsperSpaceFloorArea(float(equipment_source[5]))
    equipment_definition.setFractionLatent(float(equipment_source[7]))
    equipment_definition.setFractionRadiant(float(equipment_source[8]))
    equipment_definition.setFractionLost(float(equipment_source[9]))
    equipment = os.model.ElectricEquipment(equipment_definition)
    equipment.setSpace(space)
    checked(equipment.setSchedule(schedule(equipment_source[2])), "equipment schedule")

    water_source = source_fields(office, "HotWaterEquipment", "Office")
    water_definition = os.model.HotWaterEquipmentDefinition(model)
    water_definition.setWattsperPerson(float(water_source[6]))
    water_definition.setFractionLatent(float(water_source[7]))
    water_definition.setFractionRadiant(float(water_source[8]))
    water_definition.setFractionLost(float(water_source[9]))
    water = os.model.HotWaterEquipment(water_definition)
    water.setSpace(space)
    checked(water.setSchedule(schedule(water_source[2])), "hot-water gain schedule")

    if conditioned:
        thermostat = os.model.ThermostatSetpointDualSetpoint(model)
        checked(thermostat.setHeatingSetpointTemperatureSchedule(schedule("Heating SP Sch", "Temperature")), "heating schedule")
        checked(thermostat.setCoolingSetpointTemperatureSchedule(schedule("Cooling SP Sch", "Temperature")), "cooling schedule")
        checked(zone.setThermostatSetpointDualSetpoint(thermostat), "zone thermostat")
    infiltration = os.model.SpaceInfiltrationDesignFlowRate(model)
    infiltration.setSpace(space)
    infiltration.setAirChangesperHour(0.35)  # project.jep's first infiltration option
    checked(infiltration.setSchedule(schedule("INFIL_SCH_PNNL")), "infiltration schedule")
    infiltration.setConstantTermCoefficient(0)
    infiltration.setTemperatureTermCoefficient(0)
    infiltration.setVelocityTermCoefficient(0.224)
    infiltration.setVelocitySquaredTermCoefficient(0)
    outside_air = os.model.DesignSpecificationOutdoorAir(model)
    outdoor_source = source_fields(base, "DesignSpecification:OutdoorAir", "SZ DSOA")
    outside_air.setOutdoorAirMethod(outdoor_source[1])
    outside_air.setOutdoorAirFlowperPerson(float(outdoor_source[2]))
    outside_air.setOutdoorAirFlowperFloorArea(float(outdoor_source[3]))
    outside_air.setOutdoorAirFlowRate(float(outdoor_source[4]))
    space.setDesignSpecificationOutdoorAir(outside_air)
    if conditioned:
        ideal = os.model.ZoneHVACIdealLoadsAirSystem(model)
        ideal.setName("Solar shoebox ideal loads")
        for method, value in {
            "setHeatingLimit": "NoLimit", "setCoolingLimit": "NoLimit",
            "setMaximumHeatingSupplyAirTemperature": 50.0, "setMinimumCoolingSupplyAirTemperature": 13.0,
            "setMaximumHeatingSupplyAirHumidityRatio": 0.0156, "setMinimumCoolingSupplyAirHumidityRatio": 0.0077,
            "setDehumidificationControlType": "ConstantSensibleHeatRatio", "setCoolingSensibleHeatRatio": 0.7,
            "setHumidificationControlType": "None", "setDemandControlledVentilationType": "None",
            "setOutdoorAirEconomizerType": "NoEconomizer", "setHeatRecoveryType": "Sensible",
            "setSensibleHeatRecoveryEffectiveness": 0.7, "setLatentHeatRecoveryEffectiveness": 0.65,
        }.items():
            checked(getattr(ideal, method)(value), method)
        checked(ideal.setDesignSpecificationOutdoorAirObject(outside_air), "ideal-loads outdoor air")
        checked(ideal.addToThermalZone(zone), "ideal-loads zone assignment")

    def opaque(name):
        values = source_fields(materials, "Material", name)
        item = os.model.StandardOpaqueMaterial(model, values[1], *map(float, values[2:6]))
        item.setName(name)
        item.setThermalAbsorptance(float(values[6]))
        item.setSolarAbsorptance(float(values[7]))
        item.setVisibleAbsorptance(float(values[8]))
        return item

    def construction(name, layers):
        result = os.model.Construction(model)
        result.setName(name)
        checked(result.setLayers(os.model.MaterialVector(layers)), name)
        return result

    insulation = os.model.MasslessOpaqueMaterial(model, "Rough", 2.0)
    insulation.setName("Wall_Insulation R2")
    gap = os.model.AirGap(model)
    gap.setThermalResistance(0.15)
    gypsum = opaque("Gypsum Board")
    wall = construction("SteelFramed - No PCM", [opaque("OutdoorWall_Stucco"), insulation, gap, gypsum])
    partition = construction("Project partition", [gypsum])
    ceiling = construction("Project internal Ceiling", [opaque("CeilingTiles")])
    floor = construction("Project internal floor", [opaque("FloorTile")])
    glazing_values = source_fields(materials, "WindowMaterial:SimpleGlazingSystem", "DoublePaneClearWindows")
    glazing = os.model.SimpleGlazing(model)
    glazing.setUFactor(float(glazing_values[1]))
    glazing.setSolarHeatGainCoefficient(float(glazing_values[2]))
    glazing.setVisibleTransmittance(float(glazing_values[3]))
    window = construction("GenericWindow", [glazing])
    for surface in space.surfaces():
        external = surface.surfaceType() == "Wall" and surface.outwardNormal().y() < -0.99
        checked(surface.setOutsideBoundaryCondition("Outdoors" if external else "Adiabatic"), "boundary condition")
        surface.setSunExposure("SunExposed" if external else "NoSun")
        surface.setWindExposure("WindExposed" if external else "NoWind")
        assembly = wall if external else {"Wall": partition, "RoofCeiling": ceiling, "Floor": floor}[surface.surfaceType()]
        checked(surface.setConstruction(assembly), "surface construction")
        for opening in surface.subSurfaces():
            checked(opening.setConstruction(window), "window construction")
    model.getSiteGroundTemperatureBuildingSurface().setAllMonthlyTemperatures([18.0] * 12)
    weather = os.EpwFile(str(epw))
    os.model.WeatherFile.setWeatherFile(model, weather)
    site = model.getSite()
    site.setLatitude(weather.latitude())
    site.setLongitude(weather.longitude())
    site.setTimeZone(weather.timeZone())
    site.setElevation(weather.elevation())
    design_model = os.energyplus.loadAndTranslateIdf(str(ddy)).get()
    design_days = [day for day in design_model.getDesignDays()
                   if "Htg 99.6% Condns DB" in day.nameString() or "Clg .4% Condns DB=>MWB" in day.nameString()]
    if len(design_days) != 2:
        raise ValueError("Expected matching heating/cooling design days")
    for day in design_days:
        day.clone(model)
    model.getYearDescription().setCalendarYear(2025)
    model.getTimestep().setNumberOfTimestepsPerHour(6)
    control = model.getSimulationControl()
    control.setDoZoneSizingCalculation(conditioned)
    control.setDoSystemSizingCalculation(False)
    control.setDoPlantSizingCalculation(False)
    control.setRunSimulationforSizingPeriods(False)
    control.setRunSimulationforWeatherFileRunPeriods(True)
    period = model.getRunPeriod()
    period.setBeginMonth(1)
    period.setBeginDayOfMonth(1)
    period.setEndMonth(12)
    period.setEndDayOfMonth(31)
    model.getOutputControlTableStyle().setColumnSeparator("HTML")
    model.getOutputControlTableStyle().setUnitConversion("JtoKWH")
    model.getOutputTableSummaryReports().addSummaryReport("AllSummary")
    model.getOutputSQLite().setOptionType("SimpleAndTabular")
    temperature = os.model.OutputVariable("Zone Mean Air Temperature", model)
    temperature.setReportingFrequency("Hourly")
    for variable in ("Zone Ideal Loads Supply Air Total Heating Energy", "Zone Ideal Loads Supply Air Total Cooling Energy"):
        if conditioned:
            os.model.OutputVariable(variable, model).setReportingFrequency("Hourly")
    if not model.save(str(destination), False):
        raise RuntimeError("Could not save office candidate")
    return {
        "sourceHashes": {str(path): hashlib.sha256(path.read_bytes()).hexdigest() for path in (source, base, office, materials, epw, ddy)},
        "peopleArea_m2": float(people_source[6]), "lighting_W_m2": float(lights_source[5]),
        "equipment_W_m2": float(equipment_source[5]), "infiltration_ACH": 0.35,
        "conditioning": "ideal-loads" if conditioned else "free-floating",
        "boundaryConditions": "One exposed south facade; five adiabatic surfaces, as in Geometry.idf",
        "additionalAssumptions": {"calendarYear": 2025, "timestepMinutes": 10,
            "windowGeometry": "Existing 40% WWR MCP window, not the original IMF aspect-ratio formula",
            "scope": "Unshaded No-PCM baseline; no thermal-comfort models; hot-water equipment is the legacy internal gain, not a water-heater plant",
            "passive": "No active HVAC or automatic natural-ventilation addition when free-floating"},
    }
