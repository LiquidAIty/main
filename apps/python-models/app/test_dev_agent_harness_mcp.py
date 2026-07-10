import asyncio
import json
from unittest.mock import patch

from app import dev_agent_harness_mcp as harness


def test_runtime_reality_tools_are_one_dev_mcp_surface():
    tools = asyncio.run(harness.list_tools())
    names = {tool.name for tool in tools}
    assert {
        "describe_runtime_test_capabilities",
        "start_agent_runtime_test",
        "get_agent_runtime_test",
        "cancel_agent_runtime_test",
    } <= names
    assert "get_coder_run" not in names
    assert "emit_coder_event" not in names


def test_runtime_reality_calls_wrap_backend_routes():
    seen = []

    def fake_http(method, url, payload=None):
        seen.append((method, url, payload))
        return json.dumps({"ok": True})

    with patch.object(harness, "_http_sync", side_effect=fake_http):
        asyncio.run(harness.call_tool("describe_runtime_test_capabilities", {}))
        asyncio.run(harness.call_tool("start_agent_runtime_test", {"mode": "single_coder"}))
        asyncio.run(harness.call_tool("get_agent_runtime_test", {"runtimeTestId": "rtest_1"}))
        asyncio.run(harness.call_tool("cancel_agent_runtime_test", {"runtimeTestId": "rtest_1"}))

    assert [item[0] for item in seen] == ["GET", "POST", "GET", "POST"]
    assert seen[0][1].endswith("/runtime-tests/capabilities?")
    assert seen[1][1].endswith("/runtime-tests")
    assert seen[2][1].endswith("/runtime-tests/rtest_1")
    assert seen[3][1].endswith("/runtime-tests/rtest_1/cancel")
