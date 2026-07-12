"""Coder ↔ Mag One job-folder handoff resolver.

The job FOLDER is the handoff contract. The packet-builder writes one run-specific
Magnetic One variable context packet into ``handoff/<job-id>/prompt.md``; one
existing Mag One run is then given the EXACT bytes of that file as its task and an
assigned ``returns/<job-id>/`` directory as its return surface.

This module provides the canonical handoff resolver plus a separate returns-only
resolver for post-run review. Hermes can use the latter without acquiring the
handoff task-entrypoint path.
It never trusts a caller path: the workspace root is the server-forced trusted
root (resolved in TS and carried in), and the job id must be one opaque path
segment (no separators, no traversal, no absolute). Resolution is structurally
contained inside the workspace so a handoff run can never read or write outside it.
"""

from __future__ import annotations

import mimetypes
import os
import re
import secrets
import time
from dataclasses import dataclass

# Text artifacts up to this size are returned inline; larger ones (and any binary)
# come back as workspace-relative references + metadata, never dumped into context.
_MAX_INLINE_TEXT_BYTES = 256 * 1024

# One opaque path segment: alnum start, then alnum/._- . No separators, no "..".
_JOB_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


@dataclass(frozen=True)
class JobFolder:
    workspace_root: str        # absolute, normalized trusted root
    job_id: str
    handoff_prompt_path: str   # absolute: <root>/handoff/<job-id>/prompt.md
    returns_dir: str           # absolute: <root>/returns/<job-id>
    handoff_rel: str           # "handoff/<job-id>/prompt.md"
    returns_rel: str           # "returns/<job-id>"


@dataclass(frozen=True)
class ReturnsFolder:
    """Post-run-only view with no handoff/prompt path."""

    workspace_root: str
    job_id: str
    returns_dir: str
    returns_rel: str           # "returns/<job-id>"


def _valid_job_id(job_id: str) -> bool:
    jid = str(job_id or "").strip()
    if not jid or jid in (".", ".."):
        return False
    if "/" in jid or "\\" in jid:
        return False
    if os.sep in jid or (os.altsep and os.altsep in jid):
        return False
    return bool(_JOB_ID_RE.match(jid))


def _within(root: str, target: str) -> bool:
    root_n = os.path.normcase(os.path.normpath(root))
    target_n = os.path.normcase(os.path.normpath(target))
    return target_n == root_n or target_n.startswith(root_n + os.sep)


def resolve_job_folder(workspace_root: str, job_id: str) -> JobFolder:
    """Resolve the handoff prompt path + returns dir for a job, strictly inside root.

    Rejects a missing/non-directory workspace root and any job id that is not a
    single safe path segment (absolute, traversal, or separators all fail). The
    resolved paths are asserted to stay within the workspace as defense in depth.
    """
    root = os.path.realpath(str(workspace_root or "").strip())
    if not root or not os.path.isdir(root):
        raise ValueError(f"job_folder_workspace_invalid: {workspace_root!r}")
    if not _valid_job_id(job_id):
        raise ValueError(f"job_folder_job_id_invalid: {job_id!r}")
    jid = job_id.strip()

    handoff_dir = os.path.join(root, "handoff", jid)
    returns_dir = os.path.join(root, "returns", jid)
    prompt_path = os.path.join(handoff_dir, "prompt.md")

    for target in (handoff_dir, returns_dir, prompt_path):
        if not _within(root, target):
            raise ValueError(f"job_folder_escapes_workspace: {target!r}")

    return JobFolder(
        workspace_root=root,
        job_id=jid,
        handoff_prompt_path=prompt_path,
        returns_dir=returns_dir,
        handoff_rel=f"handoff/{jid}/prompt.md",
        returns_rel=f"returns/{jid}",
    )


def resolve_returns_folder(workspace_root: str, job_id: str) -> ReturnsFolder:
    """Resolve only returns/<job-id> for post-run review."""
    root = os.path.realpath(str(workspace_root or "").strip())
    if not root or not os.path.isdir(root):
        raise ValueError(f"returns_workspace_invalid: {workspace_root!r}")
    if not _valid_job_id(job_id):
        raise ValueError(f"returns_job_id_invalid: {job_id!r}")
    jid = job_id.strip()
    returns_dir = os.path.join(root, "returns", jid)
    if not _within(root, returns_dir):
        raise ValueError(f"returns_escapes_workspace: {returns_dir!r}")
    return ReturnsFolder(
        workspace_root=root,
        job_id=jid,
        returns_dir=returns_dir,
        returns_rel=f"returns/{jid}",
    )


def new_run_id() -> str:
    """Mint one opaque, path-safe run id for a fresh Coder→Mag One handoff."""
    return f"run_{int(time.time() * 1000)}_{secrets.token_hex(3)}"


def write_handoff_prompt(folder: JobFolder, instructions: str) -> None:
    """Write exact packet bytes to handoff/<run-id>/prompt.md.

    ``prompt.md`` is the Magnetic One variable context packet for this run. It may
    contain job/project ids, selected summaries, scoped graph context pointers, CBM
    anchors, and dirty-overlay facts. Durable constants such as system prompts,
    role definitions, output contracts, model/provider, permanent tools, graph
    write policy, denied-tool lists, and fallback behavior belong to saved agent
    cards/repo law/runtime validation, not this packet.

    No system prompt, wrapper, summary, or rewrite is added here — the bytes are the
    Mag One task. Creates the handoff dir if needed.
    """
    os.makedirs(os.path.dirname(folder.handoff_prompt_path), exist_ok=True)
    text = instructions if isinstance(instructions, str) else str(instructions)
    # Publish the final command with one atomic rename. A watcher or explicit
    # runner can never observe a partially written prompt.md; supporting files
    # may arrive earlier, but the completed rename is the only ready edge.
    temp_path = f"{folder.handoff_prompt_path}.{secrets.token_hex(6)}.tmp"
    try:
        with open(temp_path, "w", encoding="utf-8", newline="") as fh:
            fh.write(text)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(temp_path, folder.handoff_prompt_path)
    finally:
        if os.path.exists(temp_path):
            os.unlink(temp_path)


def read_handoff_prompt(folder: JobFolder) -> str:
    """Return the EXACT bytes of the handoff prompt.md packet (utf-8, no rewrite).

    Read in binary and decoded so newlines are preserved verbatim — the run's task
    is the packet file content, never a summary, wrapper, or transformed prompt.
    """
    if not os.path.isfile(folder.handoff_prompt_path):
        raise FileNotFoundError(f"handoff_prompt_missing: {folder.handoff_rel}")
    with open(folder.handoff_prompt_path, "rb") as fh:
        return fh.read().decode("utf-8")


def ensure_returns_dir(folder: JobFolder) -> None:
    """Create the assigned returns/<job-id>/ directory (idempotent)."""
    os.makedirs(folder.returns_dir, exist_ok=True)


def list_return_files(folder: JobFolder | ReturnsFolder) -> list[str]:
    """Workspace-relative paths of files actually present in returns/<job-id>/.

    No files is a valid outcome (empty list) — callers report that honestly and
    never fabricate a result file.
    """
    if not os.path.isdir(folder.returns_dir):
        return []
    out: list[str] = []
    for dirpath, _dirs, files in os.walk(folder.returns_dir):
        for name in files:
            abs_p = os.path.join(dirpath, name)
            rel = os.path.relpath(abs_p, folder.workspace_root).replace(os.sep, "/")
            out.append(rel)
    return sorted(out)


def _safe_return_target(returns_dir: str, rel_path: str) -> str:
    """Resolve rel_path to an absolute path strictly inside returns_dir.

    Rejects empty paths, absolute paths (posix, Windows drive, UNC), leading
    separators, ``..`` traversal, and symlink escapes (the realpath of the deepest
    existing ancestor must stay inside the returns root). Raises ValueError on any
    violation so nothing can be written outside the assigned return surface.
    """
    rel = str(rel_path or "").strip()
    if not rel:
        raise ValueError("return_path_empty")
    if os.path.isabs(rel) or rel.startswith(("/", "\\")) or (len(rel) >= 2 and rel[1] == ":"):
        raise ValueError(f"return_path_absolute_rejected: {rel_path!r}")

    returns_real = os.path.realpath(returns_dir)
    target = os.path.normpath(os.path.join(returns_real, rel))
    if not _within(returns_real, target):
        raise ValueError(f"return_path_escapes_returns: {rel_path!r}")

    # Symlink escape: walk up from the target to the deepest already-existing path,
    # but never above the returns root (paths that don't exist yet get created as
    # real dirs). If an existing path inside the returns tree resolves — via a
    # symlink — outside the returns root, reject it.
    ancestor = target
    while (
        ancestor != returns_real
        and not os.path.lexists(ancestor)
        and _within(returns_real, ancestor)
    ):
        parent = os.path.dirname(ancestor)
        if parent == ancestor:
            break
        ancestor = parent
    if os.path.lexists(ancestor) and not _within(returns_real, os.path.realpath(ancestor)):
        raise ValueError(f"return_path_symlink_escape: {rel_path!r}")
    return target


def _card_return_dir(folder: JobFolder, card_id: str) -> str:
    """The per-agent return subdir returns/<run-id>/<card-id>/ — the ONLY place a
    given participant may write. card_id must be one safe path segment so an agent
    can never be pointed at another agent's folder or out of the returns tree.
    """
    cid = str(card_id or "").strip()
    if not _valid_job_id(cid):
        raise ValueError(f"return_card_id_invalid: {card_id!r}")
    return os.path.join(folder.returns_dir, cid)


def write_return_file(folder: JobFolder, card_id: str, rel_path: str, content: str) -> str:
    """Create ONE real deliverable file under returns/<run-id>/<card-id>/ (creating
    needed subdirs) and return its workspace-relative path.

    The only writable surface is THIS agent's card subdir: card_id is a fixed trusted
    segment and rel_path is contained beneath it, so absolute paths, traversal,
    symlink escapes, and writes into another agent's folder or the source tree are all
    rejected by ``_safe_return_target``.
    """
    card_dir = _card_return_dir(folder, card_id)
    # The tool contract asks for a path relative to the assigned card folder,
    # but models sometimes repeat the already-known workspace-relative return
    # prefix from the job prompt. Canonicalize only that exact current
    # job/card prefix; reject any other returns/ prefix rather than creating a
    # misleading nested returns tree.
    supplied = str(rel_path or "").strip().replace("\\", "/")
    expected_prefix = f"returns/{folder.job_id}/{str(card_id).strip()}/"
    if supplied.startswith("returns/"):
        if not supplied.startswith(expected_prefix):
            raise ValueError(f"return_path_wrong_job_or_card: {rel_path!r}")
        supplied = supplied[len(expected_prefix):]
    target = _safe_return_target(card_dir, supplied)
    os.makedirs(os.path.dirname(target), exist_ok=True)
    text = content if isinstance(content, str) else str(content)
    with open(target, "w", encoding="utf-8", newline="") as fh:
        fh.write(text)
    return os.path.relpath(target, folder.workspace_root).replace(os.sep, "/")


def _file_metadata(abs_path: str, workspace_root: str) -> dict:
    st = os.stat(abs_path)
    mime, _ = mimetypes.guess_type(abs_path)
    return {
        "name": os.path.basename(abs_path),
        "path": os.path.relpath(abs_path, workspace_root).replace(os.sep, "/"),
        "bytes": st.st_size,
        "mime": mime,
        "modifiedAt": int(st.st_mtime * 1000),
    }


def list_return_runs(workspace_root: str) -> list[dict]:
    """Discover the return runs present in <workspace>/returns/ with file summaries.

    Each entry: runId, workspace-relative returns path, fileCount, and the
    workspace-relative file paths. No files / no runs are honest empty states.
    """
    root = os.path.realpath(str(workspace_root or "").strip())
    returns_root = os.path.join(root, "returns")
    if not os.path.isdir(returns_root):
        return []
    runs: list[dict] = []
    for entry in sorted(os.listdir(returns_root)):
        run_dir = os.path.join(returns_root, entry)
        if not os.path.isdir(run_dir) or not _valid_job_id(entry):
            continue
        files = [
            os.path.join(dp, name)
            for dp, _d, fs in os.walk(run_dir)
            for name in fs
        ]
        runs.append(
            {
                "runId": entry,
                "returnsPath": f"returns/{entry}",
                "fileCount": len(files),
                "files": sorted(
                    os.path.relpath(f, root).replace(os.sep, "/") for f in files
                ),
            }
        )
    return runs


def read_return_artifact(folder: JobFolder | ReturnsFolder, rel_path: str) -> dict:
    """Read ONE artifact beneath returns/<run-id>/.

    Text (utf-8-decodable, within the inline cap) returns its actual contents.
    Binary or oversized artifacts return a workspace-relative reference + metadata
    (never base64-dumped, never corrupted, never faked into text). Path escapes are
    rejected by ``_safe_return_target``; a missing file raises FileNotFoundError.
    """
    target = _safe_return_target(folder.returns_dir, rel_path)
    if not os.path.isfile(target):
        raise FileNotFoundError(f"artifact_not_found: {rel_path!r}")
    meta = _file_metadata(target, folder.workspace_root)
    with open(target, "rb") as fh:
        raw = fh.read()
    is_binary = b"\x00" in raw
    text: str | None = None
    if not is_binary and len(raw) <= _MAX_INLINE_TEXT_BYTES:
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            is_binary = True
    if text is not None:
        return {**meta, "kind": "text", "content": text}
    # Binary or oversized: reference only.
    return {**meta, "kind": "binary" if is_binary else "reference"}
