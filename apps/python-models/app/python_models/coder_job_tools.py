"""The ONE shared implementation behind the two explicit Local Coder capabilities.

  * write_mag_one_instructions — write Mag One's task into handoff/<run-id>/prompt.md
                                 (exact bytes) and assign returns/<run-id>/.
  * read_model_results         — discover/read model-produced artifacts under
                                 returns/<run-id>/ (list runs, list files, read text,
                                 reference binaries), all inside the trusted workspace.

Both Coder surfaces reach these through the SAME functions here: the chat-Coder via
the mcp_host.py MCP tools (server-lifetime Python MCP), the card-Coder via the same
host injected into its MCP config. There is exactly one implementation, not two.

The workspace root is SERVER-RESOLVED (LIQUIDAITY_GRPC_CWD, the trusted Coder root) —
never an arbitrary client filesystem path. Path validation, exact reads/writes, and
escape rejection all live in job_folder.py.
"""

from __future__ import annotations

import os

from app.python_models import job_folder as jf


def resolve_workspace_root() -> str:
    """The trusted active Coder workspace root, from server state only.

    The trusted repo root is LIQUIDAITY_GRPC_CWD (default the canonical repo root);
    the DEFAULT owned Coder workspace is <repo-root>/coder-workspace — where the
    Coder keeps its handoff prompts, returned artifacts, and its own future
    repos/apps — created if absent. The model/caller can never choose it.
    """
    repo_root = os.environ.get("LIQUIDAITY_GRPC_CWD") or "C:/Projects/main"
    workspace = os.path.join(repo_root, "coder-workspace")
    os.makedirs(workspace, exist_ok=True)
    return workspace


def write_mag_one_instructions(args: dict) -> dict:
    """TOOL 1: write exact Mag One instructions into handoff/<run-id>/prompt.md.

    Inputs: instructions (required, exact text); optional runId to reuse an existing
    handoff. Creates handoff/<run-id>/ and returns/<run-id>/ inside the trusted
    workspace and returns the run id + workspace-relative paths.
    """
    instructions = args.get("instructions")
    if not isinstance(instructions, str) or not instructions.strip():
        return {"ok": False, "status": "invalid_instructions", "error": "instructions_required"}
    run_id = str(args.get("runId") or args.get("jobId") or "").strip() or jf.new_run_id()
    try:
        folder = jf.resolve_job_folder(resolve_workspace_root(), run_id)
        jf.write_handoff_prompt(folder, instructions)
        jf.ensure_returns_dir(folder)
    except (ValueError, OSError) as err:
        return {"ok": False, "status": "invalid_result_path", "error": str(err)}
    return {
        "ok": True,
        "status": "handoff_written",
        "runId": folder.job_id,
        "handoffPath": folder.handoff_rel,
        "returnsPath": f"{folder.returns_rel}/",
    }


def read_model_results(args: dict) -> dict:
    """TOOL 2: discover/read model-produced artifacts under returns/<run-id>/.

    - no runId               -> list return runs (or no_return_runs_found)
    - runId, no path         -> list that run's artifacts (or no_return_files_created)
    - runId + path           -> read one artifact (text inline / binary reference),
                                or artifact_not_found / invalid_result_path
    Never reads outside the trusted workspace; never invents a global artifact store.
    """
    workspace_root = resolve_workspace_root()
    run_id = str(args.get("runId") or "").strip()
    path = str(args.get("path") or "").strip()

    if not run_id:
        runs = jf.list_return_runs(workspace_root)
        return {
            "ok": True,
            "status": "return_runs_listed" if runs else "no_return_runs_found",
            "runs": runs,
        }

    try:
        folder = jf.resolve_job_folder(workspace_root, run_id)
    except (ValueError, OSError) as err:
        return {"ok": False, "status": "invalid_result_path", "error": str(err)}

    if not path:
        files = jf.list_return_files(folder)
        return {
            "ok": True,
            "status": "return_files_listed" if files else "no_return_files_created",
            "runId": folder.job_id,
            "returnsPath": f"{folder.returns_rel}/",
            "files": files,
        }

    try:
        artifact = jf.read_return_artifact(folder, path)
    except FileNotFoundError as err:
        return {"ok": False, "status": "artifact_not_found", "error": str(err)}
    except (ValueError, OSError) as err:
        return {"ok": False, "status": "invalid_result_path", "error": str(err)}
    return {"ok": True, "status": "artifact_read", "runId": folder.job_id, "artifact": artifact}
