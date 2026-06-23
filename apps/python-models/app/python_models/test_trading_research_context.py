"""Coverage for the non-executing TradingResearchContextProposal."""

from app.python_models.sec_filing_signals import GraphRawRef
from app.python_models.trading_research_context import (
    build_trading_research_context_proposal,
    represented_raw_refs,
    validate_trading_research_context_proposal,
)


def _proposal(**over):
    base = dict(
        proposal_id="trc-1",
        project_id="20ac92da",
        purpose="Use selected RDW bars + a selected RDW 8-K as research context",
        selected_by="user",
        selection_reason="user explicitly selected this evidence",
        requested_research_output="thesis summary",
        selected_market_observation_refs=["alpaca:snapshot:RDW:2024-05-10"],
        selected_filing_signal_refs=["sec_api:0001628280-24-000001:8-K"],
    )
    base.update(over)
    return build_trading_research_context_proposal(**base)


def test_valid_proposal_with_explicit_selection_and_empty_knowgraph():
    proposal = _proposal(explicit_thinkgraph_refs=[GraphRawRef("thinkgraph", "tg:task-1")])
    assert proposal.explicitKnowGraphRefs == []  # opt-in only
    assert validate_trading_research_context_proposal(proposal) == {"ok": True, "errors": []}


def test_requires_at_least_one_explicit_selection():
    proposal = _proposal(selected_market_observation_refs=[], selected_filing_signal_refs=[])
    result = validate_trading_research_context_proposal(proposal)
    assert result["ok"] is False
    assert any("at least one explicit" in e for e in result["errors"])


def test_requires_identity_and_rationale():
    assert validate_trading_research_context_proposal(_proposal(proposal_id=""))["ok"] is False
    assert validate_trading_research_context_proposal(_proposal(selection_reason=""))["ok"] is False


def test_rejects_unknown_selected_by():
    assert validate_trading_research_context_proposal(_proposal(selected_by="robot"))["ok"] is False


def test_rejects_cross_store_ref_mixing():
    proposal = _proposal(explicit_thinkgraph_refs=[GraphRawRef("knowgraph", "kg:x")])
    assert validate_trading_research_context_proposal(proposal)["ok"] is False


def test_preserves_reversible_graph_refs():
    proposal = _proposal(
        explicit_knowgraph_refs=[GraphRawRef("knowgraph", "kg:rdw")],
        explicit_thinkgraph_refs=[GraphRawRef("thinkgraph", "tg:approval-1")],
        code_graph_scope={"representedRawNodeIds": ["cg:101", "cg:102"]},
    )
    refs = represented_raw_refs(proposal)
    assert GraphRawRef("knowgraph", "kg:rdw") in refs
    assert GraphRawRef("thinkgraph", "tg:approval-1") in refs
    assert GraphRawRef("codegraph", "cg:101") in refs


def test_proposal_does_not_auto_promote_to_knowgraph_or_start_work():
    # A trading research context with selected signals must NOT auto-attach KnowGraph
    # evidence and must remain in 'draft' until an explicit later workflow advances it.
    proposal = _proposal()
    assert proposal.explicitKnowGraphRefs == []
    assert proposal.approvalState == "draft"
    assert proposal.codeGraphScope is None
