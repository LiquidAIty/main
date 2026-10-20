from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

import graphiti_core.graphiti as graphiti_module
from graphiti_core.driver.driver import GraphProvider
from graphiti_core.edges import AboutEdge, CommunityEdge
from graphiti_core.errors import NodeNotFoundError
from graphiti_core.graphiti import Graphiti
from graphiti_core.nodes import CommunityNode, EntityNode, EpisodeType, EpisodicNode


class _Driver:
    provider = GraphProvider.NEO4J
    graph_operations_interface = None

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []

    async def execute_query(self, query: str, **params):
        self.calls.append((query, params))
        return ([{"uuid": params.get("uuid")}], None, None)


class _EmptyDriver(_Driver):
    async def execute_query(self, query: str, **params):
        self.calls.append((query, params))
        return ([], None, None)


@pytest.mark.asyncio
async def test_about_edge_is_distinct_from_mentions() -> None:
    driver = _Driver()
    edge = AboutEdge(
        uuid="about-1",
        group_id="group-1",
        source_node_uuid="episode-1",
        target_node_uuid="entity-1",
        created_at=datetime.now(timezone.utc),
    )

    await edge.save(driver)

    assert len(driver.calls) == 1
    query, params = driver.calls[0]
    assert ":ABOUT" in query
    assert ":MENTIONS" not in query
    assert params["episode_uuid"] == "episode-1"
    assert params["entity_uuid"] == "entity-1"


@pytest.mark.asyncio
async def test_process_episode_persists_one_exact_about_edge_in_native_batch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict = {}

    async def save_batch(*_args, **kwargs):
        captured.update(kwargs)

    monkeypatch.setattr(graphiti_module, "add_nodes_and_edges_bulk", save_batch)
    graphiti = Graphiti.__new__(Graphiti)
    graphiti.clients = SimpleNamespace(driver=_Driver(), embedder=object())
    graphiti.store_raw_episode_content = True
    now = datetime.now(timezone.utc)
    episode = EpisodicNode(
        uuid="episode-1",
        name="Know",
        group_id="group-1",
        source=EpisodeType.text,
        source_description="https://example.test/source",
        content="A compact cited Know.",
        created_at=now,
        valid_at=now,
    )

    _mentions, stored_episode, about = await graphiti._process_episode_data(
        episode,
        [],
        [],
        now,
        "group-1",
        "entity-1",
    )

    assert stored_episode.uuid == "episode-1"
    assert about is not None
    assert about.source_node_uuid == "episode-1"
    assert about.target_node_uuid == "entity-1"
    assert captured["about_edges"] == [about]


@pytest.mark.asyncio
async def test_process_episode_without_entity_keeps_original_behavior(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict = {}

    async def save_batch(*_args, **kwargs):
        captured.update(kwargs)

    monkeypatch.setattr(graphiti_module, "add_nodes_and_edges_bulk", save_batch)
    graphiti = Graphiti.__new__(Graphiti)
    graphiti.clients = SimpleNamespace(driver=_Driver(), embedder=object())
    graphiti.store_raw_episode_content = True
    now = datetime.now(timezone.utc)
    episode = EpisodicNode(
        uuid="episode-2",
        name="Ordinary memory",
        group_id="group-1",
        source=EpisodeType.text,
        source_description="ordinary source",
        content="Ordinary content.",
        created_at=now,
        valid_at=now,
    )

    _mentions, _stored_episode, about = await graphiti._process_episode_data(
        episode,
        [],
        [],
        now,
        "group-1",
    )

    assert about is None
    assert captured["about_edges"] is None


@pytest.mark.asyncio
async def test_add_episode_creates_missing_exact_entity_and_about_in_one_bulk_write(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    now = datetime.now(timezone.utc)
    captured: dict = {}

    async def missing_entity(_driver, uuid):
        raise NodeNotFoundError(uuid)

    async def retrieve_episodes(*_args, **_kwargs):
        return []

    async def extract_nodes(*_args, **_kwargs):
        return [], {}

    async def resolve_nodes(*_args, **_kwargs):
        return [], {}, []

    async def resolve_edges(*_args, **_kwargs):
        return [], [], []

    async def hydrate_nodes(_clients, nodes, *_args, **_kwargs):
        return nodes

    async def save_batch(
        _driver,
        episodic_nodes,
        _episodic_edges,
        entity_nodes,
        _entity_edges,
        _embedder,
        about_edges=None,
    ):
        captured["episodic_nodes"] = episodic_nodes
        captured["entity_nodes"] = entity_nodes
        captured["about_edges"] = about_edges

    monkeypatch.setattr(EntityNode, "get_by_uuid", staticmethod(missing_entity))
    monkeypatch.setattr(graphiti_module, "extract_nodes", extract_nodes)
    monkeypatch.setattr(graphiti_module, "resolve_extracted_nodes", resolve_nodes)
    monkeypatch.setattr(graphiti_module, "extract_attributes_from_nodes", hydrate_nodes)
    monkeypatch.setattr(graphiti_module, "add_nodes_and_edges_bulk", save_batch)

    driver = _EmptyDriver()
    graphiti = Graphiti.__new__(Graphiti)
    graphiti.clients = SimpleNamespace(
        driver=driver,
        llm_client=object(),
        embedder=object(),
    )
    graphiti.driver = driver
    graphiti.max_coroutines = None
    graphiti.store_raw_episode_content = True
    graphiti.tracer = SimpleNamespace(start_span=lambda _name: _NullSpan())
    graphiti.retrieve_episodes = retrieve_episodes
    graphiti._resolve_request_scope = lambda group_id: (
        group_id,
        driver,
        graphiti.clients,
    )
    graphiti._extract_and_resolve_edges = resolve_edges

    result = await graphiti.add_episode(
        name="Entity research",
        episode_body="A cited research episode.",
        source_description="https://example.test/source",
        reference_time=now,
        source=EpisodeType.text,
        group_id="group-1",
        update_communities=False,
        entity_uuid="entity-new",
        entity_name="New Entity",
    )

    assert result.episode in captured["episodic_nodes"]
    assert [(node.uuid, node.name) for node in captured["entity_nodes"]] == [
        ("entity-new", "New Entity")
    ]
    assert len(captured["about_edges"]) == 1
    assert captured["about_edges"][0].source_node_uuid == result.episode.uuid
    assert captured["about_edges"][0].target_node_uuid == "entity-new"


@pytest.mark.asyncio
async def test_entity_attached_episode_flattens_all_community_updates(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    now = datetime.now(timezone.utc)
    nodes = [
        EntityNode(
            uuid=f"entity-{index}",
            name=f"Entity {index}",
            group_id="group-1",
            labels=[],
            created_at=now,
        )
        for index in range(3)
    ]

    async def retrieve_episodes(*_args, **_kwargs):
        return []

    async def extract_nodes(*_args, **_kwargs):
        return nodes, {node.uuid: [index] for index, node in enumerate(nodes)}

    async def resolve_nodes(*_args, **_kwargs):
        return nodes, {}, []

    async def resolve_edges(*_args, **_kwargs):
        return [], [], []

    async def hydrate_nodes(*_args, **_kwargs):
        return nodes

    async def process_episode(*args, **_kwargs):
        episode = args[0]
        return [], episode, AboutEdge(
            uuid="about-1",
            group_id="group-1",
            source_node_uuid=episode.uuid,
            target_node_uuid="entity-0",
            created_at=now,
        )

    async def resolve_exact_entity(**_kwargs):
        return nodes[0]

    async def update_one(_driver, _llm, _embedder, node, **_kwargs):
        community = CommunityNode(
            uuid=f"community-{node.uuid}",
            name=f"Community for {node.name}",
            group_id="group-1",
            labels=[],
            created_at=now,
        )
        edge = CommunityEdge(
            uuid=f"edge-{node.uuid}",
            group_id="group-1",
            source_node_uuid=community.uuid,
            target_node_uuid=node.uuid,
            created_at=now,
        )
        return [community], [edge]

    monkeypatch.setattr(graphiti_module, "extract_nodes", extract_nodes)
    monkeypatch.setattr(graphiti_module, "resolve_extracted_nodes", resolve_nodes)
    monkeypatch.setattr(graphiti_module, "extract_attributes_from_nodes", hydrate_nodes)
    monkeypatch.setattr(graphiti_module, "update_community", update_one)

    graphiti = Graphiti.__new__(Graphiti)
    graphiti.clients = SimpleNamespace(
        driver=_Driver(),
        llm_client=object(),
        embedder=object(),
    )
    graphiti.driver = graphiti.clients.driver
    graphiti.max_coroutines = None
    graphiti.tracer = SimpleNamespace(
        start_span=lambda _name: _NullSpan(),
    )
    graphiti.retrieve_episodes = retrieve_episodes
    graphiti._resolve_request_scope = lambda group_id: (
        group_id,
        graphiti.driver,
        graphiti.clients,
    )
    graphiti._extract_and_resolve_edges = resolve_edges
    graphiti._process_episode_data = process_episode
    graphiti._resolve_exact_entity_attachment = resolve_exact_entity

    result = await graphiti.add_episode(
        name="Know",
        episode_body="A cited two-sided Know.",
        source_description="https://example.test/source",
        reference_time=now,
        source=EpisodeType.text,
        group_id="group-1",
        update_communities=True,
        entity_uuid="entity-0",
        entity_name="Entity 0",
    )

    assert [community.uuid for community in result.communities] == [
        "community-entity-0",
        "community-entity-1",
        "community-entity-2",
    ]
    assert [edge.uuid for edge in result.community_edges] == [
        "edge-entity-0",
        "edge-entity-1",
        "edge-entity-2",
    ]


class _NullSpan:
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def add_attributes(self, _attributes):
        return None

    def set_status(self, *_args):
        return None

    def record_exception(self, *_args):
        return None
