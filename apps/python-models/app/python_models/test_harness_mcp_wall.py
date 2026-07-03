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
        assert "LIQUIDAITY_MCP_HOST" in source  # the one MCP boundary
        # No direct database / graph clients on the Harness side.
        for forbidden in ("from 'pg'", 'from "pg"', "neo4j", "psycopg", "ag_catalog"):
            assert forbidden not in source, f"harness gained direct dependency: {forbidden}"
        # No direct backend capability HTTP from the Harness gRPC server.
        for forbidden in ("/api/coder/mcp-bridge", "127.0.0.1:4000", "localhost:4000"):
            assert forbidden not in source, f"harness gained direct backend HTTP: {forbidden}"


class TestBackendHarnessMcpClientWall:
    def test_control_plane_mcp_client_is_a_thin_mcp_client(self):
        source = _read("apps/backend/src/services/mcp/pythonAgentMcpClient.ts")
        assert "@modelcontextprotocol/sdk" in source
        for forbidden in ("from '../../db", "thinkGraphStore", "runCypherOnGraph", "neo4j", "pg'"):
            assert forbidden not in source, f"mcp client gained direct capability: {forbidden}"

    def test_chat_front_door_crosses_mcp_not_direct(self):
        source = _read("apps/backend/src/routes/coder.routes.ts")
        chat_route = source.split("'/openclaude/session/chat'", 1)[1].split("'/openclaude/session/answer'", 1)[0]
        assert "callPythonAgentMcpTool('thinkgraph.process_conversation_pair'" in chat_route
        assert "processThinkGraphPair(" not in chat_route  # direct call would bypass MCP


class TestPythonMcpHostIsThin:
    def test_host_module_has_no_direct_db_or_graph_imports(self):
        source = _read("apps/python-models/app/mcp_host.py")
        for forbidden in ("import psycopg", "import neo4j", "from psycopg", "from neo4j", "ag_catalog"):
            assert forbidden not in source, f"mcp host gained direct dependency: {forbidden}"

    def test_host_exposes_no_graph_write_or_task_ledger_tool(self):
        source = _read("apps/python-models/app/mcp_host.py")
        assert 'name="apply_thinkgraph_patch"' not in source
        assert "taskLedgerArtifact" not in source


class TestNoMarkdownRuntimeSkills:
    def test_runtime_skill_chain_never_reads_markdown_or_scans_folders(self):
        for relative in (
            "apps/python-models/app/python_models/runtime_assignments.py",
            "apps/python-models/app/python_models/runtime_profile_executor.py",
            "apps/python-models/app/python_models/thinkgraph_profile.py",
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
            "apps/python-models/app/python_models/thinkgraph_profile.py",
            "apps/python-models/app/control_plane.py",
        ):
            source = _read(relative)
            for forbidden in ("taskLedger", "TaskLedger", "taskIds", "task_ledger"):
                assert forbidden not in source, f"{relative} references Task Ledger state: {forbidden}"
