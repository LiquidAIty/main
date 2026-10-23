"""Focused contracts for first-class Entity-attached Knows."""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

import graphiti_core.graphiti as graphiti_module
from graphiti_core.driver.driver import GraphProvider
from graphiti_core.edges import Edge, EntityEdge
from graphiti_core.graphiti import AddEpisodeResults, Graphiti
from graphiti_core.knows import (
    KnowCitation,
    KnowDirection,
    KnowNode,
    know_content_hash,
    know_episode_content,
    resolve_know_entity,
)
from graphiti_core.nodes import EntityNode, EpisodeType, EpisodicNode, Node
from graphiti_core.search.search_config import SearchResults
from graphiti_core.tracer import NoOpTracer


def _citation() -> KnowCitation:
    return KnowCitation(
        url='https://example.com/report',
        resolvedUrl='https://example.com/report-final',
        title='Example annual report',
        publisher='Example Corp',
        evidence='Revenue increased by twenty percent during the reported period.',
        locator='page 12',
        publishedAt='2026-10-01',
        retrievedAt='2026-10-20T12:00:00Z',
        contentFingerprint='a' * 64,
    )


def _episode(now: datetime) -> EpisodicNode:
    return EpisodicNode(
        uuid='know-1',
        name='Revenue observation',
        group_id='g1',
        source=EpisodeType.text,
        source_description='Example annual report',
        content='plain episode content',
        valid_at=now,
        created_at=now,
    )


@pytest.mark.asyncio
async def test_add_know_reuses_add_episode_and_preserves_saga(monkeypatch):
    now = datetime(2026, 10, 20, tzinfo=timezone.utc)
    episode = _episode(now)
    entity = EntityNode(
        uuid='entity-1',
        name='Example Corp',
        group_id='g1',
        created_at=now,
    )
    driver = SimpleNamespace(provider=GraphProvider.NEO4J, _database='g1')
    clients = SimpleNamespace(driver=driver, embedder=object())
    graphiti = Graphiti.__new__(Graphiti)
    graphiti.driver = driver
    graphiti.clients = clients
    graphiti.add_episode = AsyncMock(
        return_value=AddEpisodeResults(
            episode=episode,
            episodic_edges=[],
            nodes=[entity],
            edges=[],
            communities=[],
            community_edges=[],
        )
    )

    monkeypatch.setattr(
        graphiti_module,
        'resolve_know_entity',
        AsyncMock(return_value=(entity, False)),
    )
    monkeypatch.setattr(KnowNode, 'get_by_content_hash', AsyncMock(return_value=None))
    monkeypatch.setattr(
        EpisodicNode,
        'get_by_uuid',
        AsyncMock(side_effect=graphiti_module.NodeNotFoundError('know-1')),
    )
    monkeypatch.setattr(KnowNode, 'save_know', AsyncMock(return_value=None))

    citation = _citation()
    direction = KnowDirection(
        proposition='Example Corp is improving',
        relation='supports',
    )
    final_know = KnowNode.from_episode(
        episode,
        entity_uuid=entity.uuid,
        observation='Example Corp revenue increased.',
        interpretation='The reported period shows improving demand.',
        citation=citation,
        direction=direction,
        content_hash=know_content_hash(
            entity_name=entity.name,
            observation='Example Corp revenue increased.',
            interpretation='The reported period shows improving demand.',
            citation=citation,
            direction=direction,
        ),
    )
    final_know.saga_uuid = 'saga-1'
    final_know.saga_name = 'company-thesis'
    monkeypatch.setattr(KnowNode, 'get_by_uuid', AsyncMock(return_value=final_know))

    result = await graphiti.add_know(
        name='Revenue observation',
        entity_name='Example Corp',
        observation='Example Corp revenue increased.',
        interpretation='The reported period shows improving demand.',
        citation=citation,
        direction=direction,
        reference_time=now,
        group_id='g1',
        uuid='know-1',
        saga='company-thesis',
        saga_previous_episode_uuid='know-0',
    )

    kwargs = graphiti.add_episode.await_args.kwargs
    assert kwargs['source'] is EpisodeType.text
    assert not kwargs['episode_body'].lstrip().startswith('{')
    assert 'Observation: Example Corp revenue increased.' in kwargs['episode_body']
    assert 'Evidence: Revenue increased by twenty percent' in kwargs['episode_body']
    assert kwargs['saga'] == 'company-thesis'
    assert kwargs['saga_previous_episode_uuid'] == 'know-0'
    assert kwargs['update_communities'] is True
    assert result.know.saga_uuid == 'saga-1'
    assert result.entity.uuid == 'entity-1'
    assert result.created is True


@pytest.mark.asyncio
async def test_save_know_stores_entity_identity_and_removes_attachment_edges():
    now = datetime(2026, 10, 20, tzinfo=timezone.utc)
    know = KnowNode.from_episode(
        _episode(now),
        entity_uuid='entity-1',
        observation='Example Corp revenue increased.',
        interpretation='The reported period shows improving demand.',
        citation=_citation(),
        direction=None,
        content_hash='b' * 64,
    )
    driver = SimpleNamespace(
        provider=GraphProvider.NEO4J,
        execute_query=AsyncMock(
            side_effect=[
                ([{'entity_uuid': None}], None, None),
                (
                    [{'uuid': 'know-1', 'entity_uuid': 'entity-1'}],
                    None,
                    None,
                ),
            ]
        ),
    )

    await know.save_know(driver)

    query = driver.execute_query.await_args_list[1].args[0]
    params = driver.execute_query.await_args_list[1].kwargs
    assert 'SET know:Know' in query
    assert "type(attachment) IN ['ABOUT', 'MENTIONS']" in query
    assert 'FOREACH (edge IN attachments | DELETE edge)' in query
    assert 'MERGE (know)-[about:ABOUT]->(entity)' not in query
    assert params['entity_uuid'] == 'entity-1'
    assert params['citation_url'] == 'https://example.com/report'
    assert params['citation_evidence'].startswith('Revenue increased')
    assert params['content_hash'] == 'b' * 64


@pytest.mark.asyncio
async def test_add_know_retry_finishes_matching_episode_without_reingestion(monkeypatch):
    now = datetime(2026, 10, 20, tzinfo=timezone.utc)
    citation = _citation()
    episode = EpisodicNode(
        uuid='know-1',
        name='Revenue observation',
        group_id='g1',
        source=EpisodeType.text,
        source_description='Example Corp: Example annual report',
        content=know_episode_content(
            observation='Example Corp revenue increased.',
            interpretation='The reported period shows improving demand.',
            citation=citation,
            direction=None,
        ),
        valid_at=now,
        created_at=now,
    )
    entity = EntityNode(
        uuid='entity-1',
        name='Example Corp',
        group_id='g1',
        created_at=now,
    )
    driver = SimpleNamespace(provider=GraphProvider.NEO4J, _database='g1')
    clients = SimpleNamespace(driver=driver, embedder=object())
    graphiti = Graphiti.__new__(Graphiti)
    graphiti.driver = driver
    graphiti.clients = clients
    graphiti.store_raw_episode_content = True
    graphiti.add_episode = AsyncMock()
    monkeypatch.setattr(
        graphiti_module,
        'resolve_know_entity',
        AsyncMock(return_value=(entity, False)),
    )
    monkeypatch.setattr(KnowNode, 'get_by_content_hash', AsyncMock(return_value=None))
    monkeypatch.setattr(EpisodicNode, 'get_by_uuid', AsyncMock(return_value=episode))
    monkeypatch.setattr(KnowNode, 'save_know', AsyncMock(return_value=None))
    finalized = KnowNode.from_episode(
        episode,
        entity_uuid='entity-1',
        observation='Example Corp revenue increased.',
        interpretation='The reported period shows improving demand.',
        citation=citation,
        direction=None,
        content_hash=know_content_hash(
            entity_name='Example Corp',
            observation='Example Corp revenue increased.',
            interpretation='The reported period shows improving demand.',
            citation=citation,
            direction=None,
        ),
    )
    monkeypatch.setattr(KnowNode, 'get_by_uuid', AsyncMock(return_value=finalized))

    result = await graphiti.add_know(
        name='Revenue observation',
        entity_name='Example Corp',
        observation='Example Corp revenue increased.',
        interpretation='The reported period shows improving demand.',
        citation=citation,
        reference_time=now,
        group_id='g1',
        uuid='know-1',
    )

    graphiti.add_episode.assert_not_awaited()
    assert result.episode_results is None
    assert result.know.uuid == 'know-1'


@pytest.mark.asyncio
async def test_save_know_rejects_a_different_stored_entity_identity():
    now = datetime(2026, 10, 20, tzinfo=timezone.utc)
    know = KnowNode.from_episode(
        _episode(now),
        entity_uuid='entity-1',
        observation='Example Corp revenue increased.',
        interpretation='The reported period shows improving demand.',
        citation=_citation(),
        direction=None,
        content_hash='c' * 64,
    )
    driver = SimpleNamespace(
        provider=GraphProvider.NEO4J,
        execute_query=AsyncMock(
            return_value=([{'entity_uuid': 'different-entity'}], None, None)
        ),
    )

    with pytest.raises(ValueError) as error:
        await know.save_know(driver)
    assert str(error.value) == 'Know is already attached to a different Entity'
    assert driver.execute_query.await_count == 1


@pytest.mark.asyncio
async def test_know_lookup_filters_after_optional_saga_matching():
    driver = SimpleNamespace(
        execute_query=AsyncMock(return_value=([], None, None)),
    )

    assert (
        await KnowNode.get_by_content_hash(
            driver,
            group_id='g1',
            content_hash='f' * 64,
        )
        is None
    )

    query = driver.execute_query.await_args.args[0]
    assert query.index('WITH know, saga') < query.index(
        'WHERE know.group_id = $group_id'
    )


def test_know_episode_content_is_plain_searchable_text():
    content = know_episode_content(
        observation='A sourced observation.',
        interpretation='A bounded interpretation.',
        citation=_citation(),
        direction=None,
    )
    assert content.startswith('Observation: A sourced observation.')
    assert 'https://example.com/report-final' not in content
    assert '"schemaVersion"' not in content


def test_know_content_identity_excludes_retrieval_time():
    first = _citation()
    second = first.model_copy(update={'retrieved_at': '2026-10-21T12:00:00Z'})
    arguments = {
        'entity_name': 'Example Corp',
        'observation': 'A sourced observation.',
        'interpretation': 'A bounded interpretation.',
        'direction': None,
    }

    assert know_content_hash(citation=first, **arguments) == know_content_hash(
        citation=second,
        **arguments,
    )


@pytest.mark.asyncio
async def test_add_episode_creates_a_new_episode_for_a_caller_supplied_uuid(monkeypatch):
    now = datetime(2026, 10, 20, tzinfo=timezone.utc)
    driver = SimpleNamespace(provider=GraphProvider.NEO4J, _database='g1')
    graphiti = Graphiti.__new__(Graphiti)
    graphiti.driver = driver
    graphiti.clients = SimpleNamespace(driver=driver)
    graphiti.tracer = NoOpTracer()
    graphiti.max_coroutines = 1
    graphiti.store_raw_episode_content = True

    monkeypatch.setattr(EpisodicNode, 'get_by_uuids', AsyncMock(return_value=[]))
    get_by_uuid = AsyncMock(side_effect=graphiti_module.NodeNotFoundError('episode-1'))
    monkeypatch.setattr(EpisodicNode, 'get_by_uuid', get_by_uuid)
    monkeypatch.setattr(graphiti_module, 'extract_nodes', AsyncMock(return_value=([], {})))
    monkeypatch.setattr(
        graphiti_module,
        'resolve_extracted_nodes',
        AsyncMock(return_value=([], {}, [])),
    )
    monkeypatch.setattr(
        graphiti_module,
        'extract_attributes_from_nodes',
        AsyncMock(return_value=[]),
    )
    graphiti._extract_and_resolve_edges = AsyncMock(return_value=([], [], []))

    processed: dict[str, EpisodicNode] = {}

    async def process_episode(episode, *_args, **_kwargs):
        processed['episode'] = episode
        return [], episode

    graphiti._process_episode_data = process_episode

    result = await graphiti.add_episode(
        name='Caller-owned identity',
        episode_body='A new episode with a deterministic caller-supplied UUID.',
        source_description='direct test',
        reference_time=now,
        source=EpisodeType.text,
        group_id='g1',
        uuid='episode-1',
        update_communities=False,
        previous_episode_uuids=[],
    )

    get_by_uuid.assert_awaited_once_with(driver, 'episode-1')
    assert processed['episode'].uuid == 'episode-1'
    assert result.episode.uuid == 'episode-1'


@pytest.mark.asyncio
async def test_search_knows_uses_graphiti_episode_retrieval_with_know_filter(monkeypatch):
    now = datetime(2026, 10, 20, tzinfo=timezone.utc)
    episode = _episode(now)
    driver = SimpleNamespace(provider=GraphProvider.NEO4J, _database='g1')
    clients = SimpleNamespace(driver=driver)
    graphiti = Graphiti.__new__(Graphiti)
    graphiti.driver = driver
    graphiti.clients = clients
    search = AsyncMock(return_value=SearchResults(episodes=[episode]))
    monkeypatch.setattr(graphiti_module, 'search', search)
    expected = KnowNode.from_episode(
        episode,
        entity_uuid='entity-1',
        observation='A sourced observation.',
        interpretation='A bounded interpretation.',
        citation=_citation(),
        direction=None,
        content_hash='d' * 64,
    )
    monkeypatch.setattr(KnowNode, 'get_by_uuids', AsyncMock(return_value=[expected]))

    results = await graphiti.search_knows('revenue', group_id='g1', limit=5)

    assert results == [expected]
    assert search.await_args.args[4].node_labels == ['Know']
    assert search.await_args.args[3].episode_config is not None
    assert search.await_args.args[3].limit == 5


@pytest.mark.asyncio
async def test_get_know_requires_the_resolved_group(monkeypatch):
    now = datetime(2026, 10, 20, tzinfo=timezone.utc)
    driver = SimpleNamespace(provider=GraphProvider.NEO4J, _database='g1')
    graphiti = Graphiti.__new__(Graphiti)
    graphiti.driver = driver
    graphiti.clients = SimpleNamespace(driver=driver)
    know = KnowNode.from_episode(
        _episode(now),
        entity_uuid='entity-1',
        observation='A sourced observation.',
        interpretation='A bounded interpretation.',
        citation=_citation(),
        direction=None,
        content_hash='e' * 64,
    )
    monkeypatch.setattr(KnowNode, 'get_by_uuid', AsyncMock(return_value=know))

    assert await graphiti.get_know('know-1', group_id='g1') is know
    know.group_id = 'another-group'
    with pytest.raises(graphiti_module.NodeNotFoundError):
        await graphiti.get_know('know-1', group_id='g1')


@pytest.mark.asyncio
async def test_resolve_know_entity_reuses_exact_existing_name(monkeypatch):
    now = datetime(2026, 10, 20, tzinfo=timezone.utc)
    entity = EntityNode(
        uuid='entity-existing',
        name='Example Corp',
        group_id='g1',
        created_at=now,
    )
    driver = SimpleNamespace(
        execute_query=AsyncMock(
            return_value=([{'uuid': 'entity-existing'}], None, None)
        )
    )
    clients = SimpleNamespace(driver=driver, embedder=object())
    get_by_uuid = AsyncMock(return_value=entity)
    monkeypatch.setattr(EntityNode, 'get_by_uuid', get_by_uuid)

    resolved, created = await resolve_know_entity(
        clients,
        group_id='g1',
        entity_name='Example Corp',
        entity_uuid=None,
    )

    assert resolved is entity
    assert created is False
    get_by_uuid.assert_awaited_once_with(driver, 'entity-existing')


@pytest.mark.asyncio
async def test_resolve_know_entity_creates_when_exact_name_is_absent(monkeypatch):
    driver = SimpleNamespace(
        execute_query=AsyncMock(return_value=([], None, None))
    )
    clients = SimpleNamespace(driver=driver, embedder=object())
    generate = AsyncMock(return_value=[0.1, 0.2])
    save = AsyncMock(return_value=None)
    monkeypatch.setattr(EntityNode, 'generate_name_embedding', generate)
    monkeypatch.setattr(EntityNode, 'save', save)

    resolved, created = await resolve_know_entity(
        clients,
        group_id='g1',
        entity_name='New Entity',
        entity_uuid=None,
    )

    assert resolved.name == 'New Entity'
    assert resolved.group_id == 'g1'
    assert created is True
    generate.assert_awaited_once_with(clients.embedder)
    save.assert_awaited_once_with(driver)


@pytest.mark.asyncio
async def test_remove_know_episode_without_attachment_edges_preserves_entity(monkeypatch):
    now = datetime(2026, 10, 20, tzinfo=timezone.utc)
    episode = _episode(now)
    driver = SimpleNamespace(
        provider=GraphProvider.NEO4J,
        execute_query=AsyncMock(),
    )
    graphiti = Graphiti.__new__(Graphiti)
    graphiti.driver = driver
    monkeypatch.setattr(EpisodicNode, 'get_by_uuid', AsyncMock(return_value=episode))
    monkeypatch.setattr(EntityEdge, 'get_by_uuids', AsyncMock(return_value=[]))
    monkeypatch.setattr(graphiti_module, 'get_mentioned_nodes', AsyncMock(return_value=[]))
    monkeypatch.setattr(Edge, 'delete_by_uuids', AsyncMock(return_value=None))
    delete_nodes = AsyncMock(return_value=None)
    delete_episode = AsyncMock(return_value=None)
    monkeypatch.setattr(Node, 'delete_by_uuids', delete_nodes)
    monkeypatch.setattr(EpisodicNode, 'delete', delete_episode)

    await graphiti.remove_episode(episode.uuid)

    driver.execute_query.assert_not_awaited()
    delete_nodes.assert_awaited_once_with(driver, [])
    delete_episode.assert_awaited_once_with(driver)
