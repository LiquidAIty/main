"""The optional team-data surface uses the normal saved-Card MCP boundary."""
# Entity: AgentGraph
# Relationship: Proves independent grants, trusted attribution, optional native execution metadata and recoverable persistence failures without invoking agents or providers.

import asyncio
from unittest.mock import Mock

import psycopg
import pytest
from mcp.types import CallToolRequestParams

from app import mcp_auth, mcp_catalog_runtime, mcp_host
from app.python_models import agentgraph_records as records


@pytest.fixture
def context(monkeypatch):
    context = {'projectId': 'project-one', 'deckId': 'deck-one', 'callerCardId': 'card-one',
               'grantedTools': ['agentgraph.publish', 'agentgraph.read', 'agentgraph.search', 'agentgraph.link']}
    monkeypatch.setattr(mcp_auth, 'authenticated_project_context', lambda: context)
    monkeypatch.setattr(mcp_auth, 'internal_mcp_principal', lambda: {'kind': 'card-runtime', 'profile': 'research'})
    monkeypatch.setattr(mcp_catalog_runtime, 'published_mcp_tool_names', lambda: frozenset(context['grantedTools']))
    publish = Mock(return_value={'ok': True, 'saved': True, 'record': {'content': 'Incomplete idea'}})
    monkeypatch.setattr(records, 'publish', publish)
    return context, publish


def call(arguments=None, metadata=None):
    return asyncio.run(mcp_host._server_call_tool(None, CallToolRequestParams(name='agentgraph.publish',
        arguments={'kind': 'proposal', 'content': 'Incomplete idea', 'idempotencyKey': 'idea-one', **(arguments or {})},
        meta=metadata))).model_dump(by_alias=True)


def test_publication_needs_no_trade_job_run_assessment_or_execution_reference(context):
    assert call()['isError'] is False
    context[1].assert_called_once_with(project='project-one', deck='deck-one', card='card-one',
        kind='proposal', content='Incomplete idea', details={}, sources=[], event_at=None, key='idea-one', execution=None)


def test_actual_native_execution_is_preserved_when_present(context):
    execution = {'profile': 'research', 'sessionId': 'actual-session', 'turnId': 'actual-turn', 'toolCallId': 'actual-call'}
    assert call(metadata={'hermes.execution': execution})['isError'] is False
    assert context[1].call_args.kwargs['execution'] == {'runtime': 'hermes', **execution}


@pytest.mark.parametrize('forged', [{'projectId': 'other'}, {'deckId': 'other'}, {'_callerCardId': 'other'}, {'_sourceExecution': {}}])
def test_model_cannot_supply_scope_or_execution(context, forged):
    assert call(forged)['isError'] is True
    context[1].assert_not_called()


@pytest.mark.parametrize('metadata', [{'hermes.execution': {}},
    {'hermes.execution': {'profile': 'main', 'sessionId': 's', 'turnId': 't', 'toolCallId': 'c'}}])
def test_optional_does_not_mean_forged_or_malformed_provenance_is_accepted(context, metadata):
    assert call(metadata=metadata)['isError'] is True
    context[1].assert_not_called()


def test_ungranted_tool_is_rejected(context):
    context[0]['grantedTools'] = []
    assert call()['isError'] is True
    context[1].assert_not_called()


def test_storage_failure_is_an_honest_tool_result_and_next_independent_call_still_works(context):
    context[1].side_effect = psycopg.OperationalError('test database unavailable')
    failed = call()
    assert failed['isError'] is True
    assert failed['structuredContent']['saved'] is None
    assert failed['structuredContent']['failureCode'] == 'agentgraph_storage_unavailable'
    context[1].side_effect = None
    assert call()['isError'] is False
