"""Focused tests for the reusable Follow-the-Money Issuer Case Loop.

Pure assembler with injected IO (no live providers, no graph writes, no orders, no scheduler).
Proves: same reusable path for two issuers, source identity/provenance preserved, honest
Alpaca-unavailable handling, supplemental seed behavior, no invented competitor tickers, and
read-only idempotence.

  py -3.12 -m pytest services/knowgraph/test_issuer_case_loop.py -q
"""
from __future__ import annotations

import issuer_case_loop as icl


def _issuer(node_id, ticker, cik):
    return {"id": node_id, "owlClass": "Issuer", "label": ticker,
            "properties": {"ticker": ticker, "cik": cik}}


def _ctx(node_id, owl, accession, form, item, url):
    return {"id": node_id, "owlClass": owl, "label": f"{owl} {item}",
            "properties": {"accessionNumber": accession, "formType": form, "sectionItemId": item,
                           "filingUrl": url, "summary": f"{owl} source-bound summary"}}


def _ev(node_id, accession, url):
    return {"id": node_id, "owlClass": "EvidenceSection",
            "properties": {"accessionNumber": accession, "filingUrl": url, "sectionItemId": "1"}}


# Two distinct issuers + an unrelated foreign context that must never leak across cases.
RDW_URL = "https://www.sec.gov/Archives/edgar/data/1819810/000181981026000029/rdw-20251231.htm"
RKLB_URL = "https://www.sec.gov/Archives/edgar/data/1819994/000181999426000013/rklb-20251231.htm"
RECORDS = [
    _issuer("kg:rdw", "RDW", "0001819810"),
    _issuer("kg:rklb", "RKLB", "0001819994"),
    _ctx("kg:rdw-biz", "BusinessContext", "0001819810-26-000029", "10-K", "1", RDW_URL),
    _ctx("kg:rdw-risk", "RiskContext", "0001819810-26-000029", "10-K", "1A", RDW_URL),
    _ctx("kg:rdw-mda", "ManagementDiscussionContext", "0001819810-26-040310", "10-Q", "part1item2", RDW_URL),
    _ev("kg:rdw-ev", "0001819810-26-000029", RDW_URL),
    _ctx("kg:rklb-biz", "BusinessContext", "0001819994-26-000013", "10-K", "1", RKLB_URL),
    _ctx("kg:rklb-risk", "RiskContext", "0001819994-26-000013", "10-K", "1A", RKLB_URL),
]
RELATIONSHIPS = [
    {"from": "kg:rdw", "to": "kg:rdw-biz", "type": "HAS_CONTEXT"},
    {"from": "kg:rdw", "to": "kg:rdw-risk", "type": "HAS_CONTEXT"},
    {"from": "kg:rdw", "to": "kg:rdw-mda", "type": "HAS_CONTEXT"},
    {"from": "kg:rdw-biz", "to": "kg:rdw-ev", "type": "SUPPORTED_BY"},
    {"from": "kg:rklb", "to": "kg:rklb-biz", "type": "HAS_CONTEXT"},
    {"from": "kg:rklb", "to": "kg:rklb-risk", "type": "HAS_CONTEXT"},
]


def _alpaca_available(ticker):
    return {"status": "available", "symbol": ticker, "provider": "alpaca",
            "fetchedAt": "2026-06-22T00:00:00Z", "latestTradePrice": 4.47}


def _alpaca_unconfigured(ticker):
    return {"status": "unconfigured", "symbol": ticker, "diagnostics": "alpaca paper credentials not configured"}


def _alpaca_error(ticker):
    return {"status": "error", "symbol": ticker, "diagnostics": "alpaca_request_failed: HTTPError"}


def _case(ticker, *, alpaca=_alpaca_available, seed=None):
    return icl.build_issuer_case(
        ticker, records=RECORDS, relationships=RELATIONSHIPS,
        alpaca_snapshot=alpaca, seed_context=seed or icl.SeedContextAdapter.unavailable())


def test_rdw_resolves_through_reusable_path():
    case = _case("RDW").to_dict()
    assert case["issuer_identity"]["resolution_status"] == "resolved"
    assert case["issuer_identity"]["ticker"] == "RDW"
    assert case["issuer_identity"]["cik"] == "0001819810"
    assert len(case["edgar_evidence"]["business"]) == 1
    assert len(case["edgar_evidence"]["risk"]) == 1
    assert len(case["edgar_evidence"]["capital_control_ownership"]) == 1  # MD&A


def test_second_issuer_replays_same_path_no_leakage():
    # identical reusable call, different issuer, no RDW data bleeding in
    rklb = _case("RKLB").to_dict()
    assert rklb["issuer_identity"]["ticker"] == "RKLB"
    assert rklb["issuer_identity"]["cik"] == "0001819994"
    biz = rklb["edgar_evidence"]["business"]
    assert len(biz) == 1
    # provenance points at RKLB's own filing, never RDW's
    assert biz[0]["provenance"]["source_identifier"] == "0001819994-26-000013"
    assert "1819994" in biz[0]["provenance"]["source_url_or_provider_reference"]
    assert "1819810" not in json_dump(rklb)  # zero RDW accession leakage


def test_edgar_evidence_preserves_filing_identity_and_never_derives_date_from_accession():
    case = _case("RDW").to_dict()
    prov = case["edgar_evidence"]["business"][0]["provenance"]
    assert prov["source_kind"] == icl.SOURCE_EDGAR
    assert prov["source_identifier"] == "0001819810-26-000029"
    assert prov["source_url_or_provider_reference"].startswith("https://www.sec.gov/")
    # SPEC date rule: an EDGAR accession year is NEVER an effective/as-of/period date. The stored
    # node carries no source filing date, so this stays empty (the Catalyst date layer resolves a
    # real filed_at/period_end from a live filing signal instead).
    assert prov["effective_or_as_of_date"] == ""
    assert "2026" not in prov["effective_or_as_of_date"]
    assert case["edgar_evidence"]["filings"][0]["accession"] == "0001819810-26-000029"


def test_alpaca_failure_is_unknown_never_false_not_tradeable():
    for fn in (_alpaca_unconfigured, _alpaca_error):
        case = _case("RDW", alpaca=fn).to_dict()
        assert case["tradability"]["status"] == icl.TRADE_UNKNOWN
        assert case["tradability"]["status"] != "not_tradeable"
    ok = _case("RDW", alpaca=_alpaca_available).to_dict()
    assert ok["tradability"]["status"] == icl.TRADE_KNOWN


def test_seed_is_supplemental_and_never_overwrites_edgar():
    seed = icl.SeedContextAdapter(
        fixture={"RDW": [{"Owner": "The Vanguard Group", "Ownership Type": "passive_index",
                          "Updated": "8/8/2023", "_source_locator": "Follow The Money!Master!row42"}]},
        source_name="Follow The Money Master Sheet")
    case = _case("RDW", seed=seed).to_dict()
    assert case["follow_the_money_context"]["status"] == icl.SEED_FOUND
    item = case["follow_the_money_context"]["items"][0]
    # raw preserved, marked UNVERIFIED — not promoted to a verified fact
    assert item["raw"]["Owner"] == "The Vanguard Group"
    assert item["provenance"]["verification_state"] == "unverified_seed"
    assert item["provenance"]["source_kind"] == icl.SOURCE_SEED
    # EDGAR business evidence is untouched and still source-backed
    assert case["edgar_evidence"]["business"][0]["provenance"]["source_kind"] == icl.SOURCE_EDGAR


def test_no_seed_crossover_is_honest():
    case = _case("RKLB").to_dict()  # default adapter is unavailable
    assert case["follow_the_money_context"]["status"] == icl.SEED_UNAVAILABLE
    seed2 = icl.SeedContextAdapter(fixture={"RDW": [{"Owner": "x"}]}, source_name="s")
    case2 = _case("RKLB", seed=seed2).to_dict()  # ticker present but no RKLB row
    assert case2["follow_the_money_context"]["status"] == icl.SEED_NOT_FOUND


def test_competitor_handling_never_invents_a_ticker_and_stays_unresolved():
    case = _case("RDW").to_dict()
    ch = case["competitor_handling"]
    assert ch["resolution"] == "unresolved"
    assert ch["candidates"] == []  # nothing fabricated
    # the competitor *evidence location* is the source-backed business section
    assert ch["source_locations"][0]["source_kind"] == icl.SOURCE_EDGAR
    assert "ticker" not in json_dump(ch).lower() or "invent" in ch["note"].lower()


def test_unresolved_issuer_is_honest_not_invented():
    case = _case("ZZZZ").to_dict()
    assert case["issuer_identity"]["resolution_status"] == "unresolved"
    assert case["issuer_identity"]["ticker"] == ""
    assert case["tradability"]["status"] == icl.TRADE_UNKNOWN


def test_repeated_assembly_is_idempotent_read_only():
    # Pure read-model: no graph writes happen, so duplication/overwrite is impossible by
    # construction. With a fixed retrieval timestamp the assembly is byte-identical (no drift).
    kw = dict(records=RECORDS, relationships=RELATIONSHIPS, alpaca_snapshot=_alpaca_available,
              seed_context=icl.SeedContextAdapter.unavailable(), retrieved_at="2026-06-22T00:00:00Z")
    a = icl.build_issuer_case("RDW", **kw).to_dict()
    b = icl.build_issuer_case("RDW", **kw).to_dict()
    assert a == b


def test_source_role_distinctions_remain_visible():
    case = _case("RDW").to_dict()
    roles = case["source_roles"]
    assert roles[icl.SOURCE_EDGAR] == "primary_source_backed"
    assert roles[icl.SOURCE_ALPACA] in (icl.TRADE_KNOWN, icl.TRADE_UNKNOWN)
    assert roles[icl.SOURCE_SEED] in (icl.SEED_FOUND, icl.SEED_NOT_FOUND, icl.SEED_UNAVAILABLE, icl.SEED_UNRESOLVED)
    assert icl.SOURCE_EXTERNAL in roles


def test_no_score_no_verdict_no_order_no_scheduler_in_output():
    case = _case("RDW").to_dict()
    blob = json_dump(case).lower()
    for banned in ("buy_score", "money_score", "rug_pull", "recommend", "long/short",
                   "place_order", "submit_order", "schedule", "cron", "kronos"):
        assert banned not in blob


def json_dump(obj):
    import json
    return json.dumps(obj, default=str)
