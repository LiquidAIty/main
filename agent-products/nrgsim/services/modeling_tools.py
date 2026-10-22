"""Saved-Card access to the same Project-owned case editor used by the inspector."""
# Entity: Building Modeling
# Relationship: Publishes two scoped MCP operations that forward to Python rails; this process never owns OSM state or a model lock.
from __future__ import annotations

import os
from uuid import UUID
from urllib.parse import quote
import httpx
from app.application_tool_error import ApplicationToolError
from app.python_models.operation_definition import OperationDefinition


async def _request(payload, projectId, deckId, _callerCardId, _sourceRunId):
    if not all(isinstance(value, str) and value.strip() for value in (projectId, deckId, _callerCardId, _sourceRunId)):
        raise ApplicationToolError('Authenticated Project, Card and Run context is required')
    if str(UUID(projectId)) != projectId:
        raise ApplicationToolError('Invalid authenticated Project identity')
    origin = os.environ.get('PYTHON_RAILS_URL', '').strip().rstrip('/')
    if not origin:
        raise ApplicationToolError('Python rails URL is not configured')
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(930, connect=10)) as client:
            response = await client.post(origin + '/nrgsim/projects/' + quote(projectId, safe=''), json=payload)
        if not response.is_success:
            raise ApplicationToolError(str(response.json().get('detail', 'Model operation refused')))
        return response.json()
    except httpx.TimeoutException as error:
        raise ApplicationToolError('Model operation timed out; its outcome is unknown. Read the case before deciding whether another edit is needed.') from error
    except httpx.HTTPError as error:
        raise ApplicationToolError('Model transport failed; read the case before repeating an edit.') from error


def _case(state, case_id):
    result = next((case for case in state.get('cases', []) if case['id'] == case_id), None)
    if result is None:
        raise ApplicationToolError('Saved model case not found in this Project')
    return result


async def read_case(caseId, scopeHandle=None, tab=None, **context):
    state = await _request({'operation': 'state'}, **context)
    case = _case(state, caseId)
    geometry = case['geometry']
    objects = [{'handle': geometry['modelId'], 'name': case['name'], 'type': 'Building'}]
    objects += [dict(handle=item['handle'], name=item['name'], type='Story') for item in geometry.get('stories', [])]
    objects += [dict(handle=item['handle'], name=item['name'], type='Space', parent=item.get('storyHandle')) for item in geometry.get('spaces', [])]
    objects += [dict(handle=item['handle'], name=item['name'], type=item['objectType'], parent=item.get('parentHandle'),
                     surfaceType=item['surfaceType'], boundary=item.get('boundary')) for item in geometry['objects']]
    scope = scopeHandle or geometry['modelId']
    if not any(item['handle'] == scope for item in objects):
        raise ApplicationToolError('Select an existing object handle from this case')
    controls = [item for item in case['controls'] if scope in item['scopes'] and (tab is None or tab == item['tab'])]
    return dict(ok=True, caseId=caseId, name=case['name'], revision=case['revision'], editable=caseId != 'baseline',
                scopeHandle=scope, objects=objects, controls=controls)


async def edit_inputs(caseId, revision, edits, **context):
    result = await _request(dict(operation='edit_inputs', caseId=caseId, revision=revision, edits=edits), **context)
    case = _case(result, caseId)
    ids = {edit['id'] for edit in edits}
    return dict(ok=True, caseId=caseId, name=case['name'], revision=case['revision'],
                readback=[item for item in case['controls'] if item['id'] in ids])


def operation_definitions(publishers):
    context = frozenset({'projectId', 'deckId', '_callerCardId', '_sourceRunId'})
    common = dict(available=True, publishers=publishers, namespace='building_model', grant_eligible=True,
                  grant_profiles=frozenset({'nrgsim'}), dispatcher_context_arguments=context)
    case_id = {'type': 'string', 'minLength': 1}
    read_schema = dict(type='object', additionalProperties=False, required=['caseId'], properties={
        'caseId': case_id, 'scopeHandle': {'type': 'string'}, 'tab': {'type': 'string', 'enum': [
            'site','geometry','construction','openings','activity','lighting','hvac','simulation']}})
    edit_schema = dict(type='object', additionalProperties=False, required=['caseId','revision','edits'], properties={
        'caseId': case_id, 'revision': {'type': 'string', 'pattern': '^[a-f0-9]{64}$'},
        'edits': {'type': 'array', 'minItems': 1, 'maxItems': 100, 'items': {
            'type': 'object', 'additionalProperties': False, 'required': ['id','value'],
            'properties': {'id': {'type': 'string', 'minLength': 1}, 'value': {'type': ['number','string','boolean']}}}}})
    return [
        OperationDefinition(canonical_id='building_model.read_case', title='Read building inputs',
            description='Read an existing saved OSM case, geometry handles and actual inspector controls. The default scope is the Building; select a returned handle/tab to inspect deeper. Baseline is read-only.',
            parameters_schema=read_schema, handler=read_case, access='read',
            annotations=dict(readOnlyHint=True, destructiveHint=False, idempotentHint=True, openWorldHint=False), **common),
        OperationDefinition(canonical_id='building_model.edit_inputs', title='Edit building inputs',
            description='Apply exact control IDs and values from read_case to the same saved case as the human inspector, using its current revision. Validates, saves/reopens and returns actual readback. A stale revision is refused; never retry blindly or edit baseline. Does not run a simulation.',
            parameters_schema=edit_schema, handler=edit_inputs, access='write',
            annotations=dict(readOnlyHint=False, destructiveHint=False, idempotentHint=False, openWorldHint=False), **common),
    ]
