"""Pure construction helpers for bounded native graph records in an IDF."""

from __future__ import annotations

from typing import Any

from app.python_models.graph_reference_contracts import (
    graph_record_fields,
    graph_record_identity,
)
from app.python_models.idf_contract import GraphDataRecord, InputMaterializationError


_ENTITY_ID_FIELD = dict(engraphis="engraphisEntityId", graphiti="graphitiEntityId", cbm="cbmQualifiedName")
_RELATIONSHIP_ID_FIELD = dict(engraphis="engraphisRelationshipId", graphiti="graphitiRelationshipId")


def _source_path(properties: dict[str, Any]) -> str | None:
    for key in ("file", "filePath", "file_path", "sourcePath", "path"):
        value = str(properties.get(key) or "").strip()
        if value:
            return value
    return None


def build_graph_records(
    *,
    graph_records: list[dict[str, Any]],
    graph_projection: dict[str, Any],
    materialized_at: str,
) -> list[GraphDataRecord]:
    records: list[GraphDataRecord] = []
    retrieved_by_identity = {
        graph_record_identity(item): item
        for item in graph_records
        if isinstance(item, dict)
    }
    for reference in graph_records:
        if not isinstance(reference, dict):
            raise InputMaterializationError("input_graph_reference_invalid")
        try:
            id_field, identifier = graph_record_identity(reference)
        except ValueError as error:
            raise InputMaterializationError("input_graph_reference_invalid") from error
        if not identifier:
            raise InputMaterializationError("input_graph_reference_invalid")
        records.append(GraphDataRecord(
            kind="selection",
            **graph_record_fields(id_field, identifier),
            type=id_field,
            content={
                "label": str(reference.get("label") or identifier),
                "reason": str(reference.get("reason") or ""),
                "required": reference.get("required") is True,
                "readOperation": str(reference.get("readOperation") or "exact_read"),
                "selectionScope": dict(reference.get("selectionScope") or {}),
                "materializedContentBytes": int(
                    reference.get("materializedContentBytes") or 0
                ),
                **(
                    {"sourceUrl": str(reference["sourceUrl"])}
                    if str(reference.get("sourceUrl") or "").strip()
                    else {}
                ),
                "truncated": reference.get("truncated") is True,
            },
            provenance=dict(reference.get("provenance") or {}),
            retrievedAt=str(reference.get("asOf") or materialized_at),
            sourcePath=str(reference.get("sourcePath") or "").strip() or None,
        ))
    for node in graph_projection.get("nodes") or []:
        if not isinstance(node, dict):
            raise InputMaterializationError("input_graph_node_invalid")
        graph_system = str(node.get("graphSystem") or "").strip()
        entity_id = str(node.get("id") or node.get("canonicalId") or "").strip()
        properties = dict(node.get("properties") or {})
        id_field = _ENTITY_ID_FIELD.get(graph_system)
        if not id_field or not entity_id:
            raise InputMaterializationError("input_graph_node_invalid")
        selected = retrieved_by_identity.get((id_field, entity_id))
        materialized_record_sha256 = str(
            (selected or {}).get("materializedRecordSha256") or ""
        ).strip()
        records.append(GraphDataRecord(
            kind="node",
            **graph_record_fields(id_field, entity_id),
            type=str(node.get("type") or "GraphObject"),
            content={
                "label": str(node.get("label") or entity_id),
                "labels": list(node.get("labels") or []),
                **(
                    {"materializedRecord": {
                        **graph_record_fields(id_field, entity_id),
                        "sha256": materialized_record_sha256,
                    }}
                    if materialized_record_sha256 else {"properties": properties}
                ),
            },
            provenance=dict(node.get("provenance") or {}),
            retrievedAt=str((selected or {}).get("asOf") or materialized_at),
            sourcePath=_source_path(properties),
        ))
    for edge in graph_projection.get("edges") or []:
        if not isinstance(edge, dict):
            raise InputMaterializationError("input_graph_relationship_invalid")
        relationship_id = str(edge.get("id") or "").strip()
        id_field = _RELATIONSHIP_ID_FIELD.get(
            str(edge.get("graphSystem") or "").strip()
        )
        source = str(edge.get("source") or "").strip()
        target = str(edge.get("target") or "").strip()
        if not id_field or not relationship_id or not source or not target:
            raise InputMaterializationError("input_graph_relationship_invalid")
        records.append(GraphDataRecord(
            kind="relationship",
            **graph_record_fields(id_field, relationship_id),
            type=str(edge.get("predicate") or "RELATED"),
            content={
                "sourceEntityId": source,
                "targetEntityId": target,
                "properties": dict(edge.get("properties") or {}),
            },
            provenance=dict(edge.get("provenance") or {}),
            retrievedAt=materialized_at,
            relationshipIds=[relationship_id],
        ))
    return records


def graph_systems(records: list[GraphDataRecord]) -> list[str]:
    return sorted({
        "engraphis" if identity[0].startswith("engraphis")
        else "graphiti" if identity[0].startswith("graphiti")
        else "cbm"
        for record in records
        for identity in [graph_record_identity(record.model_dump(exclude_none=True))]
    })


def provenance_summary(references: list[dict[str, Any]]) -> list[dict[str, Any]]:
    unique: dict[str, dict[str, Any]] = {}
    for reference in references:
        try:
            id_field, _ = graph_record_identity(reference)
        except ValueError:
            continue
        graph_system = (
            "engraphis" if id_field.startswith("engraphis")
            else "graphiti" if id_field.startswith("graphiti")
            else "cbm"
        )
        summary = unique.setdefault(graph_system, {
            "graphSystem": graph_system,
            "readOperations": [],
            "sources": [],
        })
        provenance = dict(reference.get("provenance") or {})
        operation = str(reference.get("readOperation") or "exact_read")
        if operation not in summary["readOperations"]:
            summary["readOperations"].append(operation)
        for key in (
            "source", "project", "database", "repository", "repositoryRoot",
            "path", "sourcePath", "url", "sourceUrl",
        ):
            value = str(provenance.get(key) or "").strip()
            if value and value not in summary["sources"]:
                summary["sources"].append(value)
        for value in (
            str(reference.get("sourcePath") or "").strip(),
            str(reference.get("sourceUrl") or "").strip(),
        ):
            if value and value not in summary["sources"]:
                summary["sources"].append(value)
    return [unique[key] for key in sorted(unique)]
