"""Hermes completed-job review — scaffold only (not yet connected).

The twelve earlier fragmented review attempts (separate Coder-review,
Mag-One-review, postflight, route, MCP, and activity implementations) were
removed. This package now holds one scaffold function and its planned result
contract. See ``review_completed_job.py`` for status and the TODO list — the
review runtime is intentionally not built yet.
"""

from .review_completed_job import ReviewResult, review_completed_job

__all__ = [
    "ReviewResult",
    "review_completed_job",
]
