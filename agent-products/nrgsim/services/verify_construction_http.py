"""Real owned-route construction edits and annual runs, with immutable-history checks."""
# Entity: Building Modeling
# Relationship: Retains actual edit/readback/run evidence for the existing floor cases without changing baseline or old SQL.
import argparse
import hashlib
import json
import time
from pathlib import Path
import httpx

ROOT = Path(__file__).resolve().parents[1]
PROJECT = '38bd1429-e8e1-47ff-afef-d940aa8e8040'
DATA = ROOT / '.local/projects' / PROJECT
CASES = ('case_df12ce1f214e', 'case_533019990494')
URL = 'http://127.0.0.1:4000/api/nrgsim/projects/' + PROJECT
EVIDENCE = ROOT / '.local/construction-http-verification.json'


def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()


def run(mode, case_id):
    proof = json.loads(EVIDENCE.read_text()) if EVIDENCE.exists() else {'requests':[]}
    immutable = [path for path in (DATA/'inputs').glob('*.osm') if path.stem not in CASES]
    immutable += list((DATA/'runs').rglob('*.sql'))
    proof.setdefault('preserved', {str(path):digest(path) for path in immutable})
    def save(): EVIDENCE.write_text(json.dumps(proof,indent=2),encoding='utf-8')
    def request(payload):
        start=time.monotonic()
        with httpx.Client(timeout=httpx.Timeout(950,connect=10)) as client:
            response=client.post(URL,json=payload)
        record=dict(input=payload,status=response.status_code,seconds=time.monotonic()-start)
        proof['requests'].append(record); save()
        if not response.is_success:
            record['error']=response.text; save(); response.raise_for_status()
        return response.json()
    state=request({'operation':'state'})
    if mode=='edit':
        for ident in CASES:
            case=next(item for item in state['cases'] if item['id']==ident)
            building=case['geometry']['modelId']
            changes=[]
            for kind,boundary in [('RoofCeiling','Outdoors'),('Floor','Ground')]:
                control=next(item for item in case['controls'] if item['id']==f'{building}:envelope.{kind}.{boundary}.construction')
                choice=next(item for item in control['choices'] if item['value']==control['value'])
                expected = 'Typical IEAD Roof' if kind=='RoofCeiling' else 'Typical Insulated Carpeted 8in Slab Floor'
                if not choice['label'].startswith(expected):
                    changes.append(dict(id=control['id'],value=f'library:{kind}:{boundary}'))
            if changes:
                state=request(dict(operation='edit_inputs',caseId=ident,revision=case['revision'],edits=changes))
            actual=next(item for item in state['cases'] if item['id']==ident)
            proof.setdefault('cases',{})[ident]=dict(revision=actual['revision'],assemblies=[item for item in actual['controls']
                if item['field'].startswith('envelope.') and item['field'].endswith('.construction') and building in item['scopes']])
            print(json.dumps(dict(caseId=ident,revision=actual['revision'],status='saved_and_reopened')),flush=True); save()
    elif mode=='run':
        case=next(item for item in state['cases'] if item['id']==case_id)
        if not case['resultsCurrent']:
            state=request(dict(operation='run',caseId=case_id,revision=case['revision']))
        actual=next(item for item in state['cases'] if item['id']==case_id)
        proof.setdefault('runs',{})[case_id]=actual['run']; save()
        print(json.dumps(dict(caseId=case_id,runId=actual['run']['runId'],nativeEnd=actual['run']['nativeEnd'])),flush=True)
    elif mode=='compare':
        case=next(item for item in state['cases'] if item['id']==case_id)
        channel=next(item for item in case['run']['channels'] if item['name']=='Zone Ideal Loads Supply Air Total Cooling Energy' and item['key']=='Building total')
        result=request(dict(operation='compare',cases=['baseline',case_id],channel=channel['id']))
        (ROOT/'.local/construction-comparison.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
        assert len(result['cases'])==2
        proof['comparison']=dict(cases=result['cases'],rows=len(result['rows']),channel=result['channel']); save()
        print(json.dumps(dict(comparedCases=len(result['cases']),rows=len(result['rows']))),flush=True)
    changed=[path for path,sha in proof['preserved'].items() if digest(Path(path))!=sha]
    proof['preservationFailures']=changed; proof['status']='verified' if not changed else 'failed'; save()
    if changed: raise ValueError('Historical input or SQL changed')
    print(json.dumps(dict(preserved=len(proof['preserved']),evidence=str(EVIDENCE))),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('mode',choices=['edit','run','compare','inspect']); parser.add_argument('--case-id',choices=CASES,default=CASES[0])
    args=parser.parse_args(); run(args.mode,args.case_id)
