"""MCP process-wide catalog lifecycle contract tests."""

import os
import socket
import sys

import pytest

_APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _APP_DIR not in sys.path:
    sys.path.insert(0, _APP_DIR)

from app.python_models.provider_config import ensure_env_loaded

ensure_env_loaded()

from app import (
    mcp_auth,
    mcp_catalog_runtime,
    mcp_cbm_provider,
    mcp_graphiti_provider,
    mcp_observability,
)


def test_main_selects_streamable_http_transport(monkeypatch):
    import asyncio
    import mcp_host

    events = []

    async def run_http():
        events.append("http")

    async def run_stdio():
        events.append("stdio")

    monkeypatch.setattr(mcp_host, "MCP_TRANSPORT", "streamable-http")
    monkeypatch.setattr(mcp_host, "_run_streamable_http", run_http)
    monkeypatch.setattr(mcp_host, "_run_stdio", run_stdio)

    asyncio.run(mcp_host.main())

    assert events == ["http"]

def test_catalog_guard_never_exposes_initializing_or_failed_catalog(monkeypatch):
    import asyncio
    import mcp_host
    from mcp.types import Tool

    monkeypatch.setattr(mcp_host, "MCP_TRANSPORT", "streamable-http")
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_STATE", "initializing")
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_FAILURE", None)
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_TOOLS", None)
    with pytest.raises(RuntimeError, match="mcp_catalog_initializing"):
        mcp_catalog_runtime._catalog_or_error()

    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_STATE", "failed")
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_FAILURE", "RuntimeError: cbm_failed")
    with pytest.raises(RuntimeError, match="cbm_failed"):
        mcp_catalog_runtime._catalog_or_error()

    catalog_size = 7
    catalog_names = [f"tool-{index}" for index in range(catalog_size)]
    tools = tuple(
        Tool(
            name=name,
            description="ready",
            inputSchema={"type": "object", "properties": {}},
        )
        for name in catalog_names
    )
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_STATE", "ready")
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_FAILURE", None)
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_TOOLS", tools)
    ready = asyncio.run(mcp_catalog_runtime.list_tools())
    assert len(ready) == len({tool.name for tool in ready}) == catalog_size

def test_http_tools_list_waits_for_the_one_frozen_catalog(monkeypatch):
    import asyncio
    import mcp_host
    from mcp.types import Tool

    release = asyncio.Event()

    async def complete_catalog():
        await release.wait()
        for family in ("liquidaity", "cbm", "graphiti"):
            mcp_catalog_runtime._complete_catalog_family(family)
        return [Tool(
            name="ready.tool",
            description="Ready only after the full catalog freezes.",
            inputSchema={"type": "object", "properties": {}},
        )]

    monkeypatch.setattr(mcp_catalog_runtime, "_materialize_complete_catalog", complete_catalog)
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_STATE", "initializing")
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_FAILURE", None)
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_TOOLS", None)
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_INITIALIZATION_TASK", None)
    async def check():
        pending = asyncio.create_task(mcp_catalog_runtime.list_tools())
        await asyncio.sleep(0)
        assert pending.done() is False
        release.set()
        tools = await pending
        assert [tool.name for tool in tools] == ["ready.tool"]

    asyncio.run(check())

def test_catalog_initialization_is_process_wide_once(monkeypatch):
    import asyncio
    import mcp_host
    from mcp.types import Tool

    calls = 0

    catalog_names = [f"tool-{index}" for index in range(5)]
    catalog_size = len(catalog_names)

    async def complete_catalog():
        nonlocal calls
        calls += 1
        await asyncio.sleep(0)
        for family in ("liquidaity", "cbm", "graphiti"):
            mcp_catalog_runtime._complete_catalog_family(family)
        return [
            Tool(
                name=name,
                description="ready",
                inputSchema={"type": "object", "properties": {}},
            )
            for name in catalog_names
        ]

    monkeypatch.setattr(mcp_catalog_runtime, "_materialize_complete_catalog", complete_catalog)
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_STATE", "initializing")
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_FAILURE", None)
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_TOOLS", None)
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_INITIALIZATION_TASK", None)
    async def check():
        first = mcp_catalog_runtime._start_catalog_initialization()
        second = mcp_catalog_runtime._start_catalog_initialization()
        assert first is second
        await asyncio.gather(first, second)

    asyncio.run(check())
    assert calls == 1
    assert mcp_catalog_runtime._CATALOG_STATE == "ready"
    assert len(mcp_catalog_runtime._CATALOG_TOOLS or ()) == catalog_size

def test_catalog_task_cannot_end_in_false_initializing_state(monkeypatch):
    import asyncio
    import mcp_host

    async def incomplete_initializer():
        return None

    monkeypatch.setattr(
        mcp_catalog_runtime, "_initialize_catalog_once", incomplete_initializer
    )
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_STATE", "initializing")
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_FAILURE", None)
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_FAILURE_CODE", None)
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_FAILURE_SUMMARY", None)
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_TOOLS", None)
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_INITIALIZATION_TASK", None)

    async def check():
        await mcp_catalog_runtime._start_catalog_initialization()
        await asyncio.sleep(0)

    asyncio.run(check())
    diagnostics = mcp_catalog_runtime._catalog_diagnostics()
    assert diagnostics["catalogState"] == "failed"
    assert diagnostics["failureCode"] == "catalog_initializer_ended_without_state"
    assert mcp_catalog_runtime._CATALOG_TOOLS is None

def test_catalog_initialization_has_no_arbitrary_30_second_deadline():
    import inspect
    import mcp_host

    source = inspect.getsource(mcp_catalog_runtime._initialize_catalog_once)
    assert "wait_for" not in source
    assert "30" not in source

def test_provider_catalog_progress_is_part_of_canonical_startup(monkeypatch):
    import asyncio
    import mcp_host

    snapshots = []

    async def cbm_catalog():
        snapshots.append(mcp_catalog_runtime._catalog_diagnostics())
        return []

    async def graphiti_catalog():
        snapshots.append(mcp_catalog_runtime._catalog_diagnostics())
        return []

    monkeypatch.setattr(mcp_cbm_provider, "_cbm_tools", cbm_catalog)
    monkeypatch.setattr(mcp_graphiti_provider, "_graphiti_tools", graphiti_catalog)
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_STATE", "initializing")
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_COMPLETED_FAMILIES", ())
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_UNAVAILABLE_FAMILIES", ())
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_INITIALIZING_FAMILY", "liquidaity")

    asyncio.run(mcp_catalog_runtime._materialize_complete_catalog())
    assert [item["initializingCatalogFamily"] for item in snapshots] == [
        "cbm",
        "graphiti",
    ]
    assert [item["completedCatalogFamilies"] for item in snapshots] == [
        ["liquidaity"],
        ["liquidaity", "cbm"],
    ]
    assert mcp_catalog_runtime._CATALOG_COMPLETED_FAMILIES == (
        "liquidaity",
        "cbm",
        "graphiti",
    )
    assert mcp_catalog_runtime._CATALOG_INITIALIZING_FAMILY is None

def test_cbm_catalog_failure_is_reported_without_cross_task_client_teardown(
    monkeypatch,
):
    import asyncio
    import mcp_host

    traces = []
    closed = []

    async def unavailable_cbm():
        raise RuntimeError("cbm_process_not_running")

    monkeypatch.setattr(mcp_cbm_provider, "_cbm_tools", unavailable_cbm)
    monkeypatch.setattr(
        mcp_graphiti_provider,
        "_graphiti_tools",
        lambda: asyncio.sleep(0, result=[]),
    )
    monkeypatch.setattr(
        mcp_cbm_provider,
        "_close_cbm",
        lambda: closed.append(True),
    )
    monkeypatch.setattr(
        mcp_observability,
        "trace",
        lambda event, **fields: traces.append((event, fields)),
    )
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_COMPLETED_FAMILIES", ())
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_UNAVAILABLE_FAMILIES", ())
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_INITIALIZING_FAMILY", "liquidaity")

    asyncio.run(mcp_catalog_runtime._initialize_catalog_once())
    tools = list(mcp_catalog_runtime._CATALOG_TOOLS or ())

    assert tools
    assert not any(tool.name.startswith("cbm.") for tool in tools)
    assert closed == []
    assert mcp_catalog_runtime._CATALOG_COMPLETED_FAMILIES == (
        "liquidaity",
        "graphiti",
    )
    assert mcp_catalog_runtime._CATALOG_INITIALIZING_FAMILY is None
    diagnostics = mcp_catalog_runtime._catalog_diagnostics()
    assert diagnostics["catalogReady"] is True
    assert diagnostics["unavailableCatalogFamilies"] == ["cbm"]
    listed = asyncio.run(mcp_catalog_runtime.list_tools())
    assert listed
    assert not any(tool.name.startswith("cbm.") for tool in listed)
    assert any(
        event == "catalog_family_unavailable"
        and fields["catalog_family"] == "cbm"
        and fields["failure_code"] == "cbm_process_not_running"
        for event, fields in traces
    )

def test_http_listener_and_health_are_live_while_catalog_is_slow(monkeypatch):
    import asyncio
    import httpx
    import mcp_host
    from mcp import Client
    from mcp.types import Tool

    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    entered = asyncio.Event()
    release = asyncio.Event()
    calls = 0

    catalog_size = 6
    catalog_names = [f"tool-{index}" for index in range(catalog_size)]

    async def slow_complete_catalog():
        nonlocal calls
        calls += 1
        entered.set()
        await release.wait()
        for family in ("liquidaity", "cbm", "graphiti"):
            mcp_catalog_runtime._complete_catalog_family(family)
        return [
            Tool(
                name=name,
                description="ready",
                inputSchema={"type": "object", "properties": {}},
            )
            for name in catalog_names
        ]

    async def closed_graphiti():
        return None

    async def no_cbm(*_args, **_kwargs):
        return None

    monkeypatch.setattr(mcp_host, "MCP_TRANSPORT", "streamable-http")
    monkeypatch.setattr(mcp_host, "HTTP_MCP_PORT", port)
    monkeypatch.setattr(mcp_auth, "OAUTH_ENFORCED", False)
    monkeypatch.setattr(mcp_catalog_runtime, "_materialize_complete_catalog", slow_complete_catalog)
    monkeypatch.setattr(mcp_graphiti_provider, "_close_graphiti", closed_graphiti)
    monkeypatch.setattr(mcp_cbm_provider, "_start_cbm_client", no_cbm)
    monkeypatch.setattr(mcp_cbm_provider, "_close_cbm", no_cbm)
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_STATE", "initializing")
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_FAILURE", None)
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_TOOLS", None)
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_INITIALIZATION_TASK", None)

    async def check():
        server_task = asyncio.create_task(mcp_host.main())
        try:
            base_url = f"http://127.0.0.1:{port}"
            async with httpx.AsyncClient(base_url=base_url, timeout=2) as client:
                for _ in range(30):
                    try:
                        health = await client.get("/health")
                        if health.status_code == 200:
                            break
                    except Exception:
                        pass
                    await asyncio.sleep(0.1)
                else:
                    raise RuntimeError("http_health_not_ready")
                await entered.wait()
                assert health.json()["catalogState"] == "initializing"
                catalog_readiness = await client.get("/health/catalog")
                assert catalog_readiness.status_code == 503
                assert catalog_readiness.json()["catalogReady"] is False
                readiness = await client.get("/health/ready")
                assert readiness.status_code == 503
                assert readiness.json()["catalogReady"] is False
                release.set()
                for _ in range(30):
                    catalog_readiness = await client.get("/health/catalog")
                    if catalog_readiness.status_code == 200:
                        break
                    await asyncio.sleep(0.1)
                assert catalog_readiness.json()["toolCount"] == catalog_size
                readiness = await client.get("/health/ready")
                assert readiness.status_code == 200
                assert "codeGraphReady" not in readiness.json()

            async with Client(f"{base_url}/mcp", mode="auto") as session:
                    assert session.protocol_version == "2026-07-28"
                    tools = (await session.list_tools(cache_mode="refresh")).tools
                    assert len(tools) == len({tool.name for tool in tools}) == catalog_size
        finally:
            server_task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await server_task

    asyncio.run(check())
    assert calls == 1

def test_catalog_failure_is_truthful_and_unavailable(monkeypatch, capsys):
    import asyncio
    import mcp_host

    async def failed_catalog():
        raise RuntimeError("graphiti_catalog_failed")

    monkeypatch.setattr(mcp_catalog_runtime, "_materialize_complete_catalog", failed_catalog)
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_STATE", "initializing")
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_FAILURE", None)
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_TOOLS", None)

    asyncio.run(mcp_catalog_runtime._initialize_catalog_once())

    diagnostics = mcp_catalog_runtime._catalog_diagnostics()
    assert diagnostics["catalogState"] == "failed"
    assert diagnostics["state"] == "failed"
    assert diagnostics["catalogReady"] is False
    assert diagnostics["catalogFailure"] == (
        "RuntimeError: graphiti_catalog_failed"
    )
    assert diagnostics["failureCode"] == "graphiti_catalog_failed"
    assert diagnostics["failureSummary"] == diagnostics["catalogFailure"]
    assert diagnostics["completedCatalogFamilies"] == []
    assert diagnostics["initializingCatalogFamily"] == "liquidaity"
    assert "toolCount" not in diagnostics
    assert "catalogHash" not in diagnostics
    assert mcp_catalog_runtime._CATALOG_TOOLS is None
    stderr = capsys.readouterr().err
    assert "full local traceback follows" in stderr
    assert "Traceback (most recent call last)" in stderr
    assert "graphiti_catalog_failed" in stderr
