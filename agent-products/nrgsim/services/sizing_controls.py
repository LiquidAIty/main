"""Weather-file extreme sizing periods through the version-matched OpenStudio objects."""
# Entity: Building Modeling
# Relationship: Exposes EPW-defined sizing weeks as real inspector/MCP inputs while retaining existing design days and other sizing periods.
import csv
import json
import hashlib
import shutil
from datetime import date
from pathlib import Path
import openstudio as os


def saved_period_fields(model):
    return [[item.nameString()]+[item.getString(index,True).get() for index in range(2,6)]
            for item in model.getWeatherFileConditionTypes()]


def prepare_weather_workflow(model, frozen, weather, root, operation_id):
    """Package the owned EnergyPlus measure through SDK metadata; keep the normal MCP OSW runner."""
    periods=saved_period_fields(model)
    if not periods: return None
    source=Path(__file__).with_name('weather_sizing_measure.py')
    source_hash=hashlib.sha256(source.read_bytes()).hexdigest()
    measure_dir=root/'measures'/('apply_weather_sizing_'+source_hash[:16])
    if not measure_dir.exists():
        metadata=os.BCLMeasure('Apply saved weather sizing periods','ApplyWeatherSizing',os.path(str(measure_dir)),
            'Whole Building.Space Types',os.MeasureType('EnergyPlusMeasure'),
            'Translate exact saved OSM weather-sizing fields.', 'SDK 3.11 translation extension.',os.MeasureLanguage('Python'))
        shutil.copy2(source,measure_dir/'measure.py')
        metadata.checkForUpdatesFiles(); metadata.save()
    else:
        if hashlib.sha256((measure_dir/'measure.py').read_bytes()).hexdigest()!=source_hash:
            raise ValueError('Frozen weather-sizing measure package was modified')
    bundle=root/'inputs'/('weather-sizing-'+operation_id)
    bundle.mkdir()
    shutil.copy2(frozen,bundle/'model.osm')
    shutil.copy2(weather,bundle/'weather.epw')
    shutil.copytree(measure_dir,bundle/'measures'/measure_dir.name)
    workflow=bundle/'in.osw'
    workflow.write_text(json.dumps(dict(seed_file='model.osm',weather_file='weather.epw',measure_paths=['measures'],
        steps=[dict(measure_dir_name=measure_dir.name,arguments=dict(periods=json.dumps(periods)))]),indent=2),encoding='utf-8')
    return workflow


def verify_translated_periods(model, idf_path):
    loaded=os.IdfFile.load(os.path(str(idf_path)),os.IddFileType('EnergyPlus'))
    if not loaded.is_initialized(): raise ValueError('Could not read translated EnergyPlus input')
    actual=[[item.getString(i,True).get() for i in range(5)]
            for item in loaded.get().getObjectsByType(os.IddObjectType('SizingPeriod_WeatherFileConditionType'))]
    expected=saved_period_fields(model)
    if len({fields[0] for fields in actual})!=len(actual) or sorted(actual)!=sorted(expected):
        raise ValueError('Saved OSM weather periods did not reach the actual EnergyPlus input')
    return actual


def extreme_periods(model):
    weather = model.weatherFile()
    year = model.getYearDescription().calendarYear()
    if not weather.is_initialized() or not weather.get().path().is_initialized() or not year.is_initialized():
        return {}
    with Path(str(weather.get().path().get())).open(encoding='utf-8-sig',newline='') as stream:
        reader=csv.reader(stream)
        header=next((row for _,row in zip(range(8),reader) if row and row[0].strip().upper()=='TYPICAL/EXTREME PERIODS'),None)
    if header is None: return {}
    result={}
    for index in range(int(header[1])):
        description,kind,start,end=[value.strip() for value in header[2+4*index:6+4*index]]
        for season in ('Summer','Winter'):
            if description.startswith(season) and kind=='Extreme':
                month,day=map(int,start.split('/'))
                weekday=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'][date(year.get(),month,day).weekday()]
                result[season+'Extreme']=dict(description=description,start=start,end=end,weekday=weekday)
    return result


def publish_weather_sizing(model, field, scopes):
    available=extreme_periods(model)
    required={'SummerExtreme','WinterExtreme'}
    if not required.issubset(available): return
    def chosen():
        return {item.getString(2).get():item for item in model.getWeatherFileConditionTypes() if item.getString(2).is_initialized()}
    def configure(enabled):
        existing=chosen()
        if not enabled:
            for item in list(model.getWeatherFileConditionTypes()):
                if item.getString(2).is_initialized() and item.getString(2).get() in required:
                    item.remove()
            return
        for kind in sorted(required):
            if kind in existing: continue
            item=os.model.WeatherFileConditionType(model)
            item.setName('EPW '+kind)
            # OpenStudio 3.11 dictionary: Handle, Name, Period Selection, Start Day,
            # Weather DST, Weather Rain/Snow. No untyped arbitrary field writes.
            for index,value in ((2,kind),(3,available[kind]['weekday']),(4,'No'),(5,'Yes')):
                if not item.setString(index,value): raise ValueError('OpenStudio rejected the weather sizing field')
    simulation=model.getSimulationControl()
    field(simulation,'weatherExtremes','Include EPW extreme weeks in sizing','simulation','Sizing weather',scopes,
          lambda:required.issubset(chosen()),configure,boolean=True)
    for kind,item in chosen().items():
        if kind not in available: continue
        group=kind+' · '+available[kind]['start']+'–'+available[kind]['end']
        for index,label in ((3,'Sizing start day'),(4,'Use weather daylight saving'),(5,'Use weather rain and snow')):
            choices=[key.name() for key in item.iddObject().getField(index).get().keys()]
            def set_value(value,item=item,index=index):
                if not item.setString(index,value): raise ValueError('OpenStudio rejected the weather sizing field')
            field(item,'weatherField.'+str(index),label,'simulation',group,scopes,
                  lambda item=item,index=index:item.getString(index,True).get(),set_value,choices=choices)
