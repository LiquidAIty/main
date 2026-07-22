"""Focused contract proof for the one official Python MCP host."""

import json
import os
import socket
import subprocess
import sys

_APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _run_in_script_launch_context(code: str, env: dict[str, str] | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-c", code],
        cwd=_APP_DIR,
        env=env,
        capture_output=True,
        text=True,
    )


def test_app_not_importable_without_the_bootstrap():
    result = _run_in_script_launch_context("import app; print('UNEXPECTED_OK')")
    assert "UNEXPECTED_OK" not in result.stdout
    assert "No module named 'app'" in (result.stderr + result.stdout)


def test_mcp_host_bootstrap_makes_app_and_control_handlers_importable():
    result = _run_in_script_launch_context(
        "import mcp_host;"
        "from app import control_plane;"
        "from app.python_models import coder_job_tools;"
        "print('APP_IMPORT_OK')"
    )
    assert "APP_IMPORT_OK" in result.stdout, result.stderr


def test_app_bootstrap_lives_once_at_the_host_boundary():
    host = open(os.path.join(_APP_DIR, "mcp_host.py"), encoding="utf-8").read()
    assert host.count("sys.path.insert") == 1
    for name in ("coder_job_tools.py", "job_folder.py"):
        text = open(os.path.join(_APP_DIR, "python_models", name), encoding="utf-8").read()
        assert "sys.path.insert" not in text, f"{name} must not carry the app bootstrap"


def test_external_transport_uses_the_unmodified_canonical_catalog_and_schemas():
    code = """
import asyncio, json, mcp_host
async def check():
    tools = await mcp_host.list_tools()
    by_name = {tool.name: tool for tool in tools}
    coder = by_name['run_coder_subagent']
    assert 'approvedPrompt' in coder.inputSchema['properties']
    assert coder.inputSchema['properties']['adapter']['enum'] == ['claude_code', 'codex']
    assert by_name['run_mag_one'].inputSchema['required'] == ['jobId', 'projectId', 'deckId']
    assert not any(name.startswith('main.') for name in by_name)
    print(json.dumps({name: tool.model_dump() for name, tool in by_name.items()}, sort_keys=True))
asyncio.run(check())
"""
    result = _run_in_script_launch_context(code)
    assert result.returncode == 0, result.stderr
    assert len(json.loads(result.stdout)) != 14
    host = open(os.path.join(_APP_DIR, "mcp_host.py"), encoding="utf-8").read()
    assert "CHATGPT_MAIN" not in host
    assert "LIQUIDAITY_MAIN_PROJECT_ID" not in host
    assert "LIQUIDAITY_MAIN_DECK_ID" not in host
    assert "LIQUIDAITY_MAIN_CONVERSATION_ID" not in host


def test_coder_and_mag_one_dispatch_without_hermes_report_substitution():
    code = """
import asyncio, json, mcp_host
async def check():
    calls = []
    async def bridge(path, payload):
        calls.append({'path': path, 'payload': payload})
        return [mcp_host.TextContent(type='text', text=json.dumps({'ok': True}))]
    mcp_host._bridge = bridge
    coder = {
        'parentRunId': 'main-run', 'projectId': 'project-1', 'deckId': 'deck_builder',
        'conversationId': 'conversation-1', 'cardId': 'coder-card', 'adapter': 'codex',
        'approvedPrompt': 'Main approved these exact instructions.'
    }
    mag = {'projectId': 'project-1', 'deckId': 'deck_builder', 'jobId': 'job-1'}
    await mcp_host.call_tool('run_coder_subagent', coder)
    await mcp_host.call_tool('run_mag_one', mag)
    assert calls == [
        {'path': 'run_coder_subagent', 'payload': coder},
        {'path': 'run_mag_one', 'payload': mag},
    ]
    assert all(call['path'] != 'hermes_read_report' for call in calls)
    print('UNGATED_CANONICAL_DISPATCH_OK')
asyncio.run(check())
"""
    result = _run_in_script_launch_context(code)
    assert result.returncode == 0, result.stderr
    assert "UNGATED_CANONICAL_DISPATCH_OK" in result.stdout


def test_streamable_http_initializes_and_lists_the_canonical_catalog():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    code = f"""
import asyncio, os, subprocess, sys
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
env = {{
    **os.environ,
    'LIQUIDAITY_MCP_TRANSPORT': 'streamable-http',
    'LIQUIDAITY_HTTP_MCP_PORT': '{port}',
}}
server = subprocess.Popen([sys.executable, 'mcp_host.py'], cwd={_APP_DIR!r}, env=env)
async def check():
    failure = None
    for _ in range(50):
        try:
            async with streamable_http_client('http://127.0.0.1:{port}/mcp') as streams:
                async with ClientSession(streams[0], streams[1]) as session:
                    await session.initialize()
                    actual = [tool.name for tool in (await session.list_tools()).tools]
                    assert 'codegraph.search' in actual
                    assert 'codegraph.status' in actual
                    assert not any(name.startswith('main.') for name in actual)
                    print('STREAMABLE_HTTP_OK')
                    return
        except Exception as exc:
            failure = exc
            await asyncio.sleep(0.1)
    raise failure or RuntimeError('http_mcp_not_ready')
try:
    asyncio.run(check())
finally:
    server.terminate()
    server.wait(timeout=10)
"""
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=_APP_DIR,
        capture_output=True,
        text=True,
        timeout=20,
    )
    assert result.returncode == 0, result.stderr
    assert "STREAMABLE_HTTP_OK" in result.stdout
