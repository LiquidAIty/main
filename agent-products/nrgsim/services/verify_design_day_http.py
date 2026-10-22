"""One new, explicit design-day sizing case through the human/agent Project owner."""
# Entity: Building HVAC
# Relationship: Retains unchanged reference cases and proves inspector edits, native sizing environments, annual diagnostics and exact comparison identities.
import hashlib
import json
import sqlite3
from contextlib import closing
from pathlib import Path
import httpx
import openstudio as os

ROOT=Path(__file__).resolve().parents[1]
PROJECT='38bd1429-e8e1-47ff-afef-d940aa8e8040'
DATA=ROOT/'.local/projects'/PROJECT
SOURCE='case_25171184f646'
BASELINE='case_378bae5d0090'
EVIDENCE=ROOT/'.local/design-day-verification.json'
URL='http://127.0.0.1:4000/api/nrgsim/projects/'+PROJECT
EDITS={'weatherExtremes':False,'centralHeatingMaximumSystemAirFlowRatio':1,
       'centralHeatingDesignSupplyAirTemperature':40,'doPlantSizingCalculation':False,
       'runSimulationforSizingPeriods':True}


def digest(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def inspect_native(run):
    model=os.model.Model.load(str(run['model'])).get()
    system=model.getAirLoopHVACs()[0].sizingSystem(); sim=model.getSimulationControl()
    assert system.centralHeatingMaximumSystemAirFlowRatio().get()==1
    assert system.centralHeatingDesignSupplyAirTemperature()==40
    assert not model.getWeatherFileConditionTypes()
    assert sim.doZoneSizingCalculation() and sim.doSystemSizingCalculation()
    assert not sim.doPlantSizingCalculation()
    assert sim.runSimulationforSizingPeriods() and sim.runSimulationforWeatherFileRunPeriods()
    path=Path(run['sql']).with_name('in.idf')
    native=os.IdfFile.load(os.path(str(path)),os.IddFileType('EnergyPlus')).get()
    def objects(kind): return list(native.getObjectsByType(os.IddObjectType(kind)))
    sizing=objects('Sizing_System')[0]
    assert sizing.getDouble(3).get()==1 and sizing.getDouble(9).get()==40
    assert not objects('SizingPeriod_WeatherFileConditionType')
    control=objects('SimulationControl')[0]
    assert [control.getString(i,True).get() for i in range(5)]==['Yes','Yes','No','Yes','Yes']
    design_days=objects('SizingPeriod_DesignDay')
    expected={'Chicago Ohare Intl Ap Ann Htg 99.6% Condns DB':-20,
              'Chicago Ohare Intl Ap Ann Clg .4% Condns DB=>MWB':33.3}
    assert {day.nameString():day.getDouble(4).get() for day in design_days}==expected
    with closing(sqlite3.connect(Path(run['sql']).resolve().as_uri()+'?mode=ro',uri=True)) as db:
        db.row_factory=sqlite3.Row
        environments=[dict(row) for row in db.execute('SELECT * FROM EnvironmentPeriods')]
        assert sum(row['EnvironmentType']==1 for row in environments)==2
        assert sum(row['EnvironmentType']==3 for row in environments)==1
        sizing_tables={table:[dict(row) for row in db.execute('SELECT * FROM '+table)] for table in ('ComponentSizes','SystemSizes','ZoneSizes')}
        unmet=[dict(row) for row in db.execute('''SELECT d.Name,d.KeyValue,d.Units,SUM(r.Value) AS Total
            FROM ReportData r JOIN ReportDataDictionary d USING(ReportDataDictionaryIndex)
            JOIN Time t USING(TimeIndex) JOIN EnvironmentPeriods e USING(EnvironmentPeriodIndex)
            WHERE e.EnvironmentType=3 AND t.WarmupFlag=0 AND d.ReportingFrequency='Hourly'
            AND d.Name IN ('Zone Heating Setpoint Not Met While Occupied Time','Zone Cooling Setpoint Not Met While Occupied Time')
            GROUP BY d.Name,d.KeyValue,d.Units''')]
        assert len(unmet)==2 and all(item['Units']=='hr' for item in unmet)
    err=path.with_name('eplusout.err').read_text(errors='replace')
    return dict(environments=environments,sizing=sizing_tables,unmet=unmet,
        frostWarningPresent='possibility of frost/freeze' in err,
        nativeEnd=path.with_name('eplusout.end').read_text(),idfHash=digest(path))


def main():
    proof=json.loads(EVIDENCE.read_text()) if EVIDENCE.exists() else dict(requests=[])
    def save(): EVIDENCE.write_text(json.dumps(proof,indent=2,allow_nan=False),encoding='utf-8')
    def request(payload):
        with httpx.Client(timeout=httpx.Timeout(950,connect=10)) as client: response=client.post(URL,json=payload)
        proof['requests'].append(dict(input=payload,status=response.status_code)); save()
        if not response.is_success:
            proof['failure']=response.text; save(); response.raise_for_status()
        print(json.dumps(dict(operation=payload['operation'],status=response.status_code)),flush=True)
        return response.json()
    if 'preserved' not in proof:
        paths=list((DATA/'inputs').glob('*.osm'))+list((DATA/'runs').glob('*/run/eplusout.sql'))
        proof['preserved']={str(path):digest(path) for path in paths}; save()
    state=request(dict(operation='state'))
    if 'caseId' not in proof:
        original=next(item for item in state['cases'] if item['id']==SOURCE)
        state=request(dict(operation='create_case',sourceCaseId=SOURCE,revision=original['revision'],
                           name='Office — PSZ corrected design-day sizing',layout='copy'))
        proof['caseId']=state['createdCaseId']; save()
    ident=proof['caseId']; case=next(item for item in state['cases'] if item['id']==ident)
    pending=[dict(id=item['id'],value=EDITS[item['field']]) for item in case['controls'] if item['field'] in EDITS and item['value']!=EDITS[item['field']]]
    assert {item['field'] for item in case['controls'] if item['field'] in EDITS}==set(EDITS)
    if pending:
        state=request(dict(operation='edit_inputs',caseId=ident,revision=case['revision'],edits=pending))
        case=next(item for item in state['cases'] if item['id']==ident)
    proof['readback']={item['field']:dict(id=item['id'],value=item['value'],units=item['units'],scopes=item['scopes'])
                       for item in case['controls'] if item['field'] in EDITS}
    assert all(proof['readback'][key]['value']==value for key,value in EDITS.items())
    proof['revision']=case['revision']; save()
    if not case['resultsCurrent']:
        if proof.get('runAttempted'): raise RuntimeError('Prior run outcome needs reconciliation, not an automatic retry')
        proof['runAttempted']=True; save()
        state=request(dict(operation='run',caseId=ident,revision=case['revision']))
        case=next(item for item in state['cases'] if item['id']==ident)
    proof['run']=case['run']; save()
    proof['native']=inspect_native(case['run']); save()
    baseline=next(item for item in state['cases'] if item['id']==BASELINE)
    channel=next(item for item in baseline['run']['channels'] if item['name']=='Zone Mean Air Temperature' and item['frequency']=='Hourly')
    comparison=request(dict(operation='compare',cases=[BASELINE,ident],baselineCaseId=BASELINE,
        runIds={BASELINE:baseline['run']['runId'],ident:case['run']['runId']},channel=channel['id']))
    assert len(comparison['rows'])==8760 and all(item['missing']==0 for item in comparison['cases'])
    comparison_path=ROOT/'.local/design-day-comparison.json'
    comparison_path.write_text(json.dumps(comparison,indent=2),encoding='utf-8')
    proof['comparison']=str(comparison_path)
    assert all(digest(path)==expected for path,expected in proof['preserved'].items())
    combined=sum(item['Total'] for item in proof['native']['unmet'])
    # This is Jeremiah's stated checkpoint criterion, not a universal compliance test.
    proof['technicalAcceptance']=dict(criterion='Owner checkpoint: combined occupied unmet <= 300 h and zero severe errors',
        combinedUnmetHours=combined,passed=combined<=300 and '0 Severe Errors' in proof['native']['nativeEnd'])
    proof['preservationPassed']=True
    proof['status']='technical_pass_with_retained_warnings' if proof['technicalAcceptance']['passed'] else 'executed_below_checkpoint_requirements'
    save()
    print(json.dumps(dict(caseId=ident,runId=case['run']['runId'],native=proof['native']['nativeEnd'],unmet=proof['native']['unmet'])),flush=True)


if __name__=='__main__': main()
