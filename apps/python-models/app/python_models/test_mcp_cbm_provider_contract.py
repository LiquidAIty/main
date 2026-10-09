"""MCP Codebase Memory client ownership contract tests."""

import json
import os
import sys

import pytest

_APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _APP_DIR not in sys.path:
    sys.path.insert(0, _APP_DIR)

from app.python_models.provider_config import ensure_env_loaded

ensure_env_loaded()

from app import (
    mcp_cbm_provider,
    mcp_provider_operations,
)
from mcp.types import Tool


def test_main_selects_stdio_transport(monkeypatch):
    import asyncio
    import mcp_host

    events = []

    async def run_stdio():
        events.append("stdio")

    async def run_http():
        events.append("http")

    monkeypatch.setattr(mcp_host, "MCP_TRANSPORT", "stdio")
    monkeypatch.setattr(mcp_host, "_run_stdio", run_stdio)
    monkeypatch.setattr(mcp_host, "_run_streamable_http", run_http)

    asyncio.run(mcp_host.main())

    assert events == ["stdio"]

def test_cbm_lifespan_uses_one_official_sdk_client_and_closes_once(monkeypatch):
    import asyncio
    import mcp_host

    provider_tool = Tool(
        name="list_projects",
        description="CBM project list.",
        inputSchema={"type": "object", "properties": {}},
    )

    class OfficialClient:
        closed = False

        async def __aexit__(self, *_args):
            self.closed = True

    client = OfficialClient()
    opens = []

    async def open_client(command, args, cwd, **_kwargs):
        opens.append((command, list(args), cwd))
        return client, (provider_tool,), ["list_projects"]

    monkeypatch.setattr(mcp_cbm_provider, "_CBM_CLIENT", None)
    monkeypatch.setattr(mcp_cbm_provider, "_CBM_TOOLS", None)
    monkeypatch.setattr(mcp_cbm_provider, "_CBM_NAMES", frozenset())
    monkeypatch.setattr(
        mcp_provider_operations,
        "_cbm_config",
        lambda: ("cbm", ["--stdio"], r"C:\Projects\main"),
    )
    monkeypatch.setattr(mcp_cbm_provider, "_open_cbm_client", open_client)

    async def check():
        command, args, cwd = mcp_provider_operations._cbm_config()
        for _ in range(2):
            await mcp_cbm_provider._start_cbm_client(
                command,
                args,
                cwd,
                implementation_version=mcp_host._MCP_IMPLEMENTATION_VERSION,
                request_timeout_seconds=mcp_provider_operations._CBM_REQUEST_TIMEOUT_SECONDS,
            )
        assert mcp_cbm_provider._CBM_CLIENT is client
        assert mcp_cbm_provider._CBM_NAMES == frozenset({"list_projects"})
        await mcp_cbm_provider._close_cbm()

    asyncio.run(check())

    assert opens == [("cbm", ["--stdio"], r"C:\Projects\main")]
    assert client.closed is True
    assert mcp_cbm_provider._CBM_CLIENT is None
    assert mcp_cbm_provider._CBM_TOOLS is None
    assert mcp_cbm_provider._CBM_NAMES == frozenset()

def test_http_mcp_resolves_the_current_official_command_from_path():
    import shutil
    import mcp_host

    command, args, cwd = mcp_provider_operations._cbm_config()
    expected_command = os.environ.get("MCP_CBM_BINARY", "").strip() or "codebase-memory-mcp"
    assert command == (shutil.which(expected_command) or expected_command)
    assert os.path.isfile(command)
    assert os.path.basename(command).lower() == "codebase-memory-mcp.exe"
    assert args == []
    assert cwd == mcp_provider_operations._CBM_HOST_REPO_ROOT

def test_dev_fresh_does_not_resolve_or_launch_optional_cbm():
    script = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))),
        "scripts",
        "start-dev-services.ps1",
    )
    source = open(script, encoding="utf-8").read()
    assert "MCP_CBM_BINARY" not in source
    assert "Get-Command codebase-memory-mcp" not in source
    assert "CBM startup failed" not in source
    assert "continuing LiquidAIty startup" not in source
    assert "& npm.cmd run dev:services" in source
    assert "USERPROFILE" not in source
    assert ".local\\bin\\codebase-memory-mcp.exe" not in source
    assert "--version" not in source
    assert "MCP_CBM_EXPECTED_VERSION" not in source
    assert "0.10.8" not in source
    assert "0.11.0" not in source
    assert "$expectedVersion" not in source
    assert "$expectedSha256" not in source
    assert "LiquidAIty\\cbm\\" not in source
    assert "docker" not in source.lower()
    assert "compose" not in source.lower()
    assert "AddSeconds(60)" not in source
    assert "POSTGRES_PASSWORD" not in source
    assert "NEO4J_PASSWORD" not in source

def test_cbm_adapter_has_no_version_checksum_or_catalog_copy():
    repo_root = os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
    )
    provider_sources = open(
        os.path.join(
            repo_root,
            "apps",
            "python-models",
            "app",
            "mcp_provider_operations.py",
        ),
        encoding="utf-8",
    ).read()
    cbm_provider_source = open(
        os.path.join(
            repo_root,
            "apps",
            "python-models",
            "app",
            "mcp_cbm_provider.py",
        ),
        encoding="utf-8",
    ).read()
    provider_sources += cbm_provider_source
    registry_source = open(
        os.path.join(
            repo_root,
            "apps",
            "python-models",
            "app",
            "python_models",
            "tool_registry.py",
        ),
        encoding="utf-8",
    ).read()
    idd_source = open(os.path.join(repo_root, "LiquidAIty.idd"), encoding="utf-8").read()

    assert "MCP_CBM_EXPECTED_VERSION" not in provider_sources
    assert "_cbm_binary_sha256" not in provider_sources
    assert "0.10.8" not in provider_sources
    assert "0.11.0" not in provider_sources
    assert "_CBM_READ_OPERATIONS" not in registry_source
    assert "_CBM_WRITE_OPERATIONS" not in registry_source
    assert 'id = "cbm.' not in idd_source

def test_repository_has_one_application_owned_host_cbm_boundary():
    repo_root = os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
    )
    forbidden_paths = [
        os.path.join(repo_root, ".codex", "hooks.json"),
        os.path.join(repo_root, ".codex", "hooks", "cbm_" + "graph_handoff.ps1"),
        os.path.join(repo_root, "scripts", "setup-" + "codebase-memory-mcp.ps1"),
        os.path.join(repo_root, "scripts", "check-" + "codebase-memory-mcp.ps1"),
        os.path.join(repo_root, ".tools", "codebase-memory-mcp"),
    ]
    assert all(not os.path.exists(path) for path in forbidden_paths)

    package = json.loads(open(os.path.join(repo_root, "package.json"), encoding="utf-8").read())
    assert "mcp:" + "setup" not in package["scripts"]
    assert "mcp:" + "check" not in package["scripts"]
    assert "CBM_UI_ENABLED" not in package["scripts"]["dev:mcp"]
    assert "9749" not in package["scripts"]["dev:mcp"]

    assert not os.path.exists(os.path.join(repo_root, "Dockerfile.codegraph"))
    assert not os.path.exists(os.path.join(repo_root, "compose.codegraph.yaml"))

    startup = open(
        os.path.join(repo_root, "scripts", "start-dev-services.ps1"),
        encoding="utf-8",
    ).read()
    assert "Get-Command codebase-memory-mcp" not in startup
    assert ".local\\bin\\codebase-memory-mcp.exe" not in startup
    assert "LiquidAIty\\cbm\\" not in startup
    assert "MCP_CBM_BINARY" not in startup

    vite = open(os.path.join(repo_root, "client", "vite.config.ts"), encoding="utf-8").read()
    assert "127.0.0.1:9749" not in vite

    codegraph_surface = open(
        os.path.join(
            repo_root,
            "client",
            "src",
            "components",
            "knowledge",
            "KnowledgeAuthorityGraphSurface.tsx",
        ),
        encoding="utf-8",
    ).read()
    assert "vendor/codebase-memory-ui/src/components/GraphTab" not in codegraph_surface

def test_codegraph_host_root_derives_the_canonical_project_identity():
    repo_root = os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
    )
    paths = [
        os.path.join(
            repo_root,
            "apps",
            "python-models",
            "app",
            "mcp_provider_operations.py",
        ),
        os.path.join(repo_root, "scripts", "start-dev-services.ps1"),
    ]
    sources = [open(path, encoding="utf-8").read() for path in paths]
    removed_root = "/" + "workspace" + "/main"
    assert "_CBM_HOST_REPO_ROOT" in sources[0]
    assert "MCP_CBM_BINARY" in sources[0]
    assert "MCP_CBM_BINARY" not in sources[1]
    assert all(removed_root not in source for source in sources)

def test_cbm_dispatch_uses_the_initialized_stdio_client(monkeypatch):
    import asyncio
    import mcp_host
    from mcp.types import CallToolResult, TextContent

    provider_tool = Tool(
        name="search_graph",
        description="CBM project search.",
        inputSchema={"type": "object", "properties": {}},
    )
    monkeypatch.setattr(mcp_cbm_provider, "_CBM_TOOLS", (provider_tool,))
    monkeypatch.setattr(
        mcp_cbm_provider, "_CBM_NAMES", frozenset({"search_graph"})
    )
    calls = []

    class CbmClient:
        async def call_tool(self, name, arguments, *, read_timeout_seconds):
            assert read_timeout_seconds == mcp_provider_operations._CBM_REQUEST_TIMEOUT_SECONDS
            calls.append((name, dict(arguments)))
            return CallToolResult(content=[TextContent(type="text", text="ok")])

    monkeypatch.setattr(mcp_cbm_provider, "_CBM_CLIENT", CbmClient())
    result = asyncio.run(mcp_provider_operations._call_cbm(
        "search_graph",
        {"project": "C-Projects-LiquidAIty-main", "query": "Graph Agent continuity"},
    ))

    assert calls == [
        (
            "search_graph",
            {
                "project": "C-Projects-LiquidAIty-main",
                "query": "Graph Agent continuity",
            },
        )
    ]
    assert result.content[0].text == "ok"

def test_cbm_client_failure_is_strict(monkeypatch):
    import asyncio
    import mcp_host

    class FailingClient:
        async def call_tool(self, _name, _arguments, **_kwargs):
            raise RuntimeError("provider transport closed")

    monkeypatch.setattr(mcp_cbm_provider, "_CBM_CLIENT", FailingClient())
    with pytest.raises(RuntimeError, match="provider transport closed"):
        asyncio.run(mcp_provider_operations._call_cbm(
            "search_graph", {"project": "C-Projects-LiquidAIty-main"}
        ))

def test_cbm_bootstrap_failure_does_not_spawn_a_second_frontend(monkeypatch):
    import asyncio
    import mcp_host

    attempts = []
    async def open_client(command, args, cwd, **_kwargs):
        attempts.append((command, list(args), cwd))
        raise RuntimeError(
            "cbm_process_exited:1:codebase-memory-mcp: "
            "CBM daemon could not start within 30000 ms"
        )

    monkeypatch.setattr(mcp_cbm_provider, "_open_cbm_client", open_client)
    monkeypatch.setattr(mcp_cbm_provider, "_CBM_CLIENT", None)
    monkeypatch.setattr(mcp_cbm_provider, "_CBM_TOOLS", None)
    monkeypatch.setattr(
        mcp_provider_operations,
        "_cbm_config",
        lambda: (
            "docker",
            ["exec", "-i", "codegraph", "/usr/local/bin/codebase-memory-mcp"],
            "repo",
        ),
    )
    with pytest.raises(RuntimeError, match="CBM daemon could not start within 30000 ms"):
        command, args, cwd = mcp_provider_operations._cbm_config()
        asyncio.run(mcp_cbm_provider._start_cbm_client(
            command,
            args,
            cwd,
            implementation_version=mcp_host._MCP_IMPLEMENTATION_VERSION,
            request_timeout_seconds=mcp_provider_operations._CBM_REQUEST_TIMEOUT_SECONDS,
        ))

    assert attempts == [
        (
            "docker",
            ["exec", "-i", "codegraph", "/usr/local/bin/codebase-memory-mcp"],
            "repo",
        )
    ]

def test_cbm_bootstrap_does_not_retry_other_failures(monkeypatch):
    import asyncio
    import mcp_host

    attempts = 0

    async def open_client(_command, _args, _cwd, **_kwargs):
        nonlocal attempts
        attempts += 1
        raise RuntimeError("cbm_initialize_invalid")

    monkeypatch.setattr(mcp_cbm_provider, "_open_cbm_client", open_client)
    monkeypatch.setattr(mcp_cbm_provider, "_CBM_CLIENT", None)
    monkeypatch.setattr(mcp_cbm_provider, "_CBM_TOOLS", None)
    command, args, cwd = mcp_provider_operations._cbm_config()
    with pytest.raises(RuntimeError, match="cbm_initialize_invalid"):
        asyncio.run(mcp_cbm_provider._start_cbm_client(
            command,
            args,
            cwd,
            implementation_version=mcp_host._MCP_IMPLEMENTATION_VERSION,
            request_timeout_seconds=mcp_provider_operations._CBM_REQUEST_TIMEOUT_SECONDS,
        ))
    assert attempts == 1

def test_cbm_duplicate_catalog_closes_the_only_frontend(monkeypatch):
    import asyncio
    import mcp_host
    from mcp.types import ListToolsResult

    attempts = 0
    closed = False
    provider_tool = Tool(
        name="search_graph",
        description="CBM project search.",
        inputSchema={"type": "object", "properties": {}},
    )

    class OfficialClient:
        def __init__(self, _server, **_kwargs):
            nonlocal attempts
            attempts += 1

        async def __aenter__(self):
            return self

        async def list_tools(self, **_kwargs):
            return ListToolsResult(tools=[provider_tool, provider_tool])

        async def __aexit__(self, *_args):
            nonlocal closed
            closed = True

    monkeypatch.setattr(mcp_cbm_provider, "Client", OfficialClient)
    with pytest.raises(RuntimeError, match="cbm_duplicate_tool_name"):
        asyncio.run(mcp_cbm_provider._open_cbm_client(
            "docker",
            [],
            "repo",
            implementation_version=mcp_host._MCP_IMPLEMENTATION_VERSION,
            request_timeout_seconds=mcp_provider_operations._CBM_REQUEST_TIMEOUT_SECONDS,
        ))
    assert attempts == 1
    assert closed is True
