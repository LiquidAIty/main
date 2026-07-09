"""Hermes — the knowledge compounding agent's pure review protocol.

Hermes reviews CoderReports skeptically (a separate evaluator, never the
coder grading itself), preserves-or-marks-unknown blocker types, compounds
pattern occurrences over supplied ThinkGraph memory, and produces a
ThinkGraph write PLAN. Persistence happens only through the card's scoped
``apply_thinkgraph_patch`` authority — never from this package.

Import-light on purpose: contracts + pure logic only. No services, no DB
clients, no file writes at import time.
"""

from .graph_memory import blocked_write_plan, build_write_plan, to_thinkgraph_patch
from .protocol import (
    CODER_REPORT_FIELDS,
    HERMES_ACTIVITY_TYPES,
    HERMES_VERDICTS,
    THINKGRAPH_EDGE_TYPES,
    THINKGRAPH_NODE_TYPES,
    BlockerFinding,
    GraphMemoryWritePlan,
    HermesActivityEntry,
    HermesReview,
    HermesReviewInput,
    PatternCandidate,
    ProofQuality,
    RunRecord,
)
from .review import review_coder_report, review_run_result

__all__ = [
    "CODER_REPORT_FIELDS",
    "HERMES_ACTIVITY_TYPES",
    "HERMES_VERDICTS",
    "THINKGRAPH_EDGE_TYPES",
    "THINKGRAPH_NODE_TYPES",
    "BlockerFinding",
    "GraphMemoryWritePlan",
    "HermesActivityEntry",
    "HermesReview",
    "HermesReviewInput",
    "PatternCandidate",
    "ProofQuality",
    "RunRecord",
    "blocked_write_plan",
    "build_write_plan",
    "review_coder_report",
    "review_run_result",
    "to_thinkgraph_patch",
]
