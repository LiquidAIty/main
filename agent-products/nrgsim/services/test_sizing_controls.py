"""Real native sizing objects, translations and immutable original design days."""
# Entity: Building Modeling
# Relationship: Verifies the weather-sizing inspector creates only EPW-defined periods, round-trips them and retains design-day inputs.
import tempfile
import unittest
from pathlib import Path
import openstudio as os
from input_controls import bindings,apply_edits,verify_edits
from sizing_controls import extreme_periods
from sizing_controls import publish_weather_sizing, saved_period_fields, prepare_weather_workflow, verify_translated_periods
from weather_sizing_measure import ApplyWeatherSizing
import json

ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'.local/projects/38bd1429-e8e1-47ff-afef-d940aa8e8040/inputs/case_378bae5d0090.osm'


class SizingTests(unittest.TestCase):
    def test_weather_extremes_save_reopen_translate_and_remove_without_losing_design_days(self):
        model=os.model.Model.load(str(SOURCE)).get()
        days={str(day.handle()):str(day) for day in model.getDesignDays()}
        available=extreme_periods(model)
        self.assertEqual(available['SummerExtreme']['start'],'7/13')
        self.assertEqual(available['WinterExtreme']['start'],'1/27')
        # Test the control's actual setter without claiming that the
        # stock SDK forward translator supports the class.
        controls={}
        def field(owner,key,label,tab,group,scopes,getter,setter,*args,**kwargs): controls[key]=(getter,setter)
        publish_weather_sizing(model,field,[])
        controls['weatherExtremes'][1](True)
        with tempfile.TemporaryDirectory(dir=ROOT/'.local') as folder:
            path=Path(folder)/'sizing.osm'; self.assertTrue(model.save(str(path),False))
            reopened=os.model.Model.load(str(path)).get()
            self.assertEqual(days,{str(day.handle()):str(day) for day in reopened.getDesignDays()})
            self.assertEqual(len(reopened.getWeatherFileConditionTypes()),2)
            translated=os.energyplus.ForwardTranslator().translateModel(reopened)
            periods=translated.getObjectsByType(os.IddObjectType('SizingPeriod_WeatherFileConditionType'))
            self.assertEqual(len(periods),0)  # Retained, explicit SDK 3.11 gap.
            measure=ApplyWeatherSizing(); runner=os.measure.OSRunner(os.WorkflowJSON())
            arguments=os.measure.convertOSArgumentVectorToMap(measure.arguments(translated))
            value=arguments['periods'].clone(); value.setValue(json.dumps(saved_period_fields(reopened))); arguments['periods']=value
            self.assertTrue(measure.run(translated,runner,arguments))
            periods=translated.getObjectsByType(os.IddObjectType('SizingPeriod_WeatherFileConditionType'))
            self.assertEqual({p.getString(1).get() for p in periods},{'SummerExtreme','WinterExtreme'})
            native=Path(folder)/'in.idf'; self.assertTrue(translated.save(os.path(str(native)),True))
            self.assertEqual(sorted(verify_translated_periods(reopened,native)),sorted(saved_period_fields(reopened)))
            extra=os.IdfObject(os.IddObjectType('SizingPeriod_WeatherFileConditionType'))
            for index,value in enumerate(['Extra','SummerTypical','Monday','No','Yes']): extra.setString(index,value)
            translated.addObject(extra); translated.save(os.path(str(native)),True)
            with self.assertRaisesRegex(ValueError,'did not reach'):
                verify_translated_periods(reopened,native)
            root=Path(folder)/'project'; root.mkdir(); (root/'inputs').mkdir(); (root/'measures').mkdir()
            weather=Path(str(reopened.weatherFile().get().path().get()))
            workflow=prepare_weather_workflow(reopened,path,weather,root,'test-operation')
            manifest=json.loads(workflow.read_text())
            self.assertEqual(manifest['seed_file'],'model.osm')
            self.assertEqual(manifest['measure_paths'],['measures'])
            self.assertEqual((workflow.parent/'model.osm').read_bytes(),path.read_bytes())
            self.assertEqual((workflow.parent/'weather.epw').read_bytes(),weather.read_bytes())
            package=workflow.parent/'measures'/manifest['steps'][0]['measure_dir_name']
            self.assertTrue((package/'measure.xml').is_file())
            self.assertEqual((package/'measure.py').read_bytes(),Path(__file__).with_name('weather_sizing_measure.py').read_bytes())
            publish_weather_sizing(reopened,field,[])
            controls['weatherExtremes'][1](True)
            self.assertEqual(len(reopened.getWeatherFileConditionTypes()),2)
            controls['weatherExtremes'][1](False)
            self.assertFalse(reopened.getWeatherFileConditionTypes())
            self.assertEqual(days,{str(day.handle()):str(day) for day in reopened.getDesignDays()})


if __name__=='__main__': unittest.main()
