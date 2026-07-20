"""Hermes completed-job review — SCAFFOLD ONLY, not yet connected.

One future capability, one name:

    Coder or Mag One completes work
    → real artifacts exist in a completed job folder
    → Hermes reviews the folder
    → Main uses the review to decide the next iteration

The runtime is intentionally NOT built yet. This single file replaces the twelve
earlier fragmented review attempts (separate Coder-review / Mag-One-review /
postflight / route / MCP / activity implementations). It fails honestly when
called rather than pretending the review system works.

Status: completed-job review is scaffolded; it is NOT connected. The Coder and
Mag One completion triggers are TODO. The first end-to-end review test has not
happened. Do not treat this as live, automatic, or tested.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class ReviewResult:
    """The single planned result of reviewing one completed job folder.

    Contract only — no evaluation logic produces these fields yet. There is one
    result shape (never separate Coder and Mag One schemas).
    """

    verdict: str = ""
    summary: str = ""
    completed_work: list[str] = field(default_factory=list)
    evidence: list[str] = field(default_factory=list)
    missing_evidence: list[str] = field(default_factory=list)
    blockers: list[str] = field(default_factory=list)
    recommended_next_action: str = ""
    artifact_references: list[str] = field(default_factory=list)


def review_completed_job(
    job_folder: Any,
    parent_context: Optional[dict[str, Any]] = None,
) -> ReviewResult:
    """Review one server-resolved completed job folder → one ``ReviewResult``.

    SCAFFOLD ONLY — not connected. There is no Coder trigger, no Mag One trigger,
    no artifact evaluation, no ThinkGraph write, no memory write, and no model
    call. It raises rather than returning a fabricated review.

    Invocation boundary: one MCP tool (hermes_review_completed_job) dispatches
    here. There is no HTTP review family, no producer selector, no reviewType.

    TODO (do not implement until the first Coder and Mag One runs are ready):
      1. Implement completed-folder artifact inspection.
      2. Produce the single ReviewResult.
      3. Grant hermes_review_completed_job to Hermes when ready.
      4. Trigger or call the same MCP tool after durable Coder or Mag One completion.
      5. Run the first real end-to-end result review.
      6. Let Main decide what, if anything, enters ThinkGraph.
    """
    raise NotImplementedError(
        "Hermes completed-job review is scaffolded but not yet connected."
    )
