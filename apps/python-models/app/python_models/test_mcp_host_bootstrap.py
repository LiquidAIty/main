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


def test_card_assignment_compatibility_matches_mcp_caller_enforcement():
    import mcp_host

    safe = {"risk": "safe read", "compute": "database_read"}
    assert mcp_host._tool_capability_metadata(
        "write_mag_one_instructions", safe
    )["assignableRuntimeBindings"] == ["hermes_steward"]
    assert mcp_host._tool_capability_metadata(
        "engraphis.recall", safe
    )["assignableRuntimeBindings"] == ["main_chat"]
    assert mcp_host._tool_capability_metadata(
        "graphiti.search_nodes", safe
    )["assignableRuntimeBindings"] == ["hermes_steward"]
    assert mcp_host._tool_capability_metadata(
        "cbm.search_graph", safe
    )["assignableRuntimeBindings"] == ["local_coder"]
    assert mcp_host._tool_capability_metadata(
        "web_search", safe
    )["assignableRuntimeBindings"] == ["main_chat", "hermes_steward"]
    assert mcp_host._tool_capability_metadata(
        "main.context", safe
    )["assignableRuntimeBindings"] == []


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


def test_main_context_bootstraps_once_and_is_reused_for_one_connection(monkeypatch):
    import asyncio
    import mcp_host

    class Session:
        pass

    session = Session()
    context = {
        "projectId": "project-1",
        "deckId": "deck-1",
        "conversationId": "conversation-1",
        "parentRunId": "parent-1",
        "mainCardId": "main-1",
    }
    calls: list[str] = []
    original_dispatch = mcp_host._dispatch_tool

    async def dispatch(name, arguments, *, _bootstrap=False):
        if name == "main.context" and _bootstrap:
            calls.append(name)
        return await original_dispatch(name, arguments, _bootstrap=_bootstrap)

    monkeypatch.setattr(mcp_host, "_dispatch_tool", dispatch)
    monkeypatch.setattr(mcp_host, "_current_connection_session", lambda: session)
    monkeypatch.setattr(mcp_host, "get_access_token", lambda: object())
    monkeypatch.setattr(mcp_host, "_authenticated_main_context", lambda: dict(context))

    async def check():
        first = await mcp_host._ensure_main_connection_context()
        second = await mcp_host._ensure_main_connection_context()
        visible = await mcp_host.call_tool("main.context", {})
        return first, second, visible

    first, second, visible = asyncio.run(check())
    assert calls == ["main.context"]
    assert first == context
    assert second == context
    assert json.loads(visible[0].text)["context"] == context


def test_main_context_state_isolated_between_connections(monkeypatch):
    import asyncio
    import mcp_host

    class Session:
        pass

    sessions = [Session(), Session()]
    contexts = [
        {
            "projectId": "project-1",
            "deckId": "deck-1",
            "conversationId": "conversation-1",
            "parentRunId": "parent-1",
            "mainCardId": "main-1",
        },
        {
            "projectId": "project-2",
            "deckId": "deck-2",
            "conversationId": "conversation-2",
            "parentRunId": "parent-2",
            "mainCardId": "main-2",
        },
    ]
    current = {"session": sessions[0], "context": contexts[0]}
    monkeypatch.setattr(mcp_host, "_current_connection_session", lambda: current["session"])
    monkeypatch.setattr(mcp_host, "get_access_token", lambda: object())
    monkeypatch.setattr(
        mcp_host,
        "_authenticated_main_context",
        lambda: dict(current["context"]),
    )

    async def check():
        first = await mcp_host._ensure_main_connection_context()
        current.update(session=sessions[1], context=contexts[1])
        second = await mcp_host._ensure_main_connection_context()
        current.update(session=sessions[0], context=contexts[1])
        first_again = await mcp_host._ensure_main_connection_context()
        return first, second, first_again

    first, second, first_again = asyncio.run(check())
    assert first == contexts[0]
    assert second == contexts[1]
    assert first_again == contexts[0]


def test_expired_authenticated_session_fails_before_bootstrap(monkeypatch):
    import asyncio
    import mcp_host
    from mcp.server.auth.provider import AccessToken

    class Session:
        pass

    calls = []
    monkeypatch.setattr(mcp_host, "_current_connection_session", lambda: Session())
    monkeypatch.setattr(
        mcp_host,
        "get_access_token",
        lambda: AccessToken(
            token="expired",
            client_id="chatgpt-client",
            scopes=["liquidaity.main"],
            expires_at=int(time.time()) - 1,
        ),
    )

    async def dispatch(*_args, **_kwargs):
        calls.append(True)

    monkeypatch.setattr(mcp_host, "_dispatch_tool", dispatch)

    with pytest.raises(RuntimeError, match="authentication_expired"):
        asyncio.run(mcp_host._ensure_main_connection_context())
    assert calls == []


def test_authenticated_connection_reaches_read_only_handler_without_context_injection(
    monkeypatch,
):
    import asyncio
    import mcp_host
    from app import control_plane
    from mcp.server.auth.provider import AccessToken

    class Session:
        pass

    context = {
        "projectId": "project-1",
        "deckId": "deck-1",
        "conversationId": "conversation-1",
        "parentRunId": "parent-1",
        "mainCardId": "main-1",
    }
    calls = []
    bridge_calls = []
    session = Session()
    monkeypatch.setattr(mcp_host, "_current_connection_session", lambda: session)
    monkeypatch.setattr(mcp_host, "_authenticated_main_context", lambda: dict(context))
    monkeypatch.setattr(
        mcp_host,
        "get_access_token",
        lambda: AccessToken(
            token="verified",
            client_id="chatgpt-client",
            scopes=["liquidaity.main"],
            subject="auth0|test",
            claims={"liquidaity": context},
        ),
    )
    monkeypatch.setattr(
        mcp_host,
        "_bridge",
        lambda *_args, **_kwargs: bridge_calls.append(True),
    )

    async def inspect_cards(arguments):
        calls.append(arguments)
        return {"ok": True, "cards": []}

    monkeypatch.setattr(control_plane, "canvas_inspect", inspect_cards)
    result = asyncio.run(mcp_host.call_tool("canvas.inspect", {}))

    assert json.loads(result[0].text) == {"ok": True, "cards": []}
    assert calls == [{"projectId": "project-1", "deckId": "deck-1"}]
    assert bridge_calls == []
    assert "context" not in result[0].text


def test_lifecycle_errors_remain_typed_and_distinct(monkeypatch):
    import asyncio
    import mcp_host

    async def dispatch(_name, arguments):
        raise RuntimeError(str(arguments["error"]))

    monkeypatch.setattr(mcp_host, "_dispatch_tool", dispatch)

    async def check():
        results = {}
        for name, message in {
            "session": "Session terminated",
            "auth": "authentication expired",
            "arguments": "invalid arguments",
            "service": "service unavailable",
            "internal": "unexpected handler failure",
        }.items():
            result = await mcp_host.call_tool("test", {"error": message})
            results[name] = json.loads(result.content[0].text)
        return results

    results = asyncio.run(check())
    assert results["session"]["failureCode"] == "session_terminated"
    assert results["auth"]["failureCode"] == "authentication_expired"
    assert results["arguments"]["failureCode"] == "invalid_arguments"
    assert results["service"]["failureCode"] == "service_unavailable"
    assert results["internal"]["failureCode"] == "internal_failure"
    assert results["session"]["failureCode"] != "invalid_arguments"
    assert results["auth"]["failureCode"] != "invalid_arguments"


def test_timed_out_call_does_not_block_completed_sibling(monkeypatch):
    import asyncio
    import mcp_host

    async def dispatch(name, _arguments):
        if name == "slow":
            await asyncio.sleep(60)
        return [mcp_host.TextContent(type="text", text=json.dumps({"ok": True, "name": name}))]

    monkeypatch.setattr(mcp_host, "_dispatch_tool", dispatch)
    monkeypatch.setattr(mcp_host, "_MCP_CALL_TIMEOUT_SECONDS", 0.02)

    async def check():
        slow = asyncio.create_task(mcp_host.call_tool("slow", {}))
        sibling = await asyncio.wait_for(mcp_host.call_tool("sibling", {}), timeout=0.5)
        timed_out = await asyncio.wait_for(slow, timeout=0.5)
        return sibling, timed_out

    sibling, timed_out = asyncio.run(check())
    assert json.loads(sibling[0].text) == {"ok": True, "name": "sibling"}
    assert timed_out.isError is True
    assert json.loads(timed_out.content[0].text)["failureCode"] == "timeout"


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
    assert safe.meta["runtimeExecution"] == {
        "risk": "safe read",
        "compute": "deterministic",
        "readOnly": True,
        "destructive": False,
        "openWorld": False,
    }
    assert destructive.meta["runtimeExecution"]["risk"] == "destructive"
    assert safe.annotations.readOnlyHint is True
    assert safe.annotations.destructiveHint is False
    assert safe.annotations.idempotentHint is True
    web_search = mcp_host._bind_tool_execution_contract(mcp_host.Tool(
        name="web_search",
        description="provider-backed read",
        inputSchema={"type": "object", "properties": {}},
    ))
    assert web_search.meta["runtimeExecution"] == {
        "risk": "paid/provider-backed",
        "compute": "mixed",
        "readOnly": True,
        "destructive": False,
        "openWorld": True,
    }
    assert web_search.annotations.readOnlyHint is True
    assert web_search.annotations.destructiveHint is False
    assert web_search.annotations.idempotentHint is True
    assert web_search.annotations.openWorldHint is True
    assert safe.annotations.openWorldHint is False
    assert destructive.annotations.readOnlyHint is False
    assert destructive.annotations.destructiveHint is True
    graphiti_status = mcp_host._bind_tool_execution_contract(mcp_host.Tool(
        name="graphiti.get_status",
        description="dependency health",
        inputSchema={"type": "object", "properties": {}},
    ))
    assert graphiti_status.meta["runtimeExecution"] == {
        "risk": "safe read",
        "compute": "database_read",
        "readOnly": True,
        "destructive": False,
        "openWorld": False,
    }
    assert mcp_host._tool_execution_contract("engraphis.recall_context") == {
        "risk": "safe read",
        "compute": "local_embedding",
        "readOnly": True,
        "destructive": False,
        "openWorld": False,
    }
    engraphis_recall = mcp_host._bind_tool_execution_contract(mcp_host.Tool(
        name="engraphis.recall",
        description="stateful recall receipt",
        inputSchema={"type": "object", "properties": {}},
        annotations={
            "readOnlyHint": False,
            "destructiveHint": False,
            "idempotentHint": False,
            "openWorldHint": False,
        },
    ))
    assert engraphis_recall.annotations.readOnlyHint is True
    assert engraphis_recall.annotations.idempotentHint is False
    assert engraphis_recall.meta["runtimeExecution"]["risk"] == "safe read"
    assert mcp_host._tool_execution_contract("graphiti.clear_graph") == {
        "risk": "destructive",
        "compute": "mixed",
        "readOnly": False,
        "destructive": True,
        "openWorld": False,
    }
    assert mcp_host._tool_execution_contract("web_search") == {
        "risk": "paid/provider-backed",
        "compute": "mixed",
        "readOnly": True,
        "destructive": False,
        "openWorld": True,
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
    assert set(by_name['card.run_assistant_agent'].inputSchema['required']) == {'cardId', 'input'}
    assert 'instructionId' in by_name['card.run_assistant_agent'].inputSchema['properties']
    assert set(by_name['write_mag_one_instructions'].inputSchema['properties']) == {'instructions'}
    assert by_name['run_mag_one'].inputSchema['required'] == ['instructionId', 'projectId', 'deckId']
    assert 'minProperties' not in str(by_name['card.update_configuration'].inputSchema)
    reasoning_schema = by_name['card.update_configuration'].inputSchema['properties']['updates']['properties']['reasoningEffort']
    assert reasoning_schema == {
        'type': 'string',
        'enum': ['low', 'medium', 'high', 'xhigh'],
    }
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
    combined_identity = mcp_host._catalog_identity(combined)
    assert combined_identity[0] == len(combined_names)
    assert len(combined_identity[1]) == 64
    assert {
        'main.context', 'canvas.inspect', 'coder.status', 'card.run_assistant_agent',
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


def test_streamable_http_discovers_catalogs_before_accepting_requests(monkeypatch):
    import asyncio
    import mcp_host

    events = []

    async def initialized_engraphis():
        events.append("engraphis_registry")

    async def initialized_graphiti():
        events.append("graphiti_registry")

    async def initialized_cbm():
        events.append("cbm_registry")
        return []

    async def run_http():
        events.append("http")

    monkeypatch.setattr(mcp_host, "MCP_TRANSPORT", "streamable-http")
    monkeypatch.setattr(mcp_host, "_initialize_native_engraphis", initialized_engraphis)
    monkeypatch.setattr(mcp_host, "_initialize_native_graphiti", initialized_graphiti)
    monkeypatch.setattr(mcp_host, "_native_cbm_tools", initialized_cbm)
    monkeypatch.setattr(mcp_host, "_run_streamable_http", run_http)

    asyncio.run(mcp_host.main())

    assert events == [
        "engraphis_registry",
        "graphiti_registry",
        "cbm_registry",
        "http",
    ]


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
            mcp_host.call_tool("engraphis_stats", {"request": 2}),
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
    typed_payload = json.loads(typed.content[0].text)
    assert typed_payload["error"] == "internal_failure"
    assert typed_payload["failureCode"] == "internal_failure"
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
    active_scopes = ["liquidaity.main"]
    monkeypatch.setattr(
        mcp_host,
        "get_access_token",
        lambda: AccessToken(
            token="verified",
            client_id="chatgpt-client",
            scopes=list(active_scopes),
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
        contract = tool.meta["runtimeExecution"]
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
    assert "card.run_assistant_agent" in by_name
    assert "run_coder_subagent" not in by_name
    assert not any(name.startswith("liquidaity.") for name in by_name)
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
    assert by_name["cbm.search_graph"].meta["runtimeExecution"] == {
        "risk": "safe read",
        "compute": "database_read",
        "readOnly": True,
        "destructive": False,
        "openWorld": False,
    }
    assert {"graphiti.get_status", "graphiti.search_nodes"}.issubset(by_name)
    assert "run_mag_one" in by_name
    card_tool = by_name["card.run_assistant_agent"]
    assert set(card_tool.inputSchema["properties"]) == {"cardId", "input"}
    assert set(card_tool.inputSchema["required"]) == {"cardId", "input"}
    assert "AutoGen AssistantAgent card" in card_tool.description
    assert "instructionId" not in by_name["card.run_assistant_agent"].inputSchema["properties"]
    assert {scheme["scopes"][0] for scheme in by_name["engraphis.recall"].model_dump()["securitySchemes"]} == {"liquidaity.main"}
    assert {scheme["scopes"][0] for scheme in by_name["cbm.search_graph"].model_dump()["securitySchemes"]} == {"liquidaity.main"}
    assert {scheme["scopes"][0] for scheme in by_name["graphiti.get_status"].model_dump()["securitySchemes"]} == {"liquidaity.main"}
    assert by_name["cbm.search_graph"].description == "Native search description."
    assert by_name["cbm.search_graph"].inputSchema == native_cbm_tools[0].inputSchema
    assert by_name["coder.status"].annotations.readOnlyHint is True
    assert by_name["cbm.search_graph"].annotations.readOnlyHint is True
    assert by_name["cbm.search_graph"].annotations.destructiveHint is False
    assert by_name["graphiti.search_nodes"].annotations.readOnlyHint is True
    assert by_name["graphiti.search_nodes"].annotations.destructiveHint is False
    assert by_name["card.run_assistant_agent"].annotations.readOnlyHint is False
    assert by_name["card.run_assistant_agent"].annotations.destructiveHint is False

    active_scopes[:] = ["liquidaity.main"]
    main_names = {tool.name for tool in asyncio.run(mcp_host.list_tools())}
    assert {
        "main.context", "agentgraph.inspect", "canvas.inspect",
        "card.run_assistant_agent", "run_mag_one", "cbm.search_graph",
        "graphiti.search_nodes",
    }.issubset(main_names)
    assert {
        "coder.status", "engraphis.answer", "graphiti.get_status",
        "card.update_configuration", "canvas.upsert_wire",
    }.issubset(main_names)
    active_scopes[:] = ["liquidaity.main"]

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

    denied = asyncio.run(mcp_host.call_tool("card.run_assistant_agent", {
        "projectId": "spoofed",
        "cardId": "coder-card",
        "input": "Approved exact task.",
    }))
    assert denied.isError is True
    assert "caller_identity_rejected: projectId" in denied.content[0].text

    asyncio.run(mcp_host.call_tool("card.run_assistant_agent", {
        "cardId": "coder-card",
        "input": "Approved exact task.",
    }))
    path, payload = calls[-1]
    assert path == "card_run_assistant_agent"
    assert payload["projectId"] == "project-1"
    assert payload["deckId"] == "deck_builder"
    assert payload["conversationId"] == "external-mcp:grant-1"
    assert payload["originatingAgentId"] == "card_main_chat"
    assert payload["originatingRunId"] == "external-main:grant-1"

def test_authenticated_catalog_uses_one_main_scope_for_the_full_public_registry(monkeypatch):
    import asyncio
    import mcp_host
    from mcp.server.auth.provider import AccessToken

    context = {
        "projectId": "project-1",
        "deckId": "deck_builder",
        "conversationId": "external-mcp:grant-1",
        "parentRunId": "external-main:grant-1",
        "mainCardId": "card_main_chat",
    }
    active_scopes: list[str] = []

    def access_token():
        if not active_scopes:
            return None
        return AccessToken(
            token="verified",
            client_id="chatgpt-client",
            scopes=list(active_scopes),
            subject="auth0|jeremiah",
            claims={"liquidaity": context},
        )

    monkeypatch.setattr(mcp_host, "get_access_token", access_token)
    canonical = asyncio.run(mcp_host.list_tools())
    canonical_names = {tool.name for tool in canonical}
    assert len(canonical) == 69
    assert "run_coder_subagent" not in canonical_names
    assert "card.run_assistant_agent" in canonical_names
    assert not any(name.startswith("liquidaity.") for name in canonical_names)

    active_scopes[:] = ["liquidaity.main"]
    authenticated = asyncio.run(mcp_host.list_tools())
    assert len(authenticated) == 69
    assert {tool.name for tool in authenticated} == canonical_names
    main_context = asyncio.run(mcp_host.call_tool("main.context", {}))
    assert json.loads(main_context[0].text)["ok"] is True

def test_identical_native_cbm_index_requests_share_one_in_flight_call(monkeypatch):
    import threading
    from concurrent.futures import ThreadPoolExecutor
    from mcp.types import CallToolResult, TextContent
    import mcp_host

    entered = threading.Event()
    release = threading.Event()

    class NativeCbm:
        calls = 0

        def call_tool(self, name, arguments):
            assert name == "index_repository"
            self.calls += 1
            entered.set()
            assert release.wait(timeout=2)
            return CallToolResult(content=[TextContent(type="text", text="indexed")])

    native = NativeCbm()
    monkeypatch.setattr(mcp_host, "_initialize_native_cbm_sync", lambda: None)
    monkeypatch.setattr(mcp_host, "_NATIVE_CBM_CLIENT", native)
    monkeypatch.setattr(mcp_host, "_NATIVE_CBM_INDEX_IN_FLIGHT", None)
    arguments = {"repo_path": "C:/Projects/main", "mode": "fast"}

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(mcp_host._call_native_cbm, "index_repository", arguments)
        assert entered.wait(timeout=2)
        second = pool.submit(mcp_host._call_native_cbm, "index_repository", dict(arguments))
        release.set()
        assert first.result(timeout=2).content[0].text == "indexed"
        assert second.result(timeout=2).content[0].text == "indexed"

    assert native.calls == 1


def test_graphiti_episode_projection_is_bounded_and_full_body_is_explicit():
    import json
    from mcp.types import CallToolResult, TextContent
    import mcp_host

    native_payload = {
        "message": "Episodes retrieved successfully",
        "episodes": [{
            "uuid": "episode-1",
            "name": "Large source",
            "content": "x" * 24000,
            "created_at": "2026-08-02T00:00:00Z",
            "source": "text",
            "source_description": "A source",
            "group_id": "project-1",
        }],
    }
    native = CallToolResult(
        content=[TextContent(type="text", text=json.dumps(native_payload))],
        structuredContent={"result": native_payload},
    )

    compact = mcp_host._bounded_graphiti_episodes(
        native, include_body=False, preview_chars=120, response_budget=2000,
    )
    compact_episode = compact.structuredContent["result"]["episodes"][0]
    assert "content" not in compact_episode
    assert compact_episode["content_preview"] == "x" * 120
    assert compact_episode["content_truncated"] is True
    assert len(compact.content[0].text) <= 2000

    explicit = mcp_host._bounded_graphiti_episodes(
        native, include_body=True, preview_chars=120, response_budget=3000,
    )
    explicit_episode = explicit.structuredContent["result"]["episodes"][0]
    assert "content" in explicit_episode
    assert explicit_episode["content_truncated"] is True
    assert explicit.structuredContent["result"]["truncated"] is True
    assert len(explicit.content[0].text) <= 3000


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
    failed_payload = json.loads(failed.content[0].text)
    assert failed_payload["error"] == "database_failure"
    assert failed_payload["failureCode"] == "database_failure"
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
