"""Hermes protocol: review contracts + the ThinkGraph run-memory schema.

Pure data contracts — no network, no DB, no model call, no file writes.
The review logic that fills these lives in ``review.py``; the graph write
PLAN builder lives in ``graph_memory.py``. Persistence happens only through
the card's scoped ``apply_thinkgraph_patch`` authority, never from here.

These contracts mirror the REAL runtime seams instead of restating them:
- CoderReport required fields = ``coderReportJsonSchema.required`` in
  apps/backend/src/contracts/coderContracts.ts (the one runtime contract the
  Local Coder path actually validates with).
- ThinkGraph patch shape = ``ThinkGraphPatch`` in
  apps/backend/src/services/thinkgraph/thinkGraphStore.ts.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Optional

# Honest review verdicts, worst-first.
HERMES_VERDICTS = ("empty", "blocked", "suspicious", "incomplete", "honest")

# The 13 canonical CoderReport fields (coderContracts.ts coderReportJsonSchema.required).
CODER_REPORT_FIELDS = (
    "coderPacketId",
    "status",
    "summary",
    "specComparison",
    "filesChanged",
    "proofCommands",
    "proofResults",
    "failedCommands",
    "blockers",
    "assumptions",
    "outOfScopeFindings",
    "nextRecommendedTask",
    "rawOutput",
)

# ThinkGraph run-memory schema. Node types map to resource `kind`, edge types
# to statement `predicateTerm` in the real apply_thinkgraph_patch shape.
THINKGRAPH_NODE_TYPES = ("RunRecord", "Blocker", "Pattern")
THINKGRAPH_EDGE_TYPES = ("HAS_RUN", "ENCOUNTERED", "INSTANCE_OF", "RELATED_TO")

RUN_RECORD_STATUSES = ("completed", "partial", "failed", "blocked")
WRITE_PLAN_STATUSES = ("ready", "no_useful_finding", "write_path_blocked")

HERMES_ACTIVITY_TYPES = (
    "review_started",
    "review_complete",
    "thinkgraph_write_planned",
    "thinkgraph_write_complete",
    "pattern_detected",
    "context_query",
    "blocked",
    "idle",
)


@dataclass
class HermesReviewInput:
    """Everything Hermes may receive for one review. Graph/CBM context is
    SUPPLIED (read elsewhere through authorized paths) — absent context is
    reported explicitly, never fabricated."""

    coderReport: dict[str, Any] = field(default_factory=dict)
    featureId: str = ""
    projectId: Optional[str] = None
    runId: Optional[str] = None
    # Prior ThinkGraph memory: {"runs": [...], "blockers": [...], "patterns": [...]}
    thinkGraphContext: Optional[dict[str, Any]] = None
    # CBM status: {"project", "status", "nodes", "edges", "changedFiles", "freshness"}
    codeGraphStatus: Optional[dict[str, Any]] = None
    # Source-backed evidence supplied by KnowGraph paths (read-only this pass).
    knowGraphContext: Optional[dict[str, Any]] = None


@dataclass
class ProofQuality:
    requirementsClaimed: int = 0
    requirementsProven: int = 0
    unprovenRequirements: list[str] = field(default_factory=list)
    missingEvidence: list[str] = field(default_factory=list)
    proofCommandsPresent: bool = False
    proofResultsPresent: bool = False


@dataclass
class BlockerFinding:
    """One blocker from the report. An explicit type/classification is
    preserved; free text stays type "unknown" — unknown never pretends to be
    classified. `classifiedPattern` is a deterministic canonicalization of the
    text (a stable identity key), never a semantic interpretation."""

    blockerId: str = ""
    type: str = "unknown"
    summary: str = ""
    runId: str = ""
    timestamp: str = ""
    classifiedPattern: Optional[str] = None
    sourceCitations: list[str] = field(default_factory=list)


@dataclass
class PatternCandidate:
    patternId: str = ""
    name: str = ""
    occurrenceCount: int = 1
    firstSeen: str = ""
    lastSeen: str = ""
    samples: list[str] = field(default_factory=list)


@dataclass
class RunRecord:
    runId: str = ""
    featureId: str = ""
    status: str = ""  # one of RUN_RECORD_STATUSES
    proofScore: float = 0.0
    totalRequirements: int = 0
    timestamp: str = ""
    reviewedBy: str = "hermes_steward"
    filesChanged: list[str] = field(default_factory=list)
    blockerSummary: Optional[str] = None
    cbmStatus: Optional[str] = None
    sourceCitations: list[str] = field(default_factory=list)
    # Durable run memory: the user objective the run served, and — only for an
    # honest completed run — a bounded summary of the accepted result. Both are
    # supplied structure, never inferred from prose here.
    objective: Optional[str] = None
    decisionSummary: Optional[str] = None


@dataclass
class GraphMemoryWritePlan:
    """A write PLAN only. Execution happens through the card's scoped
    apply_thinkgraph_patch authority (or is reported blocked) — never here."""

    status: str = "no_useful_finding"  # one of WRITE_PLAN_STATUSES
    runRecord: Optional[dict[str, Any]] = None
    blockers: list[dict[str, Any]] = field(default_factory=list)
    patterns: list[dict[str, Any]] = field(default_factory=list)
    # Edge plans: {"type": <THINKGRAPH_EDGE_TYPES>, "from": <id>, "to": <id>}
    edges: list[dict[str, str]] = field(default_factory=list)
    reason: Optional[str] = None


@dataclass
class HermesActivityEntry:
    """Transient console/UI activity. Durable memory belongs in ThinkGraph."""

    id: str = ""
    timestamp: str = ""
    type: str = "idle"  # one of HERMES_ACTIVITY_TYPES
    summary: str = ""
    detail: Optional[str] = None
    thinkgraphNodeId: Optional[str] = None
    runId: Optional[str] = None
    featureId: Optional[str] = None


@dataclass
class HermesReview:
    """The structured result of reviewing one CoderReport."""

    verdict: str = "empty"  # one of HERMES_VERDICTS
    proofQuality: ProofQuality = field(default_factory=ProofQuality)
    missingEvidence: list[str] = field(default_factory=list)
    blockers: list[BlockerFinding] = field(default_factory=list)
    patternCandidates: list[PatternCandidate] = field(default_factory=list)
    recommendation: str = ""
    graphMemoryWritePlan: GraphMemoryWritePlan = field(default_factory=GraphMemoryWritePlan)
    # CoderReport fields actually used for the judgment, e.g. "coderReport.proofResults".
    sourceCitations: list[str] = field(default_factory=list)
    activityEvents: list[HermesActivityEntry] = field(default_factory=list)
    # Bounded evidence about the canonical job folder. Raw worker contents stay
    # in returns/<jobId>/<cardId>/; Main Chat receives this compact index only.
    jobEvidence: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "HermesReview":
        proof = value.get("proofQuality") or {}
        plan = value.get("graphMemoryWritePlan") or {}
        return cls(
            verdict=str(value.get("verdict") or "empty"),
            proofQuality=ProofQuality(
                requirementsClaimed=int(proof.get("requirementsClaimed") or 0),
                requirementsProven=int(proof.get("requirementsProven") or 0),
                unprovenRequirements=[str(v) for v in proof.get("unprovenRequirements") or []],
                missingEvidence=[str(v) for v in proof.get("missingEvidence") or []],
                proofCommandsPresent=bool(proof.get("proofCommandsPresent")),
                proofResultsPresent=bool(proof.get("proofResultsPresent")),
            ),
            missingEvidence=[str(v) for v in value.get("missingEvidence") or []],
            blockers=[
                BlockerFinding(
                    blockerId=str(b.get("blockerId") or ""),
                    type=str(b.get("type") or "unknown"),
                    summary=str(b.get("summary") or ""),
                    runId=str(b.get("runId") or ""),
                    timestamp=str(b.get("timestamp") or ""),
                    classifiedPattern=(
                        str(b["classifiedPattern"]) if b.get("classifiedPattern") else None
                    ),
                    sourceCitations=[str(v) for v in b.get("sourceCitations") or []],
                )
                for b in value.get("blockers") or []
                if isinstance(b, dict)
            ],
            patternCandidates=[
                PatternCandidate(
                    patternId=str(p.get("patternId") or ""),
                    name=str(p.get("name") or ""),
                    occurrenceCount=int(p.get("occurrenceCount") or 1),
                    firstSeen=str(p.get("firstSeen") or ""),
                    lastSeen=str(p.get("lastSeen") or ""),
                    samples=[str(v) for v in p.get("samples") or []],
                )
                for p in value.get("patternCandidates") or []
                if isinstance(p, dict)
            ],
            recommendation=str(value.get("recommendation") or ""),
            graphMemoryWritePlan=GraphMemoryWritePlan(
                status=str(plan.get("status") or "no_useful_finding"),
                runRecord=dict(plan["runRecord"]) if isinstance(plan.get("runRecord"), dict) else None,
                blockers=[dict(b) for b in plan.get("blockers") or [] if isinstance(b, dict)],
                patterns=[dict(p) for p in plan.get("patterns") or [] if isinstance(p, dict)],
                edges=[dict(e) for e in plan.get("edges") or [] if isinstance(e, dict)],
                reason=str(plan["reason"]) if plan.get("reason") else None,
            ),
            sourceCitations=[str(v) for v in value.get("sourceCitations") or []],
            activityEvents=[
                HermesActivityEntry(
                    id=str(a.get("id") or ""),
                    timestamp=str(a.get("timestamp") or ""),
                    type=str(a.get("type") or "idle"),
                    summary=str(a.get("summary") or ""),
                    detail=str(a["detail"]) if a.get("detail") else None,
                    thinkgraphNodeId=(
                        str(a["thinkgraphNodeId"]) if a.get("thinkgraphNodeId") else None
                    ),
                    runId=str(a["runId"]) if a.get("runId") else None,
                    featureId=str(a["featureId"]) if a.get("featureId") else None,
                )
                for a in value.get("activityEvents") or []
                if isinstance(a, dict)
            ],
            jobEvidence=dict(value.get("jobEvidence") or {}),
        )
