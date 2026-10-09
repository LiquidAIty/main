"""Exact project-scoped reads from the Engraphis ThinkGraph authority."""

from __future__ import annotations

import json
from typing import Any

from app.python_models.data_anchor_contract import (
    ANCHOR_BODY_LIMIT,
    MAX_GRAPH_REFERENCE_RESULTS,
    DataAnchorError,
)
from app.python_models.engraphis_operations import private_operation


def read_thinkgraph_exact(
    project_id: str,
    id_field: str,
    identifier: str,
    *,
    bounded_expansion: int = 0,
    result_limit: int = MAX_GRAPH_REFERENCE_RESULTS,
) -> dict[str, Any] | None:
    """Read one exact memory or entity through the Engraphis service owner."""

    if bounded_expansion not in (0, 1) or not 1 <= result_limit <= MAX_GRAPH_REFERENCE_RESULTS:
        raise DataAnchorError("data_anchor_expansion_invalid")
    if id_field not in {"engraphisEntityId", "engraphisMemoryId"}:
        raise DataAnchorError("data_anchor_engraphis_reference_unsupported")
    try:
        engraphis_record = private_operation(
            project_id,
            "inspect",
            {
                "entityId" if id_field == "engraphisEntityId" else "memoryId": identifier,
            },
        )
    except (RuntimeError, ValueError, KeyError):
        return None
    except Exception as error:
        raise DataAnchorError("data_anchor_thinkgraph_read_failed") from error
    entity = engraphis_record.get("entity")
    if isinstance(entity, dict):
        evidence = entity.get("evidence", [])
        thinks = [
            item for item in evidence
            if isinstance(item.get("metadata"), dict)
            and isinstance(item["metadata"].get("thinkgraph_origin"), dict)
            and item["metadata"]["thinkgraph_origin"].get("authority") == "thinkgraph"
        ]
        think_memory_ids = {
            str(item.get("memory_id") or "").strip()
            for item in thinks
            if str(item.get("memory_id") or "").strip()
        }
        residual_evidence = [
            item for item in evidence
            if (
                str(item.get("memory_id") or "").strip() not in think_memory_ids
                if str(item.get("memory_id") or "").strip()
                else item not in thinks
            )
        ]
        bounded_thinks = thinks[:result_limit]
        remaining_evidence = max(0, result_limit - len(bounded_thinks))
        bounded_evidence = residual_evidence[:remaining_evidence]
        portable_context = bounded_thinks or bounded_evidence
        body = "\n\n".join(
            str(item.get("excerpt", "")) for item in portable_context
        )
        relations = entity.get("relations", [])[:max(0, result_limit - 1)] if bounded_expansion else []
        return {
            "graphSystem": "engraphis",
            "engraphisEntityId": entity["canonical_id"],
            "recordKind": "entity",
            "portableKind": "think",
            "recordId": entity["canonical_id"], "type": entity["type"], "title": entity["label"],
            "content": body[:ANCHOR_BODY_LIMIT],
            "metadata": {"thinks": bounded_thinks, "evidence": bounded_evidence},
            "provenance": {"engine": "engraphis", "memberIds": entity["member_ids"]},
            "asOf": "current", "readOperation": "graph_entity",
            "relationshipEvidence": [{"nodes": [{"id": r["other_id"], "title": r["other_label"]} for r in relations],
                "relationships": [{"id": r["id"], "sourceId": r["source"],
                    "targetId": r["target"], "type": r["relation"]} for r in relations]}] if relations else [],
            "resultLimit": result_limit, "truncated": len(body) > ANCHOR_BODY_LIMIT
                or len(thinks) + len(residual_evidence) > (
                    len(bounded_thinks) + len(bounded_evidence)
                )
                or any(entity.get("truncation", {}).values())
                or bounded_expansion > 0 and len(entity.get("relations", [])) > len(relations),
        }
    row = engraphis_record.get("memory")
    if not isinstance(row, dict):
        return None
    links = engraphis_record.get("relationships", []) if bounded_expansion else []
    links = links[:max(0, result_limit - 1)]
    neighbors = {link["b"] if link["a"] == row["id"] else link["a"] for link in links}
    relationships = [{
        "id": json.dumps([link["a"], link["b"], link["relation"]], separators=(",", ":")),
        "sourceId": link["a"], "targetId": link["b"], "type": link["relation"],
        "properties": {"reason": link.get("reason", ""), "layer": link.get("layer")},
    } for link in links]
    return {
        "graphSystem": "engraphis",
        "engraphisMemoryId": row["id"],
        "recordKind": "memory",
        "recordId": row["id"], "type": row.get("mtype", "semantic"),
        "title": row.get("title", ""), "content": str(row.get("content", ""))[:ANCHOR_BODY_LIMIT],
        "properties": {
            "memoryType": row.get("mtype", "semantic"),
            "validFrom": row.get("valid_from"),
            "validTo": row.get("valid_to"),
            "validToRecordedAt": row.get("valid_to_recorded_at"),
            "ingestedAt": row.get("ingested_at"),
            "expiredAt": row.get("expired_at"),
        },
        "metadata": row.get("metadata", {}), "provenance": row.get("provenance", {}),
        "asOf": "current", "readOperation": "engraphis_get_memory",
        "relationshipEvidence": [{
            "nodes": [{"id": link["id"], "title": link["title"]}
                      for link in engraphis_record.get("links", []) if link["id"] in neighbors],
            "relationships": relationships,
        }] if relationships else [],
        "resultLimit": result_limit,
        "truncated": len(str(row.get("content", ""))) > ANCHOR_BODY_LIMIT
            or bounded_expansion > 0 and len(engraphis_record.get("relationships", [])) > len(links),
    }
