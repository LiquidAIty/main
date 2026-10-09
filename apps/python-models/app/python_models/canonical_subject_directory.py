"""Complete cross-authority subject headers for exact shared-name context."""

from __future__ import annotations

import hashlib
import math
import time
from typing import Any

from app.python_models.data_anchor_contract import (
    GRAPH_CONTEXT_BYTE_LIMIT,
    DataAnchorError,
    canonical_json,
)
from app.python_models.knowgraph_reference_reads import (
    read_knowgraph_subject_directory,
)
from app.python_models.graph_reference_contracts import graph_record_identity


def _subject_directory_source(
    id_field: str,
    value: Any,
) -> tuple[list[dict[str, str]], str]:
    if not isinstance(value, dict) or value.get("complete") is not True:
        raise DataAnchorError("subject_directory_authority_incomplete")
    raw_subjects = value.get("subjects")
    count = value.get("count")
    revision = str(value.get("revision") or "").strip()
    if (
        not isinstance(raw_subjects, list)
        or isinstance(count, bool)
        or not isinstance(count, int)
        or count < 0
        or count != len(raw_subjects)
        or not revision
    ):
        raise DataAnchorError("subject_directory_authority_invalid")
    subjects: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    seen_names: set[tuple[str, str]] = set()
    for raw in raw_subjects:
        if not isinstance(raw, dict) or set(raw) != {
            id_field, "canonicalName", "entityKind",
        }:
            raise DataAnchorError("subject_directory_subject_invalid")
        record = {
            key: str(raw.get(key) or "")
            for key in (id_field, "canonicalName", "entityKind")
        }
        if (
            not record[id_field].strip()
            or len(record[id_field]) > 1_024
            or not record["canonicalName"].strip()
            or len(record["canonicalName"]) > 256
            or not record["entityKind"].strip()
            or len(record["entityKind"]) > 128
        ):
            raise DataAnchorError("subject_directory_subject_invalid")
        identity = (id_field, record[id_field])
        if identity in seen:
            raise DataAnchorError("subject_directory_subject_duplicate")
        name_identity = (id_field, record["canonicalName"])
        if name_identity in seen_names:
            raise DataAnchorError("subject_directory_subject_name_duplicate")
        seen.add(identity)
        seen_names.add(name_identity)
        subjects.append(record)
    return subjects, revision


def assemble_canonical_subject_directory(
    project_id: str,
    think_source: Any,
    know_source: Any,
    *,
    read_duration_ms: float = 0.0,
) -> dict[str, Any]:
    """Validate one complete compact directory without ranking or truncation."""

    project_id = str(project_id or "").strip()
    if not project_id:
        raise DataAnchorError("subject_directory_project_invalid")
    think_subjects, think_revision = _subject_directory_source(
        "engraphisEntityId", think_source
    )
    know_subjects, know_revision = _subject_directory_source(
        "graphitiEntityId", know_source
    )
    subjects = sorted(
        [*think_subjects, *know_subjects],
        key=lambda item: (
            item["canonicalName"], *graph_record_identity(item)
        ),
    )
    counts = {
        "engraphis": len(think_subjects),
        "graphiti": len(know_subjects),
        "total": len(subjects),
    }
    identity = {
        "schemaVersion": "graph-subject-directory",
        "projectId": project_id,
        "complete": True,
        "counts": counts,
        "revisions": {
            "engraphis": think_revision,
            "graphiti": know_revision,
        },
        "subjects": subjects,
    }
    identity_bytes = canonical_json(identity).encode("utf-8")
    directory = {
        **identity,
        "sha256": hashlib.sha256(identity_bytes).hexdigest(),
        "bytes": len(identity_bytes),
        "estimatedTokens": math.ceil(len(identity_bytes) / 4),
        "readDurationMs": round(max(0.0, float(read_duration_ms)), 3),
    }
    if len(canonical_json(directory).encode("utf-8")) > GRAPH_CONTEXT_BYTE_LIMIT:
        raise DataAnchorError("subject_directory_input_limit_exceeded")
    return directory


def build_canonical_subject_directory(project_id: str) -> dict[str, Any]:
    """Read every current subject header from both graph authorities."""

    from app.python_models.engraphis import read_subject_directory

    started = time.perf_counter()
    think_source = read_subject_directory(project_id)
    know_source = read_knowgraph_subject_directory(project_id)
    return assemble_canonical_subject_directory(
        project_id,
        think_source,
        know_source,
        read_duration_ms=(time.perf_counter() - started) * 1000,
    )


def render_canonical_subject_directory(directory: dict[str, Any]) -> str:
    return "\n".join((
        "### Complete Cross-Graph Subject Directory",
        "This is the complete write-time subject-name directory. It is identity choice context, not evidence or agreement.",
        canonical_json(directory),
    ))


def append_canonical_subject_directory(
    graph_context: str,
    directory: dict[str, Any],
) -> str:
    rendered = render_canonical_subject_directory(directory)
    combined = "\n\n".join(value for value in (graph_context.strip(), rendered) if value)
    if len(combined.encode("utf-8")) > GRAPH_CONTEXT_BYTE_LIMIT:
        raise DataAnchorError("data_anchor_seed_limit_exceeded")
    return combined
