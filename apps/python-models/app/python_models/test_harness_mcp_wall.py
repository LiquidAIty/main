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
        for forbidden in ("from '../../db", "thinkGraphStore", "runCypherOnGraph", "neo4j", "pg'"):
            assert forbidden not in source, f"mcp client gained direct capability: {forbidden}"

    def test_chat_route_never_reintroduces_the_obsolete_pair_processor(self):
        # The user/assistant pair architecture was deleted. Hermes performs only
        # explicit bounded foreground updates through the native MCP surface.
        source = _read("apps/backend/src/routes/coder.routes.ts")
        for forbidden in (
            "processThinkGraphPair",
            "process_conversation_pair",
            "thinkgraph_process_pair",
        ):
            assert forbidden not in source, f"pair architecture reappeared in coder.routes.ts: {forbidden}"

    def test_pair_processor_module_is_deleted(self):
        # The obsolete module and its spec must not exist on disk.
        for relative in (
            "apps/backend/src/services/thinkgraph/processThinkGraphPair.ts",
            "apps/backend/src/services/thinkgraph/processThinkGraphPair.spec.ts",
        ):
            assert not (REPO_ROOT / relative).exists(), f"pair module still present: {relative}"


class TestPythonMcpHostIsThin:
    def test_host_module_has_no_direct_db_or_graph_imports(self):
        source = _read("apps/python-models/app/mcp_host.py")
        for forbidden in ("import psycopg", "import neo4j", "from psycopg", "from neo4j", "ag_catalog"):
            assert forbidden not in source, f"mcp host gained direct dependency: {forbidden}"

    def test_host_never_exposes_graph_agent_or_pair_tools(self):
        source = _read("apps/python-models/app/mcp_host.py")
        for forbidden in (
            'name="thinkgraph.apply_live_patch"',
            'name="apply_thinkgraph_patch"',
            'name="read_thinkgraph_scope"',
            'name="thinkgraph.process_conversation_pair"',
            'name="thinkgraph_agent"',
            'name="codegraph_agent"',
            'name="knowgraph_agent"',
            "thinkgraph_live_agent_turn",
            "_validate_live_authority",
            "_apply_live_patch",
            "taskLedgerArtifact",
        ):
            assert forbidden not in source, f"host regressed: {forbidden}"

    def test_host_exposes_the_native_authority_surface(self):
        source = _read("apps/python-models/app/mcp_host.py")
        assert 'name="card.run_assistant_agent"' in source
        assert 'name="thinkgraph.get_graph_slice"' in source
        assert 'name="thinkgraph.submit_update"' in source
        assert 'name="knowgraph.query"' in source
        assert 'name="knowgraph.ingest"' in source
        assert "from engraphis.mcp_server import mcp" in source
        assert "tools.extend(await _native_engraphis_tools())" in source
        assert 'name="codegraph.search"' not in source
        assert 'name="codegraph.status"' not in source
        assert 'name="thinkgraph.persist_graph_view"' not in source
        assert 'name="web_search"' in source


class TestNoMarkdownRuntimeSkills:
    def test_runtime_skill_chain_never_reads_markdown_or_scans_folders(self):
        for relative in (
            "apps/python-models/app/python_models/runtime_assignments.py",
            "apps/python-models/app/python_models/runtime_profile_executor.py",
        ):
            source = _read(relative)
            assert ".md" not in source, f"{relative} references Markdown"
            for forbidden in ("glob(", "iglob", "listdir", "scandir", "rglob", "walk("):
                assert forbidden not in source, f"{relative} scans the filesystem: {forbidden}"


class TestNoTaskLedgerOnNewPaths:
    def test_new_runtime_modules_never_touch_task_ledger_state(self):
        for relative in (
            "apps/python-models/app/python_models/runtime_assignments.py",
            "apps/python-models/app/python_models/runtime_profile_executor.py",
            "apps/python-models/app/control_plane.py",
        ):
            source = _read(relative)
            for forbidden in ("taskLedger", "TaskLedger", "taskIds", "task_ledger"):
                assert forbidden not in source, f"{relative} references Task Ledger state: {forbidden}"
