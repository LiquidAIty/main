"""Resolve selected provider graph references before model dispatch.

The coordinator calls each provider's read-only owner, renders the exact returned
records, and returns stable references plus an optional transient projection. It
never writes a graph, copies one into another authority, or materializes an IDF.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

from app.python_models import (
    codegraph_reference_reads,
    thinkgraph_reference_reads,
)
from app.python_models.data_anchor_contract import (
    GRAPH_CONTEXT_BYTE_LIMIT,
    MAX_GRAPH_REFERENCE_RESULTS,
    DataAnchorError,
    canonical_json,
    json_safe,
)
from app.python_models.graph_reference_contracts import (
    GRAPH_RECORD_ID_FIELDS,
    graph_record_fields,
    graph_record_identity,
)
from app.python_models.knowgraph_exact_reads import read_knowgraph_exact


def _materialized_record_sha256(record: dict[str, Any]) -> str:
    payload = {
        "properties": record.get("properties") or {
            "type": record["type"],
            "title": record["title"],
            "metadata": record.get("metadata") or {},
        },
        "know": record.get("know") if isinstance(record.get("know"), dict) else None,
        "relationshipEvidence": record.get("relationshipEvidence") or [],
        "content": record.get("content"),
    }
    return hashlib.sha256(canonical_json(payload).encode("utf-8")).hexdigest()


def _deduplicate_exact_payload(
    value: Any,
    *,
    id_field: str,
    identifier: str,
    field: str,
    rendered_payloads: dict[tuple[str, str, str], str],
) -> Any:
    """Replace only byte-identical repeated provider payloads with a stable pointer."""

    encoded = canonical_json(value).encode("utf-8")
    if len(encoded) < 256:
        return value
    digest = hashlib.sha256(encoded).hexdigest()
    identity = (id_field, field, digest)
    first_identifier = rendered_payloads.get(identity)
    if first_identifier is None:
        rendered_payloads[identity] = identifier
        return value
    return {
        "exactProviderPayloadReference": {
            **graph_record_fields(id_field, first_identifier),
            "sha256": digest,
        }
    }


def _render_anchor(
    anchor: dict[str, Any],
    record: dict[str, Any],
    *,
    rendered_payloads: dict[tuple[str, str, str], str],
) -> str:
    properties = record.get("properties") or {
        "type": record["type"],
        "title": record["title"],
        "metadata": record.get("metadata") or {},
    }
    id_field, identifier = graph_record_identity(record)
    graph_system = str(record["graphSystem"])
    if isinstance(properties, dict) and "metadata" in properties:
        properties = {
            **properties,
            "metadata": _deduplicate_exact_payload(
                properties["metadata"], id_field=id_field, identifier=identifier,
                field="metadata", rendered_payloads=rendered_payloads,
            ),
        }
    content = _deduplicate_exact_payload(
        record["content"], id_field=id_field, identifier=identifier,
        field="content", rendered_payloads=rendered_payloads,
    )
    return "\n".join([
        f"### Data Anchor: {graph_system} / {id_field} / {identifier}",
        f"Selection reason (guidance, not verified fact): {anchor['reason']}",
        f"Verified provider read as of: {record['asOf']}",
        f"Provider read operation: {record.get('readOperation') or 'exact_read'}",
        f"Materialized provider record SHA-256: {_materialized_record_sha256(record)}",
        f"Verified provider provenance: {json.dumps(record.get('provenance') or {}, ensure_ascii=False, separators=(',', ':'), default=str)}",
        f"Verified provider properties: {json.dumps(properties, ensure_ascii=False, separators=(',', ':'), default=str)}",
        *(
            [f"Portable Know with persisted Jev classification: {json.dumps(record['know'], ensure_ascii=False, separators=(',', ':'), default=str)}"]
            if isinstance(record.get("know"), dict) else []
        ),
        *(
            [f"Verified relationship evidence: {json.dumps(record['relationshipEvidence'], ensure_ascii=False, separators=(',', ':'), default=str)}"]
            if record.get("relationshipEvidence") else []
        ),
        "Verified provider content:",
        (
            content if isinstance(content, str)
            else json.dumps(content, ensure_ascii=False, separators=(",", ":"), default=str)
        ),
    ]).strip()


def _materialized_reference(
    anchor: dict[str, Any],
    record: dict[str, Any],
    *,
    truncated: bool,
) -> dict[str, Any]:
    """Expose one truthful selection projection from the provider read result."""

    properties = record.get("properties")
    properties = properties if isinstance(properties, dict) else {}
    metadata = record.get("metadata")
    metadata = metadata if isinstance(metadata, dict) else {}
    provenance = record.get("provenance")
    provenance = provenance if isinstance(provenance, dict) else {}

    def first_text(keys: tuple[str, ...], *sources: dict[str, Any]) -> str:
        for source in sources:
            for key in keys:
                value = str(source.get(key) or "").strip()
                if value:
                    return value
        return ""

    source_path = first_text(
        ("file", "filePath", "file_path", "sourcePath", "path"),
        properties,
        metadata,
        provenance,
    )
    source_url = first_text(
        ("url", "sourceUrl", "source_url", "sourceUri", "source_uri"),
        properties,
        metadata,
        provenance,
    )
    content = record.get("content")
    content_text = (
        content
        if isinstance(content, str)
        else json.dumps(content, ensure_ascii=False, separators=(",", ":"), default=str)
    )
    selection_scope = {
        "boundedExpansion": int(anchor.get("boundedExpansion", 0)),
        **(
            {"resultLimit": int(anchor["resultLimit"])}
            if anchor.get("resultLimit") is not None
            else {}
        ),
    }
    id_field, identifier = graph_record_identity(record)
    return {
        **graph_record_fields(id_field, identifier),
        "label": str(record.get("title") or identifier),
        "reason": anchor["reason"],
        "asOf": record["asOf"],
        "required": anchor.get("required") is True,
        "readOperation": record.get("readOperation") or "exact_read",
        "provenance": provenance,
        "selectionScope": selection_scope,
        "materializedContentBytes": len(content_text.encode("utf-8")),
        "materializedRecordSha256": _materialized_record_sha256(record),
        **({"sourcePath": source_path} if source_path else {}),
        **({"sourceUrl": source_url} if source_url else {}),
        "truncated": truncated,
    }


def empty_graph_projection(project_id: str) -> dict[str, Any]:
    return {
        "schemaVersion": "provider-card-context.v1",
        "graphSystems": [],
        "projectId": project_id,
        "nodes": [],
        "edges": [],
        "counts": {"nodes": 0, "edges": 0},
    }


def _projection_node(
    graph_system: str,
    provider_id: str,
    *,
    labels: Any = None,
    properties: Any = None,
    title: str = "",
    provenance: Any = None,
) -> dict[str, Any]:
    safe_properties = properties if isinstance(properties, dict) else {}
    safe_labels = [str(label) for label in labels] if isinstance(labels, list) else []
    label = str(
        title
        or safe_properties.get("name")
        or safe_properties.get("title")
        or safe_properties.get("fact")
        or provider_id
    )
    return {
        "id": provider_id,
        "canonicalId": provider_id,
        "label": label,
        "title": label,
        "type": safe_labels[0] if safe_labels else str(safe_properties.get("type") or "GraphObject"),
        "labels": safe_labels,
        "graphSystem": graph_system,
        "mentionCount": 1,
        "properties": json_safe(safe_properties),
        "provenance": json_safe(provenance) if isinstance(provenance, dict) else {},
    }


def _record_graph_projection(project_id: str, record: dict[str, Any]) -> dict[str, Any]:
    """Project only provider node/relationship identities actually returned by a read."""

    id_field, provider_id = graph_record_identity(record)
    graph_system = str(record.get("graphSystem") or "")
    if record.get("recordKind") not in {"entity", "relationship", "symbol"}:
        return {
            "schemaVersion": "provider-card-context.v1",
            "graphSystems": [graph_system],
            "projectId": project_id,
            "nodes": [],
            "edges": [],
            "counts": {"nodes": 0, "edges": 0},
        }
    nodes: dict[str, dict[str, Any]] = {}
    edges: dict[str, dict[str, Any]] = {}

    def add_node(item: dict[str, Any], *, fallback_title: str = "") -> None:
        item_id = str(item.get("id") or item.get("graphitiId") or item.get("uuid") or "").strip()
        if not item_id or item_id in nodes:
            return
        nodes[item_id] = _projection_node(
            graph_system,
            item_id,
            labels=item.get("labels"),
            properties=item.get("properties") if isinstance(item.get("properties"), dict) else item,
            title=str(item.get("title") or item.get("name") or fallback_title),
            provenance=record.get("provenance"),
        )

    def add_edge(item: dict[str, Any]) -> None:
        edge_id = str(item.get("id") or item.get("graphitiId") or item.get("uuid") or "").strip()
        source = str(
            item.get("sourceId")
            or item.get("sourceNodeUuid")
            or item.get("source_node_uuid")
            or ""
        ).strip()
        target = str(
            item.get("targetId")
            or item.get("targetNodeUuid")
            or item.get("target_node_uuid")
            or ""
        ).strip()
        if not edge_id or not source or not target or edge_id in edges:
            return
        edges[edge_id] = {
            "id": edge_id,
            "source": source,
            "target": target,
            "predicate": str(item.get("type") or item.get("name") or item.get("edge_type") or "RELATED"),
            "mentionCount": 1,
            "properties": json_safe(item.get("properties") or item),
            "provenance": json_safe(record.get("provenance") or {}),
            "graphSystem": graph_system,
        }

    if record.get("recordKind") == "relationship":
        for endpoint in record.get("endpointNodes") or []:
            if isinstance(endpoint, dict):
                add_node(endpoint)
        evidence = record.get("relationshipEvidence") or []
        source_id = str(record.get("sourceId") or "").strip()
        target_id = str(record.get("targetId") or "").strip()
        if isinstance(evidence, list) and evidence and isinstance(evidence[0], dict):
            source_id = source_id or str(evidence[0].get("sourceNodeUuid") or "").strip()
            target_id = target_id or str(evidence[0].get("targetNodeUuid") or "").strip()
        edge_properties = dict(record.get("properties") or {})
        portable_know = record.get("know") if isinstance(record.get("know"), dict) else {}
        jev = record.get("jev") if isinstance(record.get("jev"), dict) else {}
        edge_properties.update(portable_know)
        if jev:
            edge_properties["jev"] = jev
            if jev.get("status") == "success" and jev.get("winner"):
                edge_properties["jevCanonicalRelation"] = jev["winner"]
        add_edge({
            "id": provider_id,
            "sourceId": source_id,
            "targetId": target_id,
            "type": (
                jev.get("winner")
                if jev.get("status") == "success" and jev.get("winner")
                else record.get("type")
            ),
            "properties": edge_properties,
        })
    elif provider_id and id_field in {
        "engraphisEntityId", "graphitiEntityId", "cbmQualifiedName",
    }:
        add_node({
            "id": provider_id,
            "labels": [record.get("type")] if record.get("type") else [],
            "properties": record.get("properties") or record.get("metadata") or {},
            "title": record.get("title"),
        })

    for path in record.get("relationshipEvidence") or []:
        if not isinstance(path, dict):
            continue
        for item in path.get("nodes") or []:
            if isinstance(item, dict):
                add_node(item)
        for item in path.get("relationships") or []:
            if isinstance(item, dict):
                add_edge(item)

    limit = max(1, min(
        int(record.get("resultLimit") or MAX_GRAPH_REFERENCE_RESULTS),
        MAX_GRAPH_REFERENCE_RESULTS,
    ))
    bounded_nodes = list(nodes.values())[:limit]
    node_ids = {node["id"] for node in bounded_nodes}
    bounded_edges = [
        edge for edge in edges.values()
        if edge["source"] in node_ids and edge["target"] in node_ids
    ][:limit]
    return {
        "schemaVersion": "provider-card-context.v1",
        "graphSystems": [graph_system],
        "projectId": project_id,
        "nodes": bounded_nodes,
        "edges": bounded_edges,
        "counts": {"nodes": len(bounded_nodes), "edges": len(bounded_edges)},
    }


def _merge_graph_projection(target: dict[str, Any], incoming: dict[str, Any]) -> None:
    node_ids = {str(node.get("id") or "") for node in target["nodes"]}
    edge_ids = {str(edge.get("id") or "") for edge in target["edges"]}
    target["nodes"].extend(
        node for node in incoming["nodes"] if str(node.get("id") or "") not in node_ids
    )
    target["edges"].extend(
        edge for edge in incoming["edges"] if str(edge.get("id") or "") not in edge_ids
    )
    target["graphSystems"] = sorted({
        str(value)
        for projection in (target, incoming)
        for value in projection.get("graphSystems") or []
        if str(value).strip()
    })
    target["counts"] = {"nodes": len(target["nodes"]), "edges": len(target["edges"])}


def _read_exact_anchor_record(
    project_id: str,
    deck_id: str,
    card_id: str,
    anchor: dict[str, Any],
) -> dict[str, Any] | None:
    """Use the existing provider owner for one exact Data Anchor read."""

    id_field, identifier = graph_record_identity(anchor)
    if id_field in {"engraphisEntityId", "engraphisMemoryId"}:
        return thinkgraph_reference_reads.read_thinkgraph_exact(
            project_id,
            id_field,
            identifier,
            bounded_expansion=anchor["boundedExpansion"],
            result_limit=int(anchor.get("resultLimit", MAX_GRAPH_REFERENCE_RESULTS)),
        )
    if id_field in {
        "graphitiEpisodeId", "graphitiEntityId", "graphitiRelationshipId",
    }:
        return read_knowgraph_exact(
            project_id,
            id_field,
            identifier,
            bounded_expansion=anchor["boundedExpansion"],
            result_limit=int(anchor.get("resultLimit", MAX_GRAPH_REFERENCE_RESULTS)),
        )
    if id_field == "cbmQualifiedName":
        return codegraph_reference_reads.read_codegraph_exact(
            project_id,
            deck_id,
            card_id,
            identifier,
            bounded_expansion=anchor["boundedExpansion"],
            result_limit=int(anchor.get("resultLimit", MAX_GRAPH_REFERENCE_RESULTS)),
        )
    raise DataAnchorError(f"data_anchor_resolver_unavailable:{id_field}")


def resolve_data_anchors(
    project_id: str,
    anchors: list[dict[str, Any]],
    *,
    deck_id: str = "",
    card_id: str = "",
    graph_projection: dict[str, Any] | None = None,
) -> tuple[str, list[dict[str, Any]]]:
    """Resolve ordered exact references and return model text plus source records."""

    rendered: list[str] = []
    references: list[dict[str, Any]] = []
    rendered_payloads: dict[tuple[str, str, str], str] = {}
    resolved_identities: set[tuple[str, str]] = set()
    for anchor in anchors:
        populated = [
            field for field in GRAPH_RECORD_ID_FIELDS
            if str(anchor.get(field) or "").strip()
        ]
        if not populated:
            continue
        record = _read_exact_anchor_record(
            project_id,
            deck_id,
            card_id,
            anchor,
        )
        if record is None:
            if anchor["required"]:
                raise DataAnchorError("data_anchor_required_not_found")
            continue
        identity = graph_record_identity(record)
        if identity in resolved_identities:
            continue
        resolved_identities.add(identity)
        rendered.append(_render_anchor(
            anchor, record, rendered_payloads=rendered_payloads,
        ))
        if graph_projection is not None:
            _merge_graph_projection(
                graph_projection,
                _record_graph_projection(project_id, record),
            )
        references.append(_materialized_reference(
            anchor,
            record,
            truncated=record.get("truncated") is True,
        ))
    if anchors and not rendered:
        rendered.append(
            "### Data Anchor Resolution\nNo optional current provider graph object was resolved."
        )
    graph_context = "\n\n".join(rendered)
    if len(graph_context.encode("utf-8")) > GRAPH_CONTEXT_BYTE_LIMIT:
        raise DataAnchorError("data_anchor_seed_limit_exceeded")
    return graph_context, references
