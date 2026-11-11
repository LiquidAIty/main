"""Focused contracts for first-class Entity-attached Knows."""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

import graphiti_core.graphiti as graphiti_module
from graphiti_core.driver.driver import GraphProvider
from graphiti_core.edges import CommunityEdge, Edge, EntityEdge
from graphiti_core.graphiti import AddEpisodeResults, Graphiti
from graphiti_core.knows import (
    KnowCitation,
    KnowDirection,
    KnowNode,
    KnowRelationship,
    know_content_hash,
    know_episode_content,
    resolve_know_entity,
)
from graphiti_core.nodes import CommunityNode, EntityNode, EpisodeType, EpisodicNode, Node
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
async def test_save_know_preserves_mentions_and_removes_only_redundant_about_edges():
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
    assert 'OPTIONAL MATCH (know)-[attachment:ABOUT]->()' in query
    assert 'MENTIONS' not in query
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


def test_named_relationship_requires_explicit_name_and_rejects_the_replaced_uuid_input():
    assert KnowRelationship(target_entity_name=' SpaceX ', fact='Supplier supplies components').target_entity_name == 'SpaceX'
    schema = KnowRelationship.model_json_schema()
    assert 'target_entity_name' in schema['required']
    assert 'target_entity_uuid' not in schema['properties']
    for target in ({}, {'target_entity_name': ' '}, {'target_entity_uuid': 'existing-target'},
                   {'target_entity_name': 'SpaceX', 'target_entity_uuid': 'existing-target'}):
        with pytest.raises(ValueError):
            KnowRelationship(fact='Supplier supplies components', **target)


@pytest.mark.asyncio
async def test_named_relationship_prepares_only_declared_targets_for_the_same_know_transaction(monkeypatch):
    now = datetime(2026, 11, 10, tzinfo=timezone.utc)
    owner = EntityNode(uuid='owner', name='Supplier', group_id='g1', created_at=now)
    target = EntityNode(uuid='target', name='SpaceX', group_id='g1', created_at=now)
    driver = SimpleNamespace(provider=GraphProvider.NEO4J)
    clients = SimpleNamespace(driver=driver, embedder=object())
    graphiti = Graphiti.__new__(Graphiti)
    graphiti._resolve_request_scope = lambda _group: ('g1', driver, clients)
    resolver = AsyncMock(side_effect=[(owner, True), (target, True)])
    monkeypatch.setattr(graphiti_module, 'resolve_know_entity', resolver)
    monkeypatch.setattr(EntityEdge, 'generate_embedding', AsyncMock())
    calls = []

    async def save(know, passed_driver, **kwargs):
        calls.append((know, passed_driver, kwargs))
        return know, owner, True, True, kwargs['relationships']

    monkeypatch.setattr(KnowNode, 'save_know', save)
    result = await graphiti.add_know(
        name='Supplier relationship', entity_name='Supplier',
        observation='Supplier provides components to SpaceX.', interpretation='Revenue size is unknown.',
        citation=_citation(), group_id='g1', reference_time=now,
        relationships=[{'target_entity_name': 'SpaceX', 'fact': 'Supplier provides components to SpaceX.'},
                       {'target_entity_name': 'spacex', 'fact': 'Supplier co-designs those components with SpaceX.'}],
    )
    assert resolver.await_count == 2
    assert resolver.await_args_list[1].kwargs == {
        'group_id': 'g1', 'entity_name': 'SpaceX', 'entity_uuid': None,
    }
    assert len(calls) == 1 and calls[0][1] is driver
    assert calls[0][2]['relationship_targets'] == [target]
    assert result.know.entity_uuid == owner.uuid
    assert [(edge.source_node_uuid, edge.target_node_uuid) for edge in result.relationships] == [('owner', 'target'), ('owner', 'target')]


@pytest.mark.asyncio
@pytest.mark.parametrize('existing', [[], [{'uuid': 'existing'}], [{'uuid': 'a'}, {'uuid': 'b'}]])
async def test_named_relationship_target_uses_project_name_identity_and_rejects_ambiguity(existing):
    from graphiti_core.knows import _save_named_relationship_target, normalize_entity_name
    import hashlib
    now = datetime(2026, 11, 10, tzinfo=timezone.utc)
    target = EntityNode(uuid='prepared', name='SpaceX', group_id='g1', created_at=now)
    tx = SimpleNamespace(run=AsyncMock(side_effect=[
        SimpleNamespace(data=AsyncMock(return_value=existing)),
        SimpleNamespace(data=AsyncMock(return_value=[{'uuid': 'concurrent-canonical'}])),
    ]))
    if len(existing) > 1:
        with pytest.raises(ValueError, match='ambiguous'):
            await _save_named_relationship_target(tx, target)
        assert tx.run.await_count == 1
    else:
        result = await _save_named_relationship_target(tx, target)
        assert result == ('existing' if existing else 'concurrent-canonical')
        query = tx.run.await_args_list[0]
        assert 'n.group_id=$group' in query.args[0]
        assert query.kwargs == {'group': 'g1', 'name': 'SpaceX'}
        if not existing:
            created = tx.run.await_args_list[1]
            assert created.kwargs['identity'] == hashlib.sha256(f'g1\0name:{normalize_entity_name("SpaceX")}'.encode()).hexdigest()
            assert 'Know' not in created.args[0]


@pytest.mark.asyncio
@pytest.mark.parametrize('resolved_id', ['canonical-target', 'owner'])
async def test_named_relationship_save_remaps_concurrent_identity_and_rolls_back_self_link(monkeypatch, resolved_id):
    from contextlib import asynccontextmanager
    import graphiti_core.knows as knows_module
    now = datetime(2026, 11, 10, tzinfo=timezone.utc)
    owner = EntityNode(uuid='owner', name='Supplier', group_id='g1', created_at=now)
    target = EntityNode(uuid='prepared-target', name='Target', group_id='g1', created_at=now)
    know = KnowNode(uuid='existing-know', name='Finding', group_id='g1', created_at=now,
        valid_at=now, source_description='Primary source', content='Evidence', entity_uuid='owner',
        observation='Supplier provides components.', interpretation='Limited evidence.', citation=_citation(), content_hash='a' * 64)
    edge = EntityEdge(source_node_uuid='owner', target_node_uuid=target.uuid, name='RELATED_TO',
        fact='Supplier provides components to target.', group_id='g1', created_at=now)
    run = AsyncMock(side_effect=[
        SimpleNamespace(data=AsyncMock(return_value=[{'properties': know._properties()}])),
        SimpleNamespace(data=AsyncMock(return_value=[{}])),
        SimpleNamespace(data=AsyncMock(return_value=[])),
        SimpleNamespace(data=AsyncMock(return_value=[{'uuid': resolved_id}])),
        SimpleNamespace(data=AsyncMock(return_value=[{'uuid': value} for value in {'owner', resolved_id}])),
        SimpleNamespace(data=AsyncMock(return_value=[])),
        SimpleNamespace(),
    ])
    outcomes = []
    @asynccontextmanager
    async def transaction():
        try:
            yield SimpleNamespace(run=run)
            outcomes.append('committed')
        except Exception:
            outcomes.append('rolled_back')
            raise
    save_edge = AsyncMock()
    driver = SimpleNamespace(provider=GraphProvider.NEO4J, transaction=transaction,
                             entity_edge_ops=SimpleNamespace(save=save_edge))
    monkeypatch.setattr(knows_module, 'entity_node_from_record', lambda _row: owner)
    if resolved_id == 'owner':
        with pytest.raises(ValueError, match='distinct Entities'):
            await know.save_know(driver, entity=owner, relationships=[edge], relationship_targets=[target])
        assert outcomes == ['rolled_back']
        save_edge.assert_not_awaited()
    else:
        result = await know.save_know(driver, entity=owner, relationships=[edge], relationship_targets=[target])
        assert result[0].uuid == 'existing-know' and result[0].content_hash == 'a' * 64
        assert result[1].uuid == 'owner'
        assert edge.target_node_uuid == 'canonical-target'
        assert edge.attributes['supporting_know_uuids'] == ['existing-know']
        assert outcomes == ['committed']
        save_edge.assert_awaited_once()
    assert 'MERGE (n:Entity' in run.await_args_list[3].args[0]
    assert set(run.await_args_list[4].kwargs['ids']) == {'owner', resolved_id}
    assert not any('MERGE (know:Know' in call.args[0] for call in run.await_args_list)


@pytest.mark.asyncio
@pytest.mark.parametrize('endpoints', [[{'uuid': 'owner'}, {'uuid': 'target'}], [], [{'uuid': 'owner'}]])
async def test_relationship_endpoint_needs_entity_not_an_extra_know_and_keeps_evidence(monkeypatch, endpoints):
    from contextlib import asynccontextmanager
    import graphiti_core.knows as knows_module
    now = datetime(2026, 11, 10, tzinfo=timezone.utc)
    owner = EntityNode(uuid='owner', name='Supplier', group_id='g1', created_at=now)
    know = KnowNode(uuid='existing-know', name='Finding', group_id='g1', created_at=now,
        valid_at=now, source_description='Primary source', content='Evidence', entity_uuid='owner',
        observation='Supplier provides components.', interpretation='Limited evidence.', citation=_citation(), content_hash='a' * 64)
    edge = EntityEdge(source_node_uuid='owner', target_node_uuid='target', name='RELATED_TO',
        fact='Supplier provides components to target.', group_id='g1', created_at=now)
    run = AsyncMock(side_effect=[
        SimpleNamespace(data=AsyncMock(return_value=[{'properties': know._properties()}])),
        SimpleNamespace(data=AsyncMock(return_value=[{}])),
        SimpleNamespace(data=AsyncMock(return_value=endpoints)),
        SimpleNamespace(data=AsyncMock(return_value=[])),
        SimpleNamespace(),
    ])
    outcomes = []
    @asynccontextmanager
    async def transaction():
        try:
            yield SimpleNamespace(run=run)
            outcomes.append('committed')
        except Exception:
            outcomes.append('rolled_back')
            raise
    save_edge = AsyncMock()
    driver = SimpleNamespace(provider=GraphProvider.NEO4J, transaction=transaction,
                             entity_edge_ops=SimpleNamespace(save=save_edge))
    monkeypatch.setattr(knows_module, 'entity_node_from_record', lambda _row: owner)
    if len(endpoints) == 2:
        result = await know.save_know(driver, entity=owner, relationships=[edge])
        assert result[0].uuid == 'existing-know'
        assert edge.attributes['supporting_know_uuids'] == ['existing-know']
        assert outcomes == ['committed']
        save_edge.assert_awaited_once()
    else:
        with pytest.raises(ValueError, match='distinct Entities in this Project'):
            await know.save_know(driver, entity=owner, relationships=[edge])
        assert outcomes == ['rolled_back']
        save_edge.assert_not_awaited()
    endpoint_query = run.await_args_list[2]
    assert 'n.group_id=$group' in endpoint_query.args[0]
    assert 'support:Know' not in endpoint_query.args[0]


def test_research_origin_roundtrips_without_changing_know_content_identity():
    from graphiti_core.knows import _know_from_record
    now = datetime(2026, 11, 9, tzinfo=timezone.utc)
    values = dict(uuid='know-research', name='A sourced finding', group_id='project-one',
        created_at=now, valid_at=now, source_description='Primary source', content='Original full content',
        entity_uuid='owner-one', observation='A supported observation.', interpretation='A bounded interpretation.',
        citation=_citation(), content_hash='a' * 64)
    ordinary = KnowNode(**values)
    linked = KnowNode(**values, research_origin_think_id='think-one', research_request_version=2)
    restored = _know_from_record(linked._properties())
    assert restored.research_origin_think_id == 'think-one' and restored.research_request_version == 2
    assert restored.content_hash == ordinary.content_hash and restored.uuid == ordinary.uuid
    assert restored.entity_uuid == ordinary.entity_uuid and restored.created_at == ordinary.created_at
    for invalid in ({'research_origin_think_id': 'think-one'}, {'research_request_version': 1},
                    {'research_origin_think_id': 'think-one', 'research_request_version': 0},
                    {'research_origin_think_id': 'think-one', 'research_request_version': True}):
        with pytest.raises(ValueError):
            KnowNode(**values, **invalid)


@pytest.mark.asyncio
@pytest.mark.parametrize('existing_origin', [None, 'another-think'])
async def test_research_origin_reuses_identical_know_without_overwriting_existing_origin(monkeypatch, existing_origin):
    from contextlib import asynccontextmanager
    import graphiti_core.knows as knows_module
    now = datetime(2026, 11, 9, tzinfo=timezone.utc)
    ordinary = KnowNode(uuid='know-existing', name='A sourced finding', group_id='g1',
        created_at=now, valid_at=now, source_description='Primary source', content='Original content',
        entity_uuid='owner-one', observation='A supported observation.', interpretation='A bounded interpretation.',
        citation=_citation(), content_hash='a' * 64,
        research_origin_think_id=existing_origin, research_request_version=1 if existing_origin else None)
    submitted = ordinary.model_copy(update={'research_origin_think_id': 'think-one', 'research_request_version': 1})
    owner = EntityNode(uuid='owner-one', name='Owner', group_id='g1', created_at=now)
    props = ordinary._properties()
    attached = {**props, 'researchOriginThinkId': existing_origin or 'think-one', 'researchRequestVersion': 1}
    run = AsyncMock(side_effect=[SimpleNamespace(data=AsyncMock(return_value=[{'properties': props}])),
        SimpleNamespace(data=AsyncMock(return_value=[{'properties': attached}])),
        SimpleNamespace(data=AsyncMock(return_value=[{}]))])
    @asynccontextmanager
    async def transaction():
        yield SimpleNamespace(run=run)
    driver = SimpleNamespace(provider=GraphProvider.NEO4J, transaction=transaction)
    monkeypatch.setattr(knows_module, 'entity_node_from_record', lambda _row: owner)
    if existing_origin:
        with pytest.raises(ValueError, match='different research provenance'):
            await submitted.save_know(driver, entity=owner)
    else:
        saved, saved_owner, created, owner_created, edges = await submitted.save_know(driver, entity=owner)
        assert saved.uuid == ordinary.uuid and saved.created_at == ordinary.created_at
        assert saved.content == ordinary.content and saved.content_hash == ordinary.content_hash
        assert saved.research_origin_think_id == 'think-one'
        assert saved_owner == owner and not created and not owner_created and edges == []
    statements = [call.args[0] for call in run.await_args_list]
    assert 'coalesce(know.researchOriginThinkId,$origin)' in statements[1]
    assert not any('MERGE' in statement or 'CREATE' in statement for statement in statements)


@pytest.mark.asyncio
@pytest.mark.parametrize('node_count', [0, 1, 2, 3])
@pytest.mark.parametrize('update_communities', [False, True])
async def test_add_episode_creates_a_new_episode_for_a_caller_supplied_uuid(
    monkeypatch, node_count, update_communities
):
    now = datetime(2026, 10, 20, tzinfo=timezone.utc)
    driver = SimpleNamespace(provider=GraphProvider.NEO4J, _database='g1')
    graphiti = Graphiti.__new__(Graphiti)
    graphiti.driver = driver
    graphiti.clients = SimpleNamespace(driver=driver, llm_client=object(), embedder=object())
    graphiti.tracer = NoOpTracer()
    graphiti.max_coroutines = 1
    graphiti.store_raw_episode_content = True

    monkeypatch.setattr(EpisodicNode, 'get_by_uuids', AsyncMock(return_value=[]))
    get_by_uuid = AsyncMock(side_effect=graphiti_module.NodeNotFoundError('episode-1'))
    monkeypatch.setattr(EpisodicNode, 'get_by_uuid', get_by_uuid)
    nodes = [EntityNode(name=f'Entity {i}', group_id='g1', created_at=now) for i in range(node_count)]
    communities = [CommunityNode(name=f'Community {i}', group_id='g1', created_at=now) for i in range(node_count)]
    community_edges = [CommunityEdge(source_node_uuid=community.uuid, target_node_uuid=node.uuid,
        group_id='g1', created_at=now) for community, node in zip(communities, nodes)]
    updates = [([community], [edge]) for community, edge in zip(communities, community_edges)]
    if node_count == 3:
        updates[-1] = ([], [])  # An Entity without a community remains a valid result.
    update = AsyncMock(side_effect=updates)
    monkeypatch.setattr(graphiti_module, 'update_community', update)
    monkeypatch.setattr(graphiti_module, 'extract_nodes', AsyncMock(return_value=(nodes, {})))
    monkeypatch.setattr(
        graphiti_module,
        'resolve_extracted_nodes',
        AsyncMock(return_value=(nodes, {}, [])),
    )
    monkeypatch.setattr(
        graphiti_module,
        'extract_attributes_from_nodes',
        AsyncMock(return_value=nodes),
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
        update_communities=update_communities,
        previous_episode_uuids=[],
    )

    get_by_uuid.assert_awaited_once_with(driver, 'episode-1')
    assert processed['episode'].uuid == 'episode-1'
    assert result.episode.uuid == 'episode-1'
    assert result.nodes == nodes
    assert update.await_count == (node_count if update_communities else 0)
    assert result.communities == ([community for batch, _ in updates for community in batch] if update_communities else [])
    assert result.community_edges == ([edge for _, batch in updates for edge in batch] if update_communities else [])


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
