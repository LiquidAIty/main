"""Focused coverage for the SEC API WorldSignals provider.

No live network: every "available" path runs against an explicitly labeled PROTOCOL
FIXTURE injected as the transport. The no-key, error, and invalid-shape paths run with
no transport at all. No real SEC data, no graph writes, no API key in any output.
"""

# Entity: WorldSignals
# Relationship: WorldSignals verifies SEC query validation, bounded protocol-fixture mapping, canonical SEC provenance, safe unavailable and invalid responses, and secret redaction without claiming live-provider acceptance.

import json
import gzip
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
import urllib.error

import pytest

from app.python_models import sec_filing_signals as sec
from app.python_models.sec_filing_signals import (
    IssuerRef,
    SecFilingQuery,
    STATUS_AVAILABLE,
    STATUS_ERROR,
    STATUS_INVALID,
    STATUS_UNCONFIGURED,
    find_recent_sec_filing_signals,
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


@pytest.mark.parametrize(
    "query",
    (
        SecFilingQuery(IssuerRef(ticker='RDW" OR *:*'), ["8-K"], "2024-01-01", "2024-12-31"),
        SecFilingQuery(IssuerRef(cik="123 OR 456"), ["8-K"], "2024-01-01", "2024-12-31"),
        SecFilingQuery(IssuerRef(companyName="Bad\nCompany"), ["8-K"], "2024-01-01", "2024-12-31"),
        SecFilingQuery(IssuerRef(ticker="RDW"), ["8-K\" OR *:*"], "2024-01-01", "2024-12-31"),
        SecFilingQuery(IssuerRef(ticker="RDW"), ["8-K"], "2024-1-1", "2024-12-31"),
        SecFilingQuery(IssuerRef(ticker="RDW"), ["8-K"], "2024-02-30", "2024-12-31"),
    ),
)
def test_query_fields_reject_provider_syntax_and_invalid_dates(query):
    with pytest.raises(ValueError, match="sec_filing_"):
        find_recent_sec_filing_signals(query, api_key="x")


def test_company_phrase_is_escaped_in_the_provider_query():
    query = SecFilingQuery(
        issuer=IssuerRef(companyName='Example "Space" \\ Holdings'),
        formTypes=["8-k"],
        fromDate="2024-01-01",
        toDate="2024-12-31",
    )
    captured = {}

    def transport(_key, body):
        captured.update(body)
        return {"filings": []}

    result = find_recent_sec_filing_signals(query, transport=transport, api_key="x")

    assert result.status == STATUS_AVAILABLE
    assert 'companyName:"Example \\"Space\\" \\\\ Holdings"' in captured["query"]
    assert 'formType:"8-K"' in captured["query"]


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
        raise urllib.error.URLError("network down")

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


def test_incomplete_or_non_sec_filing_record_is_skipped_not_fabricated():
    def _partial(_k, _b):
        return {"filings": [
            {"formType": "8-K"},  # missing accession/filedAt/url
            {
                "accessionNo": "evil-source",
                "formType": "8-K",
                "filedAt": "2024-05-10T16:30:00-04:00",
                "linkToFilingDetails": (
                    "https://www.sec.gov.example.test/Archives/fake"
                ),
            },
            {
                "accessionNo": "valid-source",
                "formType": "8-K",
                "filedAt": "2024-05-10T16:30:00-04:00",
                "linkToFilingDetails": (
                    "https://www.sec.gov/Archives/edgar/data/1/valid-index.htm"
                ),
                "linkToHtml": "https://example.test/not-sec.htm",
            },
        ]}

    result = find_recent_sec_filing_signals(_explicit_query(), transport=_partial, api_key="TEST-KEY")
    assert result.status == STATUS_AVAILABLE
    assert len(result.envelopes) == 1
    assert result.envelopes[0].filing.accessionNumber == "valid-source"
    assert result.envelopes[0].filing.primaryDocumentUrl is None
    assert result.omittedRecords == 2


def test_unexpected_transport_code_defect_is_not_disguised_as_provider_error():
    with pytest.raises(RuntimeError, match="programming defect"):
        find_recent_sec_filing_signals(
            _explicit_query(),
            transport=lambda _key, _body: (_ for _ in ()).throw(
                RuntimeError("programming defect")
            ),
            api_key="TEST-KEY",
        )


def test_gzip_decompression_is_bounded(monkeypatch):
    compressed = gzip.compress(b"x" * (sec.MAX_DECOMPRESSED_RESPONSE_BYTES + 1))

    class Response:
        headers = {"Content-Encoding": "gzip"}

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def read(self, _limit):
            return compressed

    monkeypatch.setattr(sec._SEC_OPENER, "open", lambda *_args, **_kwargs: Response())

    with pytest.raises(ValueError, match="sec_api_response_too_large"):
        sec._default_transport("secret", {"query": "bounded"})


def test_provider_redirect_does_not_forward_the_api_key(monkeypatch):
    received_queries: list[str] = []

    class TargetHandler(BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802 - stdlib handler contract
            received_queries.append(self.path)
            self.send_response(200)
            self.end_headers()

        def log_message(self, *_args):
            return None

    target = ThreadingHTTPServer(("127.0.0.1", 0), TargetHandler)
    target_thread = Thread(target=target.serve_forever, daemon=True)
    target_thread.start()

    class RedirectHandler(BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802 - stdlib handler contract
            self.send_response(307)
            self.send_header("Location", f"http://127.0.0.1:{target.server_port}/capture")
            self.send_header("Content-Length", "0")
            self.end_headers()

        def log_message(self, *_args):
            return None

    redirect = ThreadingHTTPServer(("127.0.0.1", 0), RedirectHandler)
    redirect_thread = Thread(target=redirect.serve_forever, daemon=True)
    redirect_thread.start()
    monkeypatch.setattr(sec, "SEC_API_QUERY_URL", f"http://127.0.0.1:{redirect.server_port}")
    try:
        with pytest.raises(urllib.error.HTTPError) as error:
            sec._default_transport("secret-token", {"query": "bounded"})
        assert error.value.code == 307
        assert received_queries == []
    finally:
        redirect.shutdown()
        target.shutdown()
        redirect.server_close()
        target.server_close()
        redirect_thread.join(timeout=2)
        target_thread.join(timeout=2)
