"""Focused contract proof for the one official Python MCP host."""

import json
import os
import socket
import subprocess
import sys
import threading
import time
from types import SimpleNamespace

import pytest

_APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _APP_DIR not in sys.path:
    sys.path.insert(0, _APP_DIR)


def test_execution_receipt_observes_the_actual_provider_client_boundary():
    import asyncio
    import mcp_host

    class ProviderClient:
        async def generate_response(self, *_args, **_kwargs):
            return SimpleNamespace(usage={"input_tokens": 2, "output_tokens": 1})

    client = ProviderClient()
    receipt = mcp_host._execution_receipt("graphiti.search_nodes")
    token = mcp_host._ACTIVE_EXECUTION_RECEIPT.set(receipt)
    try:
        mcp_host._instrument_graphiti_provider_client(
            client,
            method_names=("generate_response",),
            compute="api_llm",
            dependency="graphiti_llm",
            provider="openai",
            model="openai/test-model",
            base_url="https://openrouter.ai/api/v1",
            credential_configured=True,
        )
        asyncio.run(client.generate_response("bounded prompt"))
    finally:
        mcp_host._ACTIVE_EXECUTION_RECEIPT.reset(token)

    assert receipt["compute"] == "api_llm"
    assert [call["state"] for call in receipt["providerCalls"]] == [
        "started",
        "completed",
    ]
    assert receipt["providerCalls"][-1]["baseUrlHostname"] == "openrouter.ai"
    assert receipt["providerCalls"][-1]["credentialConfigured"] is True
    assert receipt["providerSubstitution"] is False


def test_graphiti_uses_knowgraph_openrouter_embedding_configuration(monkeypatch):
    import mcp_host

    monkeypatch.setenv("OPENROUTER_API_KEY", "router-key")
    monkeypatch.setenv("OPENROUTER_OPENAI_BASE_URL", "https://router.example/v1")
    monkeypatch.setenv("KNOWGRAPH_OPENROUTER_EMBEDDING_MODEL", "openai/test-embedder")
    monkeypatch.setenv("KNOWGRAPH_OPENROUTER_EMBEDDING_DIM", "1024")
    monkeypatch.setenv("NEO4J_DATABASE", "knowgraph")
    monkeypatch.delenv("GRAPHITI_EMBEDDER_MODEL", raising=False)

    config = mcp_host._graphiti_config()

    assert config.database.providers.neo4j.database == "knowgraph"
    assert config.embedder.provider == "openai"
    assert config.embedder.model == "openai/test-embedder"
    assert config.embedder.dimensions == 1024
    assert config.embedder.providers.openai.api_key == "router-key"
    assert config.embedder.providers.openai.api_url == "https://router.example/v1"


def test_graphiti_preserves_explicit_embedder_model_override(monkeypatch):
    import mcp_host

    monkeypatch.setenv("GRAPHITI_EMBEDDER_MODEL", "local/embeddinggemma")
    monkeypatch.setenv("KNOWGRAPH_OPENROUTER_EMBEDDING_MODEL", "openai/ignored")

    assert mcp_host._graphiti_config().embedder.model == "local/embeddinggemma"


def test_call_tool_appends_canonical_receipt_and_typed_provider_failure(monkeypatch):
    import asyncio
    import mcp_host

    async def dispatch(name, _arguments):
        if name == "graphiti.search_nodes":
            return mcp_host._normalize_graphiti_result(
                [mcp_host.TextContent(type="text", text=json.dumps({
                    "error": "OpenAI insufficient credits for embeddings"
                }))]
            )
        return [mcp_host.TextContent(type="text", text=json.dumps({"ok": True}))]

    monkeypatch.setattr(mcp_host, "_dispatch_tool", dispatch)
    failed = asyncio.run(mcp_host.call_tool("graphiti.search_nodes", {"query": "x"}))
    assert failed.isError is True
    failure = json.loads(failed.content[0].text)
    assert failure["failureCode"] == "insufficient_credits"
    assert failure["retryable"] is False
    failed_receipt = json.loads(failed.content[-1].text)["executionReceipt"]
    assert failed_receipt["state"] == "failed"
    assert failed_receipt["failureCode"] == "insufficient_credits"

    later = asyncio.run(mcp_host.call_tool("main.context", {}))
    assert json.loads(later[0].text)["ok"] is True
    later_receipt = json.loads(later[-1].text)["executionReceipt"]
    assert later_receipt["compute"] == "deterministic"
    assert later_receipt["state"] == "completed"


def test_plain_text_does_not_hide_a_later_structured_tool_error():
    import json
    import mcp_host

    result = [
        mcp_host.TextContent(type="text", text="native diagnostic"),
        mcp_host.TextContent(
            type="text",
            text=json.dumps({"ok": False, "error": "native_failure"}),
        ),
    ]

    assert mcp_host._tool_result_category(result) == "tool_error"


def test_catalog_contract_metadata_is_generated_from_each_tool():
    import mcp_host

    safe = mcp_host._bind_tool_execution_contract(mcp_host.Tool(
        name="main.context",
        description="read",
        inputSchema={"type": "object", "properties": {}},
    ))
    destructive = mcp_host._bind_tool_execution_contract(mcp_host.Tool(
        name="cbm.delete_project",
        description="delete",
        inputSchema={"type": "object", "properties": {}},
    ))
    assert safe.meta["liquidaityExecution"] == {
        "risk": "safe read",
        "compute": "deterministic",
    }
    assert destructive.meta["liquidaityExecution"]["risk"] == "destructive"
    graphiti_status = mcp_host._bind_tool_execution_contract(mcp_host.Tool(
        name="graphiti.get_status",
        description="dependency health",
        inputSchema={"type": "object", "properties": {}},
    ))
    assert graphiti_status.meta["liquidaityExecution"] == {
        "risk": "safe read",
        "compute": "database_read",
    }
    assert mcp_host._tool_execution_contract("engraphis.recall_context") == {
        "risk": "safe read",
        "compute": "local_embedding",
    }
    assert mcp_host._tool_execution_contract("graphiti.clear_graph") == {
        "risk": "destructive",
        "compute": "mixed",
    }
    assert mcp_host._tool_execution_contract("web_search") == {
        "risk": "paid/provider-backed",
        "compute": "mixed",
    }


def test_graphiti_timeout_cancels_work_and_later_dispatch_recovers(monkeypatch):
    import asyncio
    import mcp_host

    cancelled = False

    class NativeMcp:
        async def call_tool(self, name, _arguments):
            nonlocal cancelled
            if name == "slow":
                try:
                    await asyncio.Event().wait()
                except asyncio.CancelledError:
                    cancelled = True
                    raise
            return [mcp_host.TextContent(type="text", text=json.dumps({"ok": True}))]

    monkeypatch.setattr(
        mcp_host, "_NATIVE_GRAPHITI_MODULE", SimpleNamespace(mcp=NativeMcp())
    )
    monkeypatch.setattr(mcp_host, "_NATIVE_TOOL_TIMEOUT_SECONDS", 0.01)

    async def run():
        with pytest.raises(RuntimeError, match="native_graphiti_timeout:slow"):
            await mcp_host._call_native_graphiti("slow", {})
        return await mcp_host._call_native_graphiti("later", {})

    later = asyncio.run(run())
    assert cancelled is True
    assert json.loads(later.content[0].text)["ok"] is True


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
        "from app.python_models import agentgraph;"
        "print('APP_IMPORT_OK')"
    )
    assert "APP_IMPORT_OK" in result.stdout, result.stderr


def test_app_bootstrap_lives_once_at_the_host_boundary():
    host = open(os.path.join(_APP_DIR, "mcp_host.py"), encoding="utf-8").read()
    assert host.count("sys.path.insert") == 1
    text = open(os.path.join(_APP_DIR, "python_models", "agentgraph.py"), encoding="utf-8").read()
    assert "sys.path.insert" not in text


def test_external_transport_uses_the_unmodified_canonical_catalog_and_schemas():
    code = """
import asyncio, json, mcp_host
async def check():
    tools = await mcp_host.list_tools()
    by_name = {tool.name: tool for tool in tools}
    coder = by_name['run_coder_subagent']
    assert 'approvedPrompt' in coder.inputSchema['properties']
    assert 'adapter' not in coder.inputSchema['properties']
    assert 'instructionId' in by_name['card.run_assistant_agent'].inputSchema['properties']
    assert set(by_name['write_mag_one_instructions'].inputSchema['properties']) == {'instructions'}
    assert by_name['run_mag_one'].inputSchema['required'] == ['instructionId', 'projectId', 'deckId']
    assert 'main.context' in by_name
    assert 'agentgraph.inspect' in by_name
    assert 'coder.status' in by_name
    assert all(
        tool.inputSchema.get('additionalProperties') is False
        for name, tool in by_name.items()
        if not name.startswith(('engraphis.', 'cbm.', 'graphiti.'))
    )
    assert not any(name.startswith('worldsignals.') for name in by_name)
    assert len(by_name) == len(set(by_name))
    print(json.dumps({name: tool.model_dump() for name, tool in by_name.items()}, sort_keys=True))
asyncio.run(check())
"""
    result = _run_in_script_launch_context(code)
    assert result.returncode == 0, result.stderr
    catalog = json.loads(result.stdout)
    assert len(catalog) == len(set(catalog))
    host = open(os.path.join(_APP_DIR, "mcp_host.py"), encoding="utf-8").read()
    assert "CHATGPT_MAIN" not in host
    assert "LIQUIDAITY_MAIN_PROJECT_ID" not in host
    assert "LIQUIDAITY_MAIN_DECK_ID" not in host
    assert "LIQUIDAITY_MAIN_CONVERSATION_ID" not in host


def test_catalog_identity_covers_the_complete_frozen_tool_descriptor():
    import mcp_host
    from mcp.types import Tool

    original = Tool(
        name="example.read",
        description="Original description",
        inputSchema={
            "type": "object",
            "properties": {"query": {"type": "string"}},
            "required": ["query"],
            "additionalProperties": False,
        },
    )
    changed = Tool(
        name="example.read",
        description="Changed description",
        inputSchema={
            "type": "object",
            "properties": {"query": {"type": "string", "minLength": 1}},
            "required": ["query"],
            "additionalProperties": False,
        },
    )

    assert mcp_host._catalog_identity([original])[0] == 1
    assert mcp_host._catalog_identity([original])[1] != mcp_host._catalog_identity([changed])[1]


def test_mag_one_instruction_authoring_persists_the_exact_instruction(monkeypatch):
    import asyncio
    import json
    import mcp_host
    from app.python_models import agentgraph

    captured = []
    monkeypatch.setattr(mcp_host, "_native_engraphis_tools", lambda: asyncio.sleep(0, result=[]))
    monkeypatch.setattr(
        agentgraph,
        "create_instruction",
        lambda **kwargs: (
            captured.append(kwargs)
            or {"ok": True, "instructionId": "instruction:one"}
        ),
    )

    result = asyncio.run(
        mcp_host.call_tool(
            "write_mag_one_instructions",
            {
                "_callerCardId": "card_hermes",
                "_callerRuntimeBinding": "hermes_steward",
                "projectId": "project-1",
                "deckId": "deck_builder",
                "conversationId": "main",
                "instructions": "Approved task.",
            },
        )
    )

    assert json.loads(result[0].text)["instructionId"] == "instruction:one"
    assert captured[0]["body"] == "Approved task."
    assert captured[0]["prepared_by_card_id"] == "card_hermes"


def test_native_engraphis_registry_is_initialized_once_without_schema_adaptation():
    code = """
import asyncio, json, mcp_host
async def check():
    await mcp_host._initialize_native_engraphis()
    native = {tool.name: tool for tool in await mcp_host._native_engraphis_mcp().list_tools()}
    first = await mcp_host._native_engraphis_tools()
    await mcp_host._initialize_native_engraphis()
    second = await mcp_host._native_engraphis_tools()
    assert len(native) == 31
    assert set(native) == {tool.name for tool in first}
    assert len(first) == 31
    assert [id(tool) for tool in first] == [id(tool) for tool in second]
    assert {tool.name for tool in first} == set(native)
    for tool in first:
        assert tool.model_dump() == native[tool.name].model_dump()
    combined = await mcp_host.list_tools()
    combined_names = [tool.name for tool in combined]
    assert len(set(combined_names)) == len(combined_names)
    authenticated = mcp_host._bind_authenticated_catalog(combined)
    authenticated_identity = mcp_host._catalog_identity(authenticated)
    assert authenticated_identity[0] == len(combined_names)
    assert len(authenticated_identity[1]) == 64
    assert {
        'main.context', 'canvas.inspect', 'coder.status', 'run_coder_subagent',
        'agentgraph.inspect',
    }.issubset(set(combined_names))
    assert {
        'coder.inspect', 'coder.effective_tools', 'coder.account', 'coder.stop', 'coder.steer',
    }.isdisjoint(combined_names)
    assert {
        f'engraphis.{name.removeprefix("engraphis_")}' for name in set(native)
    }.issubset(combined_names)
    assert not set(native).intersection(combined_names)
    print(json.dumps(sorted(tool.name for tool in first)))
asyncio.run(check())
"""
    result = _run_in_script_launch_context(code)
    assert result.returncode == 0, result.stderr
    assert len(json.loads(result.stdout)) == 31


def test_native_engraphis_uses_the_cached_local_embedding_model(monkeypatch):
    import mcp_host

    monkeypatch.delenv("HF_HUB_OFFLINE", raising=False)
    mcp_host._load_native_engraphis_mcp()
    assert os.environ["HF_HUB_OFFLINE"] == "1"


def test_native_engraphis_hung_call_does_not_block_later_native_dispatch(monkeypatch):
    import asyncio
    import mcp_host

    outer_thread = threading.get_ident()
    entered = threading.Event()
    release = threading.Event()
    calls = []
    native_result = mcp_host.TextContent(
        type="text",
        text=json.dumps({"ok": True, "source": "native"}),
    )

    class NativeMcp:
        async def call_tool(self, name, arguments):
            calls.append((name, arguments, threading.get_ident()))
            if name == "engraphis_hung":
                entered.set()
                if not release.wait(timeout=2):
                    raise RuntimeError("test_release_timeout")
            return [native_result], {"result": {"ok": True, "source": "native"}}

    async def initialized():
        return None

    monkeypatch.setattr(mcp_host, "_initialize_native_engraphis", initialized)
    monkeypatch.setattr(
        mcp_host,
        "_NATIVE_ENGRAPHIS_NAMES",
        frozenset({"engraphis_hung", "engraphis_stats"}),
    )
    monkeypatch.setattr(mcp_host, "_native_engraphis_mcp", lambda: NativeMcp())

    async def check():
        hung = asyncio.create_task(
            mcp_host.call_tool("engraphis.hung", {"request": 1})
        )
        for _ in range(200):
            if entered.is_set():
                break
            await asyncio.sleep(0.005)
        assert entered.is_set()
        later = await asyncio.wait_for(
            mcp_host.call_tool("engraphis.stats", {"request": 2}),
            timeout=1,
        )
        release.set()
        return later, await asyncio.wait_for(hung, timeout=1)

    later, hung = asyncio.run(check())
    assert later.content[0] is native_result
    assert hung.content[0] is native_result
    assert [call[:2] for call in calls] == [
        ("engraphis_hung", {"request": 1}),
        ("engraphis_stats", {"request": 2}),
    ]
    assert all(call[2] != outer_thread for call in calls)
    assert calls[0][2] != calls[1][2]


def test_native_engraphis_failure_is_typed_and_the_next_call_succeeds():
    code = """
import asyncio, json, mcp_host

class NativeFailure(RuntimeError):
    pass

class NativeMcp:
    async def call_tool(self, name, arguments):
        if name == 'engraphis_native_failure':
            raise NativeFailure('canonical native failure')
        return [mcp_host.TextContent(type='text', text=json.dumps({
            'name': name,
            'arguments': arguments,
        }))]

native = NativeMcp()
mcp_host._NATIVE_ENGRAPHIS_MCP = native
mcp_host._NATIVE_ENGRAPHIS_TOOLS = ()
mcp_host._NATIVE_ENGRAPHIS_NAMES = frozenset({
    'engraphis_normal_call', 'engraphis_native_failure',
})

async def check():
    typed = await mcp_host.call_tool('engraphis.native_failure', {'value': 1})
    assert typed.isError is True
    assert json.loads(typed.content[0].text) == {
        'ok': False,
        'error': 'tool_handler_failed:NativeFailure',
    }
    normal = await mcp_host.call_tool('engraphis.normal_call', {'value': 2})
    assert json.loads(normal.content[0].text) == {
        'name': 'engraphis_normal_call',
        'arguments': {'value': 2},
    }

asyncio.run(check())
print('NATIVE_DIRECT_DISPATCH_OK')
"""
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=_APP_DIR,
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert result.returncode == 0, result.stderr
    assert "NATIVE_DIRECT_DISPATCH_OK" in result.stdout


def test_native_cbm_replaces_a_stale_process_without_retrying_a_tool(monkeypatch):
    import mcp_host

    native_tool = mcp_host.Tool(
        name="list_projects",
        description="Native project list.",
        inputSchema={"type": "object", "properties": {}},
    )

    class StaleClient:
        def __init__(self):
            self.closed = False

        def is_running(self):
            return False

        def close(self):
            self.closed = True

    class FreshClient:
        def __init__(self, command, args, cwd):
            self.command = command
            self.args = args
            self.cwd = cwd
            self.closed = False

        def is_running(self):
            return True

        def list_tools(self):
            return [native_tool]

        def close(self):
            self.closed = True

    stale = StaleClient()
    mcp_host._NATIVE_CBM_CLIENT = stale
    mcp_host._NATIVE_CBM_TOOLS = (native_tool,)
    mcp_host._NATIVE_CBM_NAMES = frozenset({"list_projects"})
    monkeypatch.setattr(
        mcp_host,
        "_native_cbm_config",
        lambda: ("native-cbm", ["--stdio"], r"C:\Projects\main"),
    )
    monkeypatch.setattr(mcp_host, "_NativeStdioMcpClient", FreshClient)

    try:
        mcp_host._initialize_native_cbm_sync()
        assert stale.closed is True
        assert isinstance(mcp_host._NATIVE_CBM_CLIENT, FreshClient)
        assert mcp_host._NATIVE_CBM_NAMES == frozenset({"list_projects"})
    finally:
        mcp_host._close_native_cbm()

    assert mcp_host._NATIVE_CBM_CLIENT is None
    assert mcp_host._NATIVE_CBM_TOOLS is None
    assert mcp_host._NATIVE_CBM_NAMES == frozenset()


def test_http_mcp_enables_native_cbm_ui_without_changing_shared_config(monkeypatch):
    import mcp_host

    monkeypatch.delenv("LIQUIDAITY_CBM_UI_ENABLED", raising=False)
    monkeypatch.delenv("LIQUIDAITY_CBM_UI_PORT", raising=False)
    _command, default_args, _cwd = mcp_host._native_cbm_config()
    assert "--ui=true" not in default_args
    assert not any(arg.startswith("--port=") for arg in default_args)

    monkeypatch.setenv("LIQUIDAITY_CBM_UI_ENABLED", "true")
    monkeypatch.setenv("LIQUIDAITY_CBM_UI_PORT", "9749")
    _command, http_args, _cwd = mcp_host._native_cbm_config()
    assert http_args[-2:] == ["--ui=true", "--port=9749"]


def test_native_cbm_timeout_retires_the_session_without_retrying(monkeypatch):
    import mcp_host

    class TimedOutClient:
        def __init__(self):
            self.closed = False
            self.calls = 0

        def is_running(self):
            return True

        def call_tool(self, _name, _arguments):
            self.calls += 1
            raise RuntimeError("native_cbm_timeout:tools/call")

        def close(self):
            self.closed = True

    client = TimedOutClient()
    monkeypatch.setattr(mcp_host, "_NATIVE_CBM_CLIENT", client)
    monkeypatch.setattr(mcp_host, "_NATIVE_CBM_TOOLS", ())
    monkeypatch.setattr(mcp_host, "_NATIVE_CBM_NAMES", frozenset())

    with pytest.raises(RuntimeError, match="native_cbm_timeout:tools/call"):
        mcp_host._call_native_cbm("search_graph", {"project": "C-Projects-main"})

    assert client.calls == 1
    assert client.closed is True
    assert mcp_host._NATIVE_CBM_CLIENT is None


def test_main_dispatches_coder_and_only_an_approved_mag_one_instruction():
    code = """
import asyncio, json, mcp_host
async def check():
    calls = []
    async def bridge(path, payload):
        calls.append({'path': path, 'payload': payload})
        return [mcp_host.TextContent(type='text', text=json.dumps({'ok': True}))]
    mcp_host._bridge = bridge
    identity = {'_callerCardId': 'card_main_chat', '_callerRuntimeBinding': 'main_chat'}
    coder = {
        'parentRunId': 'main-run', 'projectId': 'project-1', 'deckId': 'deck_builder',
        'conversationId': 'conversation-1', 'cardId': 'coder-card',
        'approvedPrompt': 'Main approved these exact instructions.'
    }
    mag = {'projectId': 'project-1', 'deckId': 'deck_builder', 'instructionId': 'instruction:one'}
    await mcp_host.call_tool('run_coder_subagent', {**coder, **identity})
    await mcp_host.call_tool('run_mag_one', {**mag, **identity})
    assert calls == [
        {'path': 'run_coder_subagent', 'payload': coder},
        {'path': 'run_mag_one', 'payload': mag},
    ]
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
import asyncio, os, subprocess, sys, mcp_host
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
env = {{
    **os.environ,
    'LIQUIDAITY_MCP_TRANSPORT': 'streamable-http',
    'LIQUIDAITY_HTTP_MCP_PORT': '{port}',
}}
server = subprocess.Popen([sys.executable, 'mcp_host.py'], cwd={_APP_DIR!r}, env=env)
async def check():
    expected = sorted(tool.name for tool in await mcp_host.list_tools())
    failure = None
    for _ in range(50):
        try:
            async with streamable_http_client('http://127.0.0.1:{port}/mcp') as streams:
                async with ClientSession(streams[0], streams[1]) as session:
                    await session.initialize()
                    actual = sorted(tool.name for tool in (await session.list_tools()).tools)
                    assert actual == expected
                    assert 'main.context' in actual
                    assert 'agentgraph.inspect' in actual
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


def test_stdio_initializes_and_lists_the_canonical_catalog():
    code = f"""
import asyncio, json, sys, time, mcp_host
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

async def check():
    expected = sorted(tool.name for tool in await mcp_host.list_tools())
    params = StdioServerParameters(
        command=sys.executable,
        args=['mcp_host.py'],
        cwd={_APP_DIR!r},
    )
    async with stdio_client(params) as streams:
        async with ClientSession(streams[0], streams[1]) as session:
            await session.initialize()
            started = time.perf_counter()
            actual = sorted(tool.name for tool in (await session.list_tools()).tools)
            elapsed = time.perf_counter() - started
            assert actual == expected
            assert len(actual) == len(set(actual))
            assert 'main.context' in actual
            assert 'agentgraph.inspect' in actual
            assert sum(name.startswith('engraphis.') for name in actual) == 31
            assert elapsed < 10
            print(json.dumps({{'status': 'STDIO_OK', 'count': len(actual), 'elapsed': elapsed}}))

asyncio.run(check())
"""
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=_APP_DIR,
        capture_output=True,
        text=True,
        timeout=45,
    )
    assert result.returncode == 0, result.stderr
    assert "STDIO_OK" in result.stdout


def test_auth0_token_verifier_checks_jwt_contract_and_establishes_server_owned_principal(monkeypatch):
    import jwt
    import mcp_host
    from cryptography.hazmat.primitives.asymmetric import rsa

    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    other_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    class StaticJwkClient:
        def get_signing_key_from_jwt(self, _token):
            return type("SigningKey", (), {"key": private_key.public_key()})()

    config = mcp_host.OAuthConfig(
        resource_url="https://exemption-unstable-wolverine.ngrok-free.dev/mcp",
        issuer_url="https://tenant.auth0.com/",
        audience="https://exemption-unstable-wolverine.ngrok-free.dev/mcp",
        client_id="chatgpt-client",
        required_scope="liquidaity.main",
    )
    verifier = mcp_host.Auth0TokenVerifier(config, StaticJwkClient())
    monkeypatch.setattr(
        mcp_host,
        "_resolve_external_main_context_sync",
        lambda issuer, subject: {
            "projectId": "project-1",
            "deckId": "deck_builder",
            "conversationId": "external-mcp:grant-1",
            "parentRunId": "external-main:grant-1",
            "mainCardId": "card_main_chat",
        } if issuer == config.issuer_url and subject == "auth0|jeremiah" else None,
    )
    now = int(time.time())
    base = {
        "iss": config.issuer_url,
        "sub": "auth0|jeremiah",
        "aud": config.audience,
        "iat": now,
        "exp": now + 300,
        "azp": config.client_id,
        "scope": "openid liquidaity.main",
    }

    def encoded(claims, key=private_key):
        return jwt.encode(claims, key, algorithm="RS256", headers={"kid": "test-key"})

    verified = verifier._verify_sync(encoded(base))
    assert verified is not None
    assert verified.subject == "auth0|jeremiah"
    assert verified.claims["liquidaity"]["projectId"] == "project-1"
    assert verified.claims["liquidaity"]["mainCardId"] == "card_main_chat"

    invalid_claims = [
        {**base, "iss": "https://wrong.auth0.com/"},
        {**base, "aud": "https://wrong.example/mcp"},
        {**base, "exp": now - 1},
        {**base, "nbf": now + 300},
        {**base, "azp": "wrong-client"},
        {**base, "scope": "openid profile"},
    ]
    assert verifier._verify_sync(encoded(base, other_key)) is None
    assert all(verifier._verify_sync(encoded(claims)) is None for claims in invalid_claims)


def test_authenticated_catalog_is_complete_and_dispatch_uses_server_identity(monkeypatch):
    import asyncio
    import mcp_host
    from app import control_plane
    from mcp.server.auth.provider import AccessToken

    context = {
        "projectId": "project-1",
        "deckId": "deck_builder",
        "conversationId": "external-mcp:grant-1",
        "parentRunId": "external-main:grant-1",
        "mainCardId": "card_main_chat",
    }
    monkeypatch.setattr(
        mcp_host,
        "get_access_token",
        lambda: AccessToken(
            token="verified",
            client_id="chatgpt-client",
            scopes=["liquidaity.main"],
            subject="auth0|jeremiah",
            claims={"liquidaity": context},
        ),
    )
    native_cbm_tools = [
        mcp_host.Tool(
            name="search_graph",
            title="Search graph",
            description="Native search description.",
            inputSchema={
                "type": "object",
                "properties": {"project": {"type": "string"}},
                "required": ["project"],
            },
        ),
        mcp_host.Tool(
            name="index_status",
            title="Index status",
            description="Native status description.",
            inputSchema={
                "type": "object",
                "properties": {"project": {"type": "string"}},
                "required": ["project"],
            },
        ),
    ]
    native_engraphis_tools = [
        mcp_host.Tool(
            name="engraphis_recall",
            title="Recall",
            description="Native Engraphis recall.",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "limit": {"type": "integer"},
                },
                "required": ["query"],
            },
        ),
        mcp_host.Tool(
            name="engraphis_answer",
            title="Answer",
            description="Native Engraphis grounded answer.",
            inputSchema={
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        ),
    ]
    native_graphiti_tools = [
        mcp_host.Tool(
            name="get_status",
            title="Get status",
            description="Native Graphiti status.",
            inputSchema={"type": "object", "properties": {}},
        ),
        mcp_host.Tool(
            name="search_nodes",
            title="Search nodes",
            description="Native Graphiti node search.",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "group_ids": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["query"],
            },
        ),
    ]

    monkeypatch.setattr(
        mcp_host,
        "_NATIVE_CBM_NAMES",
        frozenset(tool.name for tool in native_cbm_tools),
    )

    async def native_cbm_catalog():
        return native_cbm_tools

    monkeypatch.setattr(mcp_host, "_native_cbm_tools", native_cbm_catalog)
    monkeypatch.setattr(
        mcp_host,
        "_NATIVE_ENGRAPHIS_NAMES",
        frozenset(tool.name for tool in native_engraphis_tools),
    )
    monkeypatch.setattr(
        mcp_host,
        "_native_engraphis_tools",
        lambda: asyncio.sleep(0, result=native_engraphis_tools),
    )
    monkeypatch.setattr(
        mcp_host,
        "_NATIVE_GRAPHITI_NAMES",
        frozenset(tool.name for tool in native_graphiti_tools),
    )
    monkeypatch.setattr(
        mcp_host,
        "_native_graphiti_tools",
        lambda: asyncio.sleep(0, result=native_graphiti_tools),
    )
    tools = asyncio.run(mcp_host.list_tools())
    by_name = {tool.name: tool for tool in tools}
    assert len(tools) == len(by_name)
    for tool in tools:
        contract = tool.meta["liquidaityExecution"]
        assert contract["compute"] in {
            "deterministic", "database_read", "database_write", "local_embedding",
            "api_embedding", "api_llm", "mixed", "unknown",
        }
        assert contract["risk"] in {
            "safe read", "deterministic write", "paid/provider-backed",
            "background", "destructive", "runtime-launching",
        }
        assert (
            tool.name in mcp_host._ALLOWED_KEYS
            or tool.name.startswith(tuple(mcp_host._NATIVE_PREFIXES.values()))
        ), f"advertised but undispatchable: {tool.name}"
    assert "main.context" in by_name
    assert "agentgraph.inspect" in by_name
    assert "coder.status" in by_name
    assert {
        "coder.inspect",
        "coder.effective_tools",
        "coder.account",
        "coder.stop",
        "coder.steer",
    }.isdisjoint(by_name)
    removed_public_wrappers = {
        "coder.inspect",
        "coder.effective_tools",
        "coder.account",
        "coder.stop",
        "coder.steer",
    }
    assert removed_public_wrappers.isdisjoint(mcp_host._ALLOWED_KEYS)
    assert removed_public_wrappers.isdisjoint(mcp_host._BRIDGE_PATHS)
    assert removed_public_wrappers.isdisjoint(mcp_host._READ_ONLY_TOOLS)
    assert removed_public_wrappers.isdisjoint(mcp_host._MAIN_ONLY_TOOLS)
    native_names = {
        f"engraphis.{tool.name.removeprefix('engraphis_')}"
        for tool in native_engraphis_tools
    } | {
        f"cbm.{tool.name}" for tool in native_cbm_tools
    } | {
        f"graphiti.{tool.name}" for tool in native_graphiti_tools
    }
    assert all(
        tool.inputSchema.get("additionalProperties") is False
        for name, tool in by_name.items()
        if name not in native_names
    )
    assert not any(name.startswith("worldsignals.") for name in by_name)
    assert "engraphis.recall" in by_name
    assert "engraphis.answer" in by_name
    assert "codegraph.status" not in by_name
    assert "codegraph.search" not in by_name
    assert {"cbm.search_graph", "cbm.index_status"}.issubset(by_name)
    assert by_name["cbm.search_graph"].meta["liquidaityExecution"] == {
        "risk": "safe read",
        "compute": "database_read",
    }
    assert {"graphiti.get_status", "graphiti.search_nodes"}.issubset(by_name)
    assert "run_coder_subagent" in by_name
    assert "run_mag_one" in by_name
    coder_tool = by_name["run_coder_subagent"]
    assert set(coder_tool.inputSchema["properties"]) == {
        "approvedPrompt",
        "cardId",
        "authority",
    }
    assert "projectId" not in coder_tool.inputSchema["properties"]
    assert "parentRunId" not in coder_tool.inputSchema["properties"]
    assert "agentContextId" not in by_name["run_coder_subagent"].inputSchema["properties"]
    assert "agentContext" not in by_name["run_coder_subagent"].inputSchema["properties"]
    assert "adapter" not in by_name["run_coder_subagent"].inputSchema["properties"]
    assert "server owns project, deck, conversation, parent-run, and Main-card identity" in coder_tool.description
    assert "Pass the exact active" not in coder_tool.description
    assert "instructionId" not in by_name["card.run_assistant_agent"].inputSchema["properties"]
    assert by_name["engraphis.recall"].model_dump()["securitySchemes"] == [
        {"type": "oauth2", "scopes": ["liquidaity.main"]}
    ]
    assert by_name["cbm.search_graph"].model_dump()["securitySchemes"] == [
        {"type": "oauth2", "scopes": ["liquidaity.main"]}
    ]
    assert by_name["graphiti.get_status"].model_dump()["securitySchemes"] == [
        {"type": "oauth2", "scopes": ["liquidaity.main"]}
    ]
    assert by_name["cbm.search_graph"].description == "Native search description."
    assert by_name["cbm.search_graph"].inputSchema == native_cbm_tools[0].inputSchema
    assert by_name["coder.status"].annotations.readOnlyHint is True
    assert by_name["run_coder_subagent"].annotations is None

    calls = []
    class NativeMcp:
        async def list_tools(self):
            return native_engraphis_tools

        async def call_tool(self, name, arguments):
            calls.append((name, arguments))
            return [mcp_host.TextContent(type="text", text=json.dumps({"ok": True}))]

    monkeypatch.setattr(mcp_host, "_native_engraphis_mcp", lambda: NativeMcp())

    def call_native_cbm(name, arguments):
        calls.append((name, arguments))
        return mcp_host.CallToolResult(
            content=[
                mcp_host.TextContent(
                    type="text",
                    text=json.dumps({"ok": True, "native": name}),
                )
            ]
        )

    monkeypatch.setattr(mcp_host, "_call_native_cbm", call_native_cbm)

    async def initialize_graphiti():
        return None

    async def call_native_graphiti(name, arguments):
        calls.append((name, arguments))
        return [mcp_host.TextContent(type="text", text=json.dumps({"ok": True}))]

    monkeypatch.setattr(mcp_host, "_initialize_native_graphiti", initialize_graphiti)
    monkeypatch.setattr(mcp_host, "_call_native_graphiti", call_native_graphiti)

    async def bridge(path, payload):
        calls.append((path, payload))
        return [mcp_host.TextContent(type="text", text=json.dumps({"ok": True}))]
    monkeypatch.setattr(mcp_host, "_bridge", bridge)

    async def run_saved_card(payload):
        calls.append(("card_run_assistant_agent", payload))
        return {"ok": True}
    monkeypatch.setattr(control_plane, "card_run_assistant_agent", run_saved_card)

    asyncio.run(mcp_host.call_tool("engraphis.recall", {"query": "Main", "limit": 3}))
    assert calls[-1] == ("engraphis_recall", {"query": "Main", "limit": 3})

    cbm_result = asyncio.run(
        mcp_host.call_tool("cbm.search_graph", {"project": "C-Projects-main"})
    )
    assert calls[-1] == ("search_graph", {"project": "C-Projects-main"})
    cbm_receipt = json.loads(cbm_result.content[-1].text)["executionReceipt"]
    assert cbm_receipt["risk"] == "safe read"
    assert cbm_receipt["compute"] == "database_read"

    asyncio.run(mcp_host.call_tool("graphiti.search_nodes", {"query": "Main"}))
    assert calls[-1] == (
        "search_nodes",
        {"query": "Main", "group_ids": ["liquidaity-project-1"]},
    )

    removed_adapter = asyncio.run(
        mcp_host.call_tool("codegraph.search", {"query": "Main"})
    )
    assert removed_adapter.isError is True
    assert "unknown_tool: codegraph.search" in removed_adapter.content[0].text

    main_context = asyncio.run(mcp_host.call_tool("main.context", {}))
    assert json.loads(main_context[0].text)["context"] == {
        "projectId": "project-1",
        "deckId": "deck_builder",
        "conversationId": "external-mcp:grant-1",
        "parentRunId": "external-main:grant-1",
        "mainCardId": "card_main_chat",
    }

    asyncio.run(mcp_host.call_tool("coder.status", {}))
    assert calls[-1] == ("coder_status", {})

    asyncio.run(mcp_host.call_tool("card.run_assistant_agent", {
        "cardId": "card_agent",
        "input": "Use the assigned context.",
    }))
    path, payload = calls[-1]
    assert path == "card_run_assistant_agent"
    assert payload["originatingAgentId"] == "card_main_chat"
    assert payload["originatingRunId"] == "external-main:grant-1"

    denied = asyncio.run(mcp_host.call_tool("run_coder_subagent", {
        "projectId": "spoofed",
        "cardId": "coder-card",
        "approvedPrompt": "Approved exact task.",
    }))
    assert denied.isError is True
    assert "caller_identity_rejected: projectId" in denied.content[0].text

    asyncio.run(mcp_host.call_tool("run_coder_subagent", {
        "cardId": "coder-card",
        "approvedPrompt": "Approved exact task.",
    }))
    path, payload = calls[-1]
    assert path == "run_coder_subagent"
    assert payload["projectId"] == "project-1"
    assert payload["deckId"] == "deck_builder"
    assert payload["conversationId"] == "external-mcp:grant-1"
    assert payload["parentRunId"].startswith("req_external_main_")
    assert "agentContextId" not in payload


def test_oauth_principal_context_is_reused_within_one_verified_session(monkeypatch):
    import mcp_host

    calls: list[tuple[str, str]] = []
    config = mcp_host.OAuthConfig(
        resource_url="https://example.test/mcp",
        issuer_url="https://tenant.example/",
        audience="https://example.test/mcp",
        client_id="client",
        required_scope="liquidaity.main",
    )
    verifier = mcp_host.Auth0TokenVerifier(
        config,
        type("JwkClient", (), {})(),
    )
    monkeypatch.setattr(
        mcp_host,
        "_resolve_external_main_context_sync",
        lambda issuer, subject: (
            calls.append((issuer, subject))
            or {
                "projectId": "project-1",
                "deckId": "deck_builder",
                "conversationId": "external-mcp:grant-1",
                "parentRunId": "external-main:grant-1",
                "mainCardId": "card_main_chat",
            }
        ),
    )

    first = verifier._principal_context("auth0|jeremiah", token_expires_at=int(time.time()) + 600)
    second = verifier._principal_context("auth0|jeremiah", token_expires_at=int(time.time()) + 600)

    assert first == second
    assert calls == [("https://tenant.example/", "auth0|jeremiah")]


def test_one_handler_exception_returns_a_tool_error_and_later_calls_still_work(monkeypatch):
    import asyncio
    import mcp_host
    from app import control_plane

    async def initialized():
        mcp_host._NATIVE_ENGRAPHIS_NAMES = frozenset()

    attempts = 0

    async def inspect(_args):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise RuntimeError("database_connection_lost")
        return {"ok": True, "cards": []}

    monkeypatch.setattr(mcp_host, "_initialize_native_engraphis", initialized)
    monkeypatch.setattr(mcp_host, "_authenticated_main_context", lambda: None)
    monkeypatch.setattr(control_plane, "canvas_inspect", inspect)

    failed = asyncio.run(mcp_host.call_tool("canvas.inspect", {}))
    succeeded = asyncio.run(mcp_host.call_tool("canvas.inspect", {}))

    assert failed.isError is True
    assert json.loads(failed.content[0].text) == {
        "ok": False,
        "error": "tool_handler_failed:RuntimeError",
    }
    assert succeeded[0].type == "text"
    assert json.loads(succeeded[0].text) == {"ok": True, "cards": []}


def test_oauth_http_publishes_metadata_and_rejects_anonymous_mcp():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    resource = "https://exemption-unstable-wolverine.ngrok-free.dev/mcp"
    code = f"""
import json, os, subprocess, sys, time
from urllib.error import HTTPError
from urllib.request import Request, urlopen
env = {{
    **os.environ,
    'LIQUIDAITY_MCP_TRANSPORT': 'streamable-http',
    'LIQUIDAITY_HTTP_MCP_PORT': '{port}',
    'LIQUIDAITY_PUBLIC_MCP_RESOURCE_URL': '{resource}',
    'LIQUIDAITY_AUTH0_ISSUER_URL': 'https://tenant.auth0.com/',
    'LIQUIDAITY_AUTH0_AUDIENCE': '{resource}',
    'LIQUIDAITY_AUTH0_CLIENT_ID': 'chatgpt-client',
    'LIQUIDAITY_MCP_OAUTH_ENFORCED': 'true',
}}
server = subprocess.Popen([sys.executable, 'mcp_host.py'], cwd={_APP_DIR!r}, env=env)
try:
    metadata_url = 'http://127.0.0.1:{port}/.well-known/oauth-protected-resource/mcp'
    failure = None
    for _ in range(30):
        try:
            metadata = json.load(urlopen(metadata_url, timeout=1))
            break
        except Exception as exc:
            failure = exc
            time.sleep(0.1)
    else:
        raise failure or RuntimeError('oauth_metadata_not_ready')
    assert metadata['resource'] == '{resource}'
    assert metadata['authorization_servers'] == ['https://tenant.auth0.com/']
    assert metadata['scopes_supported'] == ['liquidaity.main']
    try:
        urlopen(Request('http://127.0.0.1:{port}/mcp', data=b'{{}}', method='POST'), timeout=2)
        raise AssertionError('anonymous_mcp_was_accepted')
    except HTTPError as exc:
        assert exc.code == 401
        challenge = exc.headers['WWW-Authenticate']
        assert 'resource_metadata="{resource.replace('/mcp', '/.well-known/oauth-protected-resource/mcp')}"' in challenge
    print('OAUTH_METADATA_AND_CHALLENGE_OK')
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
    assert "OAUTH_METADATA_AND_CHALLENGE_OK" in result.stdout
