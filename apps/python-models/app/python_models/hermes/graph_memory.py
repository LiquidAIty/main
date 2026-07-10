"""Hermes graph-memory write-plan builder.

Builds ThinkGraph write PLANS (RunRecord / Blocker / Pattern + typed edges)
and converts a plan into the REAL ``apply_thinkgraph_patch`` payload shape
(``ThinkGraphPatch`` in apps/backend/src/services/thinkgraph/thinkGraphStore.ts:
resources with id/label/kind/flat-scalar properties; typed edges carried as
statements with predicateTerm). This module never touches a database, a
network, CBM write/index APIs, or KnowGraph — execution happens only through
the card's scoped authority, elsewhere.
"""

from __future__ import annotations

from typing import Any, Optional

from .protocol import (
    BlockerFinding,
    GraphMemoryWritePlan,
    PatternCandidate,
    RunRecord,
)

# thinkGraphStore validates properties as flat scalar maps with compact
# single-line string values. Stay comfortably inside its bounds.
_MAX_PROPERTY_TEXT = 160


def _compact(value: Any) -> Any:
    """Clamp a value to the patch's flat-scalar property contract."""
    if isinstance(value, bool) or isinstance(value, (int, float)):
        return value
    text = " ".join(str(value).split())
    return text[:_MAX_PROPERTY_TEXT]


def _compact_join(values: list[str]) -> str:
    return _compact(", ".join(str(v) for v in values))


def feature_node_id(feature_id: str) -> str:
    return f"feature:{feature_id}"


def run_node_id(run_id: str) -> str:
    return f"run:{run_id}"


def blocker_node_id(run_id: str, index: int) -> str:
    return f"blocker:{run_id}:{index}"


def pattern_node_id(pattern_key: str) -> str:
    return f"pattern:{pattern_key}"


def blocked_write_plan(reason: str) -> GraphMemoryWritePlan:
    """The honest plan when the authorized write path is unavailable."""
    return GraphMemoryWritePlan(status="write_path_blocked", reason=reason)


def build_write_plan(
    *,
    verdict: str,
    run_record: Optional[RunRecord],
    blockers: list[BlockerFinding],
    patterns: list[PatternCandidate],
) -> GraphMemoryWritePlan:
    """Assemble the write plan from review findings. Deterministic IDs come
    from the supplied run/feature IDs; Blocker/Pattern writes exist only when
    the review actually found blockers — nothing speculative."""
    if verdict == "empty" or run_record is None or not run_record.runId:
        return GraphMemoryWritePlan(
            status="no_useful_finding",
            reason="no reviewable run content — nothing worth remembering",
        )

    run_id = run_node_id(run_record.runId)
    edges: list[dict[str, str]] = []
    if run_record.featureId:
        edges.append(
            {"type": "HAS_RUN", "from": feature_node_id(run_record.featureId), "to": run_id}
        )

    blocker_writes: list[dict[str, Any]] = []
    pattern_writes: list[dict[str, Any]] = []
    pattern_ids: dict[str, str] = {}

    for pattern in patterns:
        node_id = pattern_node_id(pattern.patternId)
        pattern_ids[pattern.patternId] = node_id
        pattern_writes.append(
            {
                "nodeId": node_id,
                "patternId": pattern.patternId,
                "name": pattern.name,
                "occurrenceCount": pattern.occurrenceCount,
                "firstSeen": pattern.firstSeen,
                "lastSeen": pattern.lastSeen,
            }
        )

    for index, blocker in enumerate(blockers):
        node_id = blocker_node_id(run_record.runId, index)
        blocker_writes.append(
            {
                "nodeId": node_id,
                "blockerId": blocker.blockerId,
                "type": blocker.type,
                "summary": blocker.summary,
                "runId": run_record.runId,
                "timestamp": blocker.timestamp,
                "classifiedPattern": blocker.classifiedPattern,
            }
        )
        edges.append({"type": "ENCOUNTERED", "from": run_id, "to": node_id})
        if blocker.classifiedPattern and blocker.classifiedPattern in pattern_ids:
            edges.append(
                {
                    "type": "INSTANCE_OF",
                    "from": node_id,
                    "to": pattern_ids[blocker.classifiedPattern],
                }
            )

    run_write = {
        "nodeId": run_id,
        "runId": run_record.runId,
        "featureId": run_record.featureId,
        "status": run_record.status,
        "proofScore": run_record.proofScore,
        "totalRequirements": run_record.totalRequirements,
        "timestamp": run_record.timestamp,
        "reviewedBy": run_record.reviewedBy,
        "filesChanged": list(run_record.filesChanged),
        "blockerSummary": run_record.blockerSummary,
        "cbmStatus": run_record.cbmStatus,
        "sourceCitations": list(run_record.sourceCitations),
        "objective": run_record.objective,
        "decisionSummary": run_record.decisionSummary,
    }

    return GraphMemoryWritePlan(
        status="ready",
        runRecord=run_write,
        blockers=blocker_writes,
        patterns=pattern_writes,
        edges=edges,
    )


def to_thinkgraph_patch(plan: GraphMemoryWritePlan) -> dict[str, Any]:
    """Convert a ready plan into the exact apply_thinkgraph_patch payload:
    ``{"resources": [...], "statements": [...]}``. Typed edges become
    statements (predicateTerm = edge type); node types ride as resource
    ``kind``; properties are clamped to the flat-scalar contract."""
    if plan.status != "ready":
        return {"resources": [], "statements": []}

    resources: list[dict[str, Any]] = []
    statements: list[dict[str, Any]] = []

    def add_resource(node_id: str, label: str, kind: str, properties: dict[str, Any]) -> None:
        compact_properties = {
            key: _compact_join(value) if isinstance(value, list) else _compact(value)
            for key, value in properties.items()
            if value not in (None, "", [])
        }
        resources.append(
            {"id": node_id, "label": _compact(label), "kind": kind, "properties": compact_properties}
        )

    run = plan.runRecord or {}
    if run.get("nodeId"):
        add_resource(
            str(run["nodeId"]),
            f"RunRecord {run.get('runId', '')}",
            "RunRecord",
            {k: v for k, v in run.items() if k != "nodeId"},
        )

    for blocker in plan.blockers:
        add_resource(
            str(blocker.get("nodeId", "")),
            f"Blocker {blocker.get('summary', '')[:60]}",
            "Blocker",
            {k: v for k, v in blocker.items() if k != "nodeId"},
        )

    for pattern in plan.patterns:
        add_resource(
            str(pattern.get("nodeId", "")),
            f"Pattern {pattern.get('name', '')}",
            "Pattern",
            {k: v for k, v in pattern.items() if k != "nodeId"},
        )

    for edge in plan.edges:
        subject = str(edge.get("from", ""))
        obj = str(edge.get("to", ""))
        predicate = str(edge.get("type", ""))
        if not subject or not obj or not predicate:
            continue
        statements.append(
            {
                "id": f"{subject}|{predicate}|{obj}",
                "subject": subject,
                "predicateTerm": predicate,
                "object": obj,
            }
        )

    return {"resources": resources, "statements": statements}
