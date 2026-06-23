"""Focused tests for the hardened Catalyst Research Case.

Proves: filing-family date semantics (10-K/10-Q period_end vs 8-K reported_event, never crossed);
filed date distinct from report/event date; event_effective stays empty unless source-supported;
unknown form preserves the raw period without false mapping; an accession year never creates a date;
the Alpaca import is clean (no sys.path mutation, no sys.modules purge, no neo4j_graphrag); the case
exposes structural open_evidence_gaps (not generated research questions); the schema carries no
recommendation/direction/score/order/strategy/portfolio field; no Alpaca order method exists; seed
stays supplemental + unverified; RDW and RKLB replay through the same path; refresh is idempotent.

  apps/python-models/.venv/Scripts/python.exe -m pytest services/knowgraph/test_catalyst_research_case.py -q
"""
from __future__ import annotations

import json

import catalyst_research_case as crc
import issuer_case_loop as icl

RDW_URL = "https://www.sec.gov/Archives/edgar/data/1819810/000181981026000029/rdw-20251231.htm"
RKLB_URL = "https://www.sec.gov/Archives/edgar/data/1819994/000181999426000013/rklb-20251231.htm"


def _issuer(node_id, ticker, cik, name):
    return {"id": node_id, "owlClass": "Issuer", "label": ticker,
            "properties": {"ticker": ticker, "cik": cik, "name": name}}


def _ctx(node_id, owl, accession, form, item, url):
    return {"id": node_id, "owlClass": owl, "label": f"{owl} {item}",
            "properties": {"accessionNumber": accession, "formType": form, "sectionItemId": item,
                           "filingUrl": url, "summary": f"{owl} summary", "seededAt": "2026-06-21T05:03:44.924Z"}}


RECORDS = [
    _issuer("kg:rdw", "RDW", "0001819810", "Redwire Corporation"),
    _issuer("kg:rklb", "RKLB", "0001819994", "Rocket Lab Corporation"),
    _ctx("kg:rdw-biz", "BusinessContext", "0001819810-26-000029", "10-K", "1", RDW_URL),
    _ctx("kg:rdw-risk", "RiskContext", "0001819810-26-000029", "10-K", "1A", RDW_URL),
    _ctx("kg:rklb-biz", "BusinessContext", "0001819994-26-000013", "10-K", "1", RKLB_URL),
]
RELATIONSHIPS = [
    {"from": "kg:rdw", "to": "kg:rdw-biz", "type": "HAS_CONTEXT"},
    {"from": "kg:rdw", "to": "kg:rdw-risk", "type": "HAS_CONTEXT"},
    {"from": "kg:rklb", "to": "kg:rklb-biz", "type": "HAS_CONTEXT"},
]


def _alpaca_available(ticker):
    return {"status": "available", "symbol": ticker, "provider": "alpaca", "feed": "iex",
            "fetchedAt": "2026-06-22T14:00:00Z", "observedAt": "2026-06-22T13:59:00Z",
            "latestTradePrice": 13.44, "latestQuoteBid": 13.4, "latestQuoteAsk": 13.5}


def _alpaca_unconfigured(ticker):
    return {"status": "provider_unconfigured", "symbol": ticker,
            "diagnostics": "alpaca paper credentials not configured"}


def _alpaca_module_unavailable(ticker):
    return {"status": "unconfigured", "symbol": ticker, "diagnostics": "alpaca_module_unavailable:boom"}


# Real-shaped dated envelopes. 10-K periodOfReport = financial period end; 8-K periodOfReport =
# date of report; one unknown form (S-1) with a raw period; one 10-K missing both dates.
def _filing_signals(ticker, cik):
    table = {
        "RDW": [
            {"accession": "0001819810-26-000029", "formType": "10-K", "filedAt": "2026-02-27T17:15:43-05:00",
             "periodOfReport": "2025-12-31", "filingUrl": RDW_URL, "providerRef": "sec_api:029",
             "observedAt": "2026-02-27T17:15:43-05:00", "provider": "sec_api"},
            {"accession": "0001819810-26-000081", "formType": "8-K", "filedAt": "2026-06-18T16:17:04-04:00",
             "periodOfReport": "2026-06-18", "filingUrl": RDW_URL, "providerRef": "sec_api:081",
             "observedAt": "2026-06-18T16:17:04-04:00", "provider": "sec_api"},
            {"accession": "0001819810-26-000090", "formType": "S-1", "filedAt": "2026-06-20T09:00:00-04:00",
             "periodOfReport": "2026-01-01", "filingUrl": RDW_URL, "providerRef": "sec_api:090",
             "observedAt": "2026-06-20T09:00:00-04:00", "provider": "sec_api"},
            {"accession": "0001819810-26-000099", "formType": "10-K", "filedAt": "", "periodOfReport": "",
             "filingUrl": RDW_URL, "providerRef": "sec_api:099", "observedAt": "", "provider": "sec_api"},
        ],
        "RKLB": [
            {"accession": "0001819994-26-000013", "formType": "10-K", "filedAt": "2026-02-20T16:00:00-05:00",
             "periodOfReport": "2025-12-31", "filingUrl": RKLB_URL, "providerRef": "sec_api:013",
             "observedAt": "2026-02-20T16:00:00-05:00", "provider": "sec_api"},
            {"accession": "0001819994-26-000040", "formType": "8-K", "filedAt": "2026-05-10T08:00:00-04:00",
             "periodOfReport": "2026-05-09", "filingUrl": RKLB_URL, "providerRef": "sec_api:040",
             "observedAt": "2026-05-10T08:00:00-04:00", "provider": "sec_api"},
        ],
    }
    return {"status": "available", "fetchedAt": "2026-06-22T14:00:00Z",
            "envelopes": table.get(ticker.upper(), []), "error": ""}


def _seed_found(**kw):
    ticker = kw.get("ticker", "")
    rows = {"RDW": [{"source_id": "seed_atlas::x::abc123", "configured_locator": "~/atlas.xlsx",
                     "workbook": "atlas.xlsx", "worksheet": "Institutional Managers", "row_index": 11,
                     "workbook_modified_at": "2026-06-01T00:00:00Z", "workbook_fingerprint": "f" * 64,
                     "relationship_kind": "reported_institutional_position", "matched_on": "ticker:RDW@col0",
                     "raw": {"Ticker": "RDW", "Owner": "The Vanguard Group"}, "raw_cells": ["RDW", "Vanguard"],
                     "source_as_of": "8/8/2023", "imported_at": "2026-06-22T14:00:00Z",
                     "verification_state": "unverified_seed"}]}
    items = rows.get(ticker.upper(), [])
    return ({"status": "seed_context_found", "workbook": "atlas.xlsx", "source_id": "seed_atlas::x::abc123",
             "workbook_fingerprint": "f" * 64, "items": items} if items
            else {"status": "seed_context_not_found", "items": [], "workbook": "atlas.xlsx"})


def _seed_unavailable(**kw):
    return {"status": "seed_context_unavailable", "items": [], "reason_code": "seed_atlas_path_not_configured",
            "reason": "SEED_ATLAS_PATH is not configured", "workbook": ""}


def _forecast_persisted(ticker, cik):
    return {"status": "available", "items": [{"model": "kronos", "model_family": "kronos", "version": "v1",
                                              "horizon": "5", "target": "close",
                                              "generated_at": "2026-06-22T12:00:00Z", "source_run_id": "run_123"}]}


def _case(ticker, *, alpaca=_alpaca_available, filing=_filing_signals, seed=_seed_found,
          bars=None, forecast=None):
    return crc.build_catalyst_research_case(
        ticker, records=RECORDS, relationships=RELATIONSHIPS, alpaca_snapshot=alpaca,
        seed_lookup=seed, filing_signals=filing, alpaca_bars=bars, forecast_lookup=forecast,
        retrieved_at="2026-06-22T14:00:00Z")


def _json(obj):
    return json.dumps(obj, default=str)


def _filing(case, accession):
    return next(o for o in case["dynamic_observations"]["edgar_filings"] if o["source_identifier"] == accession)


def _all_keys(obj):
    keys = set()
    if isinstance(obj, dict):
        for k, v in obj.items():
            keys.add(k)
            keys |= _all_keys(v)
    elif isinstance(obj, list):
        for v in obj:
            keys |= _all_keys(v)
    return keys


# --- date semantics (requirement 1 + 2) -----------------------------------------------------
def test_period_form_maps_source_period_to_period_end_date():
    f = _filing(_case("RDW").to_dict(), "0001819810-26-000029")  # 10-K
    assert f["form_type"] == "10-K"
    assert f["source_period_of_report"] == "2025-12-31"
    assert f["period_end_date"] == "2025-12-31"
    assert f["reported_event_date"] == ""
    assert f["display_date"] == "2025-12-31"
    assert f["display_date_kind"] == crc.DATE_PERIOD_END


def test_8k_maps_to_reported_event_date_never_period_end():
    f = _filing(_case("RDW").to_dict(), "0001819810-26-000081")  # 8-K
    assert f["form_type"] == "8-K"
    assert f["source_period_of_report"] == "2026-06-18"
    assert f["reported_event_date"] == "2026-06-18"
    assert f["period_end_date"] == ""                      # NEVER period_end for an event filing
    assert f["display_date_kind"] == crc.DATE_REPORTED_EVENT
    assert f["display_date_kind"] != crc.DATE_PERIOD_END


def test_filed_date_distinct_from_report_and_event_date():
    f = _filing(_case("RDW").to_dict(), "0001819810-26-000081")
    assert f["filed_at"] == "2026-06-18T16:17:04-04:00"
    assert f["filed_at"] != f["reported_event_date"]      # acceptance datetime vs event date
    tenk = _filing(_case("RDW").to_dict(), "0001819810-26-000029")
    assert tenk["filed_at"] == "2026-02-27T17:15:43-05:00"
    assert tenk["filed_at"] != tenk["period_end_date"]


def test_event_effective_stays_empty_without_explicit_source_support():
    case = _case("RDW").to_dict()
    for o in case["dynamic_observations"]["edgar_filings"]:
        assert o["event_effective_at"] == ""


def test_unknown_form_preserves_raw_period_without_false_mapping():
    f = _filing(_case("RDW").to_dict(), "0001819810-26-000090")  # S-1 (unknown form)
    assert f["form_type"] == "S-1"
    assert f["source_period_of_report"] == "2026-01-01"   # raw period preserved
    assert f["period_end_date"] == ""                     # not mapped
    assert f["reported_event_date"] == ""                 # not mapped
    assert f["display_date_kind"] in (crc.DATE_FILED, crc.DATE_RETRIEVED, crc.DATE_UNKNOWN)
    assert "unknown_form_period_semantics" in f["date_reason_when_unknown"]


def test_accession_year_cannot_create_any_date_field():
    f = _filing(_case("RDW").to_dict(), "0001819810-26-000099")  # 10-K with NO filed/period date
    assert f["period_end_date"] == ""
    assert f["reported_event_date"] == ""
    assert f["filed_at"] == ""
    # the accession year segment ("26") and "2026" must never appear as a fabricated date
    assert f["display_date"] != "2026"
    assert f["display_date_kind"] == crc.DATE_RETRIEVED   # honest fallback, not an accession-derived date
    assert f["period_end_date"] != "2026" and f["source_period_of_report"] != "2026"


def test_filing_section_join_uses_family_typed_date_not_accession_year():
    case = _case("RDW").to_dict()
    sec = next(o for o in case["dynamic_observations"]["edgar_filing_sections"]
               if o["source_identifier"] == "0001819810-26-000029")
    assert sec["form_type"] == "10-K"
    assert sec["period_end_date"] == "2025-12-31"          # recovered via join, not derived
    assert sec["display_date_kind"] == crc.DATE_PERIOD_END
    assert sec["display_date"] != "2026"


# --- import boundary (requirement 3) --------------------------------------------------------
def test_normal_alpaca_import_no_syspath_or_modules_mutation():
    import sys

    before_path = list(sys.path)
    before_mods = set(sys.modules)
    amd = icl.import_app_python_models_module("alpaca_market_data")
    assert hasattr(amd, "get_market_snapshot")
    assert sys.path == before_path                         # no sys.path mutation by the importer
    assert before_mods - set(sys.modules) == set()         # no sys.modules purge
    assert "neo4j_graphrag" not in sys.modules             # market path needs no GraphRAG


def test_no_alpaca_order_method_exists():
    amd = icl.import_app_python_models_module("alpaca_market_data")
    for method in ("submit_order", "place_order", "create_order", "cancel_order", "close_position"):
        assert not hasattr(amd, method)                    # structurally cannot place an order


# --- open evidence gaps (requirement 5) -----------------------------------------------------
def test_case_exposes_structural_open_evidence_gaps_not_research_questions():
    case = _case("RDW").to_dict()
    assert "research_questions" not in case
    assert "open_evidence_gaps" in case
    assert case["open_evidence_gaps"]
    gap_fields = {"gap_kind", "issuer_or_entity_ref", "related_source_refs", "reason_code",
                  "severity_or_priority", "status"}
    for g in case["open_evidence_gaps"]:
        assert set(g.keys()) == gap_fields                 # typed record, exact schema
        assert "question" not in g                          # not a generated natural-language question
        assert g["status"] == "open"


def test_open_evidence_gap_kinds_are_from_the_allowed_structural_set():
    case = _case("RDW", seed=_seed_found, forecast=None).to_dict()
    allowed = {crc.GAP_RECENT_FILING_NOT_EXTRACTED, crc.GAP_UNRESOLVED_RELATED_ENTITY,
               crc.GAP_UNVERIFIED_SEED_CONTEXT, crc.GAP_MARKET_PROVIDER_UNAVAILABLE,
               crc.GAP_FORECAST_NOT_PERSISTED, crc.GAP_NEWS_NOT_INTEGRATED,
               crc.GAP_PATENT_NOT_INTEGRATED, crc.GAP_CONTRACT_NOT_INTEGRATED, crc.GAP_ISSUER_UNRESOLVED}
    kinds = {g["gap_kind"] for g in case["open_evidence_gaps"]}
    assert kinds <= allowed
    assert crc.GAP_UNVERIFIED_SEED_CONTEXT in kinds        # seed found => unverified-seed gap
    assert crc.GAP_FORECAST_NOT_PERSISTED in kinds


# --- structural (not lexical) safety proofs (requirement 6) ----------------------------------
def test_schema_has_no_recommendation_direction_score_order_strategy_field():
    keys = _all_keys(_case("RDW", forecast=_forecast_persisted).to_dict())
    forbidden = ("recommend", "direction", "score", "order", "strateg", "portfolio",
                 "buy", "sell", "verdict", "long_short", "trade_action")
    offenders = [k for k in keys if any(tok in k.lower() for tok in forbidden)]
    assert offenders == []


def test_dynamic_observations_remain_observations():
    case = _case("RDW").to_dict()
    obs = (case["dynamic_observations"]["edgar_filings"] + case["dynamic_observations"]["edgar_filing_sections"]
           + case["dynamic_observations"]["alpaca_market"])
    assert obs
    for o in obs:
        assert "source_kind" in o and "display_date_kind" in o      # it is an observation
        assert not any(tok in k.lower() for k in o for tok in ("recommend", "score", "direction", "order"))


def test_seed_context_remains_supplemental_unverified():
    case = _case("RDW").to_dict()
    seed = case["persistent_context"]["follow_the_money_seed"]
    assert seed["status"] == "seed_context_found"
    rows = [r for rows in seed["by_relationship_kind"].values() for r in rows]
    assert rows and all(r["verification_state"] == "unverified_seed" for r in rows)


def test_alpaca_failure_is_unknown_never_not_tradeable():
    for fn, expect in ((_alpaca_unconfigured, crc.TRADE_UNCONFIGURED),
                       (_alpaca_module_unavailable, crc.TRADE_PROVIDER_UNAVAILABLE)):
        case = _case("RDW", alpaca=fn).to_dict()
        status = case["case_identity"]["tradability"]["status"]
        assert status == expect and status != "not_tradeable"
        assert case["dynamic_observations"]["counts"]["alpaca_market"] == 0
    ok = _case("RDW", alpaca=_alpaca_available).to_dict()
    assert ok["case_identity"]["tradability"]["status"] == crc.TRADE_KNOWN
    assert ok["dynamic_observations"]["counts"]["alpaca_market"] == 1


# --- forecast attaches only when persisted ---------------------------------------------------
def test_forecast_attaches_only_when_persisted_contract_exists():
    none_case = _case("RDW", forecast=None).to_dict()
    assert none_case["dynamic_observations"]["counts"]["forecast"] == 0
    assert none_case["source_capability_audit"]["FORECAST"]["status"] == crc.FORECAST_NO_PERSISTED_CONTRACT
    persisted = _case("RDW", forecast=_forecast_persisted).to_dict()
    assert persisted["dynamic_observations"]["counts"]["forecast"] == 1
    assert persisted["source_capability_audit"]["FORECAST"]["status"] == "available"


# --- replay + idempotency (requirement 7) ----------------------------------------------------
def test_rdw_and_rklb_replay_same_path_no_leakage():
    rklb = _case("RKLB").to_dict()
    assert rklb["case_identity"]["issuer_identity"]["cik"] == "0001819994"
    blob = _json(rklb)
    assert "1819810" not in blob
    assert "0001819810-26-000029" not in blob
    rdw = _case("RDW").to_dict()
    assert _filing(rdw, "0001819810-26-000081")["display_date_kind"] == crc.DATE_REPORTED_EVENT


def test_repeated_assembly_is_idempotent_read_only():
    assert _case("RDW").to_dict() == _case("RDW").to_dict()


def test_unresolved_issuer_is_honest_not_invented():
    case = _case("ZZZZ").to_dict()
    assert case["case_identity"]["issuer_identity"]["resolution_status"] == "unresolved"
    assert case["case_identity"]["issuer_identity"]["ticker"] == ""
    assert case["open_evidence_gaps"][0]["gap_kind"] == crc.GAP_ISSUER_UNRESOLVED


def test_evidence_timeline_names_its_display_date_kind():
    case = _case("RDW").to_dict()
    assert case["evidence_timeline"]
    for e in case["evidence_timeline"]:
        assert "display_date_kind" in e and "date_precision" in e
    dated = [e["display_date"] for e in case["evidence_timeline"] if e["display_date_kind"] != crc.DATE_UNKNOWN]
    assert dated == sorted(dated, reverse=True)
