"""MCP contracts for first-class Know intake and retrieval."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

import graphiti_mcp_server as server
from graphiti_core.knows import KnowCitation


@pytest.mark.asyncio
async def test_catalog_exposes_typed_know_tools_without_episode_json_fields():
    tools = {tool.name: tool for tool in await server.mcp.list_tools()}

    assert {'add_know', 'get_know', 'search_knows', 'get_entity_knows'} <= set(tools)
    schema = tools['add_know'].input_schema
    assert schema['required'] == [
        'name', 'entity_name', 'observation', 'interpretation', 'citation'
    ]
    assert 'episode_body' not in schema['properties']
    assert 'source_description' not in schema['properties']
    assert schema['properties']['citation'] == {'$ref': '#/$defs/KnowCitation'}


@pytest.mark.asyncio
async def test_add_know_uses_the_existing_group_queue_and_saga_fields(monkeypatch):
    queue = SimpleNamespace(add_know=AsyncMock(return_value=1))
    graphiti_service = SimpleNamespace(
        entity_types={'Company': object()},
        edge_types={'Reports': object()},
        edge_type_map={('Company', 'Metric'): ['Reports']},
    )
    monkeypatch.setattr(server, 'queue_service', queue)
    monkeypatch.setattr(server, 'graphiti_service', graphiti_service)
    monkeypatch.setattr(
        server,
        'config',
        SimpleNamespace(graphiti=SimpleNamespace(group_id='default-group')),
        raising=False,
    )
    citation = KnowCitation(
        url='https://example.com/report',
        title='Example report',
        publisher='Example Corp',
        evidence='The exact cited passage is preserved with the Know.',
    )

    result = await server.add_know(
        name='Revenue result',
        entity_name='Example Corp',
        entity_uuid='entity-1',
        observation='Revenue increased.',
        interpretation='Demand may be improving.',
        citation=citation,
        group_id='project-group',
        saga='company-thesis',
        saga_previous_episode_uuid='know-0',
    )

    assert 'accepted for processing' in result['message']
    assert result['know_uuid']
    assert len(result['content_hash']) == 64
    assert result['group_id'] == 'project-group'
    assert result['entity_uuid'] == 'entity-1'
    kwargs = queue.add_know.await_args.kwargs
    assert kwargs['group_id'] == 'project-group'
    assert kwargs['entity_uuid'] == 'entity-1'
    assert kwargs['citation'] is citation
    assert kwargs['saga'] == 'company-thesis'
    assert kwargs['saga_previous_episode_uuid'] == 'know-0'
    assert kwargs['update_communities'] is True
    assert len(kwargs['uuid']) == 36
