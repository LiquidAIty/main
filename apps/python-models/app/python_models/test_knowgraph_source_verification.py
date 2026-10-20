# Entity: KnowGraph
# Relationship: This file verifies the source-acceptance boundary rejects invented, unavailable, mismatched, soft-error, and unsupported documents while preserving exact verified redirects and evidence.

from __future__ import annotations

from datetime import datetime, timezone

import httpx
import pytest

from app.python_models.knowgraph_source_verification import (
    KnowSourceVerificationError,
    verify_source_document,
)


EVIDENCE = "Revenue for the quarter increased to 100 million dollars."


class Response:
    def __init__(
        self,
        status: int,
        body: str,
        *,
        content_type: str = "text/html; charset=utf-8",
        location: str = "",
    ) -> None:
        self.status_code = status
        self.content = body.encode("utf-8")
        self.headers = {"content-type": content_type}
        if location:
            self.headers["location"] = location


class Client:
    def __init__(self, routes: dict[str, Response | Exception], **_kwargs) -> None:
        self.routes = routes

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def get(self, url: str):
        value = self.routes[url]
        if isinstance(value, Exception):
            raise value
        return value


def _resolver(_host: str, _port: int, **_kwargs):
    return [(None, None, None, None, ("93.184.216.34", 443))]


def _source(url: str = "https://investor.example.test/result") -> dict:
    return {
        "url": url,
        "title": "Example Corporation quarterly results",
        "publisher": "Example Corporation",
        "evidence": EVIDENCE,
        "publishedAt": "2026-10-19",
    }


def _page(*, title: str = "Example Corporation quarterly results") -> str:
    return (
        f"<html><head><title>{title}</title></head><body>"
        "<h1>Example Corporation quarterly results</h1>"
        "<p>Published October 19, 2026.</p>"
        f"<p>{EVIDENCE}</p></body></html>"
    )


def _verify(source: dict, routes: dict[str, Response | Exception]) -> dict[str, str]:
    return verify_source_document(
        source,
        client_factory=lambda **kwargs: Client(routes, **kwargs),
        resolver=_resolver,
        now=lambda: datetime(2026, 10, 20, tzinfo=timezone.utc),
    )


def test_verified_redirect_preserves_requested_and_resolved_source_identity() -> None:
    source = _source()
    result = _verify(source, {
        source["url"]: Response(302, "redirect", location="/archive/result.html"),
        "https://investor.example.test/archive/result.html": Response(200, _page()),
    })

    assert result["url"] == source["url"]
    assert result["resolvedUrl"] == "https://investor.example.test/archive/result.html"
    assert result["evidence"] == EVIDENCE
    assert result["documentTitle"] == "Example Corporation quarterly results"
    assert result["retrievedAt"] == "2026-10-20T00:00:00Z"
    assert len(result["contentFingerprint"]) == 64


def test_invented_or_unresolvable_url_is_rejected() -> None:
    def missing(*_args, **_kwargs):
        raise OSError("no such host")

    with pytest.raises(KnowSourceVerificationError, match="know_source_resolution_failed"):
        verify_source_document(
            _source("https://invented.invalid/result"),
            client_factory=lambda **kwargs: Client({}, **kwargs),
            resolver=missing,
        )


def test_hard_and_soft_404_documents_are_rejected() -> None:
    source = _source()
    with pytest.raises(KnowSourceVerificationError, match="know_source_http_failure"):
        _verify(source, {source["url"]: Response(404, "missing")})
    with pytest.raises(KnowSourceVerificationError, match="know_source_soft_failure"):
        _verify(source, {
            source["url"]: Response(
                200,
                "<html><head><title>404 Error</title></head><body>Page not found.</body></html>",
            ),
        })


def test_wrong_document_redirect_is_rejected_even_when_reachable() -> None:
    source = _source()
    with pytest.raises(
        KnowSourceVerificationError,
        match="know_source_document_identity_mismatch",
    ):
        _verify(source, {
            source["url"]: Response(302, "redirect", location="https://example.test/home"),
            "https://example.test/home": Response(
                200,
                "<html><head><title>Example home</title></head><body>General navigation.</body></html>",
            ),
        })


def test_reachable_page_without_the_claims_exact_evidence_is_not_verified() -> None:
    source = _source()
    with pytest.raises(KnowSourceVerificationError, match="know_source_evidence_not_found"):
        _verify(source, {
            source["url"]: Response(
                200,
                _page().replace(EVIDENCE, "The source contains a different result."),
            ),
        })


def test_temporary_access_failure_remains_incomplete() -> None:
    source = _source()
    request = httpx.Request("GET", source["url"])
    with pytest.raises(
        KnowSourceVerificationError,
        match="know_source_temporary_access_failure",
    ):
        _verify(source, {
            source["url"]: httpx.ReadTimeout("slow", request=request),
        })


def test_private_redirect_and_mismatched_date_are_rejected() -> None:
    source = _source()
    with pytest.raises(KnowSourceVerificationError, match="know_source_public_host_required"):
        verify_source_document(
            source,
            client_factory=lambda **kwargs: Client({
                source["url"]: Response(302, "redirect", location="https://127.0.0.1/private"),
            }, **kwargs),
            resolver=_resolver,
        )
    wrong_date = {**source, "publishedAt": "2025-10-19"}
    with pytest.raises(
        KnowSourceVerificationError,
        match="know_source_publishedAt_mismatch",
    ):
        _verify(wrong_date, {source["url"]: Response(200, _page())})
