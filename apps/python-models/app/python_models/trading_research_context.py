"""TradingResearchContextProposal — explicit, non-executing research/paper context.

Lets a future USER-APPROVED workflow say "use these selected Alpaca observations and
this selected SEC filing signal as the evidence context for a research / Coder /
paper-experiment task" — without doing any of it now.

Creating a proposal writes nothing: no KnowGraph node, no ThinkGraph task, no agent
run, no Coder call, no paper experiment, no trade. Selections are explicit references
only; KnowGraph refs default to empty (knowledge is opt-in); every selected existing
graph reference preserves its graph kind + raw id (reversible). No cross-store merge,
no bridge inference, no global trading context.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Optional

from app.python_models.sec_filing_signals import APPROVAL_STATES, GraphRawRef

SELECTED_BY = ("user", "approved_workflow")


@dataclass(frozen=True)
class TradingResearchContextProposal:
    proposalId: str
    projectId: str
    purpose: str
    selectedBy: str  # user | approved_workflow
    selectionReason: str
    requestedResearchOutput: str
    taskId: Optional[str] = None
    approvalState: str = "draft"
    # Explicit selected provider observations (opaque provider refs — NOT auto-graph).
    selectedMarketObservationRefs: list[str] = field(default_factory=list)
    selectedFilingSignalRefs: list[str] = field(default_factory=list)
    # Explicit existing-graph references (reversible). KnowGraph may be empty.
    explicitKnowGraphRefs: list[GraphRawRef] = field(default_factory=list)
    explicitThinkGraphRefs: list[GraphRawRef] = field(default_factory=list)
    codeGraphScope: Optional[dict[str, Any]] = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def represented_raw_refs(proposal: TradingResearchContextProposal) -> list[GraphRawRef]:
    """Every existing-graph reference the proposal represents, preserving kind + id."""
    refs: list[GraphRawRef] = []
    refs.extend(proposal.explicitThinkGraphRefs)
    refs.extend(proposal.explicitKnowGraphRefs)
    scope = proposal.codeGraphScope or {}
    for raw_id in scope.get("representedRawNodeIds", []) or []:
        refs.append(GraphRawRef("codegraph", str(raw_id)))
    return refs


def build_trading_research_context_proposal(
    *,
    proposal_id: str,
    project_id: str,
    purpose: str,
    selected_by: str,
    selection_reason: str,
    requested_research_output: str,
    selected_market_observation_refs: Optional[list[str]] = None,
    selected_filing_signal_refs: Optional[list[str]] = None,
    explicit_knowgraph_refs: Optional[list[GraphRawRef]] = None,
    explicit_thinkgraph_refs: Optional[list[GraphRawRef]] = None,
    code_graph_scope: Optional[dict[str, Any]] = None,
    task_id: Optional[str] = None,
    approval_state: str = "draft",
) -> TradingResearchContextProposal:
    """Build a non-executing trading-research context proposal. Performs no writes and
    starts nothing. KnowGraph refs default to empty (opt-in only)."""
    return TradingResearchContextProposal(
        proposalId=str(proposal_id),
        projectId=str(project_id),
        purpose=str(purpose),
        selectedBy=str(selected_by),
        selectionReason=str(selection_reason),
        requestedResearchOutput=str(requested_research_output),
        taskId=(str(task_id) if task_id else None),
        approvalState=str(approval_state),
        selectedMarketObservationRefs=[str(r).strip() for r in (selected_market_observation_refs or []) if str(r).strip()],
        selectedFilingSignalRefs=[str(r).strip() for r in (selected_filing_signal_refs or []) if str(r).strip()],
        explicitKnowGraphRefs=list(explicit_knowgraph_refs or []),
        explicitThinkGraphRefs=list(explicit_thinkgraph_refs or []),
        codeGraphScope=code_graph_scope,
    )


def validate_trading_research_context_proposal(
    proposal: TradingResearchContextProposal,
) -> dict[str, Any]:
    """Validate the proposal. Requires explicit identity + rationale, a known
    ``selectedBy``, at least one explicitly selected market/filing reference, a declared
    approvalState, and well-formed reversible graph refs whose kind matches the bucket.
    Empty KnowGraph refs are valid. Returns ``{ok, errors}``."""
    errors: list[str] = []
    if not isinstance(proposal, TradingResearchContextProposal):
        return {"ok": False, "errors": ["proposal_missing"]}
    for key in ("proposalId", "projectId", "purpose", "selectionReason", "requestedResearchOutput"):
        if not str(getattr(proposal, key) or "").strip():
            errors.append(f"{key} required")
    if proposal.selectedBy not in SELECTED_BY:
        errors.append(f"selectedBy must be one of {'|'.join(SELECTED_BY)}")
    if proposal.approvalState not in APPROVAL_STATES:
        errors.append("approvalState must be a declared workflow state")
    if not proposal.selectedMarketObservationRefs and not proposal.selectedFilingSignalRefs:
        errors.append("at least one explicit market-observation or filing-signal ref required")
    for bucket, kind in (
        (proposal.explicitThinkGraphRefs, "thinkgraph"),
        (proposal.explicitKnowGraphRefs, "knowgraph"),
    ):
        for i, ref in enumerate(bucket):
            if not isinstance(ref, GraphRawRef) or ref.graphKind != kind:
                errors.append(f"{kind}Refs[{i}] must have graphKind '{kind}'")
            elif not str(ref.rawId or "").strip():
                errors.append(f"{kind}Refs[{i}] requires explicit rawId")
    return {"ok": not errors, "errors": errors}
