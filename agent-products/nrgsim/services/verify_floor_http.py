"""Exercise real floor cases through the loaded human Project endpoint."""
# Entity: Building Geometry
# Relationship: Retains resumable native-run evidence for the one-floor/two-floor acceptance without replacing existing cases or SQL.
import argparse
import hashlib
import json
import math
import urllib.request
import urllib.error
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
PROJECT='38bd1429-e8e1-47ff-afef-d940aa8e8040'


def verify(url, output):
    evidence=json.loads(output.read_text()) if output.exists() else dict(status='running',requests=[],cases={})
    if 'error' in evidence:
        evidence.setdefault('priorFailures',[]).append(evidence.pop('error'))
    evidence['status']='running'
    def publish():
        output.write_text(json.dumps(evidence,indent=2,allow_nan=False),encoding='utf-8')
    def request(payload, expected=200):
        req=urllib.request.Request(url,data=json.dumps(payload).encode(),headers={'Content-Type':'application/json','Origin':'http://127.0.0.1:5173'})
        try:
            with urllib.request.urlopen(req,timeout=940) as response:
                status,value=response.status,json.load(response)
        except urllib.error.HTTPError as error:
            status,value=error.code,json.load(error)
        evidence['requests'].append(dict(input=payload,status=status,error=value if status!=200 else None)); publish()
        print(json.dumps(dict(operation=payload['operation'],case=payload.get('caseId'),status=status)),flush=True)
        if status!=expected:
            raise ValueError(value)
        return value
    project=ROOT/'.local/projects'/PROJECT
    hashes=lambda: {str(path.relative_to(project)):hashlib.sha256(path.read_bytes()).hexdigest()
                    for path in [*(project/'inputs').glob('*.osm'),*(project/'runs').glob('*/run/eplusout.sql')]}
    if 'preserved' not in evidence:
        evidence['preserved']=hashes(); publish()
    try:
        state=request(dict(operation='state'))
        baseline=next(c for c in state['cases'] if c['id']=='baseline')
        if 'one' not in evidence['cases']:
            state=request(dict(operation='create_case',sourceCaseId='baseline',revision=baseline['revision'],name='Core + perimeter — one floor',layout='core_perimeter'))
            evidence['cases']['one']=state['createdCaseId']; publish()
        first=next(c for c in state['cases'] if c['id']==evidence['cases']['one'])
        if not evidence.get('editedOne'):
            changes={'Footprint width':12,'Footprint depth':10,'Core width':6,'Core depth':4,'Floor height':3}
            edits=[dict(id=next(c['id'] for c in first['controls'] if c['label']==label),value=value) for label,value in changes.items()]
            state=request(dict(operation='edit_inputs',caseId=first['id'],revision=first['revision'],edits=edits))
            first=next(c for c in state['cases'] if c['id']==first['id'])
            evidence['editedOne']=first['revision']; publish()
        if not first['resultsCurrent']:
            state=request(dict(operation='run',caseId=first['id'],revision=first['revision']))
            first=next(c for c in state['cases'] if c['id']==first['id'])
        evidence['oneRun']=first['run']; publish()
        if 'two' not in evidence['cases']:
            state=request(dict(operation='create_case',sourceCaseId=first['id'],revision=first['revision'],name='Core + perimeter — two floors',layout='upper_floor'))
            evidence['cases']['two']=state['createdCaseId']; publish()
        second=next(c for c in state['cases'] if c['id']==evidence['cases']['two'])
        if not second['resultsCurrent']:
            state=request(dict(operation='run',caseId=second['id'],revision=second['revision']))
            second=next(c for c in state['cases'] if c['id']==second['id'])
        evidence['twoRun']=second['run']; publish()
        selected=next(c for c in second['run']['channels'] if c.get('scope')=='building' and c['name']=='Zone Ideal Loads Supply Air Total Cooling Energy')
        comparison=request(dict(operation='compare',cases=['baseline',first['id'],second['id']],channel=selected['id']))
        assert len(comparison['rows'])==8760 and all(c['missing']==0 for c in comparison['cases'])
        assert all(math.isclose(c['floorArea'],area,rel_tol=1e-8) for c,area in zip(comparison['cases'][1:],[120,240]))
        assert comparison['summary']['changePercent'][1:]==[None,None]
        assert all(v is not None for v in comparison['summary']['perArea'])
        comparison_path=output.with_name(output.stem+'-comparison.json')
        comparison_path.write_text(json.dumps(comparison,allow_nan=False),encoding='utf-8')
        evidence['comparison']=dict(path=str(comparison_path),cases=comparison['cases'],summary=comparison['summary'],hourlyRows=len(comparison['rows']))
        for case in (first,second):
            snapshot=request(dict(operation='inspect_run',caseId=case['id'],runId=case['run']['runId']))
            assert snapshot['revision']==case['run']['revision']
            assert snapshot['geometry']['floorArea']==case['geometry']['floorArea']
        current=hashes()
        assert all(current.get(path)==digest for path,digest in evidence['preserved'].items()), 'An original model or SQL changed'
        evidence['preservedVerified']=len(evidence['preserved']); evidence['status']='passed'
    except BaseException as error:
        evidence.update(status='failed',error=str(error)); raise
    finally:
        publish()


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--url',default=f'http://127.0.0.1:4000/api/nrgsim/projects/{PROJECT}')
    parser.add_argument('--output',type=Path,default=ROOT/'.local/floor-http-verification.json')
    args=parser.parse_args(); verify(args.url,args.output)
