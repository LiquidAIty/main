# @graph entity: Follow-the-Money Issuer Case Loop
# @graph role: reusable-source-aware-issuer-evidence-case-assembler
# @graph depends_on: KnowGraph semantic-graph read route, Alpaca read-only market data, Seed context adapter
# @graph feeds_to: KnowGraph issuer research
"""Reusable Follow-the-Money Issuer Case Loop (read-only assembler).

Given a resolved issuer input (ticker / CIK / graph entity id), assemble a source-aware
Issuer Case from EXISTING evidence, preserving the difference between persistent identity,
source-backed assertion, time-bound observation, and derived research output. Follow-the-Money
is the *navigation order and organizing principle* here — NOT a recommendation engine.

This module is a pure assembler with INJECTABLE IO (KnowGraph records, an Alpaca snapshot fn,
a seed-context adapter) so it is unit-testable without live providers — mirroring the existing
``transport``/``call_fn`` injection pattern in this package. The live wiring (``run_issuer_case``)
reuses the existing read-only KnowGraph route and the existing read-only Alpaca client. It writes
NOTHING: the durable evidence already lives in KnowGraph; the case is a read-model over it, so
repeated refresh cannot duplicate or overwrite canonical records.

Out of scope by SPEC: no money/buy/rug-pull score, no long/short verdict, no order execution, no
scheduler, no FCA/OWL reasoner, no Kronos. None of those appear here.
"""

from __future__ import annotations

import json
import urllib.request
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Mapping, Optional, Sequence

# --- source-role vocabulary (SPEC requirement 1) ------------------------------------------
SOURCE_EDGAR = "EDGAR"
SOURCE_ALPACA = "ALPACA"
SOURCE_SEED = "FOLLOW_THE_MONEY_SEED"
SOURCE_EXTERNAL = "INTERNET_OR_EXTERNAL_DISCOVERY"
SOURCE_DERIVED = "DERIVED_RESEARCH_OUTPUT"

# seed-context outcomes (SPEC requirement 4)
SEED_FOUND = "seed_context_found"
SEED_NOT_FOUND = "seed_context_not_found"
SEED_UNAVAILABLE = "seed_context_unavailable"
SEED_UNRESOLVED = "seed_context_unresolved"

# tradability states (SPEC requirement 2) — note: NEVER "not_tradeable" from a failed lookup.
TRADE_KNOWN = "known"
TRADE_UNKNOWN = "unknown"
TRADE_UNSUPPORTED = "unsupported"
TRADE_INACTIVE = "inactive"

CONTEXT_ROLE = {
    "BusinessContext": "business",
    "RiskContext": "risk",
    "ManagementDiscussionContext": "management_discussion",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _s(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return str(value)


def _first_owl(owl: Any) -> str:
    if isinstance(owl, list):
        return _s(owl[0]).strip() if owl else ""
    return _s(owl).strip()


@dataclass
class Provenance:
    source_kind: str
    source_identifier: str = ""
    source_url_or_provider_reference: str = ""
    retrieved_at: str = ""
    observed_or_filed_at: str = ""
    effective_or_as_of_date: str = ""
    entity_resolution_status: str = ""
    verification_state: str = ""
    raw_value: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class EvidenceItem:
    role: str                       # business | risk | management_discussion | competitor_candidate | ...
    label: str
    summary: str
    provenance: Provenance

    def to_dict(self) -> dict[str, Any]:
        return {"role": self.role, "label": self.label, "summary": self.summary,
                "provenance": self.provenance.to_dict()}


@dataclass
class IssuerCase:
    issuer_input: str
    issuer_identity: dict[str, Any]
    tradability: dict[str, Any]
    edgar_evidence: dict[str, Any]
    follow_the_money_context: dict[str, Any]
    market_context: dict[str, Any]
    competitor_handling: dict[str, Any]
    ownership_control_handling: dict[str, Any]
    research_state: dict[str, Any]
    source_roles: dict[str, Any]
    assembled_at: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


# --- seed-context adapter (SPEC requirement 4) --------------------------------------------
class SeedContextAdapter:
    """Narrow boundary that can attach known supplemental Follow-the-Money / ownership / brand
    seed context to a resolved issuer WITHOUT corrupting source truth. Seed rows are never
    marked verified merely by being present. Default state is honest unavailability when no
    real seed source is wired (the spreadsheets are not in the repo)."""

    def __init__(self, fixture: Optional[Mapping[str, Sequence[Mapping[str, Any]]]] = None,
                 *, available: bool = True, source_name: str = ""):
        self._fixture = {k.upper(): list(v) for k, v in (fixture or {}).items()}
        self._available = available and fixture is not None
        self._source_name = source_name

    @classmethod
    def unavailable(cls, reason: str = "seed spreadsheets not present in repository data path") -> "SeedContextAdapter":
        adapter = cls(fixture=None, available=False)
        adapter._reason = reason  # type: ignore[attr-defined]
        return adapter

    def lookup(self, ticker: str) -> dict[str, Any]:
        if not self._available:
            return {"status": SEED_UNAVAILABLE, "items": [],
                    "reason": getattr(self, "_reason", "no seed source configured")}
        rows = self._fixture.get(_s(ticker).strip().upper(), [])
        if not rows:
            return {"status": SEED_NOT_FOUND, "items": []}
        items = []
        for row in rows:
            items.append({
                "raw": dict(row),  # preserve raw source fields verbatim — NOT marked verified
                "provenance": Provenance(
                    source_kind=SOURCE_SEED,
                    source_identifier=_s(row.get("_source_locator") or row.get("Owner") or ""),
                    source_url_or_provider_reference=self._source_name,
                    retrieved_at="",
                    effective_or_as_of_date=_s(row.get("_as_of") or row.get("Updated") or ""),
                    entity_resolution_status="seed_only",
                    verification_state="unverified_seed",  # never "verified" just because imported
                    raw_value=json.dumps(dict(row), default=str)[:500],
                ).to_dict(),
            })
        return {"status": SEED_FOUND, "items": items, "source_name": self._source_name}


# --- the reusable assembler (SPEC requirement 2) — PURE, no IO ------------------------------
def _resolve_issuer(issuer_input: str, records: Sequence[Mapping[str, Any]]) -> Optional[Mapping[str, Any]]:
    """Resolve an issuer record by ticker / CIK / graph id. No issuer hardcoding."""
    key = _s(issuer_input).strip()
    if not key:
        return None
    up = key.upper()
    for rec in records:
        if _first_owl(rec.get("owlClass")) != "Issuer":
            continue
        props = rec.get("properties") or {}
        if (_s(props.get("ticker")).strip().upper() == up
                or _s(props.get("cik")).strip().lstrip("0") == key.lstrip("0")
                or _s(rec.get("id")).strip() == key):
            return rec
    return None


def _edge_ends(edge: Mapping[str, Any]) -> tuple[str, str, str]:
    return (_s(edge.get("from") or edge.get("source")).strip(),
            _s(edge.get("to") or edge.get("target")).strip(),
            _s(edge.get("type")).strip().upper())


def _evidence_provenance(rec: Mapping[str, Any], retrieved_at: str) -> Provenance:
    props = rec.get("properties") or {}
    return Provenance(
        source_kind=SOURCE_EDGAR,
        source_identifier=_s(props.get("accessionNumber")),
        source_url_or_provider_reference=_s(props.get("filingUrl") or props.get("source_url")),
        retrieved_at=retrieved_at,
        # seededAt is the KnowGraph IMPORT/extraction time — never a filing or event date. The
        # node carries no source filing date, so effective/as-of stays empty here (the Catalyst
        # date layer resolves real filed_at/period_end from a live filing-signal source instead).
        # NEVER derive a date from the accession-number year (SPEC date rule).
        observed_or_filed_at=_s(props.get("seededAt") or props.get("created_at")),
        effective_or_as_of_date="",
        entity_resolution_status="source_backed",
        verification_state="edgar_filing_backed",
        raw_value=f"formType={_s(props.get('formType'))} item={_s(props.get('sectionItemId'))}",
    )


def build_issuer_case(
    issuer_input: str,
    *,
    records: Sequence[Mapping[str, Any]],
    relationships: Sequence[Mapping[str, Any]],
    alpaca_snapshot: Callable[[str], Mapping[str, Any]],
    seed_context: SeedContextAdapter,
    retrieved_at: Optional[str] = None,
) -> IssuerCase:
    """Assemble a source-aware Issuer Case from existing evidence. Pure: all IO is injected."""
    retrieved_at = retrieved_at or _now_iso()
    by_id = {_s(r.get("id")): r for r in records}
    issuer = _resolve_issuer(issuer_input, records)

    if issuer is None:
        # Honest unresolved identity — never invent an issuer.
        return IssuerCase(
            issuer_input=issuer_input,
            issuer_identity={"resolution_status": "unresolved", "ticker": "", "cik": "", "legal_name": ""},
            tradability={"status": TRADE_UNKNOWN, "source": SOURCE_ALPACA, "detail": "issuer not resolved in KnowGraph"},
            edgar_evidence={"business": [], "risk": [], "capital_control_ownership": [], "filings": []},
            follow_the_money_context={"status": SEED_UNRESOLVED, "items": []},
            market_context={},
            competitor_handling={"candidates": [], "note": "issuer unresolved"},
            ownership_control_handling={"observations": [], "note": "issuer unresolved"},
            research_state={"source_backed": [], "derived": [], "unresolved": ["issuer_identity"],
                            "conflicting": [], "missing_source": []},
            source_roles={"EDGAR": "absent", "ALPACA": "not_attempted", "FOLLOW_THE_MONEY_SEED": "unresolved",
                          "EXTERNAL_DISCOVERY": "absent"},
            assembled_at=retrieved_at,
        )

    iprops = issuer.get("properties") or {}
    ticker = _s(iprops.get("ticker")).strip().upper()
    cik = _s(iprops.get("cik")).strip()
    issuer_id = _s(issuer.get("id"))

    # --- EDGAR evidence: issuer --HAS_CONTEXT--> context --SUPPORTED_BY--> evidence (stored only)
    buckets: dict[str, list[EvidenceItem]] = {"business": [], "risk": [], "management_discussion": []}
    filings: dict[str, dict[str, Any]] = {}
    context_ids: list[str] = []
    for edge in relationships:
        s, t, typ = _edge_ends(edge)
        if typ != "HAS_CONTEXT" or s != issuer_id:
            continue
        ctx = by_id.get(t)
        if not ctx:
            continue
        role = CONTEXT_ROLE.get(_first_owl(ctx.get("owlClass")))
        if not role:
            continue
        context_ids.append(t)
        prov = _evidence_provenance(ctx, retrieved_at)
        cprops = ctx.get("properties") or {}
        buckets[role].append(EvidenceItem(role=role, label=_s(ctx.get("label")),
                                          summary=_s(cprops.get("summary")), provenance=prov))
        acc = _s(cprops.get("accessionNumber"))
        if acc and acc not in filings:
            filings[acc] = {"accession": acc, "formType": _s(cprops.get("formType")),
                            "filingUrl": _s(cprops.get("filingUrl") or cprops.get("source_url")),
                            "source_kind": SOURCE_EDGAR}

    # supporting EvidenceSection nodes (the deeper provenance) per context
    evidence_sections: list[dict[str, Any]] = []
    for edge in relationships:
        s, t, typ = _edge_ends(edge)
        if typ != "SUPPORTED_BY" or s not in context_ids:
            continue
        ev = by_id.get(t)
        if not ev or _first_owl(ev.get("owlClass")) != "EvidenceSection":
            continue
        evidence_sections.append({"context_id": s, "evidence_id": t,
                                  "provenance": _evidence_provenance(ev, retrieved_at).to_dict()})

    # --- tradability via existing read-only Alpaca client (failed lookup => unknown, NOT untradeable)
    snap = dict(alpaca_snapshot(ticker) or {})
    a_status = _s(snap.get("status")).lower()
    if a_status in ("available", "ok"):
        tradability = {"status": TRADE_KNOWN, "source": SOURCE_ALPACA, "detail": "instrument resolved by provider"}
    elif a_status in ("unconfigured", "provider_unconfigured", ""):
        # Preserve the provider's own diagnostic so a missing module / missing creds / unconfigured
        # account stay distinguishable — never collapse a real blocker into a generic label.
        tradability = {"status": TRADE_UNKNOWN, "source": SOURCE_ALPACA,
                       "detail": _s(snap.get("diagnostics")) or "provider_unconfigured"}
    else:  # error / invalid / unexpected => unknown/unavailable, never "not_tradeable"
        tradability = {"status": TRADE_UNKNOWN, "source": SOURCE_ALPACA,
                       "detail": _s(snap.get("diagnostics") or a_status or "provider_unavailable")}
    market_context = {"source_kind": SOURCE_ALPACA, "snapshot": snap,
                      "provenance": Provenance(
                          source_kind=SOURCE_ALPACA, source_identifier=ticker,
                          source_url_or_provider_reference=_s(snap.get("provider")),
                          retrieved_at=_s(snap.get("fetchedAt")) or retrieved_at,
                          observed_or_filed_at=_s(snap.get("observedAt")),
                          entity_resolution_status="provider_symbol",
                          verification_state=a_status or "unavailable").to_dict()}

    # --- competitor handling: structured COMPETES_WITH edges are not yet extracted; surface the
    # business EvidenceSection as the source-backed competitor *evidence location*, candidates
    # UNRESOLVED. Never invent a ticker.
    competitor_handling = {
        "candidates": [],
        "resolution": "unresolved",
        "note": "no structured COMPETES_WITH relationships in graph yet; competitor discussion lives "
                "in the EDGAR business filing section (deferred to extraction). No tickers invented.",
        "source_locations": [b.provenance.to_dict() for b in buckets["business"]],
    }

    # --- ownership / control / holder: no holder observations in graph for this issuer yet; seed is
    # supplemental. Do not collapse to OWNS, do not infer current ownership.
    seed = seed_context.lookup(ticker)
    ownership_control_handling = {
        "graph_holder_observations": [],
        "note": "no source-backed holder / 13F / Form 4 / control observations in graph yet "
                "(deferred live functor). Seed context, if any, is supplemental and unverified.",
        "seed_status": seed.get("status"),
    }

    research_state = {
        "source_backed": [f"edgar:{role}:{i.provenance.source_identifier}"
                          for role in buckets for i in buckets[role]],
        "derived": ["issuer_identity_resolution", "edgar_role_bucketing"],
        "unresolved": (["competitor_candidates"] if not competitor_handling["candidates"] else [])
                      + ["ownership_control_observations"],
        "conflicting": [],
        "missing_source": ["institutional_holders_13F", "insider_transactions_form4"],
    }

    return IssuerCase(
        issuer_input=issuer_input,
        issuer_identity={
            "resolution_status": "resolved",
            "legal_name": _s(iprops.get("name")) or _s(issuer.get("label")),
            "ticker": ticker,
            "cik": cik,
            "graph_id": issuer_id,
            "provenance": Provenance(source_kind=SOURCE_EDGAR, source_identifier=cik or ticker,
                                     entity_resolution_status="resolved",
                                     verification_state="edgar_issuer_node").to_dict(),
        },
        tradability=tradability,
        edgar_evidence={
            "filings": list(filings.values()),
            "business": [i.to_dict() for i in buckets["business"]],
            "risk": [i.to_dict() for i in buckets["risk"]],
            "capital_control_ownership": [i.to_dict() for i in buckets["management_discussion"]],
            "evidence_sections": evidence_sections,
        },
        follow_the_money_context=seed,
        market_context=market_context,
        competitor_handling=competitor_handling,
        ownership_control_handling=ownership_control_handling,
        research_state=research_state,
        source_roles={
            SOURCE_EDGAR: "primary_source_backed" if (buckets["business"] or buckets["risk"]) else "absent",
            SOURCE_ALPACA: tradability["status"],
            SOURCE_SEED: seed.get("status"),
            SOURCE_EXTERNAL: "not_used",
            SOURCE_DERIVED: "issuer_resolution+role_bucketing",
        },
        assembled_at=retrieved_at,
    )


# --- live wiring (read-only) ---------------------------------------------------------------
def _read_knowgraph_records(project_id: str, *, base_url: str = "http://localhost:4000",
                            opener: Optional[Callable[[str], Mapping[str, Any]]] = None) -> dict[str, Any]:
    """Reuse the EXISTING read-only KnowGraph route (no duplicate store/query/client)."""
    url = f"{base_url}/api/knowgraph/semantic-graph?projectId={project_id}"
    if opener is not None:
        return dict(opener(url))
    req = urllib.request.Request(url, headers={"Accept": "application/json"}, method="GET")
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def import_app_python_models_module(module_name: str):
    """Import ``app.python_models.<module_name>`` from apps/python-models CLEANLY.

    Durable boundary: ``apps/python-models/app`` is now a REGULAR package (it carries an
    ``__init__.py``), so ``app`` resolves to the real package whenever ``apps/python-models``
    precedes a colliding top-level ``app.py`` on sys.path — which every supported launch path
    guarantees (the uvicorn sidecar runs with ``apps/python-models`` as the package root; the
    documented ``-m`` smoke and the services/knowgraph test conftest put it ahead). This function
    performs NO sys.path mutation and NO sys.modules purge; it is a plain canonical import.
    """
    import importlib

    return importlib.import_module(f"app.python_models.{module_name}")


def import_alpaca_market_data():
    """Import the EXISTING read-only Alpaca market module via the canonical package import."""
    return import_app_python_models_module("alpaca_market_data")


def _live_alpaca_snapshot(ticker: str) -> Mapping[str, Any]:
    """Existing read-only Alpaca client; honest status on any failure (never not_tradeable)."""
    try:
        amd = import_alpaca_market_data()
    except Exception as exc:  # noqa: BLE001 — provider module path not importable here
        return {"status": "unconfigured", "symbol": ticker.upper(),
                "diagnostics": f"alpaca_module_unavailable:{exc}"}
    try:
        snap = amd.get_market_snapshot(amd.AlpacaInstrumentRef(symbol=ticker.upper()))
        return snap.to_dict()
    except Exception as exc:  # noqa: BLE001
        return {"status": "error", "symbol": ticker.upper(), "diagnostics": f"alpaca_call_failed:{type(exc).__name__}"}


def run_issuer_case(
    issuer_input: str,
    *,
    project_id: str,
    seed_context: Optional[SeedContextAdapter] = None,
    base_url: str = "http://localhost:4000",
    alpaca_snapshot: Optional[Callable[[str], Mapping[str, Any]]] = None,
) -> IssuerCase:
    """Live, READ-ONLY issuer case for one issuer in one project. Writes nothing."""
    graph = _read_knowgraph_records(project_id, base_url=base_url)
    return build_issuer_case(
        issuer_input,
        records=graph.get("records") or [],
        relationships=graph.get("relationships") or [],
        alpaca_snapshot=alpaca_snapshot or _live_alpaca_snapshot,
        seed_context=seed_context or SeedContextAdapter.unavailable(),
    )


if __name__ == "__main__":
    import sys

    pid = "20ac92da-01fd-4cf6-97cc-0672421e751a"
    tickers = sys.argv[1:] or ["RDW", "RKLB"]
    for tk in tickers:
        case = run_issuer_case(tk, project_id=pid)
        d = case.to_dict()
        print(f"\n==== ISSUER CASE: {tk} ====")
        print("identity:", d["issuer_identity"].get("resolution_status"),
              d["issuer_identity"].get("ticker"), "cik", d["issuer_identity"].get("cik"))
        print("tradability:", d["tradability"]["status"], "-", d["tradability"]["detail"])
        print("edgar business:", len(d["edgar_evidence"]["business"]),
              "risk:", len(d["edgar_evidence"]["risk"]),
              "mgmt/capital:", len(d["edgar_evidence"]["capital_control_ownership"]),
              "filings:", len(d["edgar_evidence"]["filings"]))
        print("seed:", d["follow_the_money_context"]["status"])
        print("competitors:", d["competitor_handling"]["resolution"])
        print("source_roles:", d["source_roles"])
