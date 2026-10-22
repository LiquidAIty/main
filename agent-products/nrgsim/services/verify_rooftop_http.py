"""Bounded real MCP and EnergyPlus packaged-system acceptance."""
# Entity: Building HVAC
# Relationship: Tests System 3 on a separately named shoebox copy and retains exact loaded-route, model and simulation evidence.
import json
import urllib.request
import urllib.error
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'.local/rooftop-http-verification.json'
URL='http://127.0.0.1:4000/api/nrgsim/projects/38bd1429-e8e1-47ff-afef-d940aa8e8040'


def main():
    evidence=json.loads(OUT.read_text()) if OUT.exists() else dict(requests=[])
    if evidence.get('run'):
        evidence.setdefault('priorRuns',{})[evidence['run']['runId']]=evidence['run']
    if 'error' in evidence:
        evidence.setdefault('priorFailures',[]).append(evidence.pop('error'))
    evidence['status']='running'
    def publish():
        OUT.write_text(json.dumps(evidence,indent=2,allow_nan=False),encoding='utf-8')
    def request(payload):
        req=urllib.request.Request(URL,data=json.dumps(payload).encode(),headers={'Content-Type':'application/json','Origin':'http://127.0.0.1:5173'})
        try:
            with urllib.request.urlopen(req,timeout=940) as response:
                data=json.load(response); status=response.status
        except urllib.error.HTTPError as error:
            status=error.code; data=json.load(error)
        evidence['requests'].append(dict(input=payload,status=status)); publish()
        print(json.dumps(dict(operation=payload['operation'],status=status)),flush=True)
        if status!=200:
            raise ValueError(data)
        return data
    try:
        state=request(dict(operation='state')); baseline=next(c for c in state['cases'] if c['id']=='baseline')
        evidence.setdefault('baselineRevision',baseline['revision'])
        if 'caseId' not in evidence:
            state=request(dict(operation='create_case',sourceCaseId='baseline',revision=baseline['revision'],name='Shoebox — packaged rooftop DX / gas',layout='copy'))
            evidence['caseId']=state['createdCaseId']; publish()
        case=next(c for c in state['cases'] if c['id']==evidence['caseId'])
        if not case.get('rooftop') or not case['rooftop'].get('connectionOrderValid'):
            state=request(dict(operation='packaged_rooftop',caseId=case['id'],revision=case['revision'],zoneHandle=case['geometry']['spaces'][0]['thermalZoneHandle'],heatingFuel='NaturalGas',economizer=True))
            case=next(c for c in state['cases'] if c['id']==case['id'])
        # Retain the original shoebox's actual supply limits, not the recipe's
        # unbounded -99/99 C defaults. Exercise the same published controls.
        import openstudio as os
        source=os.model.Model.load(str(ROOT/'.local/projects/38bd1429-e8e1-47ff-afef-d940aa8e8040/inputs/baseline.osm')).get()
        ideal=source.getZoneHVACIdealLoadsAirSystems()[0]
        limits={'Minimum supply temperature':ideal.minimumCoolingSupplyAirTemperature(),
                'Maximum supply temperature':ideal.maximumHeatingSupplyAirTemperature()}
        # This System 3 test is recirculating, not a 100%-outdoor-air system.
        limits.update({'Size cooling for 100% outdoor air':False,'Size heating for 100% outdoor air':False})
        edits=[dict(id=control['id'],value=limits[control['label']]) for control in case['controls'] if control['label'] in limits and control['value']!=limits[control['label']]]
        if edits:
            state=request(dict(operation='edit_inputs',caseId=case['id'],revision=case['revision'],edits=edits))
            case=next(c for c in state['cases'] if c['id']==case['id'])
        evidence['supplyLimitsFromBaseline']=limits
        evidence['system']=case['rooftop']; publish()
        if not case['resultsCurrent']:
            state=request(dict(operation='run',caseId=case['id'],revision=case['revision']))
            case=next(c for c in state['cases'] if c['id']==case['id'])
        evidence['run']=case['run']; publish()
        assert case['rooftop']['idealLoads']==0
        assert case['rooftop']['connectionOrderValid']
        assert '0 Severe Errors' in case['run']['nativeEnd']
        assert all(not c['name'].startswith('Zone Ideal Loads ') for c in case['run']['channels'])
        assert any(c['name']=='Electricity:Facility' for c in case['run']['channels'])
        assert any(c['name']=='NaturalGas:Facility' for c in case['run']['channels'])
        assert next(c for c in state['cases'] if c['id']=='baseline')['revision']==evidence['baselineRevision']
        native_err=Path(case['run']['sql']).with_name('eplusout.err').read_text(errors='replace')
        issues=[text for text in ('Low condenser dry-bulb temperature error continues','possibility of frost/freeze error continues') if text in native_err]
        evidence['physicsIssues']=issues
        evidence['status']='executed_with_physics_warnings' if issues else 'passed'
    except BaseException as error:
        evidence.update(status='failed',error=str(error)); raise
    finally:
        publish()


if __name__=='__main__':
    main()
