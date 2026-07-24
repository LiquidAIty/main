"""Focused contract proof for the one official Python MCP host."""

import json
import os
import socket
import subprocess
import sys
import threading
import time

_APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _APP_DIR not in sys.path:
    sys.path.insert(0, _APP_DIR)


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
    assert by_name['main.context'].inputSchema == {'type': 'object', 'properties': {}, 'required': []}
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


def test_native_engraphis_registry_is_initialized_once_without_schema_adaptation():
    code = """
import asyncio, json, mcp_host
async def check():
    await mcp_host._initialize_native_engraphis()
    native = {tool.name: tool for tool in await mcp_host._native_engraphis_mcp().list_tools()}
    first = await mcp_host._native_engraphis_tools()
    await mcp_host._initialize_native_engraphis()
    second = await mcp_host._native_engraphis_tools()
    assert len(native) == 29
    assert [id(tool) for tool in first] == [id(tool) for tool in second]
    assert {tool.name for tool in first} == set(native)
    for tool in first:
        assert tool.model_dump() == native[tool.name].model_dump()
    combined = await mcp_host.list_tools()
    combined_names = [tool.name for tool in combined]
    assert len(combined_names) == 65
    assert len(set(combined_names)) == 65
    assert len(set(combined_names) - set(native)) == 36
    print(json.dumps(sorted(native)))
asyncio.run(check())
"""
    result = _run_in_script_launch_context(code)
    assert result.returncode == 0, result.stderr
    assert len(json.loads(result.stdout)) == 29


def test_native_engraphis_dispatch_keeps_sync_handlers_off_the_outer_event_loop(monkeypatch):
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
            entered.set()
            if not release.wait(timeout=2):
                raise RuntimeError("test_release_timeout")
            return [native_result], {"result": {"ok": True, "source": "native"}}

    async def initialized():
        return None

    monkeypatch.setattr(mcp_host, "_initialize_native_engraphis", initialized)
    monkeypatch.setattr(mcp_host, "_NATIVE_ENGRAPHIS_NAMES", frozenset({"engraphis_stats"}))
    monkeypatch.setattr(mcp_host, "_native_engraphis_mcp", lambda: NativeMcp())

    async def check():
        task = asyncio.create_task(mcp_host.call_tool("engraphis_stats", {"canonical": True}))
        for _ in range(200):
            if entered.is_set():
                break
            await asyncio.sleep(0.005)
        assert entered.is_set()
        heartbeat = False
        await asyncio.sleep(0)
        heartbeat = True
        release.set()
        result = await asyncio.wait_for(task, timeout=2)
        return result, heartbeat

    result, heartbeat = asyncio.run(check())
    assert heartbeat is True
    assert result[0][0] is native_result
    assert result[1] == {"result": {"ok": True, "source": "native"}}
    assert calls == [("engraphis_stats", {"canonical": True}, calls[0][2])]
    assert calls[0][2] != outer_thread

    active = 0
    max_active = 0
    state_lock = threading.Lock()

    class SerializedNativeMcp:
        async def call_tool(self, _name, _arguments):
            nonlocal active, max_active
            with state_lock:
                active += 1
                max_active = max(max_active, active)
            time.sleep(0.05)
            with state_lock:
                active -= 1
            return [mcp_host.TextContent(type="text", text="serialized")]

    monkeypatch.setattr(mcp_host, "_native_engraphis_mcp", lambda: SerializedNativeMcp())

    async def check_serialization():
        return await asyncio.gather(
            mcp_host.call_tool("engraphis_stats", {"request": 1}),
            mcp_host.call_tool("engraphis_stats", {"request": 2}),
        )

    serialized_results = asyncio.run(check_serialization())
    assert [result[0].text for result in serialized_results] == ["serialized", "serialized"]
    assert max_active == 1


def test_native_engraphis_worker_completion_failure_and_cancellation_exit_cleanly():
    code = """
import asyncio, json, time, mcp_host

class NativeFailure(RuntimeError):
    pass

class NativeMcp:
    async def call_tool(self, name, arguments):
        if name == 'native_failure':
            raise NativeFailure('canonical native failure')
        if name == 'cancelled_call':
            time.sleep(0.1)
        return [mcp_host.TextContent(type='text', text=json.dumps({
            'name': name,
            'arguments': arguments,
        }))]

native = NativeMcp()
mcp_host._NATIVE_ENGRAPHIS_MCP = native
mcp_host._NATIVE_ENGRAPHIS_TOOLS = ()
mcp_host._NATIVE_ENGRAPHIS_NAMES = frozenset({
    'normal_call', 'native_failure', 'cancelled_call',
})

async def check():
    normal = await mcp_host.call_tool('normal_call', {'value': 1})
    assert json.loads(normal[0].text) == {
        'name': 'normal_call',
        'arguments': {'value': 1},
    }
    try:
        await asyncio.to_thread(
            mcp_host._call_native_engraphis,
            'native_failure',
            {'value': 2},
        )
    except NativeFailure as exc:
        assert str(exc) == 'canonical native failure'
    else:
        raise AssertionError('native_exception_was_not_propagated')
    typed = await mcp_host.call_tool('native_failure', {'value': 3})
    assert json.loads(typed[0].text) == {
        'ok': False,
        'error': 'engraphis_failed: canonical native failure',
    }
    pending = asyncio.create_task(
        mcp_host.call_tool('cancelled_call', {'value': 4})
    )
    await asyncio.sleep(0.01)
    pending.cancel()
    try:
        await pending
    except asyncio.CancelledError:
        pass
    else:
        raise AssertionError('cancelled_call_was_not_cancelled')

asyncio.run(check())
print('NATIVE_WORKER_LIFECYCLE_OK')
"""
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=_APP_DIR,
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert result.returncode == 0, result.stderr
    assert "NATIVE_WORKER_LIFECYCLE_OK" in result.stdout


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
            assert 'main.context' in actual
            assert len(actual) == 65
            assert sum(name.startswith('engraphis_') for name in actual) == 29
            assert elapsed < 10
            print(json.dumps({{'status': 'STDIO_OK', 'count': len(actual), 'elapsed': elapsed}}))

asyncio.run(check())
"""
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=_APP_DIR,
        capture_output=True,
        text=True,
        timeout=20,
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
        lambda issuer, subject, **_kwargs: {
            "projectId": "project-1",
            "deckId": "deck_builder",
            "conversationId": "external-mcp:grant-1",
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
    assert "mainCardId" not in verified.claims["liquidaity"]

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


def test_authenticated_catalog_and_dispatch_use_saved_main_grants_and_server_identity(monkeypatch):
    import asyncio
    import mcp_host
    from mcp.server.auth.provider import AccessToken

    context = {
        "projectId": "project-1",
        "deckId": "deck_builder",
        "conversationId": "external-mcp:grant-1",
        "mainCardId": "card_main_chat",
        "instructions": "Persisted Main instructions.",
        "savedMainToolGrants": [
            "mcp__liquidaity__engraphis_recall",
            "mcp__liquidaity__run_coder_subagent",
        ],
    }
    monkeypatch.setattr(
        mcp_host,
        "get_access_token",
        lambda: AccessToken(
            token="verified",
            client_id="chatgpt-client",
            scopes=["liquidaity.main"],
            subject="auth0|jeremiah",
            claims={
                "iss": "https://tenant.auth0.com/",
                "liquidaity": {
                    "projectId": "project-1",
                    "deckId": "deck_builder",
                    "conversationId": "external-mcp:grant-1",
                },
            },
        ),
    )
    monkeypatch.setattr(
        mcp_host,
        "_resolve_external_main_context_sync",
        lambda issuer, subject, *, resolve_runtime=False: (
            context
            if resolve_runtime
            and issuer == "https://tenant.auth0.com/"
            and subject == "auth0|jeremiah"
            else None
        ),
    )
    tools = asyncio.run(mcp_host.list_tools())
    by_name = {tool.name: tool for tool in tools}
    assert "main.context" in by_name
    assert "engraphis_recall" in by_name
    assert "codegraph.status" not in by_name
    assert "codegraph.search" not in by_name
    assert "thinkgraph.persist_graph_view" not in by_name
    assert "run_coder_subagent" in by_name
    assert "run_mag_one" not in by_name
    assert "projectId" not in by_name["run_coder_subagent"].inputSchema["properties"]
    assert "parentRunId" not in by_name["run_coder_subagent"].inputSchema["properties"]
    assert "agentContextId" in by_name["run_coder_subagent"].inputSchema["properties"]
    assert "agentContext" not in by_name["run_coder_subagent"].inputSchema["properties"]
    assert by_name["engraphis_recall"].model_dump()["securitySchemes"] == [
        {"type": "oauth2", "scopes": ["liquidaity.main"]}
    ]
    assert by_name["run_coder_subagent"].annotations is None

    calls = []
    native_tools = asyncio.run(mcp_host._native_engraphis_tools())
    class NativeMcp:
        async def list_tools(self):
            return native_tools

        async def call_tool(self, name, arguments):
            calls.append((name, arguments))
            return [mcp_host.TextContent(type="text", text=json.dumps({"ok": True}))]

    monkeypatch.setattr(mcp_host, "_native_engraphis_mcp", lambda: NativeMcp())

    async def bridge(path, payload):
        calls.append((path, payload))
        return [mcp_host.TextContent(type="text", text=json.dumps({"ok": True}))]
    monkeypatch.setattr(mcp_host, "_bridge", bridge)

    asyncio.run(mcp_host.call_tool("engraphis_recall", {"query": "Main", "limit": 3}))
    assert calls[-1] == ("engraphis_recall", {"query": "Main", "limit": 3})

    denied = asyncio.run(mcp_host.call_tool("run_coder_subagent", {
        "projectId": "spoofed",
        "cardId": "coder-card",
        "adapter": "codex",
        "approvedPrompt": "Approved exact task.",
    }))
    assert "caller_identity_rejected: projectId" in denied[0].text

    asyncio.run(mcp_host.call_tool("run_coder_subagent", {
        "cardId": "coder-card",
        "adapter": "codex",
        "approvedPrompt": "Approved exact task.",
        "agentContextId": "agentctx:test",
    }))
    path, payload = calls[-1]
    assert path == "run_coder_subagent"
    assert payload["projectId"] == "project-1"
    assert payload["deckId"] == "deck_builder"
    assert payload["conversationId"] == "external-mcp:grant-1"
    assert payload["parentRunId"].startswith("req_external_main_")
    assert payload["agentContextId"] == "agentctx:test"


def test_post_auth_unknown_saved_grant_is_configuration_error_not_authentication(monkeypatch):
    import asyncio
    import mcp_host
    from mcp.server.auth.provider import AccessToken

    monkeypatch.setattr(
        mcp_host,
        "get_access_token",
        lambda: AccessToken(
            token="verified",
            client_id="chatgpt-client",
            scopes=["liquidaity.main"],
            subject="auth0|jeremiah",
            claims={
                "iss": "https://tenant.auth0.com/",
                "liquidaity": {
                    "projectId": "project-1",
                    "deckId": "deck_builder",
                    "conversationId": "external-mcp:grant-1",
                },
            },
        ),
    )
    monkeypatch.setattr(
        mcp_host,
        "_resolve_external_main_context_sync",
        lambda _issuer, _subject, *, resolve_runtime=False: {
            "projectId": "project-1",
            "deckId": "deck_builder",
            "conversationId": "external-mcp:grant-1",
            "mainCardId": "card_main_chat",
            "instructions": "Persisted Main instructions.",
            "savedMainToolGrants": ["codegraph.status"],
            "availableActionPaths": [{"kind": "tool", "grant": "codegraph.status"}],
        } if resolve_runtime else None,
    )

    result = asyncio.run(mcp_host.call_tool("main.context", {}))
    payload = json.loads(result[0].text)
    assert payload == {
        "ok": False,
        "error": (
            "main_runtime_configuration_error:"
            "harness_mcp_tool_unknown:codegraph.status"
        ),
    }


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
