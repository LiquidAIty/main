"""Focused coverage for the Coder job-folder handoff resolver + return writer.

Proves: exact prompt.md packet bytes are read; the run-scoped return writer creates
real files only under returns/<job-id>/; absolute paths, traversal, and source-tree
writes are rejected; written paths are collected; an empty return folder is honest
(no fabricated result.md); and the writer tool has no ambient authority.
"""
import asyncio
import json
import os

import pytest

from app.python_models import job_folder as jf
from app.python_models import tool_registry as tr


def _workspace(tmp_path) -> str:
    # A realistic workspace: a source tree file plus the handoff packet the Coder wrote.
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "secret.py").write_text("SOURCE = 1\n", encoding="utf-8")
    handoff = tmp_path / "handoff" / "job_abc"
    handoff.mkdir(parents=True)
    (handoff / "prompt.md").write_bytes("# Task\nDo the work.\n\n- exact bytes ✓\n".encode("utf-8"))
    return str(tmp_path)


# --------------------------------------------------------------------------- #
# resolver: workspace-relative paths, strictly inside the workspace
# --------------------------------------------------------------------------- #
class TestResolveJobFolder:
    def test_resolves_both_paths_inside_workspace(self, tmp_path):
        root = _workspace(tmp_path)
        folder = jf.resolve_job_folder(root, "job_abc")
        assert folder.handoff_rel == "handoff/job_abc/prompt.md"
        assert folder.returns_rel == "returns/job_abc"
        assert folder.handoff_prompt_path.endswith(os.path.join("handoff", "job_abc", "prompt.md"))
        assert jf._within(os.path.realpath(root), folder.returns_dir)

    @pytest.mark.parametrize("bad", ["../evil", "a/b", "/abs", "..", ".", "", "  ", "job\\x"])
    def test_rejects_unsafe_job_ids(self, tmp_path, bad):
        with pytest.raises(ValueError):
            jf.resolve_job_folder(str(tmp_path), bad)

    def test_rejects_missing_workspace(self, tmp_path):
        with pytest.raises(ValueError):
            jf.resolve_job_folder(str(tmp_path / "nope"), "job_abc")


# --------------------------------------------------------------------------- #
# exact prompt.md packet bytes
# --------------------------------------------------------------------------- #
class TestExactPromptBytes:
    def test_reads_prompt_md_verbatim(self, tmp_path):
        folder = jf.resolve_job_folder(_workspace(tmp_path), "job_abc")
        assert jf.read_handoff_prompt(folder) == "# Task\nDo the work.\n\n- exact bytes ✓\n"

    def test_missing_prompt_is_honest(self, tmp_path):
        (tmp_path / "returns").mkdir()
        folder = jf.resolve_job_folder(str(tmp_path), "no_prompt")
        with pytest.raises(FileNotFoundError):
            jf.read_handoff_prompt(folder)

    def test_prompt_md_can_be_variable_context_packet(self, tmp_path):
        (tmp_path / "src").mkdir()
        folder = jf.resolve_job_folder(str(tmp_path), "job_packet")
        packet = """---
jobId: job_packet
projectId: project-123
createdBy: harness_packet_builder
packetKind: magnetic_one_context
cbm:
  project: C-Projects-main
  status: ready
  changedCount: 0
contextPointers:
  - id: tg-plan-focus
    graph: thinkgraph
    mode: read
    purpose: selected planning context
    scope:
      projectId: project-123
      featureIds:
        - feature.coder-to-mag-one-handoff
      nodeIds:
        - think:node-1
      topics:
        - handoff packet
      files:
        - apps/python-models/app/python_models/job_folder.py
      symbols:
        - resolve_job_folder
      relationTypes:
        - related_to
      maxDepth: 1
      maxNodes: 8
      maxTokens: 1200
anchors:
  wiki:
    - wiki/coder-to-mag-one-handoff.md
  skills:
    - skills/cbm-graph-reader-skill.md
  files:
    - apps/python-models/app/python_models/job_folder.py
  symbols:
    - read_handoff_prompt
---

# Current ask

Prove the packet boundary.

# Selected context

Scoped graph pointers and CBM anchors are run-specific context handles only.
"""
        jf.write_handoff_prompt(folder, packet)
        assert jf.read_handoff_prompt(folder) == packet


# --------------------------------------------------------------------------- #
# return writer: returns/<job-id>/ only, with real deliverables
# --------------------------------------------------------------------------- #
CARD = "agent_a"


class TestReturnWriter:
    def test_writes_into_the_agents_own_card_subdir(self, tmp_path):
        folder = jf.resolve_job_folder(_workspace(tmp_path), "job_abc")
        jf.ensure_returns_dir(folder)
        written = jf.write_return_file(folder, CARD, "proposed/example.patch", "--- a\n+++ b\n")
        assert written == "returns/job_abc/agent_a/proposed/example.patch"
        on_disk = os.path.join(folder.returns_dir, CARD, "proposed", "example.patch")
        assert os.path.isfile(on_disk)
        assert open(on_disk, encoding="utf-8").read() == "--- a\n+++ b\n"
        assert jf.list_return_files(folder) == ["returns/job_abc/agent_a/proposed/example.patch"]

    def test_nonempty_return_files_excludes_zero_byte_writes(self, tmp_path):
        # PL-1: an empty file is a failed write, not a durable deliverable.
        folder = jf.resolve_job_folder(_workspace(tmp_path), "job_abc")
        jf.ensure_returns_dir(folder)
        jf.write_return_file(folder, CARD, "real.md", "actual content")
        jf.write_return_file(folder, CARD, "empty.md", "")
        # list_return_files sees both; nonempty_return_files keeps only the real one.
        assert len(jf.list_return_files(folder)) == 2
        nonempty = jf.nonempty_return_files(folder)
        assert nonempty == ["returns/job_abc/agent_a/real.md"]

    def test_nonempty_return_files_empty_when_all_writes_are_empty(self, tmp_path):
        folder = jf.resolve_job_folder(_workspace(tmp_path), "job_abc")
        jf.ensure_returns_dir(folder)
        jf.write_return_file(folder, CARD, "a.md", "")
        jf.write_return_file(folder, CARD, "b.md", "")
        assert jf.list_return_files(folder)  # files exist
        assert jf.nonempty_return_files(folder) == []  # but none are durable

    def test_agent_cannot_write_into_another_agents_folder(self, tmp_path):
        folder = jf.resolve_job_folder(_workspace(tmp_path), "job_abc")
        jf.ensure_returns_dir(folder)
        with pytest.raises(ValueError):
            jf.write_return_file(folder, CARD, "../agent_b/x.md", "no")

    def test_rejects_an_unsafe_card_id(self, tmp_path):
        folder = jf.resolve_job_folder(_workspace(tmp_path), "job_abc")
        for bad_card in ["../evil", "a/b", "", ".."]:
            with pytest.raises(ValueError):
                jf.write_return_file(folder, bad_card, "x.md", "no")

    @pytest.mark.parametrize(
        "bad",
        ["/etc/passwd", "C:\\Windows\\x", "../../src/secret.py", "../secret.py", "..\\x", "", "   "],
    )
    def test_rejects_escapes_and_absolute(self, tmp_path, bad):
        folder = jf.resolve_job_folder(_workspace(tmp_path), "job_abc")
        jf.ensure_returns_dir(folder)
        with pytest.raises(ValueError):
            jf.write_return_file(folder, CARD, bad, "x")

    def test_source_tree_is_never_touched(self, tmp_path):
        folder = jf.resolve_job_folder(_workspace(tmp_path), "job_abc")
        jf.ensure_returns_dir(folder)
        with pytest.raises(ValueError):
            jf.write_return_file(folder, CARD, "../../../src/secret.py", "HACKED")
        assert open(os.path.join(folder.workspace_root, "src", "secret.py"), encoding="utf-8").read() == "SOURCE = 1\n"

    @pytest.mark.skipif(not hasattr(os, "symlink"), reason="no symlink support")
    def test_rejects_symlink_escape(self, tmp_path):
        folder = jf.resolve_job_folder(_workspace(tmp_path), "job_abc")
        card_dir = os.path.join(folder.returns_dir, CARD)
        os.makedirs(card_dir)
        outside = tmp_path / "outside"
        outside.mkdir()
        try:
            os.symlink(str(outside), os.path.join(card_dir, "link"))
        except (OSError, NotImplementedError):
            pytest.skip("symlink not permitted in this environment")
        with pytest.raises(ValueError):
            jf.write_return_file(folder, CARD, "link/escape.txt", "x")


# --------------------------------------------------------------------------- #
# honest empty: no files -> no fabricated result.md
# --------------------------------------------------------------------------- #
class TestHonestEmpty:
    def test_empty_return_folder_has_no_files_and_no_result_md(self, tmp_path):
        folder = jf.resolve_job_folder(_workspace(tmp_path), "job_abc")
        jf.ensure_returns_dir(folder)
        assert jf.list_return_files(folder) == []
        assert not os.path.exists(os.path.join(folder.returns_dir, "result.md"))


# --------------------------------------------------------------------------- #
# run-scoped tool: no ambient authority; resolves against the armed folder only
# --------------------------------------------------------------------------- #
class TestRunScopedTool:
    def test_tool_fails_without_run_authority(self):
        # No JOB_RETURN_ROOT set -> honest authority-missing, never a stray write.
        out = json.loads(asyncio.run(tr.write_return_file_tool(CARD, "proposed/x.txt", "x")))
        assert out["ok"] is False and "job_return_authority_missing" in out["error"]

    def test_tool_writes_only_into_its_own_card_subdir(self, tmp_path):
        folder = jf.resolve_job_folder(_workspace(tmp_path), "job_abc")
        jf.ensure_returns_dir(folder)
        token = tr.JOB_RETURN_ROOT.set(folder)
        try:
            ok = json.loads(asyncio.run(tr.write_return_file_tool(CARD, "reports/r.md", "hi")))
            escaped = json.loads(asyncio.run(tr.write_return_file_tool(CARD, "../../src/secret.py", "no")))
            other = json.loads(asyncio.run(tr.write_return_file_tool(CARD, "../agent_b/x.md", "no")))
        finally:
            tr.JOB_RETURN_ROOT.reset(token)
        assert ok["ok"] is True and ok["path"] == "returns/job_abc/agent_a/reports/r.md"
        assert escaped["ok"] is False and "return_path_escapes_returns" in escaped["error"]
        assert other["ok"] is False  # cannot reach another agent's folder


# --------------------------------------------------------------------------- #
# handoff writing + run/artifact discovery
# --------------------------------------------------------------------------- #
class TestHandoffAndDiscovery:
    def test_new_run_id_is_a_safe_segment(self):
        rid = jf.new_run_id()
        assert jf._valid_job_id(rid)
        assert jf.new_run_id() != rid  # opaque + unique

    def test_write_handoff_prompt_is_byte_exact(self, tmp_path):
        (tmp_path / "x").mkdir()  # make it a real workspace dir
        folder = jf.resolve_job_folder(str(tmp_path), "job_new")
        jf.write_handoff_prompt(folder, "# exact\r\nkeep bytes\tçafé\n")
        assert jf.read_handoff_prompt(folder) == "# exact\r\nkeep bytes\tçafé\n"

    def test_list_return_runs_summarizes_each_run(self, tmp_path):
        root = _workspace(tmp_path)
        a = jf.resolve_job_folder(root, "run_a")
        b = jf.resolve_job_folder(root, "run_b")
        jf.write_return_file(a, CARD, "r.md", "hi")
        jf.write_return_file(a, CARD, "sub/p.patch", "x")
        jf.ensure_returns_dir(b)  # empty run
        runs = {r["runId"]: r for r in jf.list_return_runs(root)}
        assert runs["run_a"]["fileCount"] == 2
        assert runs["run_a"]["returnsPath"] == "returns/run_a"
        assert "returns/run_a/agent_a/sub/p.patch" in runs["run_a"]["files"]
        assert runs["run_b"]["fileCount"] == 0

    def test_list_return_runs_empty_when_no_returns_root(self, tmp_path):
        (tmp_path / "src").mkdir()
        assert jf.list_return_runs(str(tmp_path)) == []

    def test_read_text_artifact_returns_contents(self, tmp_path):
        folder = jf.resolve_job_folder(_workspace(tmp_path), "job_abc")
        jf.write_return_file(folder, CARD, "report.md", "# Findings\nall good\n")
        art = jf.read_return_artifact(folder, "agent_a/report.md")
        assert art["kind"] == "text"
        assert art["content"] == "# Findings\nall good\n"
        assert art["path"] == "returns/job_abc/agent_a/report.md"
        assert art["bytes"] > 0

    def test_read_binary_artifact_is_a_reference_not_corrupted_text(self, tmp_path):
        folder = jf.resolve_job_folder(_workspace(tmp_path), "job_abc")
        card_dir = os.path.join(folder.returns_dir, CARD)
        os.makedirs(card_dir)
        png = os.path.join(card_dir, "img.png")
        with open(png, "wb") as fh:
            fh.write(b"\x89PNG\r\n\x00\x01\x02\x03binary\x00data")
        art = jf.read_return_artifact(folder, "agent_a/img.png")
        assert art["kind"] == "binary"
        assert "content" not in art  # never base64-dumped / never faked into text
        assert art["path"] == "returns/job_abc/agent_a/img.png"
        assert art["mime"] == "image/png"

    def test_read_artifact_rejects_escape_and_missing(self, tmp_path):
        folder = jf.resolve_job_folder(_workspace(tmp_path), "job_abc")
        jf.ensure_returns_dir(folder)
        with pytest.raises(ValueError):
            jf.read_return_artifact(folder, "../../src/secret.py")
        with pytest.raises(FileNotFoundError):
            jf.read_return_artifact(folder, "nope.txt")
