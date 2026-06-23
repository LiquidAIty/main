# @graph entity: Catalyst Research Case
# @graph role: source-aware-dynamic-observation-research-case-assembler
# @graph depends_on: Issuer Case Loop, SEC filing-signal source, Alpaca read-only market path, Seed Atlas source
# @graph feeds_to: later paper-thesis / trade-type experiment layer (out of scope here)
"""Catalyst Research Case — the source-aware research case that LATER experiment work can use.

Follow-the-Money is ONE contextual lens here, not the product. The product input is dynamic, dated,
source-backed observations. This assembler wraps the reusable Issuer Case Loop (identity, entity
resolution, stored EDGAR evidence, tradability) and layers four DISTINCT layers on top:

    1. dynamic_observations   — dated, source-backed: EDGAR filings + filing-section evidence and
                                Alpaca market snapshot / bars. Each carries STRICT date provenance
                                by filing family (period_end vs reported_event vs unknown).
    2. persistent_context     — supplemental seed-atlas enrichment, every row UNVERIFIED.
    3. derived research        — explainable derived relationships + STRUCTURAL open_evidence_gaps
                                (typed records, never generated trading advice). No score/direction.
    4. later experiment layer  — thesis / trade-type / paper portfolio. OUT OF SCOPE here.

Hard rules enforced: never derive a date from an accession number / ticker / URL filename / current
time / filing year; an 8-K period-of-report is a reported_event_date, NEVER a period_end_date; never
label retrieval/import time as a source event time; never invent a ticker; seed stays supplemental
and unverified; no score, direction, recommendation, order, scheduler, or monitor.

Pure assembler with injected IO so it is unit-testable without live providers; ``run_catalyst_
research_case`` wires the existing read-only routes/clients and writes NOTHING.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Mapping, Optional, Sequence

import issuer_case_loop as icl

# --- allowed dynamic source kinds (only real supported paths) ---------------------------------
EDGAR_FILING = "EDGAR_FILING"
EDGAR_FILING_SECTION = "EDGAR_FILING_SECTION"
ALPACA_MARKET_SNAPSHOT = "ALPACA_MARKET_SNAPSHOT"
ALPACA_BAR_SERIES = "ALPACA_BAR_SERIES"
EXISTING_FORECAST_OBSERVATION = "EXISTING_FORECAST_OBSERVATION"

# --- date kinds — the displayed date ALWAYS names its kind ------------------------------------
DATE_PERIOD_END = "period_end_date"
DATE_REPORTED_EVENT = "reported_event_date"
DATE_FILED = "filed_at"
DATE_RETRIEVED = "retrieved_at"
DATE_OBSERVATION = "observation_timestamp"
DATE_UNKNOWN = "unknown"

# --- filing families (smallest explicit handling for currently supported forms) ---------------
_PERIOD_FORMS = {"10-K", "10-K/A", "10-Q", "10-Q/A"}      # periodOfReport => financial period end
_EVENT_FORMS = {"8-K", "8-K/A"}                            # periodOfReport => reported event date

# --- tradability states — a failed lookup is NEVER "not_tradeable" -----------------------------
TRADE_KNOWN = "TRADE_KNOWN"
TRADE_UNCONFIGURED = "TRADE_UNCONFIGURED"
TRADE_UNKNOWN = "TRADE_UNKNOWN"
TRADE_PROVIDER_UNAVAILABLE = "TRADE_PROVIDER_UNAVAILABLE"

# --- honest capability/absence states ---------------------------------------------------------
SOURCE_NOT_INTEGRATED = "source_not_integrated"
SOURCE_UNAVAILABLE = "source_unavailable"
NO_OBSERVATION_FOUND = "no_observation_found"
FORECAST_NO_PERSISTED_CONTRACT = "model_code_exists_no_persisted_observation_contract"

# --- structural open-evidence-gap kinds (typed records, never trading advice) ------------------
GAP_RECENT_FILING_NOT_EXTRACTED = "recent_filing_not_extracted"
GAP_UNRESOLVED_RELATED_ENTITY = "unresolved_related_entity"
GAP_UNVERIFIED_SEED_CONTEXT = "unverified_seed_context"
GAP_MARKET_PROVIDER_UNAVAILABLE = "market_provider_unavailable"
GAP_FORECAST_NOT_PERSISTED = "forecast_observation_not_persisted"
GAP_NEWS_NOT_INTEGRATED = "news_source_not_integrated"
GAP_PATENT_NOT_INTEGRATED = "patent_source_not_integrated"
GAP_CONTRACT_NOT_INTEGRATED = "contract_source_not_integrated"
GAP_ISSUER_UNRESOLVED = "issuer_unresolved"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _s(value: Any) -> str:
    return "" if value is None else str(value)


def _date_precision(value: str) -> str:
    v = _s(value).strip()
    if not v:
        return "unknown"
    if "T" in v or ":" in v:
        return "second"
    parts = v.split("-")
    if len(parts) >= 3:
        return "day"
    if len(parts) == 2:
        return "month"
    if len(v) == 4 and v.isdigit():
        return "year"
    return "unknown"


@dataclass
class DynamicObservation:
    """One dated, source-backed observation. The date contract is explicit and family-aware:
    the raw provider period is preserved in ``source_period_of_report`` and is mapped to a TYPED
    date field only when the filing family makes that meaning valid."""

    source_kind: str
    source_identifier: str
    provider_or_source_system: str
    label: str
    form_type: str = ""
    source_period_of_report: str = ""   # raw provider periodOfReport, preserved independently
    filed_at: str = ""                  # SEC filing/acceptance date only
    period_end_date: str = ""           # financial reporting-period end only (10-K/10-Q family)
    reported_event_date: str = ""       # date of report / earliest reported event (8-K family)
    event_effective_at: str = ""        # only when explicitly source-supported (never inferred)
    retrieved_at: str = ""              # when LiquidAIty/provider retrieved the source only
    observation_timestamp: str = ""     # market/forecast observation time (not a filing date)
    display_date: str = ""
    display_date_kind: str = DATE_UNKNOWN
    date_precision: str = "unknown"
    date_reason_when_unknown: str = ""
    source_url_or_provider_reference: str = ""
    entity_resolution_status: str = ""
    verification_state: str = ""
    raw_value: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class CatalystResearchCase:
    case_identity: dict[str, Any]
    dynamic_observations: dict[str, Any]
    persistent_context: dict[str, Any]
    evidence_timeline: list[dict[str, Any]]
    open_evidence_gaps: list[dict[str, Any]]
    derived_relationships: list[dict[str, Any]]
    unknown_or_unresolved: dict[str, Any]
    source_capability_audit: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


# --- date semantics by filing family (requirement 1 + 2) -------------------------------------
def _filing_family_dates(form_type: str, source_period: str, filed_at: str, retrieved_at: str):
    """Return (period_end_date, reported_event_date, display_date, display_date_kind,
    date_precision, date_reason_when_unknown) for one filing family. NEVER maps an 8-K period to
    period_end_date; NEVER fabricates a date from accession/ticker/URL/now/year."""
    fam = _s(form_type).strip().upper()
    period_end = reported_event = reason = ""
    if fam in _PERIOD_FORMS:
        period_end = _s(source_period)  # only when the source actually supplies a period
        if period_end:
            disp, kind = period_end, DATE_PERIOD_END
        elif filed_at:
            disp, kind = filed_at, DATE_FILED
        elif retrieved_at:
            disp, kind = retrieved_at, DATE_RETRIEVED
        else:
            disp, kind, reason = "", DATE_UNKNOWN, "no period_end/filed/retrieved date from source"
    elif fam in _EVENT_FORMS:
        reported_event = _s(source_period)  # 8-K periodOfReport = date of report / earliest event
        if reported_event:
            disp, kind = reported_event, DATE_REPORTED_EVENT
        elif filed_at:
            disp, kind = filed_at, DATE_FILED
        elif retrieved_at:
            disp, kind = retrieved_at, DATE_RETRIEVED
        else:
            disp, kind, reason = "", DATE_UNKNOWN, "no reported_event/filed/retrieved date from source"
    else:
        # unknown / unsupported form: the raw period semantics are unknown — preserve it in
        # source_period_of_report ONLY, never map it to a typed date.
        if _s(source_period):
            reason = "unknown_form_period_semantics: raw source_period_of_report retained, not mapped"
        if filed_at:
            disp, kind = filed_at, DATE_FILED
        elif retrieved_at:
            disp, kind = retrieved_at, DATE_RETRIEVED
        else:
            disp, kind = "", DATE_UNKNOWN
            reason = reason or "unknown form, no filed/retrieved date from source"
    return period_end, reported_event, disp, kind, _date_precision(disp), reason


def _map_tradability(base_tradability: Mapping[str, Any]) -> dict[str, Any]:
    status = _s(base_tradability.get("status")).lower()
    detail = _s(base_tradability.get("detail"))
    low = detail.lower()
    if status == icl.TRADE_KNOWN:
        return {"status": TRADE_KNOWN, "detail": detail or "instrument resolved by provider"}
    if "unconfigured" in low or "not configured" in low or "credentials" in low:
        return {"status": TRADE_UNCONFIGURED, "detail": detail or "provider credentials not configured"}
    if "module_unavailable" in low or "unavailable" in low or "error" in low or "failed" in low:
        return {"status": TRADE_PROVIDER_UNAVAILABLE, "detail": detail or "provider unavailable"}
    return {"status": TRADE_UNKNOWN, "detail": detail or "instrument not resolved"}


def build_catalyst_research_case(
    issuer_input: str,
    *,
    records: Sequence[Mapping[str, Any]],
    relationships: Sequence[Mapping[str, Any]],
    alpaca_snapshot: Callable[[str], Mapping[str, Any]],
    seed_lookup: Callable[..., Mapping[str, Any]],
    filing_signals: Optional[Callable[[str, str], Mapping[str, Any]]] = None,
    alpaca_bars: Optional[Callable[[str], Mapping[str, Any]]] = None,
    forecast_lookup: Optional[Callable[[str, str], Mapping[str, Any]]] = None,
    news_status: str = SOURCE_NOT_INTEGRATED,
    patent_status: str = SOURCE_NOT_INTEGRATED,
    contract_status: str = SOURCE_NOT_INTEGRATED,
    retrieved_at: Optional[str] = None,
) -> CatalystResearchCase:
    """Assemble a Catalyst Research Case. Pure: every source is injected. Writes nothing."""
    retrieved_at = retrieved_at or _now_iso()

    base = icl.build_issuer_case(
        issuer_input, records=records, relationships=relationships,
        alpaca_snapshot=alpaca_snapshot, seed_context=icl.SeedContextAdapter.unavailable(),
        retrieved_at=retrieved_at).to_dict()
    identity = base["issuer_identity"]

    if identity.get("resolution_status") != "resolved":
        return _unresolved_case(issuer_input, retrieved_at, news_status, patent_status, contract_status)

    ticker = _s(identity.get("ticker"))
    cik = _s(identity.get("cik"))
    names = [n for n in {_s(identity.get("legal_name")), _company_long_name(records, identity)} if n]

    # ---- dynamic layer: EDGAR filings (real dated source, family-aware date semantics) --------
    fs = dict(filing_signals(ticker, cik)) if filing_signals else {"status": SOURCE_UNAVAILABLE, "envelopes": []}
    filing_envs = list(fs.get("envelopes") or [])
    filing_meta: dict[str, dict[str, str]] = {}  # accession -> {filed, period, form_type}
    edgar_filing_obs: list[DynamicObservation] = []
    for env in filing_envs:
        acc, form = _s(env.get("accession")), _s(env.get("formType"))
        filed, period = _s(env.get("filedAt")), _s(env.get("periodOfReport"))
        if acc:
            filing_meta[acc] = {"filed": filed, "period": period, "form_type": form}
        pe, rev, disp, kind, prec, reason = _filing_family_dates(form, period, filed, retrieved_at)
        edgar_filing_obs.append(DynamicObservation(
            source_kind=EDGAR_FILING, source_identifier=acc,
            provider_or_source_system=_s(env.get("provider") or "sec_api"),
            label=f"{form} filing {acc}", form_type=form, source_period_of_report=period,
            filed_at=filed, period_end_date=pe, reported_event_date=rev,
            retrieved_at=_s(fs.get("fetchedAt")) or retrieved_at,
            observation_timestamp=_s(env.get("observedAt")),
            display_date=disp, display_date_kind=kind, date_precision=prec, date_reason_when_unknown=reason,
            source_url_or_provider_reference=_s(env.get("filingUrl")),
            entity_resolution_status="source_backed", verification_state="edgar_filing_source_backed",
            raw_value=f"providerRef={_s(env.get('providerRef'))}"))

    # ---- dynamic layer: stored EDGAR filing-section evidence (joined to a real filing date) ----
    base_form_by_acc = {_s(f.get("accession")): _s(f.get("formType"))
                        for f in base["edgar_evidence"].get("filings", [])}
    edgar_section_obs: list[DynamicObservation] = []
    for role_key in ("business", "risk", "capital_control_ownership"):
        for item in base["edgar_evidence"].get(role_key, []):
            prov = item.get("provenance", {})
            acc = _s(prov.get("source_identifier"))
            meta = filing_meta.get(acc, {})
            form = meta.get("form_type") or base_form_by_acc.get(acc, "")
            filed, period = meta.get("filed", ""), meta.get("period", "")
            import_at = _s(prov.get("observed_or_filed_at"))  # KnowGraph import time — NOT a source date
            pe, rev, disp, kind, prec, reason = _filing_family_dates(form, period, filed, retrieved_at)
            edgar_section_obs.append(DynamicObservation(
                source_kind=EDGAR_FILING_SECTION, source_identifier=acc,
                provider_or_source_system="knowgraph_edgar_extraction",
                label=f"{role_key} section · {_s(item.get('label'))}", form_type=form,
                source_period_of_report=period, filed_at=filed, period_end_date=pe, reported_event_date=rev,
                retrieved_at=retrieved_at, observation_timestamp="",  # import time is not a source event time
                display_date=disp, display_date_kind=kind, date_precision=prec, date_reason_when_unknown=reason,
                source_url_or_provider_reference=_s(prov.get("source_url_or_provider_reference")),
                entity_resolution_status="source_backed", verification_state="edgar_filing_backed",
                raw_value=f"{_s(prov.get('raw_value'))}; knowgraph_import_at={import_at} (not a source date)"))

    # ---- dynamic layer: Alpaca market snapshot + bars (observation timestamps, when available) --
    snap = dict(base.get("market_context", {}).get("snapshot", {}))
    snap_status = _s(snap.get("status")).lower()
    alpaca_obs: list[DynamicObservation] = []
    if snap_status in ("available", "ok"):
        obs_ts = _s(snap.get("observedAt"))
        fetched = _s(snap.get("fetchedAt")) or retrieved_at
        alpaca_obs.append(DynamicObservation(
            source_kind=ALPACA_MARKET_SNAPSHOT, source_identifier=ticker,
            provider_or_source_system=_s(snap.get("provider") or "alpaca"), label=f"market snapshot {ticker}",
            retrieved_at=fetched, observation_timestamp=obs_ts,
            display_date=obs_ts or fetched, display_date_kind=DATE_OBSERVATION if obs_ts else DATE_RETRIEVED,
            date_precision=_date_precision(obs_ts or fetched),
            source_url_or_provider_reference=_s(snap.get("feed")), entity_resolution_status="provider_symbol",
            verification_state="provider_observed",
            raw_value=f"price={snap.get('latestTradePrice')} bid={snap.get('latestQuoteBid')} ask={snap.get('latestQuoteAsk')}"))
    bars_payload = dict(alpaca_bars(ticker)) if alpaca_bars else {}
    bars_status = _s(bars_payload.get("status")).lower()
    if bars_status in ("available", "ok") and bars_payload.get("bars"):
        bars = bars_payload.get("bars") or []
        last_ts = _s(bars[-1].get("timestamp")) if bars else ""
        alpaca_obs.append(DynamicObservation(
            source_kind=ALPACA_BAR_SERIES, source_identifier=ticker, provider_or_source_system="alpaca",
            label=f"{_s(bars_payload.get('timeframe'))} bar series {ticker} ({len(bars)} bars)",
            retrieved_at=_s(bars_payload.get("fetchedAt")) or retrieved_at, observation_timestamp=last_ts,
            display_date=last_ts, display_date_kind=DATE_OBSERVATION, date_precision=_date_precision(last_ts),
            entity_resolution_status="provider_symbol", verification_state="provider_observed",
            raw_value=f"timeframe={_s(bars_payload.get('timeframe'))} count={len(bars)} last={last_ts}"))

    # ---- dynamic layer: existing forecast output — ONLY if a real persisted contract exists ----
    forecast = dict(forecast_lookup(ticker, cik)) if forecast_lookup else {
        "status": FORECAST_NO_PERSISTED_CONTRACT, "items": []}
    forecast_obs: list[DynamicObservation] = []
    for fo in forecast.get("items") or []:
        gen = _s(fo.get("generated_at"))
        forecast_obs.append(DynamicObservation(
            source_kind=EXISTING_FORECAST_OBSERVATION, source_identifier=_s(fo.get("source_run_id")),
            provider_or_source_system=_s(fo.get("model_family") or "forecast_model"),
            label=f"{_s(fo.get('model'))} forecast h={_s(fo.get('horizon'))}", retrieved_at=retrieved_at,
            observation_timestamp=gen, display_date=gen, display_date_kind=DATE_OBSERVATION,
            date_precision=_date_precision(gen), entity_resolution_status="provider_symbol",
            verification_state="model_output_persisted",
            raw_value=f"model={_s(fo.get('model'))} version={_s(fo.get('version'))} target={_s(fo.get('target'))}"))

    # ---- persistent context: supplemental seed atlas (unverified, source-preserved) ------------
    seed = dict(seed_lookup(ticker=ticker, cik=cik, names=names))
    seed_items = list(seed.get("items") or [])
    seed_by_kind: dict[str, list[dict[str, Any]]] = {}
    for row in seed_items:
        seed_by_kind.setdefault(_s(row.get("relationship_kind")) or "seed_atlas_context", []).append(row)

    tradability = _map_tradability(base["tradability"])
    timeline = _build_timeline(edgar_filing_obs + edgar_section_obs + alpaca_obs + forecast_obs)
    derived = _derived_relationships(identity, snap_status, filing_meta, edgar_section_obs)
    gaps = _open_evidence_gaps(identity, base, edgar_filing_obs, edgar_section_obs, seed,
                               tradability, forecast, news_status, patent_status, contract_status)
    unknown = _unknown_or_unresolved(base, fs, tradability, forecast, news_status, patent_status, contract_status)
    audit = _capability_audit(base, fs, tradability, bars_status, seed, forecast,
                              news_status, patent_status, contract_status)

    return CatalystResearchCase(
        case_identity={
            "case_key": f"catalyst_case::{cik or ticker}",
            "issuer_identity": identity,
            "instrument_identity": ({"symbol": ticker, "provider": _s(snap.get("provider") or "alpaca"),
                                     "resolution": "provider_resolved"} if snap_status in ("available", "ok")
                                    else {"symbol": ticker, "provider": "alpaca", "resolution": "unresolved"}),
            "tradability": tradability,
            "created_or_refreshed_at": retrieved_at,
        },
        dynamic_observations={
            "edgar_filings": [o.to_dict() for o in edgar_filing_obs],
            "edgar_filing_sections": [o.to_dict() for o in edgar_section_obs],
            "alpaca_market": [o.to_dict() for o in alpaca_obs],
            "forecast": [o.to_dict() for o in forecast_obs],
            "counts": {"edgar_filings": len(edgar_filing_obs), "edgar_filing_sections": len(edgar_section_obs),
                       "alpaca_market": len(alpaca_obs), "forecast": len(forecast_obs)},
        },
        persistent_context={
            "follow_the_money_seed": {"status": seed.get("status"), "workbook": seed.get("workbook"),
                                      "source_id": seed.get("source_id"),
                                      "workbook_fingerprint": seed.get("workbook_fingerprint"),
                                      "by_relationship_kind": seed_by_kind, "count": len(seed_items),
                                      "note": "supplemental + UNVERIFIED; never current truth; never overwrites EDGAR",
                                      "reason": seed.get("reason", "")},
        },
        evidence_timeline=timeline,
        open_evidence_gaps=gaps,
        derived_relationships=derived,
        unknown_or_unresolved=unknown,
        source_capability_audit=audit,
    )


def _company_long_name(records: Sequence[Mapping[str, Any]], identity: Mapping[str, Any]) -> str:
    gid = _s(identity.get("graph_id"))
    for r in records:
        if _s(r.get("id")) == gid:
            props = r.get("properties") or {}
            return _s(props.get("name") or props.get("companyName") or r.get("label"))
    return ""


def _build_timeline(observations: Sequence[DynamicObservation]) -> list[dict[str, Any]]:
    dated, undated = [], []
    for o in observations:
        entry = {"display_date": o.display_date, "display_date_kind": o.display_date_kind,
                 "date_precision": o.date_precision, "source_kind": o.source_kind,
                 "source_identifier": o.source_identifier, "form_type": o.form_type,
                 "source_reference": o.source_url_or_provider_reference, "label": o.label,
                 "date_reason_when_unknown": o.date_reason_when_unknown}
        (dated if o.display_date and o.display_date_kind != DATE_UNKNOWN else undated).append(entry)
    dated.sort(key=lambda e: e["display_date"], reverse=True)
    return dated + undated


def _derived_relationships(identity, snap_status, filing_meta, section_obs) -> list[dict[str, Any]]:
    rels = [{
        "relationship": "issuer_resolved",
        "statement": f"ticker {identity.get('ticker')} ↔ CIK {identity.get('cik')} resolved to one EDGAR issuer node",
        "basis": [f"knowgraph_issuer_node:{identity.get('graph_id')}"], "permanence": "derived_not_persisted"}]
    if snap_status in ("available", "ok"):
        rels.append({"relationship": "instrument_resolved",
                     "statement": f"ticker {identity.get('ticker')} resolves to a tradeable instrument on the market provider",
                     "basis": ["alpaca_market_snapshot:available"], "permanence": "derived_not_persisted"})
    joined = sorted({o.source_identifier for o in section_obs
                     if o.source_identifier in filing_meta and (o.period_end_date or o.reported_event_date)})
    if joined:
        rels.append({"relationship": "filing_section_date_join",
                     "statement": ("stored EDGAR section evidence joined to a live filing signal to recover the real "
                                   "filed_at + family-typed date (NOT derived from the accession year)"),
                     "basis": [f"accession_join:{a}" for a in joined], "permanence": "derived_not_persisted"})
    return rels


def _open_evidence_gaps(identity, base, filing_obs, section_obs, seed, tradability, forecast,
                        news_status, patent_status, contract_status) -> list[dict[str, Any]]:
    """STRUCTURAL typed open-evidence-gap records (requirement 5) — derived from literal evidence
    state only. No natural-language questions, no direction, no recommendation, no classification."""
    ref = {"ticker": identity.get("ticker"), "cik": identity.get("cik"), "graph_id": identity.get("graph_id")}

    def gap(kind, refs, reason):
        return {"gap_kind": kind, "issuer_or_entity_ref": ref, "related_source_refs": list(refs),
                "reason_code": reason, "severity_or_priority": None, "status": "open"}

    gaps: list[dict[str, Any]] = []
    represented = {o.source_identifier for o in section_obs}
    for fo in filing_obs:
        if fo.source_identifier and fo.source_identifier not in represented:
            gaps.append(gap(GAP_RECENT_FILING_NOT_EXTRACTED,
                            [fo.source_identifier, fo.source_url_or_provider_reference],
                            "filing_signal_without_extracted_section"))
    if base["competitor_handling"].get("resolution") == "unresolved":
        gaps.append(gap(GAP_UNRESOLVED_RELATED_ENTITY, ["competitor_handling"], "no_structured_competes_with_edges"))
    if base["ownership_control_handling"].get("graph_holder_observations") == []:
        gaps.append(gap(GAP_UNRESOLVED_RELATED_ENTITY, ["ownership_control_handling"],
                        "no_source_backed_holder_observations"))
    if seed.get("status") == "seed_context_found":
        gaps.append(gap(GAP_UNVERIFIED_SEED_CONTEXT, [_s(seed.get("workbook")) or "seed_atlas"],
                        "seed_rows_unverified"))
    if tradability["status"] != TRADE_KNOWN:
        gaps.append(gap(GAP_MARKET_PROVIDER_UNAVAILABLE, ["alpaca"], tradability["status"].lower()))
    if (forecast.get("status") or FORECAST_NO_PERSISTED_CONTRACT) != "available":
        gaps.append(gap(GAP_FORECAST_NOT_PERSISTED, ["kronos", "chronos"], "no_persisted_forecast_output_contract"))
    if news_status != "available":
        gaps.append(gap(GAP_NEWS_NOT_INTEGRATED, [], news_status))
    if patent_status != "available":
        gaps.append(gap(GAP_PATENT_NOT_INTEGRATED, [], patent_status))
    if contract_status != "available":
        gaps.append(gap(GAP_CONTRACT_NOT_INTEGRATED, [], contract_status))
    return gaps


def _unknown_or_unresolved(base, fs, tradability, forecast,
                           news_status, patent_status, contract_status) -> dict[str, Any]:
    missing = []
    for label, status in (("news", news_status), ("patents", patent_status), ("contracts_or_awards", contract_status)):
        if status != "available":
            missing.append({"source": label, "status": status})
    if (forecast.get("status") or FORECAST_NO_PERSISTED_CONTRACT) != "available":
        missing.append({"source": "forecast", "status": forecast.get("status") or FORECAST_NO_PERSISTED_CONTRACT})
    missing.append({"source": "institutional_holders_13F", "status": NO_OBSERVATION_FOUND})
    missing.append({"source": "insider_transactions_form4", "status": NO_OBSERVATION_FOUND})
    unavailable_providers = []
    if _s(fs.get("status")).lower() not in ("available", "ok"):
        unavailable_providers.append({"provider": "sec_api_filing_signals", "status": fs.get("status"),
                                      "detail": _s(fs.get("error"))})
    if tradability["status"] in (TRADE_PROVIDER_UNAVAILABLE, TRADE_UNCONFIGURED):
        unavailable_providers.append({"provider": "alpaca", "status": tradability["status"],
                                      "detail": tradability["detail"]})
    return {
        "missing_source": missing,
        "unresolved_entity": (["competitor_candidates", "ownership_control_observations"]
                              if base["competitor_handling"].get("candidates", []) == [] else []),
        "unavailable_provider": unavailable_providers,
        "conflicting": [],
        "unsupported_instrument": [],
    }


def _capability_audit(base, fs, tradability, bars_status, seed, forecast,
                      news_status, patent_status, contract_status) -> dict[str, Any]:
    seed_kinds = sorted({_s(r.get("relationship_kind")) for r in (seed.get("items") or [])})
    edgar_sections = sum(len(base["edgar_evidence"].get(k, []))
                         for k in ("business", "risk", "capital_control_ownership"))
    return {
        "EDGAR": {"stored_sections": edgar_sections, "filing_signal_status": fs.get("status"),
                  "filing_signal_count": len(fs.get("envelopes") or []), "filing_signal_error": _s(fs.get("error"))},
        "ALPACA": {"snapshot": tradability["status"], "bar_series": bars_status or NO_OBSERVATION_FOUND,
                   "options": SOURCE_NOT_INTEGRATED, "news": SOURCE_NOT_INTEGRATED},
        "FOLLOW_THE_MONEY_SEED": {"status": seed.get("status"), "workbook": seed.get("workbook"),
                                  "workbook_fingerprint": seed.get("workbook_fingerprint"),
                                  "relationship_kinds_present": seed_kinds},
        "BRAND_OWNERSHIP_SEED": {"status": seed.get("status"),
                                 "relationship_kinds_present": [k for k in seed_kinds
                                                                if k in ("brand_or_product_relationship",
                                                                         "owner_or_parent_relationship")]},
        "NEWS": {"status": news_status},
        "PATENTS": {"status": patent_status},
        "CONTRACTS_OR_AWARDS": {"status": contract_status},
        "KRONOS": {"status": FORECAST_NO_PERSISTED_CONTRACT,
                   "detail": "kronos adapter code exists (market/model_adapters/kronos_adapter.py); no persisted output contract"},
        "CRONOS": {"status": FORECAST_NO_PERSISTED_CONTRACT,
                   "detail": "chronos adapter code exists (market/model_adapters/chronos_adapter.py); no persisted output contract"},
        "FORECAST": {"status": forecast.get("status") or FORECAST_NO_PERSISTED_CONTRACT,
                     "attached_observations": len(forecast.get("items") or [])},
    }


def _unresolved_case(issuer_input, retrieved_at, news_status, patent_status, contract_status) -> CatalystResearchCase:
    """Honest unresolved issuer — never invents a ticker or instrument."""
    ref = {"ticker": "", "cik": "", "graph_id": ""}
    return CatalystResearchCase(
        case_identity={"case_key": f"catalyst_case::unresolved::{issuer_input}",
                       "issuer_identity": {"resolution_status": "unresolved", "ticker": "", "cik": ""},
                       "instrument_identity": {"symbol": "", "resolution": "unresolved"},
                       "tradability": {"status": TRADE_UNKNOWN, "detail": "issuer not resolved in KnowGraph"},
                       "created_or_refreshed_at": retrieved_at},
        dynamic_observations={"edgar_filings": [], "edgar_filing_sections": [], "alpaca_market": [],
                              "forecast": [], "counts": {"edgar_filings": 0, "edgar_filing_sections": 0,
                                                         "alpaca_market": 0, "forecast": 0}},
        persistent_context={"follow_the_money_seed": {"status": "seed_context_not_attempted", "count": 0}},
        evidence_timeline=[],
        open_evidence_gaps=[{"gap_kind": GAP_ISSUER_UNRESOLVED, "issuer_or_entity_ref": ref,
                             "related_source_refs": [issuer_input], "reason_code": "issuer_input_not_resolved",
                             "severity_or_priority": None, "status": "open"}],
        derived_relationships=[],
        unknown_or_unresolved={"missing_source": [], "unresolved_entity": ["issuer_identity"],
                               "unavailable_provider": [], "conflicting": [], "unsupported_instrument": []},
        source_capability_audit={"EDGAR": {"stored_sections": 0, "filing_signal_status": "not_attempted"},
                                 "NEWS": {"status": news_status}, "PATENTS": {"status": patent_status},
                                 "CONTRACTS_OR_AWARDS": {"status": contract_status}},
    )


# --- live wiring (READ-ONLY) ------------------------------------------------------------------
def _import_app_module(module_name: str):
    """Import an apps/python-models module through the clean canonical importer (no sys.path or
    sys.modules manipulation; relies on the durable regular-package boundary)."""
    return icl.import_app_python_models_module(module_name)


def _live_filing_signals(ticker: str, cik: str) -> Mapping[str, Any]:
    """Existing read-only SEC filing-signal source. Query by ticker (sec-api stores CIK without
    leading zeros, so a zero-padded CIK over-constrains). Honest provider state on any failure."""
    try:
        s = _import_app_module("sec_filing_signals")
    except Exception as exc:  # noqa: BLE001
        return {"status": SOURCE_UNAVAILABLE, "envelopes": [], "error": f"sec_filing_signals_unavailable:{exc}"}
    from datetime import timedelta

    today = datetime.now(timezone.utc).date()
    frm = (today - timedelta(days=540)).isoformat()
    issuer = s.IssuerRef(ticker=ticker or None, cik=(cik.lstrip("0") or None) if not ticker else None)
    try:
        q = s.SecFilingQuery(issuer=issuer, formTypes=["10-K", "10-Q", "8-K"],
                             fromDate=frm, toDate=today.isoformat(), limit=8)
        res = s.find_recent_sec_filing_signals(q)
    except Exception as exc:  # noqa: BLE001
        return {"status": "provider_error", "envelopes": [], "error": f"{type(exc).__name__}"}
    envelopes = []
    for e in res.envelopes:
        f = e.filing
        envelopes.append({"accession": f.accessionNumber, "formType": f.formType, "filedAt": f.filedAt,
                          "periodOfReport": _s(f.periodOfReport), "filingUrl": f.filingUrl,
                          "providerRef": e.sourceRefs.providerResponseRef if e.sourceRefs else "",
                          "observedAt": e.observedAt, "provider": e.provider})
    return {"status": res.status, "fetchedAt": res.fetchedAt, "envelopes": envelopes, "error": _s(res.error)}


def _live_alpaca_bars(ticker: str) -> Mapping[str, Any]:
    """Existing read-only Alpaca bar path (daily, small window). Honest status on any failure."""
    try:
        amd = icl.import_alpaca_market_data()
        bars = amd.get_historical_bars(amd.AlpacaInstrumentRef(symbol=ticker.upper()), "1Day", limit=5)
        return bars.to_dict()
    except Exception as exc:  # noqa: BLE001
        return {"status": "error", "symbol": ticker.upper(), "diagnostics": f"alpaca_bars_failed:{type(exc).__name__}"}


def _live_forecast_lookup(ticker: str, cik: str) -> Mapping[str, Any]:
    """Honest: Kronos/Chronos adapter code exists (market/model_adapters) but there is NO persisted
    forecast-output contract/store anywhere in the repo, so there is nothing to attach. This NEVER
    invokes a model and NEVER fabricates a forecast."""
    return {"status": FORECAST_NO_PERSISTED_CONTRACT, "items": []}


def run_catalyst_research_case(
    issuer_input: str,
    *,
    project_id: str,
    base_url: str = "http://localhost:4000",
    seed_path: Optional[str] = None,
    attach_bars: bool = True,
) -> CatalystResearchCase:
    """Live, READ-ONLY Catalyst Research Case for one issuer. Writes nothing; places no order."""
    import seed_atlas_source as sas

    graph = icl._read_knowgraph_records(project_id, base_url=base_url)
    seed = sas.load_seed_atlas(seed_path)
    return build_catalyst_research_case(
        issuer_input,
        records=graph.get("records") or [],
        relationships=graph.get("relationships") or [],
        alpaca_snapshot=icl._live_alpaca_snapshot,
        seed_lookup=seed.lookup,
        filing_signals=_live_filing_signals,
        alpaca_bars=(_live_alpaca_bars if attach_bars else None),
        forecast_lookup=_live_forecast_lookup,
    )


if __name__ == "__main__":
    import sys

    pid = "20ac92da-01fd-4cf6-97cc-0672421e751a"
    tickers = sys.argv[1:] or ["RDW", "RKLB"]
    for tk in tickers:
        case = run_catalyst_research_case(tk, project_id=pid).to_dict()
        ci = case["case_identity"]
        print(f"\n==== CATALYST RESEARCH CASE: {tk} ====")
        print("identity:", ci["issuer_identity"].get("resolution_status"),
              ci["issuer_identity"].get("ticker"), "cik", ci["issuer_identity"].get("cik"))
        print("tradability:", ci["tradability"]["status"], "-", ci["tradability"]["detail"])
        print("dynamic counts:", case["dynamic_observations"]["counts"])
        filings = case["dynamic_observations"]["edgar_filings"]
        period_f = next((o for o in filings if o["display_date_kind"] == "period_end_date"), None)
        event_f = next((o for o in filings if o["display_date_kind"] == "reported_event_date"), None)
        if period_f:
            print(f"  10-K/10-Q: {period_f['form_type']} {period_f['source_identifier']} "
                  f"period_end_date={period_f['period_end_date']} filed_at={period_f['filed_at']} "
                  f"display={period_f['display_date']}/{period_f['display_date_kind']}")
        if event_f:
            print(f"  8-K:       {event_f['form_type']} {event_f['source_identifier']} "
                  f"reported_event_date={event_f['reported_event_date']} period_end_date='{event_f['period_end_date']}' "
                  f"filed_at={event_f['filed_at']} display={event_f['display_date']}/{event_f['display_date_kind']}")
        seedp = case["persistent_context"]["follow_the_money_seed"]
        print("SEED:", seedp.get("status"), seedp.get("count"), "rows fp=", seedp.get("workbook_fingerprint"))
        print("open_evidence_gaps:", [g["gap_kind"] for g in case["open_evidence_gaps"]])
