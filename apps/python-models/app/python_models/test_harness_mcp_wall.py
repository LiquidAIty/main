"""Harness MCP wall architecture sweep (static, no network).

The Harness (localcoder gRPC server + the backend control-plane MCP client)
may cross its capability boundary ONLY through MCP. These sweeps fail the build
if a new direct database / graph / Python-HTTP dependency appears on a Harness
path, if the MCP host stops being thin transport, or if runtime skills regress
to filesystem/Markdown reads.
"""

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]


def _read(relative: str) -> str:
    path = REPO_ROOT / relative
    assert path.exists(), f"expected file missing: {relative}"
    return path.read_text(encoding="utf-8", errors="replace")


class TestHarnessGrpcServerWall:
    def test_harness_crosses_only_via_the_mcp_host(self):
        source = _read("localcoder/src/grpc/server.ts")
        # The env-var/.env MCP wiring is dead: the official Python MCP config is
        # constructor-injected (PythonMcpConfig) and connected once for the
        # server's lifetime, never read from LIQUIDAITY_MCP_* env vars.
        assert "LIQUIDAITY_MCP_HOST" not in source
        assert "LIQUIDAITY_MCP_NODE" not in source
        assert "PythonMcpConfig" in source
        assert "connectOfficialPythonMcp" in source
        # No direct database / graph clients on the Harness side.
        for forbidden in ("from 'pg'", 'from "pg"', "neo4j", "psycopg", "ag_catalog"):
            assert forbidden not in source, f"harness gained direct dependency: {forbidden}"
        # No direct backend capability HTTP from the Harness gRPC server.
        for forbidden in ("/api/coder/mcp-bridge", "127.0.0.1:4000", "localhost:4000"):
            assert forbidden not in source, f"harness gained direct backend HTTP: {forbidden}"

    def test_start_grpc_resolves_and_validates_the_official_python_host(self):
        # start-grpc.ts is the only place the official host identity is built:
        # exact repo-root-resolved paths, existence-validated, fail-closed
        # (process.exit) before the server is constructed. No env vars, no
        # .env, no Node .mjs host.
        launcher = _read("localcoder/scripts/start-grpc.ts")
        assert "mcp_host.py" in launcher
        assert "python.exe" in launcher
        assert "existsSync" in launcher
        assert "process.exit(1)" in launcher
        for forbidden in ("LIQUIDAITY_MCP_HOST", "LIQUIDAITY_MCP_NODE", ".mjs", "liquidAItyMcpHost"):
            assert forbidden not in launcher, f"launcher regressed to: {forbidden}"


class TestBackendHarnessMcpClientWall:
    def test_control_plane_mcp_client_is_a_thin_mcp_client(self):
        source = _read("apps/backend/src/services/mcp/pythonAgentMcpClient.ts")
        assert "@modelcontextprotocol/sdk" in source
        for forbidden in ("from '../../db", "runCypherOnGraph", "neo4j", "pg'"):
            assert forbidden not in source, f"mcp client gained direct capability: {forbidden}"

class TestPythonMcpHostIsThin:
    def test_host_module_has_no_direct_db_or_graph_imports(self):
        source = _read("apps/python-models/app/mcp_host.py")
        for forbidden in ("import psycopg", "import neo4j", "from psycopg", "from neo4j", "ag_catalog"):
            assert forbidden not in source, f"mcp host gained direct dependency: {forbidden}"

    def test_host_exposes_the_native_authority_surface(self):
        source = _read("apps/python-models/app/mcp_host.py")
        assert 'name="card.run_assistant_agent"' in source
        assert "from engraphis.mcp_server import mcp" in source
        assert 'tools.extend(_namespace_native_tools(provider, native_tools))' in source
        assert '"engraphis": await _native_engraphis_tools()' in source
        assert '"cbm": await _native_cbm_tools()' in source
        assert '"graphiti": await _native_graphiti_tools()' in source
        assert 'name="knowgraph.query"' not in source
        assert 'name="knowgraph.ingest"' not in source
        assert 'name="codegraph.search"' not in source
        assert 'name="codegraph.status"' not in source
        assert 'name="web_search"' in source


class TestNoTaskLedgerOnNewPaths:
    def test_new_runtime_modules_never_touch_task_ledger_state(self):
        for relative in ("apps/python-models/app/control_plane.py",):
            source = _read(relative)
            for forbidden in ("taskLedger", "TaskLedger", "taskIds", "task_ledger"):
                assert forbidden not in source, f"{relative} references Task Ledger state: {forbidden}"
