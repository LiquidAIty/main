"""The ONE shared implementation behind write_mag_one_instructions / read_model_results.

Proves: the workspace is resolved from server state (env), never a client path; the
handoff prompt.md packet is byte-exact and reusable by run id; the Mag One handoff
read path sees those exact bytes; and read_model_results lists runs/files, reads
text, and returns honest empty/invalid states.
"""
import asyncio
import json
import os

import pytest

from app import mcp_host
from app.python_models import coder_job_tools as cjt
from app.python_models import job_folder as jf


@pytest.fixture()
def workspace(tmp_path, monkeypatch):
    # Server-forced trusted repo root — the ONLY way the tools learn the workspace.
    # The default owned Coder workspace is <repo-root>/coder-workspace.
    monkeypatch.setenv("LIQUIDAITY_GRPC_CWD", str(tmp_path))
    ws = cjt.resolve_workspace_root()  # <tmp_path>/coder-workspace, created
    os.makedirs(os.path.join(ws, "src"), exist_ok=True)
    with open(os.path.join(ws, "src", "secret.py"), "w", encoding="utf-8") as fh:
        fh.write("SOURCE = 1\n")
    return ws


class TestWorkspaceAuthority:
    def test_workspace_root_defaults_to_coder_workspace_under_server_root(self, workspace, tmp_path):
        assert cjt.resolve_workspace_root() == workspace
        assert workspace == os.path.join(str(tmp_path), "coder-workspace")
        assert os.path.isdir(workspace)  # created if absent

    def test_write_ignores_a_client_supplied_path_and_uses_the_trusted_root(self, workspace):
        out = cjt.write_mag_one_instructions(
            {"instructions": "do it", "workspaceRoot": "C:/evil", "path": "/etc"}
        )
        # Extra client keys are simply not consulted; the file lands under the trusted root.
        assert out["ok"] is True
        assert os.path.isfile(os.path.join(workspace, "handoff", out["runId"], "prompt.md"))


class TestWriteMagOneInstructions:
    def test_creates_handoff_and_returns_folders_with_exact_bytes(self, workspace):
        packet = "---\njobId: run_x\npacketKind: magnetic_one_context\ncontextPointers: []\n---\n\n# Current ask\nbuild X\n"
        out = cjt.write_mag_one_instructions({"instructions": packet})
        assert out["ok"] is True and out["status"] == "handoff_written"
        run_id = out["runId"]
        assert out["handoffPath"] == f"handoff/{run_id}/prompt.md"
        assert out["returnsPath"] == f"returns/{run_id}/"
        assert os.path.isdir(os.path.join(workspace, "returns", run_id))
        # Byte-exact, and readable through the SAME path a Coder-created Mag One run uses.
        folder = jf.resolve_job_folder(workspace, run_id)
        assert jf.read_handoff_prompt(folder) == packet

    def test_reuses_an_existing_run_id(self, workspace):
        first = cjt.write_mag_one_instructions({"instructions": "v1"})
        second = cjt.write_mag_one_instructions({"instructions": "v2", "runId": first["runId"]})
        assert second["runId"] == first["runId"]
        folder = jf.resolve_job_folder(workspace, first["runId"])
        assert jf.read_handoff_prompt(folder) == "v2"

    def test_rejects_empty_instructions(self, workspace):
        out = cjt.write_mag_one_instructions({"instructions": "   "})
        assert out["ok"] is False and out["status"] == "invalid_instructions"

    def test_rejects_a_traversal_run_id(self, workspace):
        out = cjt.write_mag_one_instructions({"instructions": "x", "runId": "../escape"})
        assert out["ok"] is False and out["status"] == "invalid_result_path"


class TestReadModelResults:
    def test_no_run_id_lists_runs_or_honest_empty(self, workspace):
        assert cjt.read_model_results({})["status"] == "no_return_runs_found"
        run_id = cjt.write_mag_one_instructions({"instructions": "x"})["runId"]
        folder = jf.resolve_job_folder(workspace, run_id)
        jf.write_return_file(folder, "agent_a", "a.md", "hi")
        assert jf.write_return_file(
            folder,
            "agent_a",
            f"returns/{run_id}/agent_a/full-path.md",
            "full path",
        ) == f"returns/{run_id}/agent_a/full-path.md"
        listed = cjt.read_model_results({})
        assert listed["status"] == "return_runs_listed"
        assert any(r["runId"] == run_id for r in listed["runs"])

    def test_run_id_lists_files_or_honest_empty(self, workspace):
        run_id = cjt.write_mag_one_instructions({"instructions": "x"})["runId"]
        empty = cjt.read_model_results({"runId": run_id})
        assert empty["status"] == "no_return_files_created" and empty["files"] == []
        jf.write_return_file(jf.resolve_job_folder(workspace, run_id), "agent_a", "proposed/x.patch", "diff")
        listed = cjt.read_model_results({"runId": run_id})
        assert listed["status"] == "return_files_listed"
        assert listed["files"] == [f"returns/{run_id}/agent_a/proposed/x.patch"]

    def test_rejects_a_workspace_prefix_for_another_job_or_card(self, workspace):
        run_id = cjt.write_mag_one_instructions({"instructions": "x"})["runId"]
        folder = jf.resolve_job_folder(workspace, run_id)
        with pytest.raises(ValueError, match="return_path_wrong_job_or_card"):
            jf.write_return_file(folder, "agent_a", "returns/other_job/agent_a/x.md", "no")

    def test_reads_a_text_artifact(self, workspace):
        run_id = cjt.write_mag_one_instructions({"instructions": "x"})["runId"]
        jf.write_return_file(jf.resolve_job_folder(workspace, run_id), "agent_a", "r.md", "# report\n")
        out = cjt.read_model_results({"runId": run_id, "path": "agent_a/r.md"})
        assert out["ok"] is True and out["artifact"]["kind"] == "text"
        assert out["artifact"]["content"] == "# report\n"

    def test_artifact_not_found_and_invalid_path_are_honest(self, workspace):
        run_id = cjt.write_mag_one_instructions({"instructions": "x"})["runId"]
        assert cjt.read_model_results({"runId": run_id, "path": "gone.md"})["status"] == "artifact_not_found"
        escaped = cjt.read_model_results({"runId": run_id, "path": "../../src/secret.py"})
        assert escaped["ok"] is False and escaped["status"] == "invalid_result_path"


class TestMcpHostDispatch:
    """The chat-Coder reaches the SAME shared impl through the one MCP host
    (server.ts:279 injects these tools). The card-Coder reaches the identical host
    via adapter.ts injection — same tool, same functions, one implementation.
    """

    def _call(self, name: str, args: dict) -> dict:
        out = asyncio.run(mcp_host.call_tool(name, args))
        return json.loads(out[0].text)

    def test_write_tool_routes_to_shared_impl(self, workspace):
        payload = self._call("write_mag_one_instructions", {"instructions": "hi"})
        assert payload["ok"] is True and payload["status"] == "handoff_written"
        assert os.path.isfile(os.path.join(workspace, payload["handoffPath"].replace("/", os.sep)))

    def test_read_tool_routes_to_shared_impl(self, workspace):
        self._call("write_mag_one_instructions", {"instructions": "hi"})
        payload = self._call("read_model_results", {})
        assert payload["status"] == "return_runs_listed"

    def test_host_rejects_smuggled_keys(self, workspace):
        payload = self._call("write_mag_one_instructions", {"instructions": "hi", "evil": 1})
        assert payload["ok"] is False and "tool_arguments_rejected" in payload["error"]
