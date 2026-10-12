"""Complete cross-authority Entity identities for exact shared-name context."""

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
from app.python_models.knowgraph_exact_reads import read_knowgraph_entity_directory


def _entity_directory_source(
    id_field: str,
    value: Any,
) -> tuple[list[dict[str, str]], str]:
    if not isinstance(value, dict) or value.get("complete") is not True:
        raise DataAnchorError("entity_directory_authority_incomplete")
    raw_entities = value.get("entities")
    count = value.get("count")
    revision = str(value.get("revision") or "").strip()
    if (
        not isinstance(raw_entities, list)
        or isinstance(count, bool)
        or not isinstance(count, int)
        or count < 0
        or count != len(raw_entities)
        or not revision
    ):
        raise DataAnchorError("entity_directory_authority_invalid")
    entities: list[dict[str, str]] = []
    seen_ids: set[str] = set()
    seen_names: set[str] = set()
    for raw in raw_entities:
        if not isinstance(raw, dict) or set(raw) != {id_field, "canonicalName"}:
            raise DataAnchorError("entity_directory_entity_invalid")
        record = {
            id_field: str(raw.get(id_field) or ""),
            "canonicalName": str(raw.get("canonicalName") or ""),
        }
        if (
            not record[id_field].strip()
            or len(record[id_field]) > 1_024
            or not record["canonicalName"].strip()
            or len(record["canonicalName"]) > 256
        ):
            raise DataAnchorError("entity_directory_entity_invalid")
        if record[id_field] in seen_ids:
            raise DataAnchorError("entity_directory_entity_duplicate")
        if record["canonicalName"] in seen_names:
            raise DataAnchorError("entity_directory_entity_name_duplicate")
        seen_ids.add(record[id_field])
        seen_names.add(record["canonicalName"])
        entities.append(record)
    return entities, revision


def assemble_canonical_entity_directory(
    project_id: str,
    think_source: Any,
    know_source: Any,
    *,
    read_duration_ms: float = 0.0,
) -> dict[str, Any]:
    """Validate and exactly merge the complete native Entity directories."""

    project_id = str(project_id or "").strip()
    if not project_id:
        raise DataAnchorError("entity_directory_project_invalid")
    think_entities, think_revision = _entity_directory_source(
        "engraphisEntityId", think_source
    )
    know_entities, know_revision = _entity_directory_source(
        "graphitiEntityId", know_source
    )
    by_name: dict[str, dict[str, str]] = {}
    for entity in think_entities:
        name = entity["canonicalName"]
        by_name[name] = {
            "canonicalName": name,
            "engraphisEntityId": entity["engraphisEntityId"],
            "authority": "thinkgraph",
        }
    for entity in know_entities:
        name = entity["canonicalName"]
        current = by_name.get(name)
        if current is None:
            by_name[name] = {
                "canonicalName": name,
                "graphitiEntityId": entity["graphitiEntityId"],
                "authority": "knowgraph",
            }
            continue
        current["graphitiEntityId"] = entity["graphitiEntityId"]
        current["authority"] = "both"
    entities = sorted(
        by_name.values(),
        key=lambda item: (
            item["canonicalName"],
            item.get("engraphisEntityId", ""),
            item.get("graphitiEntityId", ""),
        ),
    )
    counts = {
        "engraphis": len(think_entities),
        "graphiti": len(know_entities),
        "total": len(entities),
    }
    identity = {
        "schemaVersion": "graph-entity-directory",
        "projectId": project_id,
        "complete": True,
        "counts": counts,
        "revisions": {
            "engraphis": think_revision,
            "graphiti": know_revision,
        },
        "entities": entities,
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
        raise DataAnchorError("entity_directory_input_limit_exceeded")
    return directory


def build_canonical_entity_directory(project_id: str) -> dict[str, Any]:
    """Read every current Entity identity from both native authorities."""

    from app.python_models.engraphis import read_entity_directory

    started = time.perf_counter()
    think_source = read_entity_directory(project_id)
    know_source = read_knowgraph_entity_directory(project_id)
    return assemble_canonical_entity_directory(
        project_id,
        think_source,
        know_source,
        read_duration_ms=(time.perf_counter() - started) * 1000,
    )


def render_canonical_entity_directory(directory: dict[str, Any]) -> str:
    return "\n".join((
        "### Complete Cross-Graph Entity Directory",
        "This is the complete write-time Entity identity directory. It contains identity choice context, not Think or Know bodies or cross-authority agreement.",
        canonical_json(directory),
    ))


def append_canonical_entity_directory(
    graph_context: str,
    directory: dict[str, Any],
) -> str:
    rendered = render_canonical_entity_directory(directory)
    combined = "\n\n".join(value for value in (graph_context.strip(), rendered) if value)
    if len(combined.encode("utf-8")) > GRAPH_CONTEXT_BYTE_LIMIT:
        raise DataAnchorError("data_anchor_seed_limit_exceeded")
    return combined
