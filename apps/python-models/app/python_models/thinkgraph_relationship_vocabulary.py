"""Project-scoped ThinkGraph relationship vocabulary and promotion."""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any

from .engraphis import THINKGRAPH_INTAKE_LOCK, get_service, project_id
from .jev_edge_ontology import SHARED_JEV_RELATIONSHIPS


THINKGRAPH_CONTROL_OUTCOMES: tuple[str, ...] = ()
JEV_CHOICE_OPTION_MAXIMUM = 255
PROJECT_RELATIONSHIP_VOCABULARY_MAXIMUM = 252
PROJECT_RELATIONSHIP_VOCABULARY_VERSION = (
    "project.relationship-vocabulary.v1"
)
_PROJECT_RELATIONSHIP_VOCABULARY_SETTING = (
    "jev_relationship_vocabulary"
)
_RELATIONSHIP_LABEL_PATTERN = re.compile(
    r"^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+){0,2}$"
)


class ThinkGraphIntakeError(RuntimeError):
    """The completed-pair intake could not start or persist its source memory."""


def normalize_relationship_label(value: Any) -> str:
    """Normalize one bounded predicate label without interpreting its meaning."""
    normalized = re.sub(r"[\s-]+", "_", str(value or "").strip()).upper()
    normalized = re.sub(r"_+", "_", normalized).strip("_")
    if not _RELATIONSHIP_LABEL_PATTERN.fullmatch(normalized):
        return ""
    return normalized


def relationship_vocabulary_hash(labels: tuple[str, ...] | list[str]) -> str:
    return hashlib.sha256(
        json.dumps(tuple(labels), separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def _workspace_settings(store: Any, workspace_id: str) -> dict[str, Any]:
    row = store.conn.execute(
        "SELECT settings FROM workspaces WHERE id=?", (workspace_id,),
    ).fetchone()
    if row is None:
        raise ThinkGraphIntakeError("thinkgraph_workspace_unavailable")
    try:
        value = json.loads(str(row["settings"] or "{}"))
    except (TypeError, ValueError, json.JSONDecodeError) as error:
        raise ThinkGraphIntakeError(
            "thinkgraph_workspace_settings_invalid"
        ) from error
    if not isinstance(value, dict):
        raise ThinkGraphIntakeError("thinkgraph_workspace_settings_invalid")
    return value


def project_relationship_vocabulary(
    store: Any,
    workspace_id: str,
) -> tuple[str, ...]:
    """Read the seed 20 plus this project's Jev-promoted predicates."""
    settings = _workspace_settings(store, workspace_id)
    configured = settings.get(_PROJECT_RELATIONSHIP_VOCABULARY_SETTING)
    if configured is None:
        raw_labels: list[Any] = []
    elif isinstance(configured, dict) and isinstance(configured.get("labels"), list):
        raw_labels = configured["labels"]
    else:
        raise ThinkGraphIntakeError(
            "thinkgraph_relationship_vocabulary_invalid"
        )
    labels = list(SHARED_JEV_RELATIONSHIPS)
    for raw in raw_labels:
        label = normalize_relationship_label(raw)
        if not label:
            raise ThinkGraphIntakeError(
                "thinkgraph_relationship_vocabulary_invalid"
            )
        if label not in labels:
            labels.append(label)
    # Legacy vocabularies remain readable even when an older build allowed
    # more labels than one current Choice can carry. Classification fails
    # explicitly at the provider boundary; durable graph data is never hidden
    # or deleted to make a request fit.
    return tuple(labels)


def _promote_project_relationship_label(
    store: Any,
    *,
    workspace_id: str,
    label: str,
) -> tuple[tuple[str, ...], bool]:
    """Append one Jev-winning predicate inside the caller's graph transaction."""
    normalized = normalize_relationship_label(label)
    if not normalized or normalized != label:
        raise ThinkGraphIntakeError(
            "thinkgraph_relationship_label_invalid"
        )
    current = project_relationship_vocabulary(store, workspace_id)
    if normalized in current:
        return current, False
    if len(current) >= PROJECT_RELATIONSHIP_VOCABULARY_MAXIMUM:
        raise ThinkGraphIntakeError(
            "thinkgraph_relationship_vocabulary_ceiling"
        )
    updated = (*current, normalized)
    settings = _workspace_settings(store, workspace_id)
    settings[_PROJECT_RELATIONSHIP_VOCABULARY_SETTING] = {
        "version": PROJECT_RELATIONSHIP_VOCABULARY_VERSION,
        "labels": list(updated),
    }
    store.conn.execute(
        "UPDATE workspaces SET settings=? WHERE id=?",
        (
            json.dumps(settings, ensure_ascii=False, separators=(",", ":")),
            workspace_id,
        ),
    )
    return updated, True


def relationship_choice_plan(
    relationship_proposal: str,
    vocabulary: tuple[str, ...],
    control_outcomes: tuple[str, ...] = THINKGRAPH_CONTROL_OUTCOMES,
) -> dict[str, Any]:
    """Offer the current vocabulary plus at most one structurally valid candidate."""
    normalized = normalize_relationship_label(relationship_proposal)
    at_maximum = len(vocabulary) >= PROJECT_RELATIONSHIP_VOCABULARY_MAXIMUM
    if normalized in vocabulary:
        status = "reused_canonical"
        candidate = ""
    elif not normalized:
        status = "invalid_novel_label"
        candidate = ""
    elif at_maximum:
        status = "novel_blocked_at_ceiling"
        candidate = ""
    else:
        status = "novel_candidate"
        candidate = normalized
    choices = (
        *vocabulary,
        *((candidate,) if candidate else ()),
        *control_outcomes,
    )
    if len(choices) > JEV_CHOICE_OPTION_MAXIMUM:
        raise ThinkGraphIntakeError(
            "thinkgraph_relationship_choice_capacity_exceeded"
        )
    return {
        "raw_proposal": str(relationship_proposal or ""),
        "normalized_proposal": normalized,
        "proposal_status": status,
        "novel_candidate": candidate,
        "vocabulary": vocabulary,
        "vocabulary_hash": relationship_vocabulary_hash(vocabulary),
        "vocabulary_at_maximum": at_maximum,
        "choices": choices,
    }


def relationship_vocabulary_state(labels: tuple[str, ...]) -> dict[str, Any]:
    return {
        "version": PROJECT_RELATIONSHIP_VOCABULARY_VERSION,
        "hash": relationship_vocabulary_hash(labels),
        "labels": list(labels),
        "count": len(labels),
        "maximum": PROJECT_RELATIONSHIP_VOCABULARY_MAXIMUM,
        "atMaximum": len(labels) >= PROJECT_RELATIONSHIP_VOCABULARY_MAXIMUM,
    }


def read_project_relationship_vocabulary(project: str) -> dict[str, Any]:
    """Read the one durable vocabulary shared by this project's graph twins."""
    service = get_service()
    with THINKGRAPH_INTAKE_LOCK:
        workspace_id = service.store.get_or_create_workspace(project_id(project))
        labels = project_relationship_vocabulary(service.store, workspace_id)
        return relationship_vocabulary_state(labels)


def promote_project_relationship_label(
    project: str,
    label: str,
) -> dict[str, Any]:
    """Promote one already-winning label through the shared Engraphis project seam."""
    service = get_service()
    with THINKGRAPH_INTAKE_LOCK:
        workspace_id = service.store.get_or_create_workspace(project_id(project))
        with service.store.write_transaction():
            labels, promoted = _promote_project_relationship_label(
                service.store,
                workspace_id=workspace_id,
                label=label,
            )
        return {
            **relationship_vocabulary_state(labels),
            "label": label,
            "promoted": promoted,
        }
