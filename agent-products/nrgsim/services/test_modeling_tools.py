"""Transport and authority tests; these do not stand in for a live saved-Card run."""
# Entity: Building Modeling
# Relationship: Checks the two modeling MCP tools use the one Project endpoint with exact grants, context, revisions and typed failure.
import asyncio
from unittest.mock import patch
import httpx
import pytest
from app.application_operation_catalog import _modeling_tools as tools
from app import mcp_request_dispatch as dispatch
from app.python_models.tool_registry import operation_definition

CONTEXT = dict(projectId='38bd1429-e8e1-47ff-afef-d940aa8e8040', deckId='deck_builder', _callerCardId='modeler', _sourceRunId='run-test')
STATE = {'cases': [dict(id='case1', name='Transport fixture', revision='a'*64, controls=[
    dict(id='control', scopes=['building'], tab='construction', value=2)], geometry=dict(modelId='building', objects=[], spaces=[], stories=[]))]}


def test_read_and_edit_forward_to_one_project_owner(monkeypatch):
    monkeypatch.setenv('PYTHON_RAILS_URL', 'http://rails.example')
    requests = []
    def respond(request):
        requests.append(request)
        return httpx.Response(200, json=STATE)
    client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
    with patch.object(tools.httpx, 'AsyncClient', return_value=client):
        result = asyncio.run(tools.read_case(caseId='case1', tab='construction', **CONTEXT))
    assert str(requests[0].url) == 'http://rails.example/nrgsim/projects/' + CONTEXT['projectId']
    assert requests[0].content == b'{"operation":"state"}'
    assert result['controls'][0]['id'] == 'control'
    client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
    with patch.object(tools.httpx, 'AsyncClient', return_value=client):
        result = asyncio.run(tools.edit_inputs(caseId='case1', revision='a'*64, edits=[dict(id='control', value=2)], **CONTEXT))
    import json
    assert json.loads(requests[-1].content) == dict(operation='edit_inputs', caseId='case1', revision='a'*64, edits=[dict(id='control', value=2)])
    assert result['readback'][0]['value'] == 2


def test_no_missing_context_or_unknown_case(monkeypatch):
    with pytest.raises(tools.ApplicationToolError, match='context'):
        asyncio.run(tools.read_case(caseId='case1', **{**CONTEXT, '_sourceRunId': ''}))
    with pytest.raises(tools.ApplicationToolError, match='not found'):
        tools._case(STATE, 'other')


def test_conflicts_and_timeouts_are_not_success(monkeypatch):
    monkeypatch.setenv('PYTHON_RAILS_URL', 'http://rails.example')
    for handler, message in [
        (lambda request: httpx.Response(409, json={'detail': 'Model revision changed'}), 'revision changed'),
        (lambda request: (_ for _ in ()).throw(httpx.ReadTimeout('late')), 'outcome is unknown'),
    ]:
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        with patch.object(tools.httpx, 'AsyncClient', return_value=client), pytest.raises(tools.ApplicationToolError, match=message):
            asyncio.run(tools.read_case(caseId='case1', **CONTEXT))


def test_catalog_grants_context_and_timeout(monkeypatch):
    names = {'building_model.read_case', 'building_model.edit_inputs'}
    for name in names:
        definition = operation_definition(name)
        assert definition.grant_profiles == frozenset({'nrgsim'})
        assert definition.parameters_schema['additionalProperties'] is False
        assert 'projectId' not in definition.parameters_schema['properties']
        assert dispatch.mcp_tool_timeout_seconds(name) == 960
    context = dict(projectId=CONTEXT['projectId'], deckId='deck_builder', callerCardId='modeler', parentRunId='run-test', grantedTools=[])
    monkeypatch.setattr(dispatch.mcp_auth, 'internal_mcp_principal', lambda: {'kind': 'card-runtime'})
    monkeypatch.setattr(dispatch.mcp_auth, 'authenticated_project_context', lambda: context)
    monkeypatch.setattr(dispatch.mcp_catalog_runtime, 'published_mcp_tool_names', lambda: names)
    refused = asyncio.run(dispatch.dispatch_tool('building_model.read_case', {'caseId': 'case1'}))
    assert refused.is_error and refused.structured_content['failureCode'] == 'tool_not_granted'
    context['grantedTools'] = list(names)
    refused = asyncio.run(dispatch.dispatch_tool('building_model.read_case', {'caseId':'case1','projectId':'foreign'}))
    assert refused.is_error and refused.structured_content['failureCode'] == 'caller_identity_rejected'
    async def inspect(payload, **injected):
        assert injected == CONTEXT
        assert payload == {'operation':'state'}
        return STATE
    monkeypatch.setattr(tools, '_request', inspect)
    result = asyncio.run(dispatch.dispatch_tool('building_model.read_case', {'caseId':'case1'}))
    assert not result.is_error and result.structured_content['revision'] == 'a'*64
