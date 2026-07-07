"""Proof that the MCP host's sys.path bootstrap fixes 'No module named app'.

The gRPC harness launches the host as a SCRIPT
(``python .../apps/python-models/app/mcp_host.py``), so sys.path[0] is the ``app/``
dir and the package root (apps/python-models) is NOT importable — which broke every
``from app...`` control handler (e.g. thinkgraph.get_graph_slice) at call time.

These tests reproduce that exact launch condition in a subprocess (cwd = the app/ dir,
package root absent from sys.path) and assert the app package + control handlers import
after ``import mcp_host`` runs the shared bootstrap. The fix lives in ONE place
(mcp_host.py top), not scattered across tools.
"""
import os
import subprocess
import sys

_APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # .../app


def _run_in_script_launch_context(code: str) -> subprocess.CompletedProcess:
    # cwd = app/ reproduces the script launch: the package root (its parent) is not on
    # sys.path, so a bare `import app` fails unless mcp_host's bootstrap repairs it.
    return subprocess.run(
        [sys.executable, "-c", code],
        cwd=_APP_DIR,
        capture_output=True,
        text=True,
    )


def test_app_not_importable_without_the_bootstrap():
    # Guard: prove the failure condition is real in this launch context (no bootstrap).
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
    # The app-package repair is a single insert of the package root at the host
    # entry — never duplicated into the graph/coder tool modules. (tool_registry's
    # own sys.path.insert is the unrelated KnowGraph-rails loader, not this fix.)
    host = open(os.path.join(_APP_DIR, "mcp_host.py"), encoding="utf-8").read()
    assert host.count("sys.path.insert") == 1
    for name in ("coder_job_tools.py", "job_folder.py"):
        text = open(os.path.join(_APP_DIR, "python_models", name), encoding="utf-8").read()
        assert "sys.path.insert" not in text, f"{name} must not carry the app bootstrap"
