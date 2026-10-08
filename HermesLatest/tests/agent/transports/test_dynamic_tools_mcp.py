from __future__ import annotations

import asyncio
import json
import sys
import threading
from contextlib import asynccontextmanager
from types import ModuleType


def test_in_flight_mcp_call_is_cancelled_and_transport_contexts_close(monkeypatch):
    from agent.transports import dynamic_tools_mcp

    entered = asyncio.Event()
    observations: list[str] = []

    class FakeAsyncClient:
        def __init__(self, **_kwargs):
            observations.append("http-created")

        async def __aenter__(self):
            observations.append("http-entered")
            return self

        async def __aexit__(self, *_args):
            observations.append("http-closed")

    @asynccontextmanager
    async def fake_streamable_http_client(_endpoint, *, http_client):
        assert isinstance(http_client, FakeAsyncClient)
        observations.append("stream-entered")
        try:
            yield object(), object()
        finally:
            observations.append("stream-closed")

    class FakeClientSession:
        def __init__(self, *_args, **_kwargs):
            pass

        async def __aenter__(self):
            observations.append("session-entered")
            return self

        async def __aexit__(self, *_args):
            observations.append("session-closed")

        async def initialize(self):
            observations.append("initialized")

        async def call_tool(self, *_args, **_kwargs):
            entered.set()
            try:
                await asyncio.Future()
            except asyncio.CancelledError:
                observations.append("call-cancelled")
                raise

    httpx2 = ModuleType("httpx2")
    httpx2.AsyncClient = FakeAsyncClient
    httpx2.Timeout = lambda value: value
    mcp = ModuleType("mcp")
    mcp.ClientSession = FakeClientSession
    mcp_client = ModuleType("mcp.client")
    mcp_stream = ModuleType("mcp.client.streamable_http")
    mcp_stream.streamable_http_client = fake_streamable_http_client
    monkeypatch.setitem(sys.modules, "httpx2", httpx2)
    monkeypatch.setitem(sys.modules, "mcp", mcp)
    monkeypatch.setitem(sys.modules, "mcp.client", mcp_client)
    monkeypatch.setitem(sys.modules, "mcp.client.streamable_http", mcp_stream)

    async def scenario():
        interrupt_event = threading.Event()
        task = asyncio.create_task(dynamic_tools_mcp._call(
            "http://127.0.0.1:9999/mcp",
            "Bearer exact",
            "graphiti.search_nodes",
            {"query": "bounded"},
            interrupt_event,
        ))
        await asyncio.wait_for(entered.wait(), timeout=1)
        interrupt_event.set()
        return await asyncio.wait_for(task, timeout=1)

    result = asyncio.run(scenario())

    assert result["success"] is False
    assert json.loads(result["contentItems"][0]["text"]) == {
        "error": "dynamic_tool_cancelled",
    }
    assert observations == [
        "http-created",
        "http-entered",
        "stream-entered",
        "session-entered",
        "initialized",
        "call-cancelled",
        "session-closed",
        "stream-closed",
        "http-closed",
    ]
