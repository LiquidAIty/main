"""EDGAR core seed — append-only ledger + bounded SEC API Extractor lane.

Free direct-SEC discovery feeds an explicit extraction manifest; the sec-api.io
Extractor turns a single selected filing section into normalized evidence text. Every
attempted extraction is recorded in an append-only ledger and the hard 30-call budget
ceiling is enforced IN CODE — a 31st consuming call cannot happen. Raw provider payloads
go to the file replay cache keyed by accession + item; the durable EvidenceSection record
stores only normalized fields (no raw JSON, no giant text in graph properties later).

The SEC_API_KEY is read from apps/backend/.env via the environment and is never logged,
returned, or written to the ledger/cache.
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv

PROVIDER = "sec_api"
EXTRACTOR_URL = "https://api.sec-api.io/extractor"
MAX_EXTRACTIONS = 30  # hard ceiling for the approved core seed — NOT "approximately"
SEC_UA = "LiquidAIty EDGAR research seed (jeremiah.crossett@gmail.com)"

_REPO_ROOT = Path(__file__).resolve().parents[2]
_SEED_DIR = Path(__file__).resolve().parent / "edgar_seed_data"
_LEDGER_PATH = _SEED_DIR / "edgar_core_seed_ledger.jsonl"
_CACHE_DIR = _SEED_DIR / "cache"
_EVIDENCE_PATH = _SEED_DIR / "evidence_sections.jsonl"

_env_loaded = False


def _ensure_env() -> None:
    global _env_loaded
    if _env_loaded:
        return
    env_path = _REPO_ROOT / "apps" / "backend" / ".env"
    if env_path.exists():
        load_dotenv(env_path, override=False)
    _env_loaded = True


def _sec_api_key() -> str:
    _ensure_env()
    return str(os.getenv("SEC_API_KEY") or "").strip()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ensure_dirs() -> None:
    _SEED_DIR.mkdir(parents=True, exist_ok=True)
    _CACHE_DIR.mkdir(parents=True, exist_ok=True)


def consumed_count() -> int:
    """Count ledger rows that actually consumed an extraction credit (append-only truth)."""
    if not _LEDGER_PATH.exists():
        return 0
    n = 0
    for line in _LEDGER_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            if json.loads(line).get("budgetConsumed") is True:
                n += 1
        except json.JSONDecodeError:
            continue
    return n


def remaining_budget() -> int:
    return max(0, MAX_EXTRACTIONS - consumed_count())


@dataclass
class LedgerRow:
    seedRunId: str
    extractionOrdinal: int
    ticker: str
    cik: str
    accessionNumber: str
    formType: str
    itemId: str
    originalSecFilingUrl: str
    providerRequestId: str
    responseStatus: str
    budgetConsumed: bool
    durableWriteStatus: str
    skipOrFailureReason: Optional[str]
    timestamp: str = field(default_factory=_now)


def _append_ledger(row: LedgerRow) -> None:
    _ensure_dirs()
    with _LEDGER_PATH.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(asdict(row)) + "\n")


def _request_identity(filing_url: str, item: str) -> str:
    # Deterministic, key-free request identity for replay (provider + url + item).
    import hashlib

    digest = hashlib.sha256(f"{PROVIDER}|{filing_url}|{item}".encode("utf-8")).hexdigest()[:16]
    return f"sec_api:extractor:{digest}"


def _normalize_text(text: str) -> str:
    return " ".join(str(text or "").split())


def extract_section(
    *,
    seed_run_id: str,
    extraction_ordinal: int,
    ticker: str,
    cik: str,
    accession: str,
    form_type: str,
    item_id: str,
    filing_url: str,
    api_key: Optional[str] = None,
) -> dict[str, Any]:
    """Run ONE bounded SEC API Extractor call for an explicit filing section.

    Enforces the hard ceiling, records an append-only ledger row, caches the raw payload
    by request identity, and writes a normalized EvidenceSection. Never retries; never
    exposes the key. Returns a value-free summary dict.
    """
    _ensure_dirs()
    provider_request_id = _request_identity(filing_url, item_id)

    # Hard ceiling — refuse a consuming call past the budget; record as skipped.
    if consumed_count() >= MAX_EXTRACTIONS:
        _append_ledger(LedgerRow(
            seedRunId=seed_run_id, extractionOrdinal=extraction_ordinal, ticker=ticker, cik=cik,
            accessionNumber=accession, formType=form_type, itemId=item_id, originalSecFilingUrl=filing_url,
            providerRequestId=provider_request_id, responseStatus="skipped", budgetConsumed=False,
            durableWriteStatus="none", skipOrFailureReason="budget_ceiling_reached",
        ))
        return {"status": "skipped", "reason": "budget_ceiling_reached", "budgetConsumed": False,
                "remainingBudget": remaining_budget()}

    key = (api_key if api_key is not None else _sec_api_key())
    if not key:
        _append_ledger(LedgerRow(
            seedRunId=seed_run_id, extractionOrdinal=extraction_ordinal, ticker=ticker, cik=cik,
            accessionNumber=accession, formType=form_type, itemId=item_id, originalSecFilingUrl=filing_url,
            providerRequestId=provider_request_id, responseStatus="provider_unconfigured", budgetConsumed=False,
            durableWriteStatus="none", skipOrFailureReason="sec_api_unconfigured",
        ))
        return {"status": "provider_unconfigured", "budgetConsumed": False, "remainingBudget": remaining_budget()}

    query = urllib.parse.urlencode({"url": filing_url, "item": item_id, "type": "text", "token": key})
    request = urllib.request.Request(
        f"{EXTRACTOR_URL}?{query}",
        headers={"User-Agent": SEC_UA, "Accept-Encoding": "identity"},
        method="GET",
    )
    # A real network attempt is made now → it consumes a credit. No silent retry.
    try:
        with urllib.request.urlopen(request, timeout=40) as response:
            raw = response.read()
            if response.headers.get("Content-Encoding") == "gzip":
                import gzip
                raw = gzip.decompress(raw)
            elif raw[:2] == b"\x1f\x8b":  # gzip magic, even without the header
                import gzip
                raw = gzip.decompress(raw)
            body = raw.decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        _append_ledger(LedgerRow(
            seedRunId=seed_run_id, extractionOrdinal=extraction_ordinal, ticker=ticker, cik=cik,
            accessionNumber=accession, formType=form_type, itemId=item_id, originalSecFilingUrl=filing_url,
            providerRequestId=provider_request_id, responseStatus=f"http_{exc.code}", budgetConsumed=True,
            durableWriteStatus="none", skipOrFailureReason=f"extractor_http_{exc.code}",
        ))
        return {"status": "provider_error", "httpStatus": exc.code, "budgetConsumed": True,
                "remainingBudget": remaining_budget()}
    except urllib.error.URLError as exc:
        _append_ledger(LedgerRow(
            seedRunId=seed_run_id, extractionOrdinal=extraction_ordinal, ticker=ticker, cik=cik,
            accessionNumber=accession, formType=form_type, itemId=item_id, originalSecFilingUrl=filing_url,
            providerRequestId=provider_request_id, responseStatus="url_error", budgetConsumed=True,
            durableWriteStatus="none", skipOrFailureReason=f"extractor_url_error:{type(exc).__name__}",
        ))
        return {"status": "provider_error", "budgetConsumed": True, "remainingBudget": remaining_budget()}

    normalized = _normalize_text(body)
    empty = len(normalized) == 0

    # Raw payload → replay cache, keyed by request identity + accession + item (never the key).
    cache_file = _CACHE_DIR / f"{accession.replace('/', '_')}__{item_id}.json"
    cache_file.write_text(json.dumps({
        "providerRequestId": provider_request_id, "accessionNumber": accession, "itemId": item_id,
        "originalSecFilingUrl": filing_url, "fetchedAt": _now(), "rawTextLength": len(body), "rawText": body,
    }), encoding="utf-8")

    durable_status = "empty" if empty else "written"
    if not empty:
        with _EVIDENCE_PATH.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps({
                "type": "EvidenceSection", "issuer": ticker, "cik": cik, "accessionNumber": accession,
                "formType": form_type, "sectionItemId": item_id, "originalSecFilingUrl": filing_url,
                "providerReference": provider_request_id, "normalizedTextLength": len(normalized),
                "normalizedText": normalized, "extractionTimestamp": _now(),
            }) + "\n")

    _append_ledger(LedgerRow(
        seedRunId=seed_run_id, extractionOrdinal=extraction_ordinal, ticker=ticker, cik=cik,
        accessionNumber=accession, formType=form_type, itemId=item_id, originalSecFilingUrl=filing_url,
        providerRequestId=provider_request_id, responseStatus="available" if not empty else "empty",
        budgetConsumed=True, durableWriteStatus=durable_status,
        skipOrFailureReason=None if not empty else "empty_section",
    ))
    return {"status": "available" if not empty else "empty", "budgetConsumed": True,
            "normalizedTextLength": len(normalized), "preview": normalized[:280],
            "remainingBudget": remaining_budget(), "providerRequestId": provider_request_id}


# ---------------------------------------------------------------------------
# Free direct-SEC discovery + manifest orchestration (Space + AI + Energy atlas).
# ---------------------------------------------------------------------------

# Atlas Core-30 universe: 10 issuers x 3 narrative sections.
SPACE_AI_ENERGY_TICKERS = ["GHM", "RDW", "RKLB", "ASTS", "PL", "NVDA", "VRT", "ETN", "CEG", "PWR"]
# (form, sec-api Extractor item code, label) — the 3 sections per issuer.
SECTIONS = [
    ("10-K", "1", "Item 1 Business"),
    ("10-K", "1A", "Item 1A Risk Factors"),
    ("10-Q", "part1item2", "Part I Item 2 MD&A"),
]

_TICKER_CIK: Optional[dict[str, tuple[str, str]]] = None


def _sec_get_json(url: str) -> Any:
    req = urllib.request.Request(url, headers={"User-Agent": SEC_UA, "Accept-Encoding": "identity"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def resolve_cik(ticker: str) -> Optional[tuple[str, str]]:
    """Authoritative ticker -> (CIK, name) from free SEC data. Never guessed."""
    global _TICKER_CIK
    if _TICKER_CIK is None:
        data = _sec_get_json("https://www.sec.gov/files/company_tickers.json")
        _TICKER_CIK = {
            v["ticker"].upper(): (str(v["cik_str"]).zfill(10), v["title"]) for v in data.values()
        }
    return _TICKER_CIK.get(ticker.upper())


def discover_latest_filings(cik: str) -> dict[str, dict[str, str]]:
    """Latest NON-amended 10-K and 10-Q (accession + canonical primary-doc URL)."""
    subs = _sec_get_json(f"https://data.sec.gov/submissions/CIK{cik}.json")
    recent = subs["filings"]["recent"]
    n = len(recent["accessionNumber"])
    cik_int = str(int(cik))
    out: dict[str, dict[str, str]] = {}
    for want in ("10-K", "10-Q"):
        for i in range(n):
            if recent["form"][i] == want:  # exact match excludes 10-K/A, 10-Q/A
                acc = recent["accessionNumber"][i]
                doc = recent["primaryDocument"][i]
                out[want] = {
                    "accession": acc,
                    "url": f"https://www.sec.gov/Archives/edgar/data/{cik_int}/{acc.replace('-', '')}/{doc}",
                    "date": recent["filingDate"][i],
                }
                break
    return out


def _already_extracted(accession: str, item: str) -> bool:
    """True if a prior consumed call already produced a section for (accession, item)."""
    if not _LEDGER_PATH.exists():
        return False
    for line in _LEDGER_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            r = json.loads(line)
        except json.JSONDecodeError:
            continue
        if (r.get("accessionNumber") == accession and r.get("itemId") == item
                and r.get("budgetConsumed") and r.get("responseStatus") in ("available", "empty")):
            return True
    return False


def run_space_ai_energy_seed(tickers: Optional[list[str]] = None) -> dict[str, Any]:
    """Free discovery for each issuer, then bounded extraction over the 3-section manifest.
    Dedupes already-extracted (accession, item); the hard ceiling stops paid calls at 30."""
    tickers = tickers or SPACE_AI_ENERGY_TICKERS
    seed_run = f"edgar_core_seed:{int(time.time())}"
    ordinal = 0
    summary: dict[str, Any] = {
        "seedRunId": seed_run, "discovered": [], "extracted": 0, "empty": 0,
        "skipped": 0, "errors": 0, "dedupSkipped": 0,
    }
    for ticker in tickers:
        resolved = resolve_cik(ticker)
        if not resolved:
            summary["discovered"].append({"ticker": ticker, "error": "cik_not_found"})
            continue
        cik, name = resolved
        try:
            filings = discover_latest_filings(cik)
        except Exception as exc:  # noqa: BLE001
            summary["discovered"].append({"ticker": ticker, "cik": cik, "error": f"discovery_failed:{type(exc).__name__}"})
            continue
        summary["discovered"].append({
            "ticker": ticker, "cik": cik, "name": name,
            "filings": {k: v["accession"] for k, v in filings.items()},
        })
        for form, item, _label in SECTIONS:
            ordinal += 1
            f = filings.get(form)
            if not f:
                _append_ledger(LedgerRow(
                    seedRunId=seed_run, extractionOrdinal=ordinal, ticker=ticker, cik=cik,
                    accessionNumber="", formType=form, itemId=item, originalSecFilingUrl="",
                    providerRequestId="", responseStatus="skipped", budgetConsumed=False,
                    durableWriteStatus="none", skipOrFailureReason=f"no_{form}_found",
                ))
                summary["skipped"] += 1
                continue
            if _already_extracted(f["accession"], item):
                summary["dedupSkipped"] += 1
                continue
            res = extract_section(
                seed_run_id=seed_run, extraction_ordinal=ordinal, ticker=ticker, cik=cik,
                accession=f["accession"], form_type=form, item_id=item, filing_url=f["url"],
            )
            st = res.get("status")
            if st == "available":
                summary["extracted"] += 1
            elif st == "empty":
                summary["empty"] += 1
            elif st == "skipped":
                summary["skipped"] += 1
            else:
                summary["errors"] += 1
    summary["consumedTotal"] = consumed_count()
    summary["remainingBudget"] = remaining_budget()
    return summary


if __name__ == "__main__":
    result = run_space_ai_energy_seed()
    print(json.dumps(result, indent=1))
