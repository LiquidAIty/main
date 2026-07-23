"""Focused contract proof for the one official Python MCP host."""

import json
import os
import socket
import subprocess
import sys
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
import asyncio, sys, mcp_host
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
            actual = sorted(tool.name for tool in (await session.list_tools()).tools)
            assert actual == expected
            assert 'main.context' in actual
            print('STDIO_OK')

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


def test_auth0_token_verifier_checks_jwt_contract_and_resolves_server_owned_main(monkeypatch):
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
            "mainCardId": "card_main_chat",
            "instructions": "Persisted Main instructions.",
            "savedMainToolGrants": ["mcp__liquidaity__codegraph_search"],
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
            "mcp__liquidaity__codegraph_search",
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
            claims={"liquidaity": context},
        ),
    )
    tools = asyncio.run(mcp_host.list_tools())
    by_name = {tool.name: tool for tool in tools}
    assert "main.context" in by_name
    assert "codegraph.status" in by_name
    assert "codegraph.search" in by_name
    assert "run_coder_subagent" in by_name
    assert "run_mag_one" not in by_name
    assert "projectId" not in by_name["run_coder_subagent"].inputSchema["properties"]
    assert "parentRunId" not in by_name["run_coder_subagent"].inputSchema["properties"]
    assert by_name["codegraph.search"].model_dump()["securitySchemes"] == [
        {"type": "oauth2", "scopes": ["liquidaity.main"]}
    ]
    assert by_name["codegraph.search"].annotations.readOnlyHint is True
    assert by_name["run_coder_subagent"].annotations is None

    calls = []
    async def bridge(path, payload):
        calls.append((path, payload))
        return [mcp_host.TextContent(type="text", text=json.dumps({"ok": True}))]
    monkeypatch.setattr(mcp_host, "_bridge", bridge)

    asyncio.run(mcp_host.call_tool("codegraph.search", {"query": "Main", "limit": 3}))
    assert calls[-1] == ("codegraph_search", {
        "projectId": "project-1",
        "conversationId": "external-mcp:grant-1",
        "query": "Main",
        "limit": 3,
    })

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
    }))
    path, payload = calls[-1]
    assert path == "run_coder_subagent"
    assert payload["projectId"] == "project-1"
    assert payload["deckId"] == "deck_builder"
    assert payload["conversationId"] == "external-mcp:grant-1"
    assert payload["parentRunId"].startswith("req_external_main_")


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
