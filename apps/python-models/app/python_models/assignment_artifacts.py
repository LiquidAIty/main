"""Assignment-scoped artifact storage.

Files are deliberate outputs only. AgentGraph owns their assignment/run/result
identity; this module only contains writes beneath one server-owned directory
and returns exact locator/hash metadata for immediate database registration.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
from typing import Any


_SAFE_SEGMENT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$")


@dataclass(frozen=True)
class AssignmentArtifactScope:
    workspace_root: Path
    assignment_id: str
    producer_card_id: str
    directory: Path


def resolve_workspace_root() -> str:
    repo_root = os.environ.get("LIQUIDAITY_GRPC_CWD") or "C:/Projects/main"
    workspace = Path(repo_root).resolve() / "coder-workspace"
    workspace.mkdir(parents=True, exist_ok=True)
    return str(workspace)


def _required_segment(value: Any, field: str) -> str:
    text = str(value or "").strip()
    if not _SAFE_SEGMENT.fullmatch(text):
        raise ValueError(f"assignment_artifact_{field}_invalid")
    return text


def resolve_scope(
    workspace_root: str,
    assignment_id: str,
    producer_card_id: str,
) -> AssignmentArtifactScope:
    root = Path(str(workspace_root or "")).resolve()
    if not root.is_dir():
        raise ValueError("assignment_artifact_workspace_invalid")
    assignment = str(assignment_id or "").strip()
    if not assignment:
        raise ValueError("assignment_artifact_assignment_id_invalid")
    producer = _required_segment(producer_card_id, "producer_card_id")
    assignment_segment = sha256(assignment.encode("utf-8")).hexdigest()[:24]
    directory = (root / "artifacts" / assignment_segment / producer).resolve()
    if root not in directory.parents:
        raise ValueError("assignment_artifact_scope_escape")
    directory.mkdir(parents=True, exist_ok=True)
    return AssignmentArtifactScope(root, assignment, producer, directory)


def _target(scope: AssignmentArtifactScope, relative_path: str) -> Path:
    supplied = str(relative_path or "").strip().replace("\\", "/")
    if not supplied or supplied.startswith("/") or ":" in supplied:
        raise ValueError("assignment_artifact_path_invalid")
    parts = supplied.split("/")
    if any(not part or part in {".", ".."} for part in parts):
        raise ValueError("assignment_artifact_path_invalid")
    target = scope.directory.joinpath(*parts).resolve()
    if scope.directory != target and scope.directory not in target.parents:
        raise ValueError("assignment_artifact_path_escape")
    return target


def write_artifact(
    scope: AssignmentArtifactScope,
    relative_path: str,
    content: str,
) -> dict[str, Any]:
    target = _target(scope, relative_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    raw = (content if isinstance(content, str) else str(content)).encode("utf-8")
    target.write_bytes(raw)
    locator = target.relative_to(scope.workspace_root).as_posix()
    digest = sha256(raw).hexdigest()
    return {
        "artifactId": f"artifact:{digest[:24]}",
        "artifactType": "file",
        "locator": locator,
        "producerCardId": scope.producer_card_id,
        "sha256": digest,
        "byteCount": len(raw),
    }


def read_artifact(scope: AssignmentArtifactScope, locator: str) -> bytes:
    target = (scope.workspace_root / str(locator or "")).resolve()
    if scope.directory != target and scope.directory not in target.parents:
        raise ValueError("assignment_artifact_locator_escape")
    return target.read_bytes()
