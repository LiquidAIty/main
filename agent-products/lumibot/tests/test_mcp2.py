"""Real SDK interoperability and canonical wheel reproducibility, not model acceptance."""
import asyncio
from contextlib import contextmanager
from dataclasses import replace
import hashlib
from importlib.metadata import version
import json
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time

import httpx
import pytest

from lumibot.components.agents.runtime import _list_mcp_tools_async, _call_mcp_tool_async, _with_mcp_session_once, RemoteMCPToolError
from lumibot.components.agents.schemas import MCPServer

ROOT = Path(__file__).resolve().parents[3]
TESTS = Path(__file__).resolve().parent


def command(peer):
    return [sys.executable, str(TESTS / 'modern_server.py')] if peer == 'modern' else [shutil.which('node'), str(TESTS / 'legacy-server.mjs')]


@contextmanager
def endpoint(peer, transport):
    args = command(peer)
    if transport == 'stdio':
        yield MCPServer(name=peer, command=args[0], args=args[1:], transport='stdio',
                        exposed_tools=['multiply', 'refuse'], timeout_seconds=15)
        return
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0)); port = listener.getsockname()[1]
    process = subprocess.Popen([*args, str(port)], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        for _ in range(100):
            if process.poll() is not None:
                raise RuntimeError(process.stderr.read().decode(errors='replace'))
            try:
                httpx.get(f'http://127.0.0.1:{port}/mcp', timeout=.2)
                break
            except httpx.TransportError:
                time.sleep(.1)
        else:
            raise RuntimeError('Disposable protocol peer did not start')
        yield MCPServer(name=peer, url=f'http://127.0.0.1:{port}/mcp', transport='streamable_http',
                        exposed_tools=['multiply', 'refuse'], headers={'Authorization': 'Bearer acceptance-only'},
                        timeout_seconds=5, sse_read_timeout_seconds=5)
    finally:
        process.terminate()
        try: process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill(); process.communicate(timeout=5)


@pytest.mark.parametrize('peer', ['modern', 'legacy'])
@pytest.mark.parametrize('transport', ['stdio', 'http'])
def test_real_protocol_discovery_calls_and_error_alias(peer, transport):
    assert version('lumibot') == '4.6.48+mcp2.1'
    assert version('mcp').split('.')[0] == '2'
    with endpoint(peer, transport) as server:
        async def exercise():
            async def negotiated(client):
                return client.protocol_version
            protocol = await _with_mcp_session_once(server, negotiated)
            if peer == 'legacy':
                assert protocol == '2025-11-25'
            else:
                from mcp_types.version import MODERN_PROTOCOL_VERSIONS
                assert protocol in MODERN_PROTOCOL_VERSIONS
            listing = await _list_mcp_tools_async(server)
            multiply = next(tool for tool in listing if tool['name'] == 'multiply')
            assert multiply['inputSchema']['properties']['a']['type'] == 'integer'
            assert 'input_schema' not in multiply
            result = await _call_mcp_tool_async(server, 'multiply', {'a': 3, 'b': 7})
            assert any(json.loads(part['text']).get('value') == 21 for part in result['content'] if part['type'] == 'text')
            with pytest.raises(RemoteMCPToolError, match='refus'):
                await _call_mcp_tool_async(server, 'refuse', {})
            with pytest.raises(Exception):
                await _call_mcp_tool_async(server, 'multiply', {'a': 'not an integer', 'b': 7})
        asyncio.run(exercise())


def test_http_authentication_failure_is_not_success():
    with endpoint('modern', 'http') as server:
        server = replace(server, headers={'Authorization': 'Bearer wrong-acceptance-token'})
        with pytest.raises(Exception):
            asyncio.run(_list_mcp_tools_async(server))


def test_declared_dependencies_do_not_install_other_agent_frameworks():
    from importlib.metadata import requires
    requirements = requires('lumibot')
    assert 'mcp<3,>=2' in requirements
    assert not any('google-adk[extensions]' in item or 'langchain' in item or 'langgraph' in item or 'crewai' in item for item in requirements)


def test_patch_changes_only_declared_files_and_rebuilds_record():
    import base64, csv, io, zipfile
    wheel = ROOT / 'agent-products/lumibot/dist/lumibot-4.6.48+mcp2.1-py3-none-any.whl'
    with zipfile.ZipFile(wheel) as archive:
        # Preserve upstream Unix metadata on Windows too: the platform-default
        # create_system byte previously made the two deployment artifacts differ.
        assert all(info.create_system == 3 for info in archive.infolist())
        record = archive.read('lumibot-4.6.48+mcp2.1.dist-info/RECORD').decode()
        for path, expected, size in csv.reader(io.StringIO(record)):
            if not expected: continue
            body = archive.read(path)
            digest = base64.urlsafe_b64encode(hashlib.sha256(body).digest()).rstrip(b'=').decode()
            assert expected == 'sha256=' + digest
            assert int(size) == len(body)
