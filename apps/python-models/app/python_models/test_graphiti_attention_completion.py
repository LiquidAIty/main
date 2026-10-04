"""Real native queue scheduling with provider-free SDK completion fixtures."""

import asyncio
from types import SimpleNamespace

from app import mcp_host
from services.queue_service import QueueService


def test_native_queue_preserves_each_request_identity_until_actual_completion(monkeypatch):
    observations = []
    completed = asyncio.Event()

    async def persist(event, context):
        observations.append((dict(event), dict(context)))
        if len([entry for entry, _ in observations if entry["phase"] != "pending"]) == 4:
            completed.set()
        return True

    async def native_add_episode(**args):
        await asyncio.sleep(0)
        if args["name"] == "failure":
            raise RuntimeError("native write failed")
        if args["name"] == "unknown":
            return SimpleNamespace(episode=None, nodes=None, edges=None)
        return SimpleNamespace(episode=SimpleNamespace(uuid=f'episode-{args["name"]}'),
                               nodes=[SimpleNamespace(uuid=f'node-{args["name"]}')], edges=[])

    monkeypatch.setattr(mcp_host, "_persist_native_attention", persist)

    async def run():
        queue = QueueService()
        client = SimpleNamespace(add_episode=native_add_episode)
        await queue.initialize(client)
        mcp_host._instrument_graphiti_attention(client, queue)
        wrapped = queue.add_episode_task
        mcp_host._instrument_graphiti_attention(client, queue)
        assert queue.add_episode_task is wrapped
        for name in ("first", "second", "failure", "unknown"):
            context = {"projectId": "project-one", "deckId": "deck-one", "mainCardId": f"card-{name}",
                       "parentRunId": f"run-{name}", "conversationId": f"conversation-{name}"}
            token = mcp_host._ACTIVE_GRAPHITI_ATTENTION.set({"context": context, "event": None})
            try:
                await queue.add_episode(group_id="one-native-queue", name=name, content="fixture",
                                        source_description="fixture", episode_type="text", entity_types={}, uuid=None)
            finally:
                mcp_host._ACTIVE_GRAPHITI_ATTENTION.reset(token)
        await asyncio.wait_for(completed.wait(), timeout=2)

    asyncio.run(run())
    for name in ("first", "second", "failure", "unknown"):
        events = [event for event, context in observations if context["mainCardId"] == f"card-{name}"]
        assert len(events) == 2
        assert events[0]["phase"] == "pending"
        assert events[0]["nativeNodeIds"] == []
        assert events[0]["eventId"] == events[1]["eventId"]
        assert events[1]["runId"] == f"run-{name}"
        if name == "failure":
            assert events[1]["phase"] == "failed"
            assert events[1]["nativeNodeIds"] == []
        elif name == "unknown":
            assert events[1]["phase"] == "completed"
            assert events[1]["nativeNodeIds"] == events[1]["nativeEdgeIds"] == []
        else:
            assert events[1]["phase"] == "completed"
            assert events[1]["nativeNodeIds"] == [f"episode-{name}", f"node-{name}"]


def test_canonical_know_completion_separates_episode_entity_and_fact_ids(monkeypatch):
    observations = []
    completed = asyncio.Event()
    driver_calls = []
    context = {
        "projectId": "project-one", "deckId": "deck-one",
        "mainCardId": "card_knowgraph", "parentRunId": "run-one",
        "conversationId": "conversation-one",
    }
    payload = {
        "schemaVersion": "knowgraph.source-observation.v2",
        "name": "One exact Know",
        "observations": [{
            "datum": "One source-supported datum.",
            "interpretation": "One bounded interpretation.",
            "citations": [{
                "url": "https://primary.example/report",
                "title": "Primary report",
                "publishedAt": None,
                "sourceNote": "This report establishes the datum.",
            }],
            "relevantEntities": ["Rocket Lab"],
        }],
    }
    native_args, authority = mcp_host._canonical_know_submission(payload, context)

    async def persist(event, _context):
        observations.append(dict(event))
        if event["phase"] == "completed":
            completed.set()
        return True

    async def execute_query(query, **parameters):
        driver_calls.append((query, parameters))
        return []

    async def native_add_episode(**_args):
        return SimpleNamespace(
            episode=SimpleNamespace(uuid=authority["episode_uuid"]),
            nodes=[SimpleNamespace(uuid="entity-one")],
            edges=[SimpleNamespace(
                uuid="fact-one", source_node_uuid="entity-one",
                target_node_uuid="entity-two", name="SUPPORTS",
            )],
        )

    monkeypatch.setattr(mcp_host, "_persist_native_attention", persist)

    async def run():
        queue = QueueService()
        client = SimpleNamespace(
            add_episode=native_add_episode,
            driver=SimpleNamespace(execute_query=execute_query),
        )
        await queue.initialize(client)
        mcp_host._instrument_graphiti_attention(client, queue)
        token = mcp_host._ACTIVE_GRAPHITI_ATTENTION.set({
            "context": context, "event": None, "know_authority": authority,
        })
        try:
            await queue.add_episode(
                group_id="liquidaity-project-one",
                name=native_args["name"],
                content=native_args["episode_body"],
                source_description=native_args["source_description"],
                episode_type="json",
                entity_types={},
                uuid=native_args["uuid"],
            )
        finally:
            mcp_host._ACTIVE_GRAPHITI_ATTENTION.reset(token)
        await asyncio.wait_for(completed.wait(), timeout=2)

    asyncio.run(run())

    assert [event["phase"] for event in observations] == ["pending", "completed"]
    assert {event["eventId"] for event in observations} == {authority["call_id"]}
    assert {event["callId"] for event in observations} == {authority["call_id"]}
    assert observations[0]["nativeEpisodeIds"] == []
    assert observations[1]["nativeEpisodeIds"] == [authority["episode_uuid"]]
    assert observations[1]["nativeNodeIds"] == ["entity-one"]
    assert observations[1]["nativeEdgeIds"] == ["fact-one"]
    assert authority["episode_uuid"] not in observations[1]["nativeNodeIds"]
    assert driver_calls[0][1]["call_id"] == authority["call_id"]
    assert driver_calls[0][1]["canonical_know_json"] == authority[
        "canonical_know_json"
    ]
