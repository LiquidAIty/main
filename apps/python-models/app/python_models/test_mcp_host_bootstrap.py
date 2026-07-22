"""Proof that the MCP host's sys.path bootstrap fixes 'No module named app'.

The gRPC harness launches the host as a SCRIPT
(``python .../apps/python-models/app/mcp_host.py``), so sys.path[0] is the ``app/``
dir and the package root (apps/python-models) is NOT importable — which broke every
``from app...`` control handler (e.g. thinkgraph.get_graph_slice) at call time.

These tests reproduce that exact launch condition in a subprocess (cwd = the app/ dir,
package root absent from sys.path) and assert the app package + control handlers import
after ``import mcp_host`` runs the shared bootstrap. The fix lives in ONE place
(mcp_host.py top), not scattered across tools.
"""
import os
import json
import socket
import subprocess
import sys

_APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # .../app


def _run_in_script_launch_context(code: str) -> subprocess.CompletedProcess:
    # cwd = app/ reproduces the script launch: the package root (its parent) is not on
    # sys.path, so a bare `import app` fails unless mcp_host's bootstrap repairs it.
    return subprocess.run(
        [sys.executable, "-c", code],
        cwd=_APP_DIR,
        capture_output=True,
        text=True,
    )


def test_app_not_importable_without_the_bootstrap():
    # Guard: prove the failure condition is real in this launch context (no bootstrap).
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
    # The app-package repair is a single insert of the package root at the host
    # entry — never duplicated into the graph/coder tool modules. (tool_registry's
    # own sys.path.insert is the unrelated KnowGraph-rails loader, not this fix.)
    host = open(os.path.join(_APP_DIR, "mcp_host.py"), encoding="utf-8").read()
    assert host.count("sys.path.insert") == 1
    for name in ("coder_job_tools.py", "job_folder.py"):
        text = open(os.path.join(_APP_DIR, "python_models", name), encoding="utf-8").read()
        assert "sys.path.insert" not in text, f"{name} must not carry the app bootstrap"


def test_chatgpt_main_profile_is_bounded_and_keeps_raw_chat_out_of_coder():
    code = """
import asyncio, json, mcp_host
async def check():
    tools = await mcp_host.list_tools()
    by_name = {tool.name: tool for tool in tools}
    assert set(by_name) == mcp_host.CHATGPT_MAIN_TOOL_NAMES
    assert 'card.update_configuration' not in by_name
    coder = by_name['run_coder_subagent']
    assert 'approvedPrompt' not in coder.inputSchema['properties']
    assert coder.inputSchema['properties']['adapter']['enum'] == ['claude_code']
    context = json.loads((await mcp_host.call_tool('main.context', {}))[0].text)
    assert context['configured'] is True
    denied = json.loads((await mcp_host.call_tool('card.update_configuration', {}))[0].text)
    assert denied['error'].startswith('tool_not_granted_to_chatgpt_main')
    print(json.dumps({'tools': sorted(by_name), 'context': context}))
asyncio.run(check())
"""
    env = {
        **os.environ,
        "LIQUIDAITY_MCP_PRINCIPAL": "chatgpt_main",
        "LIQUIDAITY_MAIN_PROJECT_ID": "project-1",
        "LIQUIDAITY_MAIN_DECK_ID": "agent-builder",
        "LIQUIDAITY_MAIN_CONVERSATION_ID": "conversation-1",
    }
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=_APP_DIR,
        env=env,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["context"]["principal"] == "chatgpt_main"


def test_chatgpt_codegraph_search_uses_server_owned_identity_for_exact_public_invocation():
    code = """
import asyncio, json, os, mcp_host
async def check():
    tools = {tool.name: tool for tool in await mcp_host.list_tools()}
    schema = tools['codegraph.search'].inputSchema
    assert schema == {
        'type': 'object',
        'properties': {'query': {'type': 'string'}, 'limit': {'type': 'integer'}},
        'required': ['query'],
    }
    captured = {}
    async def bridge(path, payload):
        captured.update({'path': path, 'payload': payload})
        return [mcp_host.TextContent(type='text', text=json.dumps({'ok': True}))]
    mcp_host._bridge = bridge
    result = json.loads((await mcp_host.call_tool(
        'codegraph.search', {'query': 'resolveCodeGraphProjectName', 'limit': 5}
    ))[0].text)
    assert result == {'ok': True}
    assert captured == {
        'path': 'codegraph_search',
        'payload': {
            'query': 'resolveCodeGraphProjectName',
            'limit': 5,
            'projectId': 'project-1',
            'conversationId': 'conversation-1',
        },
    }
    rejected = json.loads((await mcp_host.call_tool('codegraph.search', {
        'query': 'resolveCodeGraphProjectName',
        'projectId': 'project-1',
        'conversationId': 'conversation-1',
    }))[0].text)
    assert rejected == {
        'ok': False,
        'error': 'tool_arguments_rejected: conversationId,projectId',
    }
    del os.environ['LIQUIDAITY_MAIN_CONVERSATION_ID']
    missing = json.loads((await mcp_host.call_tool(
        'codegraph.search', {'query': 'resolveCodeGraphProjectName'}
    ))[0].text)
    assert missing == {'ok': False, 'error': 'chatgpt_main_conversationId_unconfigured'}
    print('CHATGPT_CODEGRAPH_IDENTITY_CONTRACT_OK')
asyncio.run(check())
"""
    env = {
        **os.environ,
        "LIQUIDAITY_MCP_PRINCIPAL": "chatgpt_main",
        "LIQUIDAITY_MAIN_PROJECT_ID": "project-1",
        "LIQUIDAITY_MAIN_DECK_ID": "agent-builder",
        "LIQUIDAITY_MAIN_CONVERSATION_ID": "conversation-1",
    }
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=_APP_DIR,
        env=env,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    assert "CHATGPT_CODEGRAPH_IDENTITY_CONTRACT_OK" in result.stdout


def test_chatgpt_main_profile_serves_streamable_http_on_the_mcp_path():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    code = f"""
import asyncio, json, os, subprocess, sys
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
env = {{**os.environ,
  'LIQUIDAITY_MCP_TRANSPORT': 'streamable-http',
  'LIQUIDAITY_HTTP_MCP_PORT': '{port}',
  'LIQUIDAITY_MCP_PRINCIPAL': 'chatgpt_main',
  'LIQUIDAITY_MAIN_PROJECT_ID': 'project-http-test',
  'LIQUIDAITY_MAIN_DECK_ID': 'deck_builder',
  'LIQUIDAITY_MAIN_CONVERSATION_ID': 'conversation-http-test'}}
server = subprocess.Popen([sys.executable, 'mcp_host.py'], cwd={_APP_DIR!r}, env=env)
async def check():
    failure = None
    for _ in range(80):
        try:
            async with streamable_http_client('http://127.0.0.1:{port}/mcp') as streams:
                async with ClientSession(streams[0], streams[1]) as session:
                    await session.initialize()
                    tools = await session.list_tools()
                    assert len(tools.tools) == 14
                    result = await session.call_tool('main.context', {{}})
                    assert json.loads(result.content[0].text)['principal'] == 'chatgpt_main'
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
        timeout=30,
    )
    assert result.returncode == 0, result.stderr
    assert "STREAMABLE_HTTP_OK" in result.stdout
