"""One new HVAC feature case; never reruns or alters its retained source case."""
# Entity: Building Simulation
# Relationship: Exercises the real inspector transaction and MCP OSW run with EPW-defined sizing periods and actual node/coil diagnostic requests.
import json
import hashlib
import argparse
from pathlib import Path
import httpx

ROOT=Path(__file__).resolve().parents[1]
PROJECT='38bd1429-e8e1-47ff-afef-d940aa8e8040'
SOURCE='case_378bae5d0090'
DATA=ROOT/'.local/projects'/PROJECT
EVIDENCE=ROOT/'.local/weather-sizing-verification.json'
URL='http://127.0.0.1:4000/api/nrgsim/projects/'+PROJECT
DIAGNOSTICS=['System Node Temperature','System Node Mass Flow Rate','Cooling Coil Total Cooling Rate',
    'Cooling Coil Runtime Fraction','Heating Coil Heating Rate','Heating Coil Runtime Fraction',
    'Air System Outdoor Air Economizer Status','Air System Outdoor Air Flow Fraction','Air System Outdoor Air Mass Flow Rate']


def main():
    proof=json.loads(EVIDENCE.read_text()) if EVIDENCE.exists() else dict(sourceCaseId=SOURCE,requests=[])
    def save(): EVIDENCE.write_text(json.dumps(proof,indent=2),encoding='utf-8')
    def request(payload):
        with httpx.Client(timeout=httpx.Timeout(950,connect=10)) as client:
            response=client.post(URL,json=payload)
        proof['requests'].append(dict(input=payload,status=response.status_code)); save()
        if not response.is_success:
            proof['error']=response.text; save(); response.raise_for_status()
        return response.json()
    source=DATA/'inputs'/(SOURCE+'.osm')
    proof.setdefault('sourceSha256',hashlib.sha256(source.read_bytes()).hexdigest()); save()
    state=request(dict(operation='state'))
    if 'caseId' not in proof:
        original=next(item for item in state['cases'] if item['id']==SOURCE)
        state=request(dict(operation='create_case',sourceCaseId=SOURCE,revision=original['revision'],name='Office — PSZ weather-extreme sizing',layout='copy'))
        proof['caseId']=state['createdCaseId']; save()
    ident=proof['caseId']; case=next(item for item in state['cases'] if item['id']==ident)
    if not proof.get('prepared'):
        control=next(item for item in case['controls'] if item['field']=='weatherExtremes')
        if control['value'] is not True:
            state=request(dict(operation='edit_inputs',caseId=ident,revision=case['revision'],edits=[dict(id=control['id'],value=True)]))
        case=next(item for item in state['cases'] if item['id']==ident)
        outputs=[item for item in case['requestedOutputs'] if item['name'] not in DIAGNOSTICS]
        outputs += [dict(name=name,key='*',frequency='Timestep') for name in DIAGNOSTICS]
        if sorted((v['name'],v['key'],v['frequency']) for v in case['requestedOutputs']) != sorted((v['name'],v['key'],v['frequency']) for v in outputs):
            state=request(dict(operation='outputs',caseId=ident,revision=case['revision'],outputs=outputs))
        case=next(item for item in state['cases'] if item['id']==ident)
        proof.update(prepared=True,revision=case['revision']); save()
        print(json.dumps(dict(caseId=ident,status='prepared',revision=case['revision'])),flush=True)
    if not case['resultsCurrent']:
        if proof.get('runAttempted'): raise RuntimeError('Prior run attempt needs evidence review; no automatic duplicate run')
        proof['runAttempted']=True; save()
        state=request(dict(operation='run',caseId=ident,revision=case['revision']))
        case=next(item for item in state['cases'] if item['id']==ident)
    proof['run']=case['run']; proof['sourcePreserved']=hashlib.sha256(source.read_bytes()).hexdigest()==proof['sourceSha256']
    proof['status']='executed_pending_physics_review'; save()
    assert proof['sourcePreserved']
    print(json.dumps(dict(caseId=ident,runId=case['run']['runId'],nativeEnd=case['run']['nativeEnd'])),flush=True)


def compare_completed():
    """Read existing SQL through the same UI endpoint; never submit a simulation."""
    proof=json.loads(EVIDENCE.read_text())
    baseline=json.loads((DATA/(SOURCE+'-run.json')).read_text())
    performance=json.loads((DATA/(proof['caseId']+'-run.json')).read_text())
    preserved={run['sql']:hashlib.sha256(Path(run['sql']).read_bytes()).hexdigest() for run in (baseline,performance)}
    results=[]
    for meter,frequency,count in (('Electricity:Facility','Zone Timestep',52560),('NaturalGas:Facility','Zone Timestep',52560),('Zone Mean Air Temperature','Hourly',8760)):
        channel=next(item for item in baseline['channels'] if item['name']==meter and item['frequency']==frequency)
        payload=dict(operation='compare',cases=[SOURCE,proof['caseId']],baselineCaseId=SOURCE,
            runIds={SOURCE:baseline['runId'],proof['caseId']:performance['runId']},channel=channel['id'])
        with httpx.Client(timeout=httpx.Timeout(950,connect=10)) as client:
            response=client.post(URL,json=payload); response.raise_for_status(); comparison=response.json()
        output=ROOT/'.local'/('weather-sizing-compare-'+meter.split(':')[0]+'.json')
        output.write_text(json.dumps(dict(request=payload,response=comparison),indent=2),encoding='utf-8')
        assert comparison['baselineCaseId']==SOURCE
        assert len(comparison['rows'])==count
        assert all(item['missing']==0 for item in comparison['cases'])
        assert [item['runId'] for item in comparison['cases']]==[baseline['runId'],performance['runId']]
        results.append(dict(meter=meter,rows=len(comparison['rows']),summary=comparison['summary'],evidence=str(output)))
    assert all(hashlib.sha256(Path(path).read_bytes()).hexdigest()==digest for path,digest in preserved.items())
    proof['comparisons']=results; proof['sqlUnchanged']=preserved
    EVIDENCE.write_text(json.dumps(proof,indent=2),encoding='utf-8')
    print(json.dumps(results),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('--compare-only',action='store_true')
    compare_completed() if parser.parse_args().compare_only else main()
