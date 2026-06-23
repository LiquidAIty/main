"""Focused coverage for the SEC API WorldSignals provider + research handoff.

No live network: every "available" path runs against an explicitly labeled PROTOCOL
FIXTURE injected as the transport. The no-key, error, and invalid-shape paths run with
no transport at all. No real SEC data, no graph writes, no API key in any output.
"""

import json

import pytest

from app.python_models.sec_filing_signals import (
    GraphRawRef,
    IssuerRef,
    SecFilingQuery,
    SecFilingResearchProposal,
    STATUS_AVAILABLE,
    STATUS_ERROR,
    STATUS_INVALID,
    STATUS_UNCONFIGURED,
    build_research_proposal,
    find_recent_sec_filing_signals,
    validate_research_proposal,
)

# PROTOCOL FIXTURE — shape of a sec-api.io Query API response. This is a recorded
# protocol fixture for mapping tests, NOT live SEC data and NOT a live provider.
SEC_API_PROTOCOL_FIXTURE = {
    "total": {"value": 2, "relation": "eq"},
    "filings": [
        {
            "accessionNo": "0001628280-24-000001",
            "formType": "8-K",
            "filedAt": "2024-05-10T16:30:00-04:00",
            "periodOfReport": "2024-05-10",
            "ticker": "RDW",
            "cik": "1819810",
            "companyName": "Redwire Corp",
            "linkToFilingDetails": "https://www.sec.gov/Archives/edgar/data/1819810/000162828024000001/0001628280-24-000001-index.htm",
            "linkToHtml": "https://www.sec.gov/Archives/edgar/data/1819810/000162828024000001/rdw-8k.htm",
        },
        {
            "accessionNo": "0001628280-24-000002",
            "formType": "10-Q",
            "filedAt": "2024-05-08T16:00:00-04:00",
            "periodOfReport": "2024-03-31",
            "ticker": "RDW",
            "cik": "1819810",
            "companyName": "Redwire Corp",
            "linkToFilingDetails": "https://www.sec.gov/Archives/edgar/data/1819810/000162828024000002/0001628280-24-000002-index.htm",
            "linkToHtml": "https://www.sec.gov/Archives/edgar/data/1819810/000162828024000002/rdw-10q.htm",
        },
    ],
}


def _explicit_query(limit: int = 10) -> SecFilingQuery:
    return SecFilingQuery(
        issuer=IssuerRef(ticker="RDW"),
        formTypes=["8-K", "10-Q"],
        fromDate="2024-01-01",
        toDate="2024-12-31",
        limit=limit,
    )


def _fixture_transport(_key, _body):
    # Explicit recorded PROTOCOL FIXTURE — never a live source.
    return SEC_API_PROTOCOL_FIXTURE


# --- WorldSignalEnvelope / provider validation -----------------------------------


def test_explicit_issuer_is_required():
    with pytest.raises(ValueError):
        find_recent_sec_filing_signals(
            SecFilingQuery(issuer=IssuerRef(), formTypes=["8-K"], fromDate="2024-01-01", toDate="2024-12-31"),
            api_key="x",
        )


def test_form_types_and_window_required():
    with pytest.raises(ValueError):
        find_recent_sec_filing_signals(
            SecFilingQuery(issuer=IssuerRef(ticker="RDW"), formTypes=[], fromDate="2024-01-01", toDate="2024-12-31"),
            api_key="x",
        )
    with pytest.raises(ValueError):
        find_recent_sec_filing_signals(
            SecFilingQuery(issuer=IssuerRef(ticker="RDW"), formTypes=["8-K"], fromDate="2024-12-31", toDate="2024-01-01"),
            api_key="x",
        )


def test_limit_out_of_range_is_rejected():
    with pytest.raises(ValueError):
        find_recent_sec_filing_signals(_explicit_query(limit=0), api_key="x")
    with pytest.raises(ValueError):
        find_recent_sec_filing_signals(_explicit_query(limit=9999), api_key="x")


def test_no_key_returns_provider_unconfigured_without_calling_transport():
    calls = {"n": 0}

    def _never(_k, _b):
        calls["n"] += 1
        return {}

    result = find_recent_sec_filing_signals(_explicit_query(), transport=_never, api_key="")
    assert result.status == STATUS_UNCONFIGURED
    assert result.envelopes == []
    assert calls["n"] == 0  # no provider call when unconfigured
    assert result.error is None


def test_fixture_maps_to_typed_envelopes_with_canonical_sec_source():
    result = find_recent_sec_filing_signals(_explicit_query(), transport=_fixture_transport, api_key="TEST-KEY")
    assert result.status == STATUS_AVAILABLE
    assert len(result.envelopes) == 2
    first = result.envelopes[0]
    assert first.provider == "sec_api"
    assert first.signalType == "sec_filing_published"
    assert first.filing.accessionNumber == "0001628280-24-000001"
    assert first.filing.formType == "8-K"
    # canonical source is the original SEC.gov URL; sec_api is only a processing ref
    assert first.sourceRefs.originalSecFilingRef.startswith("https://www.sec.gov/")
    assert first.sourceRefs.providerResponseRef.startswith("sec_api:")
    assert first.replay.providerQueryId.startswith("sec_api:query:")


def test_bounded_result_limit_is_honored():
    result = find_recent_sec_filing_signals(_explicit_query(limit=1), transport=_fixture_transport, api_key="TEST-KEY")
    assert result.status == STATUS_AVAILABLE
    assert len(result.envelopes) == 1


def test_transport_failure_returns_provider_error():
    def _boom(_k, _b):
        raise RuntimeError("network down")

    result = find_recent_sec_filing_signals(_explicit_query(), transport=_boom, api_key="TEST-KEY")
    assert result.status == STATUS_ERROR
    assert result.envelopes == []
    assert "network down" not in (result.error or "")  # only a safe reason, not internals


def test_invalid_response_shape_is_reported_honestly():
    result = find_recent_sec_filing_signals(
        _explicit_query(), transport=lambda _k, _b: {"unexpected": True}, api_key="TEST-KEY"
    )
    assert result.status == STATUS_INVALID
    assert result.envelopes == []


def test_api_key_never_appears_in_output():
    secret = "TEST-SEC-TOKEN-DO-NOT-LEAK-abcdef123456"
    result = find_recent_sec_filing_signals(_explicit_query(), transport=_fixture_transport, api_key=secret)
    blob = json.dumps(result.to_dict())
    assert secret not in blob
    assert "token" not in blob.lower()


def test_incomplete_filing_record_is_skipped_not_fabricated():
    def _partial(_k, _b):
        return {"filings": [{"formType": "8-K"}]}  # missing accession/filedAt/url

    result = find_recent_sec_filing_signals(_explicit_query(), transport=_partial, api_key="TEST-KEY")
    assert result.status == STATUS_AVAILABLE
    assert result.envelopes == []  # skipped, never invented


# --- Selected-filing research proposal (non-executing handoff) --------------------


def _one_available_signal():
    result = find_recent_sec_filing_signals(_explicit_query(limit=1), transport=_fixture_transport, api_key="TEST-KEY")
    return result.envelopes[0]


def test_proposal_requires_an_available_filing_signal():
    bad = _one_available_signal()
    object.__setattr__(bad, "status", STATUS_UNCONFIGURED)  # simulate a non-available signal
    with pytest.raises(ValueError):
        build_research_proposal(
            bad, proposal_id="p1", task_id="t1", requested_research_output="summary", selection_reason="r"
        )


def test_proposal_defaults_to_empty_knowgraph_refs_and_validates():
    signal = _one_available_signal()
    proposal = build_research_proposal(
        signal,
        proposal_id="p1",
        task_id="t1",
        requested_research_output="extract risk factors",
        selection_reason="user explicitly selected this 8-K",
        explicit_thinkgraph_refs=[GraphRawRef("thinkgraph", "tg:task-1")],
    )
    assert proposal.selectedSignalRef == signal.signalId
    assert proposal.explicitKnowGraphRefs == []  # opt-in only
    assert validate_research_proposal(proposal) == {"ok": True, "errors": []}


def test_proposal_rejects_cross_store_ref_mixing():
    signal = _one_available_signal()
    proposal = build_research_proposal(
        signal,
        proposal_id="p1",
        task_id="t1",
        requested_research_output="x",
        selection_reason="r",
        explicit_thinkgraph_refs=[GraphRawRef("knowgraph", "kg:x")],  # wrong store
    )
    assert validate_research_proposal(proposal)["ok"] is False


def test_proposal_preserves_reversible_graph_refs():
    signal = _one_available_signal()
    proposal = build_research_proposal(
        signal,
        proposal_id="p1",
        task_id="t1",
        requested_research_output="x",
        selection_reason="r",
        explicit_knowgraph_refs=[GraphRawRef("knowgraph", "kg:rdw")],
        explicit_thinkgraph_refs=[GraphRawRef("thinkgraph", "tg:approval-1")],
    )
    assert proposal.explicitKnowGraphRefs[0].rawId == "kg:rdw"
    assert proposal.explicitThinkGraphRefs[0].graphKind == "thinkgraph"


# --- Static full-loop fixture: no automatic merge / write / research / trade ------


def test_static_full_loop_signal_does_not_auto_become_graph_task_or_trade():
    # 1. explicit issuer filing signal (from the protocol fixture)
    result = find_recent_sec_filing_signals(_explicit_query(), transport=_fixture_transport, api_key="TEST-KEY")
    assert result.status == STATUS_AVAILABLE and result.envelopes

    # 2. user selects ONE filing
    selected = result.envelopes[0]

    # 3. SecFilingResearchProposal — KnowGraph empty (no auto-attach from the ticker),
    #    only explicit ThinkGraph task/approval refs, code scope empty.
    proposal = build_research_proposal(
        selected,
        proposal_id="proposal-1",
        task_id="task-research-rdw-8k",
        requested_research_output="Summarize the 8-K material event",
        selection_reason="User explicitly selected this filing for research",
        requested_sections=["Item 8.01"],
        explicit_thinkgraph_refs=[
            GraphRawRef("thinkgraph", "tg:task-research-rdw-8k"),
            GraphRawRef("thinkgraph", "tg:approval-draft"),
        ],
    )

    # The signal did NOT automatically become a KnowGraph record, a ThinkGraph task,
    # a Coder task, a strategy context, or a trade.
    assert proposal.explicitKnowGraphRefs == []  # no KnowGraph promotion
    assert proposal.codeGraphScope is None  # no Coder code scope
    assert proposal.approvalState == "draft"  # nothing approved or executed
    assert validate_research_proposal(proposal) == {"ok": True, "errors": []}
    # selection stays reversible to the original filing
    assert proposal.selectedFilingRef == selected.filing.accessionNumber
    assert selected.sourceRefs.originalSecFilingRef.startswith("https://www.sec.gov/")
