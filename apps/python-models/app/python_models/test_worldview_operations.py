"""WorldView tool schemas, bounded provider reads, and view-control admission."""
# Entity: WorldView
# Relationship: Tests provider provenance and strict scoped globe commands without claiming live source or browser acceptance.
import asyncio
import httpx
import pytest

from app import main_worldview_operations as operations
from app.application_tool_error import ApplicationToolError


def test_worldview_catalog_contract():
    definitions = operations.main_worldview_operation_definitions(frozenset({'external-mcp'}), frozenset({'internal-runtime'}))
    read = next(item for item in definitions if item.canonical_id == 'worldview.read')
    action = next(item for item in definitions if item.canonical_id == 'worldview.action')
    assert read.access == 'read' and not read.grant_profiles
    assert action.grant_profiles == frozenset({'worldview'})
    assert 'projectId' in read.parameters_schema['properties']


def test_launch_read_preserves_stale_status_and_source_coordinates(monkeypatch):
    client_class = httpx.AsyncClient
    def respond(request):
        assert str(request.url) == 'http://127.0.0.1:4174/api/launches'
        return httpx.Response(200, headers={'X-GEV-Cache': 'STALE-ERROR'}, json={'results': [{
            'id': 'launch-one', 'name': 'Published launch', 'net': '2026-01-01T12:00:00Z',
            'status': {'name': 'Success'}, 'url': 'https://example.org/launch-one',
            'launch_service_provider': {'id': 1, 'name': 'Provider'},
            'pad': {'name': 'Pad', 'latitude': '-39.26', 'longitude': '177.86'},
        }]})
    monkeypatch.setattr(operations.httpx, 'AsyncClient', lambda **kwargs: client_class(
        **kwargs, transport=httpx.MockTransport(respond)))
    result = asyncio.run(operations.worldview_read(projectId='project', source='launches'))
    assert result['stale'] is True and result['sourceAsOf'] is None
    assert result['records'][0]['location']['latitude'] == '-39.26'
    assert result['records'][0]['eventTime'] == '2026-01-01T12:00:00Z'
    assert result['records'][0]['sourceReference'] == 'https://example.org/launch-one'


@pytest.mark.parametrize('action,args', [
    ('fly_to_location', {'latitude': None, 'longitude': 1}),
    ('fly_to_location', {'latitude': 91, 'longitude': 1}),
    ('fly_to_location', {'latitude': 1}),
    ('fly_to_location', {'latitude': 1, 'longitude': 2, 'query': 'another place'}),
    ('fly_to_location', {'latitude': float('nan'), 'longitude': 2}),
    ('focus_satellites', {'noradIds': [True]}),
    ('focus_satellites', {'noradIds': [1, 1]}),
    ('zoom_to_globe', {'enabled': True}),
    ('set_layer_visibility', {'enabled': True}),
])
def test_invalid_actions_never_reach_transport(monkeypatch, action, args):
    from app import mcp_auth, backend_operation_transport
    monkeypatch.setattr(mcp_auth, 'internal_mcp_principal', lambda: {'projectId': 'p', 'ownerUserId': 'o'})
    def unexpected(*args, **kwargs):
        pytest.fail('Invalid action reached transport')
    monkeypatch.setattr(backend_operation_transport, 'request_backend_json', unexpected)
    with pytest.raises(ApplicationToolError):
        asyncio.run(operations.worldview_action(projectId='p', deckId='d', _callerCardId='c', action=action, arguments=args))


def test_action_preserves_scope_and_unconfirmed_result(monkeypatch):
    from app import mcp_auth, backend_operation_transport
    monkeypatch.setattr(mcp_auth, 'internal_mcp_principal', lambda: {'projectId': 'p', 'ownerUserId': 'o'})
    def send(method, route, payload, **kwargs):
        assert payload == {'projectId': 'p', 'ownerUserId': 'o', 'deckId': 'd', 'cardId': 'c',
                           'action': 'fly_to_location', 'arguments': {'latitude': 1, 'longitude': 2}}
        assert kwargs['require_internal_secret'] is True
        return {'ok': False, 'confirmed': False, 'error': 'worldview_result_unconfirmed'}
    monkeypatch.setattr(backend_operation_transport, 'request_backend_json', send)
    result = asyncio.run(operations.worldview_action(projectId='p', deckId='d', _callerCardId='c',
        action='fly_to_location', arguments={'latitude': 1, 'longitude': 2}))
    assert result['confirmed'] is False
    with pytest.raises(ApplicationToolError, match='scope'):
        asyncio.run(operations.worldview_action(projectId='other', deckId='d', _callerCardId='c', action='zoom_to_globe'))
