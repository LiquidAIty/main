"""Restricted codegraph doorway: exactly two read-only tools, real backend
handlers, no write/product surface, honest failure. No model, no network."""

from __future__ import annotations

import asyncio
import json
import os
import sys
from urllib.error import URLError

# The doorway lives in app/ (a sibling of this test's app/python_models/ dir).
_APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _APP not in sys.path:
    sys.path.insert(0, _APP)

import codegraph_doorway_mcp as doorway  # noqa: E402


def _doorway_source() -> str:
    with open(os.path.join(_APP, "codegraph_doorway_mcp.py"), encoding="utf-8") as handle:
        return handle.read()


def test_exposes_exactly_two_readonly_codegraph_tools():
    names = sorted(tool.name for tool in doorway._tools())
    assert names == ["codegraph.search", "codegraph.status"]


def test_no_write_or_product_tools_registered():
    names = {tool.name for tool in doorway._tools()}
    for forbidden in (
        "thinkgraph.submit_update",
        "thinkgraph.get_graph_slice",
        "knowgraph.ingest",
        "knowgraph.query",
        "card.update_configuration",
        "canvas.upsert_wire",
        "run_mag_one",
        "run_coder_subagent",
        "web_search",
    ):
        assert forbidden not in names


def test_source_registers_and_dispatches_only_codegraph():
    import re

    src = _doorway_source()
    # Exactly the two codegraph tools are registered (Tool name= entries).
    assert sorted(re.findall(r'name="([^"]+)"', src)) == ["codegraph.search", "codegraph.status"]
    # No write/mutation backend endpoint or shell tool is referenced (exact tokens,
    # so the docstring's plain-English exclusions never trip this).
    for forbidden in (
        "thinkgraph_submit_update",
        "apply_thinkgraph_patch",
        "knowgraph_ingest",
        "knowgraph_query",
        "run_mag_one",
        "run_coder_subagent",
        "card_update_configuration",
        "canvas_upsert_wire",
        '"web_search"',
        "Bash",
        "PowerShell",
    ):
        assert forbidden not in src, f"doorway regressed: references {forbidden}"


def test_status_and_search_call_the_real_backend_endpoints(monkeypatch):
    calls: list[tuple[str, dict]] = []

    def fake_bridge(path, payload):
        calls.append((path, payload))
        return json.dumps({"ok": True, "path": path})

    monkeypatch.setattr(doorway, "_bridge_sync", fake_bridge)
    asyncio.run(doorway._dispatch("codegraph.status", {}))
    asyncio.run(doorway._dispatch("codegraph.search", {
        "query": "runCoderSubagent",
        "limit": 5,
        "projectId": "project-1",
        "conversationId": "conversation-1",
    }))
    assert calls[0] == ("codegraph_status", {})
    assert calls[1] == ("codegraph_search", {
        "query": "runCoderSubagent",
        "limit": 5,
        "projectId": "project-1",
            "conversationId": "conversation-1",
            "requestingRole": None,
            "producingRole": None,
            "receivingRole": None,
            "parentViewId": None,
            "note": None,
            "hopDepth": None,
        })


def test_unknown_tool_fails_honestly():
    out = asyncio.run(doorway._dispatch("codegraph.write", {}))
    assert "unknown_tool" in out[0].text


def test_missing_cbm_backend_fails_honestly(monkeypatch):
    def boom(*_args, **_kwargs):
        raise URLError("connection refused")

    monkeypatch.setattr(doorway, "urlopen", boom)
    out = doorway._bridge_sync("codegraph_status", {})
    parsed = json.loads(out)
    assert parsed["ok"] is False
    assert "codegraph_backend_unreachable" in parsed["error"]
