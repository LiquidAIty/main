"""Owner-authorized saved Modeler migration and real application-run evidence."""
# Entity: Building Modeling
# Relationship: Exercises existing saved Card persistence and Main delivery; never bypasses Hermes with a model stand-in.
import argparse
import hashlib
import json
from pathlib import Path
import uuid
import httpx

ROOT = Path(__file__).resolve().parents[1]
PROJECT = '38bd1429-e8e1-47ff-afef-d940aa8e8040'
CARD = 'card_9c43e17bb2b64ff2'
BASE = 'http://127.0.0.1:4000'
DECK = f'/api/projects/{PROJECT}/decks/deck_builder'
TOOLS = ['building_model.read_case', 'building_model.edit_inputs']


def write(name, value):
    (ROOT / '.local' / name).write_text(json.dumps(value, indent=2, ensure_ascii=False), encoding='utf-8')


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def migrate():
    with httpx.Client(timeout=120) as client:
        response = client.get(BASE + DECK); response.raise_for_status(); before = response.json()
        document = before['deck']
        card = next(item for item in document['nodes'] if item['id'] == CARD)
        others = {node['id']: fingerprint(node) for node in document['nodes'] if node['id'] != CARD}
        topology = fingerprint(document['edges'])
        old = dict(prompt=card['prompt'], tools=card['runtimeOptions']['tools'], revision=card['_cardRevisionId'])
        if old['tools'] == TOOLS:
            print('Modeler already migrated; no second write.'); return
        expected = {'create_baseline_osm','get_model_summary','list_model_objects','get_object_fields','set_object_property','save_osm_model'}
        if set(old['tools']) != expected:
            raise ValueError('Saved tools changed; inspect instead of overwriting')
        start = card['prompt'].index('[MODEL_AUTHORITY]')
        end = card['prompt'].index('[BOUNDARIES]')
        contract = '''[MODEL_AUTHORITY]
Saved Project-owned OSM case files are authoritative. Human inspector and these tools use the same Python rails transaction: load current case, validate a candidate, save/reopen, compare its revision and publish. There is no persistent active in-memory model to edit separately. Baseline and completed-run input/SQL artifacts must remain unchanged. Do not run a simulation; these grants do not provide simulation or case creation.

[WORK]
Use building_model.read_case and building_model.edit_inputs only. Work on the exact existing case ID supplied by the user; ask if the target is unclear. These are application operations backed by actual OpenStudio SDK bindings, not generic arbitrary property writers.

[REQUIRED_METHOD]
1. Read the named case before editing. Read the returned geometry handle and relevant tab to identify the exact control ID, current value, units, choices, bounds and target scope.
2. Building/story construction controls affect the returned targets; surface controls create local exceptions. Resolve scope before writing and preserve unrelated assignments.
3. Use only returned control IDs and valid values. Preserve unset, SI/IP distinctions and model-specific identifiers. Assembly resistance excludes films and bridges; do not call it total operational or PCM performance.
4. Submit edits with the revision returned by the read. A stale revision is a conflict, not permission to overwrite a human edit. Read back and explain the conflict; do not blindly replay it.
5. The edit operation already validates, saves/reopens and publishes the candidate. Check its actual readback, then read the case again to confirm the saved values. No separate save tool exists or is needed.
6. On timeout or transport failure the result is unknown. Read the case before deciding whether any further action is needed. Never invent successful writes, simulations or results.

'''
        card['prompt'] = card['prompt'][:start] + contract + card['prompt'][end:]
        card['prompt'] = card['prompt'].replace(
            "Preserve the human inspector's active-model edits and avoid replacing or reinitializing the active model unless the user explicitly requests creation and acknowledges replacement risk.",
            "Preserve pending human edits and saved model revisions; never replace or reinitialize a model through these tools.")
        card['runtimeOptions']['tools'] = TOOLS
        write('modeler-migration-before.json', old)
        response = client.put(BASE + DECK, json={'document':document,'expectedRevision':before['meta']['deckRevision']})
        response.raise_for_status()
        after = client.get(BASE + DECK).json()
        actual = next(item for item in after['deck']['nodes'] if item['id'] == CARD)
        assert actual['runtimeOptions']['tools'] == TOOLS and actual['prompt'] == card['prompt']
        assert others == {node['id']:fingerprint(node) for node in after['deck']['nodes'] if node['id'] != CARD}
        assert topology == fingerprint(after['deck']['edges'])
        catalog = client.get(BASE+'/api/idd/tools', params=dict(projectId=PROJECT,deckId='deck_builder',cardId=CARD,selectedIds=','.join(TOOLS),limit=100)).json()
        assert not catalog['unresolvedSelectedIds'], catalog['unresolvedSelectedIds']
        write('modeler-migration.json', dict(status='saved_and_read_back',beforeRevision=old['revision'],afterRevision=actual['_cardRevisionId'],
            tools=TOOLS,otherCardsPreserved=len(others),topologyPreserved=True,prompt=actual['prompt'],catalog=catalog['selectedKnownReferences']))
        print(json.dumps(dict(status='saved_and_read_back',revision=actual['_cardRevisionId'],otherCardsPreserved=len(others))))


def invoke(mission):
    message_id, reply_id = 'msg_'+str(uuid.uuid4()), 'msg_'+str(uuid.uuid4())
    events = []
    payload = dict(projectId=PROJECT,deckId='deck_builder',message='@Modeler '+mission,clientMessageId=message_id,clientReplyMessageId=reply_id,dataAnchors=[])
    with httpx.Client(timeout=httpx.Timeout(600,connect=10)) as client:
        with client.stream('POST', BASE+'/api/main/session/chat', json=payload) as response:
            if not response.is_success:
                body = response.read().decode('utf-8')
                write('modeler-live-'+message_id+'.json', dict(request=payload,status=response.status_code,error=body))
                print(body,flush=True)
            response.raise_for_status()
            event_name = ''
            for line in response.iter_lines():
                if line.startswith('event:'): event_name = line[6:].strip()
                if line.startswith('data:'):
                    event = json.loads(line[5:].strip()); events.append(dict(event=event_name,data=event))
                    if event_name in ('error','done','end'):
                        print(json.dumps(dict(event=event_name,data=event), ensure_ascii=False), flush=True)
    path = 'modeler-live-'+message_id+'.json'
    write(path,dict(request=payload,events=events))
    print(str(ROOT/'.local'/path))


if __name__ == '__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('mode',choices=['migrate','invoke']); parser.add_argument('--mission')
    args=parser.parse_args()
    migrate() if args.mode=='migrate' else invoke(args.mission)
