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
