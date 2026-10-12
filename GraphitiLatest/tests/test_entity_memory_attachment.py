from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

import graphiti_core.graphiti as graphiti_module
from graphiti_core.driver.driver import GraphProvider
from graphiti_core.edges import AboutEdge
from graphiti_core.graphiti import Graphiti
from graphiti_core.nodes import EpisodeType, EpisodicNode


class _Driver:
    provider = GraphProvider.NEO4J
    graph_operations_interface = None

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []

    async def execute_query(self, query: str, **params):
        self.calls.append((query, params))
        return ([{"uuid": params.get("uuid")}], None, None)


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
