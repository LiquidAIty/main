"""Public recipe and SDK contracts on disposable OSM copies."""
# Entity: Building HVAC
# Relationship: Tests packaged-system topology, real control readback and rejection of duplicate conditioning; live MCP/run evidence is separate.
import tempfile
import unittest
from pathlib import Path
import openstudio as os
from mcp_server.model_manager import load_model
from mcp_server.skills.loop_operations.operations import remove_zone_equipment
from mcp_server.skills.hvac_systems.operations import add_baseline_system
from packaged_rooftop import describe, reconcile_connections
from input_controls import apply_edits, bindings, verify_edits

ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'.local/projects/38bd1429-e8e1-47ff-afef-d940aa8e8040/inputs/baseline.osm'


class PackagedTests(unittest.TestCase):
    def test_recipe_controls_save_and_reopen(self):
        for fuel in ('NaturalGas','Electricity'):
            with self.subTest(fuel=fuel):
                model=load_model(BASE,False); zone=model.getThermalZones()[0]
                self.assertTrue(remove_zone_equipment(zone.nameString(),zone.equipment()[0].nameString())['ok'])
                self.assertTrue(add_baseline_system(3,[zone.nameString()],heating_fuel=fuel,system_name='Packaged rooftop DX')['ok'])
                self.assertFalse(describe(model)['connectionOrderValid'])
                reconcile_connections(model,[13,50])
                self.assertTrue(describe(model)['connectionOrderValid'])
                self.assertEqual(describe(model)['heatingFuel'],fuel)
                self.assertEqual(describe(model)['heatingDesignAirflowRatio'],1)
                self.assertEqual(describe(model)['centralHeatingDesignSupplyTemperature'],describe(model)['zoneHeatingDesignSupplyTemperature'])
                self.assertFalse(model.getSimulationControl().doPlantSizingCalculation())
                self.assertFalse(model.getAirLoopHVACs()[0].sizingSystem().allOutdoorAirinHeating())
                self.assertFalse(model.getAirLoopHVACs()[0].sizingSystem().allOutdoorAirinCooling())
                edits={'Rated cooling COP':3.5,'Fan pressure rise':300,'Fan efficiency':.75,'Heating sizing factor':1.2,'Cooling sizing factor':1.1,
                       'Size cooling for 100% outdoor air':False,'Size heating for 100% outdoor air':False,
                       'Heating design airflow ratio':1,'Central heating design supply temperature':40,
                       'Central cooling design supply temperature':13,'Zone heating design supply temperature':40,'Zone cooling design supply temperature':14}
                actual=[dict(id=next(c.data['id'] for c in bindings(model).values() if c.data['label']==label),value=value) for label,value in edits.items()]
                changed=apply_edits(model,actual)
                with tempfile.TemporaryDirectory(prefix='packaged-test-',dir=ROOT/'.local') as folder:
                    path=Path(folder)/'model.osm'; self.assertTrue(model.save(str(path),False))
                    reopened=os.model.Model.load(str(path)).get()
                    verify_edits(reopened,changed['expected']); self.assertEqual(describe(model),describe(reopened))
                invalid=next(c.data['id'] for c in bindings(model).values() if c.data['field']=='centralHeatingMaximumSystemAirFlowRatio')
                for value in (-.1,1.1,float('nan'),True):
                    with self.assertRaises(ValueError): apply_edits(model,[dict(id=invalid,value=value)])
                # Calling connection repair on an existing system does not replace
                # explicitly edited engineering sizing values.
                model.getAirLoopHVACs()[0].sizingSystem().setCentralHeatingDesignSupplyAirTemperature(42)
                reconcile_connections(model)
                self.assertEqual(model.getAirLoopHVACs()[0].sizingSystem().centralHeatingDesignSupplyAirTemperature(),42)
    def test_duplicate_conditioning_rejected(self):
        model=load_model(BASE,False); zone=model.getThermalZones()[0]
        self.assertTrue(add_baseline_system(3,[zone.nameString()],system_name='Packaged rooftop DX')['ok'])
        with self.assertRaisesRegex(ValueError,'Duplicate Ideal Loads'):
            describe(model)


if __name__=='__main__':
    unittest.main()
