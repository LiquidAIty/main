"""SEC API (sec-api.io) WorldSignals provider — the first real WorldSignals lane.

Read-only filing-signal intake on the Python rails. Given an EXPLICIT issuer + form
filter + bounded time window, query the sec-api.io Query API and return typed
``WorldSignalEnvelope`` records. An explicitly selected envelope can become a
``SecFilingResearchProposal`` (a non-executing research handoff that reuses the
explicit TaskContextSlice ref shape).

Hard boundaries (enforced by tests):
  * no graph writes (KnowGraph/ThinkGraph), no task creation, no trading;
  * no scheduler, no streaming, no section/XBRL extraction;
  * the canonical source is always the original SEC.gov filing URL — sec-api.io is a
    processing/provider reference only;
  * no fabricated filings: when ``SEC_API_KEY`` is absent the provider returns the
    honest ``provider_unconfigured`` status; provider/transport failures return
    ``provider_error``; a malformed body returns ``invalid_response``;
  * the API key is read from the environment only and never appears in any returned
    object, replay identity, error string, or log.
"""

from __future__ import annotations

import hashlib
import json
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Optional

# SEC API key resolution goes through the shared typed config boundary (which loads the
# canonical apps/backend/.env), not a scattered os.getenv. Never returns the key publicly.
from app.python_models.provider_config import sec_api_key as sec_api_key_from_config

PROVIDER = "sec_api"
SIGNAL_TYPE = "sec_filing_published"
SEC_API_QUERY_URL = "https://api.sec-api.io"  # sec-api.io Query API (token-authenticated)
SEC_API_KEY_ENV = "SEC_API_KEY"
MAX_RESULT_LIMIT = 50

# WorldSignalEnvelope / provider statuses.
STATUS_AVAILABLE = "available"
STATUS_UNCONFIGURED = "provider_unconfigured"
STATUS_ERROR = "provider_error"
STATUS_INVALID = "invalid_response"

# Future approval/execution states (design constants — this module never advances
# them or performs the actions; the proposal only records an approvalState).
APPROVAL_STATES = (
    "draft",
    "research_requested",
    "research_reviewed",
    "coder_task_proposed",
    "coder_task_approved",
    "code_changed_and_tested",
    "paper_experiment_proposed",
    "paper_experiment_approved",
    "paper_experiment_completed",
    "result_reviewed",
)

GRAPH_KINDS = ("knowgraph", "thinkgraph", "codegraph")


# ---------------------------------------------------------------------------
# WorldSignalEnvelope contract.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class IssuerRef:
    ticker: Optional[str] = None
    cik: Optional[str] = None
    companyName: Optional[str] = None

    def is_explicit(self) -> bool:
        return bool(
            (self.ticker or "").strip()
            or (self.cik or "").strip()
            or (self.companyName or "").strip()
        )


@dataclass(frozen=True)
class FilingRef:
    accessionNumber: str
    formType: str
    filedAt: str
    filingUrl: str  # canonical original SEC.gov filing URL
    primaryDocumentUrl: Optional[str] = None
    periodOfReport: Optional[str] = None


@dataclass(frozen=True)
class SourceRefs:
    # sec-api.io processing reference — NOT the canonical source.
    providerResponseRef: str
    # canonical SEC.gov filing URL — the authoritative source of record.
    originalSecFilingRef: str


@dataclass(frozen=True)
class ReplayRef:
    # Deterministic identity of the provider query request (derived from the query
    # parameters only — never from the API key).
    providerQueryId: str
    # Reference to a recorded provider payload when one was captured for replay.
    recordedPayloadRef: Optional[str] = None


@dataclass(frozen=True)
class WorldSignalEnvelope:
    signalId: str
    provider: str
    signalType: str
    observedAt: str  # when the world event happened (filing filedAt)
    fetchedAt: str  # when this provider query ran
    status: str
    issuer: IssuerRef
    filing: Optional[FilingRef]
    sourceRefs: Optional[SourceRefs]
    freshness: Optional[str]
    replay: ReplayRef

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class SecFilingQuery:
    issuer: IssuerRef
    formTypes: list[str]
    fromDate: str  # ISO date (YYYY-MM-DD)
    toDate: str  # ISO date (YYYY-MM-DD)
    limit: int = 10


@dataclass(frozen=True)
class SecFilingSignalResult:
    status: str
    provider: str
    fetchedAt: str
    replay: ReplayRef
    envelopes: list[WorldSignalEnvelope] = field(default_factory=list)
    error: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "provider": self.provider,
            "fetchedAt": self.fetchedAt,
            "replay": asdict(self.replay),
            "envelopes": [e.to_dict() for e in self.envelopes],
            "error": self.error,
        }


# A transport is a callable(key, body) -> parsed JSON dict. Injected in tests so the
# mapping/validation paths run deterministically against recorded protocol fixtures
# with no network. The default transport performs the real urllib request.
Transport = Callable[[str, dict[str, Any]], dict[str, Any]]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _query_identity(query: SecFilingQuery) -> str:
    """Deterministic provider-query id from the query parameters only (no key)."""
    canonical = json.dumps(
        {
            "provider": PROVIDER,
            "ticker": (query.issuer.ticker or "").strip().upper(),
            "cik": (query.issuer.cik or "").strip(),
            "company": (query.issuer.companyName or "").strip(),
            "forms": sorted(f.strip() for f in query.formTypes if f.strip()),
            "from": query.fromDate,
            "to": query.toDate,
            "limit": query.limit,
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]
    return f"sec_api:query:{digest}"


def _lucene_query(query: SecFilingQuery) -> str:
    clauses: list[str] = []
    ticker = (query.issuer.ticker or "").strip()
    cik = (query.issuer.cik or "").strip()
    company = (query.issuer.companyName or "").strip()
    if ticker:
        clauses.append(f"ticker:{ticker}")
    if cik:
        clauses.append(f"cik:{cik}")
    if company and not ticker and not cik:
        clauses.append(f'companyName:"{company}"')
    forms = [f.strip() for f in query.formTypes if f.strip()]
    if forms:
        form_clause = " OR ".join(f'formType:"{f}"' for f in forms)
        clauses.append(f"({form_clause})")
    clauses.append(f"filedAt:[{query.fromDate} TO {query.toDate}]")
    return " AND ".join(clauses)


def _default_transport(key: str, body: dict[str, Any]) -> dict[str, Any]:
    """Real sec-api.io Query API call via urllib (the repo's HTTP convention).

    The token is passed as a query parameter per sec-api.io and is NEVER logged.
    """
    url = f"{SEC_API_QUERY_URL}?token={key}"
    data = json.dumps(body).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=20) as response:  # noqa: S310 (trusted host)
        raw = response.read()
        # sec-api.io returns gzip-compressed JSON; urllib does not auto-decompress, so a bare
        # decode('utf-8') raised UnicodeDecodeError on the gzip magic bytes. Decompress honestly
        # when the server marks the body gzip (or the gzip magic 0x1f8b is present).
        encoding = (response.headers.get("Content-Encoding") or "").lower()
        if "gzip" in encoding or raw[:2] == b"\x1f\x8b":
            import gzip

            raw = gzip.decompress(raw)
        payload = raw.decode("utf-8")
    return json.loads(payload)


def _validate_query(query: SecFilingQuery) -> None:
    if not isinstance(query, SecFilingQuery):
        raise TypeError("sec_filing_query_invalid")
    if not query.issuer.is_explicit():
        raise ValueError("sec_filing_explicit_issuer_required")
    forms = [f.strip() for f in (query.formTypes or []) if f.strip()]
    if not forms:
        raise ValueError("sec_filing_form_types_required")
    if not str(query.fromDate or "").strip() or not str(query.toDate or "").strip():
        raise ValueError("sec_filing_time_window_required")
    if str(query.fromDate) > str(query.toDate):
        raise ValueError("sec_filing_time_window_inverted")
    if not isinstance(query.limit, int) or query.limit < 1 or query.limit > MAX_RESULT_LIMIT:
        raise ValueError(f"sec_filing_limit_out_of_range_1_{MAX_RESULT_LIMIT}")


def _freshness(observed_at: str, fetched_at: str) -> Optional[str]:
    try:
        observed = datetime.fromisoformat(observed_at.replace("Z", "+00:00"))
        fetched = datetime.fromisoformat(fetched_at.replace("Z", "+00:00"))
        age = int((fetched - observed).total_seconds())
        return f"age_seconds={max(age, 0)}"
    except (ValueError, AttributeError):
        return None


def _map_filing_to_envelope(
    raw: dict[str, Any],
    *,
    fetched_at: str,
    replay: ReplayRef,
) -> Optional[WorldSignalEnvelope]:
    accession = str(raw.get("accessionNo") or raw.get("accessionNumber") or "").strip()
    form_type = str(raw.get("formType") or "").strip()
    filed_at = str(raw.get("filedAt") or "").strip()
    # linkToFilingDetails is the canonical SEC.gov filing-index URL.
    filing_url = str(raw.get("linkToFilingDetails") or raw.get("filingUrl") or "").strip()
    primary_doc = str(raw.get("linkToHtml") or raw.get("primaryDocumentUrl") or "").strip() or None
    period = str(raw.get("periodOfReport") or "").strip() or None
    if not accession or not form_type or not filed_at or not filing_url:
        return None  # honest: incomplete filing record is skipped, never fabricated
    issuer = IssuerRef(
        ticker=(str(raw.get("ticker") or "").strip() or None),
        cik=(str(raw.get("cik") or "").strip() or None),
        companyName=(str(raw.get("companyName") or "").strip() or None),
    )
    filing = FilingRef(
        accessionNumber=accession,
        formType=form_type,
        filedAt=filed_at,
        filingUrl=filing_url,
        primaryDocumentUrl=primary_doc,
        periodOfReport=period,
    )
    source_refs = SourceRefs(
        providerResponseRef=f"sec_api:{accession}",
        originalSecFilingRef=filing_url,
    )
    return WorldSignalEnvelope(
        signalId=f"sec_api:{accession}:{form_type}",
        provider=PROVIDER,
        signalType=SIGNAL_TYPE,
        observedAt=filed_at,
        fetchedAt=fetched_at,
        status=STATUS_AVAILABLE,
        issuer=issuer,
        filing=filing,
        sourceRefs=source_refs,
        freshness=_freshness(filed_at, fetched_at),
        replay=replay,
    )


def find_recent_sec_filing_signals(
    query: SecFilingQuery,
    *,
    transport: Optional[Transport] = None,
    api_key: Optional[str] = None,
) -> SecFilingSignalResult:
    """Find recent SEC filings for an EXPLICIT issuer/form/window → typed envelopes.

    Read-only. Never fabricates filings. Returns ``provider_unconfigured`` when no
    ``SEC_API_KEY`` is configured, ``provider_error`` on a transport/HTTP failure, and
    ``invalid_response`` on a malformed body.
    """
    _validate_query(query)
    fetched_at = _now_iso()
    replay = ReplayRef(providerQueryId=_query_identity(query))

    key = (api_key if api_key is not None else sec_api_key_from_config()).strip()
    if not key:
        return SecFilingSignalResult(
            status=STATUS_UNCONFIGURED,
            provider=PROVIDER,
            fetchedAt=fetched_at,
            replay=replay,
            envelopes=[],
            error=None,
        )

    body = {
        "query": _lucene_query(query),
        "from": "0",
        "size": str(query.limit),
        "sort": [{"filedAt": {"order": "desc"}}],
    }
    send = transport or _default_transport
    try:
        payload = send(key, body)
    except (urllib.error.HTTPError, urllib.error.URLError) as exc:
        # Never include the key/url; report only the safe reason.
        return SecFilingSignalResult(
            status=STATUS_ERROR,
            provider=PROVIDER,
            fetchedAt=fetched_at,
            replay=replay,
            envelopes=[],
            error=f"sec_api_request_failed: {type(exc).__name__}",
        )
    except Exception as exc:  # noqa: BLE001 — any transport failure is provider_error
        return SecFilingSignalResult(
            status=STATUS_ERROR,
            provider=PROVIDER,
            fetchedAt=fetched_at,
            replay=replay,
            envelopes=[],
            error=f"sec_api_transport_error: {type(exc).__name__}",
        )

    if not isinstance(payload, dict) or not isinstance(payload.get("filings"), list):
        return SecFilingSignalResult(
            status=STATUS_INVALID,
            provider=PROVIDER,
            fetchedAt=fetched_at,
            replay=replay,
            envelopes=[],
            error="sec_api_invalid_response_shape",
        )

    envelopes: list[WorldSignalEnvelope] = []
    for raw in payload["filings"][: query.limit]:
        if not isinstance(raw, dict):
            continue
        envelope = _map_filing_to_envelope(raw, fetched_at=fetched_at, replay=replay)
        if envelope is not None:
            envelopes.append(envelope)

    return SecFilingSignalResult(
        status=STATUS_AVAILABLE,
        provider=PROVIDER,
        fetchedAt=fetched_at,
        replay=replay,
        envelopes=envelopes,
        error=None,
    )


# ---------------------------------------------------------------------------
# Explicit selected-filing research handoff (non-executing).
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class GraphRawRef:
    """A reference into exactly one store (mirrors the TaskContextSlice ref shape)."""

    graphKind: str  # 'knowgraph' | 'thinkgraph' | 'codegraph'
    rawId: str


@dataclass(frozen=True)
class SecFilingResearchProposal:
    """A non-executing proposal that turns ONE explicitly selected filing signal into
    the input for a future research workflow. Creating it writes nothing — no KnowGraph
    node, no ThinkGraph task, no Research Agent call, no filing-text extraction."""

    proposalId: str
    taskId: str
    selectedSignalRef: str  # the chosen WorldSignalEnvelope.signalId
    selectedFilingRef: str  # the chosen filing accessionNumber
    requestedResearchOutput: str
    selectionReason: str
    approvalState: str = "draft"
    requestedSections: list[str] = field(default_factory=list)
    explicitKnowGraphRefs: list[GraphRawRef] = field(default_factory=list)
    explicitThinkGraphRefs: list[GraphRawRef] = field(default_factory=list)
    codeGraphScope: Optional[dict[str, Any]] = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def build_research_proposal(
    signal: WorldSignalEnvelope,
    *,
    proposal_id: str,
    task_id: str,
    requested_research_output: str,
    selection_reason: str,
    requested_sections: Optional[list[str]] = None,
    explicit_knowgraph_refs: Optional[list[GraphRawRef]] = None,
    explicit_thinkgraph_refs: Optional[list[GraphRawRef]] = None,
    code_graph_scope: Optional[dict[str, Any]] = None,
    approval_state: str = "draft",
) -> SecFilingResearchProposal:
    """Build a research proposal from an explicitly selected, available filing signal.

    Requires an explicit available signal that carries a filing. Performs no writes and
    starts no research. KnowGraph refs default to empty — knowledge is opt-in only.
    """
    if not isinstance(signal, WorldSignalEnvelope):
        raise TypeError("research_proposal_requires_signal_envelope")
    if signal.status != STATUS_AVAILABLE or signal.filing is None:
        raise ValueError("research_proposal_requires_available_filing_signal")
    if not str(signal.signalId or "").strip():
        raise ValueError("research_proposal_requires_explicit_signal_id")
    return SecFilingResearchProposal(
        proposalId=str(proposal_id),
        taskId=str(task_id),
        selectedSignalRef=signal.signalId,
        selectedFilingRef=signal.filing.accessionNumber,
        requestedResearchOutput=str(requested_research_output),
        selectionReason=str(selection_reason),
        approvalState=str(approval_state),
        requestedSections=list(requested_sections or []),
        explicitKnowGraphRefs=list(explicit_knowgraph_refs or []),
        explicitThinkGraphRefs=list(explicit_thinkgraph_refs or []),
        codeGraphScope=code_graph_scope,
    )


def validate_research_proposal(proposal: SecFilingResearchProposal) -> dict[str, Any]:
    """Validate the proposal. Requires an explicit selected signal id + task + reason,
    well-formed reversible refs, and a valid approvalState. Empty KnowGraph refs are
    valid. Returns ``{ok, errors}`` so callers can fail closed."""
    errors: list[str] = []
    if not isinstance(proposal, SecFilingResearchProposal):
        return {"ok": False, "errors": ["proposal_missing"]}
    if not str(proposal.selectedSignalRef or "").strip():
        errors.append("explicit selectedSignalRef required")
    if not str(proposal.taskId or "").strip():
        errors.append("taskId required")
    if not str(proposal.selectionReason or "").strip():
        errors.append("selectionReason required")
    if proposal.approvalState not in APPROVAL_STATES:
        errors.append("approvalState must be a declared workflow state")
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
