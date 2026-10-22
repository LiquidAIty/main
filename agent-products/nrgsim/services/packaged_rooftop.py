"""Readback for the installed public MCP's bounded System 3 recipe."""
# Entity: Building HVAC
# Relationship: Validates one real packaged DX air loop and its served zone without implementing another HVAC recipe or compliance transformation.
from __future__ import annotations


def describe(model):
    zones=list(model.getThermalZones()); loops=list(model.getAirLoopHVACs())
    if len(zones)!=1 or len(model.getSpaces())!=1 or len(loops)!=1 or model.getPlantLoops():
        raise ValueError('Packaged test requires one Space, one zone, one air loop and no plant')
    zone,loop=zones[0],loops[0]
    if [str(z.handle()) for z in loop.thermalZones()] != [str(zone.handle())]:
        raise ValueError('The packaged air loop does not serve the selected zone')
    if model.getZoneHVACIdealLoadsAirSystems() or zone.useIdealAirLoads():
        raise ValueError('Duplicate Ideal Loads conditioning remains')
    fans=list(model.getFanConstantVolumes()); coolers=list(model.getCoilCoolingDXSingleSpeeds())
    gas=list(model.getCoilHeatingGass()); electric=list(model.getCoilHeatingElectrics())
    if len(fans)!=1 or len(coolers)!=1 or len(gas)+len(electric)!=1:
        raise ValueError('Packaged recipe component types differ from System 3')
    supply={str(o.handle()) for o in loop.supplyComponents()}
    nodes=[]
    for component in [fans[0],coolers[0],*(gas or electric)]:
        if str(component.handle()) not in supply or not component.inletModelObject().is_initialized() or not component.outletModelObject().is_initialized():
            raise ValueError('A fan or coil is disconnected')
        nodes.append(dict(handle=str(component.handle()),name=component.nameString(),type=component.iddObjectType().valueName(),
                          inlet=str(component.inletModelObject().get().handle()),outlet=str(component.outletModelObject().get().handle())))
    # SDK 3.11's deprecated Uncontrolled constructor actually creates the current
    # ConstantVolume:NoReheat object; verify the persisted IDD identity.
    if len(zone.equipment())!=1 or zone.equipment()[0].iddObjectType().valueName() != 'OS_AirTerminal_SingleDuct_ConstantVolume_NoReheat':
        raise ValueError('The served zone does not have exactly one expected terminal')
    thermostat=zone.thermostatSetpointDualSetpoint()
    oa=loop.airLoopHVACOutdoorAirSystem()
    if not thermostat.is_initialized() or not oa.is_initialized():
        raise ValueError('Thermostat or outdoor air system is missing')
    thermostat=thermostat.get(); controller=oa.get().getControllerOutdoorAir()
    if not thermostat.heatingSetpointTemperatureSchedule().is_initialized() or not thermostat.coolingSetpointTemperatureSchedule().is_initialized():
        raise ValueError('Thermostat schedules are missing')
    if len(model.getDesignDays())<2:
        raise ValueError('Heating and cooling sizing design days are required')
    sizing=model.getSizingParameters(); sim=model.getSimulationControl()
    if not sim.doZoneSizingCalculation() or not sim.doSystemSizingCalculation():
        raise ValueError('Zone and system sizing must be enabled')
    managers=[s for s in model.getSetpointManagerSingleZoneReheats() if s.controlZone().is_initialized() and s.controlZone().get().handle()==zone.handle()]
    if len(managers)!=1:
        raise ValueError('Single-zone supply setpoint manager is missing or ambiguous')
    order=[c.iddObjectType().valueName() for c in loop.supplyComponents() if c.iddObjectType().valueName()!='OS_Node']
    expected=['OS_AirLoopHVAC_OutdoorAirSystem','OS_Coil_Cooling_DX_SingleSpeed',
              'OS_Coil_Heating_Gas' if gas else 'OS_Coil_Heating_Electric','OS_Fan_ConstantVolume']
    heating_ratio=loop.sizingSystem().centralHeatingMaximumSystemAirFlowRatio()
    return dict(recipe='OpenStudio MCP 1.2.1 add_baseline_system, System 3; generic equipment, not Appendix G compliance',
                zoneHandle=str(zone.handle()),zone=zone.nameString(),airLoopHandle=str(loop.handle()),airLoop=loop.nameString(),
                heatingFuel='NaturalGas' if gas else 'Electricity',coolingFuel='Electricity',components=nodes,
                heatingSchedule=thermostat.heatingSetpointTemperatureSchedule().get().nameString(),
                coolingSchedule=thermostat.coolingSetpointTemperatureSchedule().get().nameString(),
                economizer=controller.getEconomizerControlType(),
                outdoorAir=[dict(space=s.nameString(),specification=str(s.designSpecificationOutdoorAir().get())) for s in zone.spaces() if s.designSpecificationOutdoorAir().is_initialized()],
                designDays=[d.nameString() for d in model.getDesignDays()],
                heatingSizingFactor=sizing.heatingSizingFactor(),coolingSizingFactor=sizing.coolingSizingFactor(),
                coolingCapacityAutosized=coolers[0].isRatedTotalCoolingCapacityAutosized(),
                heatingCapacityAutosized=(gas or electric)[0].isNominalCapacityAutosized(),
                coolingCOP=coolers[0].ratedCOP(),fanPressurePa=fans[0].pressureRise(),
                heatingDesignAirflowRatio=heating_ratio.get() if heating_ratio.is_initialized() else None,
                centralHeatingDesignSupplyTemperature=loop.sizingSystem().centralHeatingDesignSupplyAirTemperature(),
                zoneHeatingDesignSupplyTemperature=zone.sizingZone().zoneHeatingDesignSupplyAirTemperature(),
                fanEfficiency=fans[0].fanEfficiency(),idealLoads=0,supplyOrder=order,connectionOrderValid=order==expected,
                minimumSupplyTemperature=managers[0].minimumSupplyAirTemperature(),maximumSupplyTemperature=managers[0].maximumSupplyAirTemperature())


def reconcile_connections(model, supply_limits=None):
    """Correct the observed upstream inlet-insertion order using public SDK moves.

    No component is added, removed or replaced. The native recipe currently puts
    its OA mixer after both coils and the fan; the air must be mixed before it is conditioned.
    """
    before=describe(model)
    loop=model.getAirLoopHVACs()[0]
    if not before['connectionOrderValid']:
        for component in [model.getCoilCoolingDXSingleSpeeds()[0],*(list(model.getCoilHeatingGass()) or list(model.getCoilHeatingElectrics())),model.getFanConstantVolumes()[0]]:
            if not component.addToNode(loop.supplyOutletNode()):
                raise ValueError('Could not place the existing fan/coil after the outdoor air mixer')
    if supply_limits:
        manager=model.getSetpointManagerSingleZoneReheats()[0]
        if not manager.setMinimumSupplyAirTemperature(supply_limits[0]) or not manager.setMaximumSupplyAirTemperature(supply_limits[1]):
            raise ValueError('Could not retain the source shoebox supply temperature limits')
        # New System 3 only: the upstream generic SizingSystem defaults describe
        # partial-flow central heating, not this constant-volume/no-reheat loop.
        # Explicit existing-system reconciliations retain their user overrides.
        sizing=loop.sizingSystem(); zone=loop.thermalZones()[0]
        if (not sizing.setCentralHeatingMaximumSystemAirFlowRatio(1)
                or not sizing.setCentralHeatingDesignSupplyAirTemperature(zone.sizingZone().zoneHeatingDesignSupplyAirTemperature())
                or not sizing.setAllOutdoorAirinHeating(False) or not sizing.setAllOutdoorAirinCooling(False)):
            raise ValueError('Could not configure constant-volume heating sizing')
        model.getSimulationControl().setDoPlantSizingCalculation(False)
    after=describe(model)
    if not after['connectionOrderValid']:
        raise ValueError('The packaged air-loop component order is incorrect')
    return dict(before=before['supplyOrder'],after=after['supplyOrder'],supplyTemperatureLimits=supply_limits)
