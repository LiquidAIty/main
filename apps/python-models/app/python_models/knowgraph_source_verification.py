"""Mechanical document verification for atomic Know acceptance."""
# Entity: KnowGraph
# Relationship: This file verifies the one source document and exact evidence passage supplied to an atomic Know before Graphiti receives it.

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
from html.parser import HTMLParser
from io import BytesIO
import ipaddress
import re
import socket
import unicodedata
from typing import Any, Callable
from urllib.parse import urljoin, urlsplit

import httpx

from app.python_models.knowgraph_know_contract import safe_source_url


_MAX_DOCUMENT_BYTES = 2_000_000
_MAX_REDIRECTS = 5
_REDIRECT_STATUSES = frozenset({301, 302, 303, 307, 308})
_SOFT_FAILURE = re.compile(
    r"(?:\b404\b|page\s+not\s+found|no\s+such\s+key|specified\s+key\s+does\s+not\s+exist|access\s+denied)",
    re.IGNORECASE,
)
_WORD = re.compile(r"[a-z0-9]+")
_DATE_YEAR = re.compile(r"\b(?:19|20)\d{2}\b")
_STOP_WORDS = frozenset({
    "and", "the", "for", "from", "with", "that", "this", "into", "its", "inc",
    "corp", "corporation", "company", "report", "press", "release", "official",
})


class KnowSourceVerificationError(ValueError):
    """A source could not become verified provenance."""


class _DocumentText(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._skip = 0
        self._title = False
        self.title_parts: list[str] = []
        self.text_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        del attrs
        lowered = tag.lower()
        if lowered in {"script", "style", "noscript", "svg"}:
            self._skip += 1
        if lowered == "title":
            self._title = True

    def handle_endtag(self, tag: str) -> None:
        lowered = tag.lower()
        if lowered in {"script", "style", "noscript", "svg"} and self._skip:
            self._skip -= 1
        if lowered == "title":
            self._title = False

    def handle_data(self, data: str) -> None:
        if self._skip:
            return
        if data.strip():
            self.text_parts.append(data)
            if self._title:
                self.title_parts.append(data)


def _normalized_text(value: Any) -> str:
    text = unicodedata.normalize("NFKC", str(value or ""))
    text = text.translate(str.maketrans({
        "\u2018": "'", "\u2019": "'", "\u201c": '"', "\u201d": '"',
        "\u2013": "-", "\u2014": "-", "\u00a0": " ",
    }))
    return " ".join(text.split())


def _significant_tokens(value: str) -> set[str]:
    return {
        token for token in _WORD.findall(_normalized_text(value).casefold())
        if len(token) > 2 and token not in _STOP_WORDS
    }


def _public_host(url: str, resolver: Callable[..., Any]) -> None:
    hostname = (urlsplit(url).hostname or "").strip().lower()
    if not hostname or hostname == "localhost" or hostname.endswith(".local"):
        raise KnowSourceVerificationError("know_source_public_host_required")
    try:
        direct = ipaddress.ip_address(hostname)
        addresses = [direct]
    except ValueError:
        try:
            addresses = [
                ipaddress.ip_address(item[4][0])
                for item in resolver(hostname, 443, type=socket.SOCK_STREAM)
            ]
        except (OSError, ValueError) as error:
            raise KnowSourceVerificationError("know_source_resolution_failed") from error
    if not addresses or any(
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_multicast
        or address.is_reserved
        or address.is_unspecified
        for address in addresses
    ):
        raise KnowSourceVerificationError("know_source_public_host_required")


def _response_content(response: Any) -> bytes:
    content = bytes(getattr(response, "content", b""))
    if not content or len(content) > _MAX_DOCUMENT_BYTES:
        raise KnowSourceVerificationError("know_source_document_size_invalid")
    return content


def _document_text(content: bytes, content_type: str) -> tuple[str, str]:
    media_type = content_type.partition(";")[0].strip().lower()
    if media_type == "application/pdf" or content.startswith(b"%PDF"):
        try:
            from pypdf import PdfReader

            reader = PdfReader(BytesIO(content))
            text = " ".join((page.extract_text() or "") for page in reader.pages[:200])
        except Exception as error:
            raise KnowSourceVerificationError("know_source_document_unreadable") from error
        return "", _normalized_text(text)
    if media_type and not (
        media_type.startswith("text/")
        or media_type in {"application/json", "application/xml", "application/xhtml+xml"}
        or media_type.endswith("+json")
        or media_type.endswith("+xml")
    ):
        raise KnowSourceVerificationError("know_source_content_type_unsupported")
    decoded = content.decode("utf-8", errors="replace")
    if "<html" in decoded[:2000].casefold() or media_type in {"text/html", "application/xhtml+xml"}:
        parser = _DocumentText()
        parser.feed(decoded)
        return (
            _normalized_text(" ".join(parser.title_parts)),
            _normalized_text(" ".join(parser.text_parts)),
        )
    return "", _normalized_text(decoded)


def _identity_matches(expected: str, actual: str) -> bool:
    expected_tokens = _significant_tokens(expected)
    actual_tokens = _significant_tokens(actual)
    if not expected_tokens or not actual_tokens:
        return False
    overlap = len(expected_tokens & actual_tokens)
    return overlap >= max(1, (len(expected_tokens) + 1) // 2)


def verify_source_document(
    source: Any,
    *,
    client_factory: Callable[..., Any] | None = None,
    resolver: Callable[..., Any] | None = None,
    now: Callable[[], datetime] | None = None,
) -> dict[str, str]:
    """Fetch and mechanically verify one exact source/evidence pair.

    This proves document identity and quotation presence, not semantic entailment or
    an investment thesis. The accepting KnowGraph root remains responsible for that
    explicit interpretation.
    """

    if not isinstance(source, dict):
        raise KnowSourceVerificationError("know_source_required")
    url = safe_source_url(source.get("url"))
    title = _normalized_text(source.get("title"))
    publisher = _normalized_text(source.get("publisher"))
    evidence = _normalized_text(source.get("evidence"))
    if url is None or not title or not publisher or len(evidence) < 20:
        raise KnowSourceVerificationError("know_source_identity_and_evidence_required")
    resolve = resolver or socket.getaddrinfo
    factory = client_factory or httpx.Client
    headers = {
        "Accept": "text/html,application/xhtml+xml,application/pdf,text/plain,application/json,application/xml;q=0.9,*/*;q=0.5",
        "User-Agent": "LiquidAIty-SourceVerifier/1.0",
    }
    current = url
    try:
        with factory(timeout=httpx.Timeout(15.0), follow_redirects=False, headers=headers) as client:
            response = None
            for _index in range(_MAX_REDIRECTS + 1):
                _public_host(current, resolve)
                response = client.get(current)
                status = int(response.status_code)
                if status in _REDIRECT_STATUSES:
                    location = str(response.headers.get("location") or "").strip()
                    redirected = safe_source_url(urljoin(current, location))
                    if redirected is None:
                        raise KnowSourceVerificationError("know_source_redirect_invalid")
                    current = redirected
                    continue
                break
            else:
                raise KnowSourceVerificationError("know_source_redirect_limit_exceeded")
    except KnowSourceVerificationError:
        raise
    except httpx.TimeoutException as error:
        raise KnowSourceVerificationError("know_source_temporary_access_failure") from error
    except httpx.HTTPError as error:
        raise KnowSourceVerificationError("know_source_temporary_access_failure") from error
    if response is None:
        raise KnowSourceVerificationError("know_source_temporary_access_failure")
    status = int(response.status_code)
    if status in {401, 403, 408, 425, 429} or status >= 500:
        raise KnowSourceVerificationError("know_source_temporary_access_failure")
    if status < 200 or status >= 300:
        raise KnowSourceVerificationError("know_source_http_failure")
    content = _response_content(response)
    document_title, document_text = _document_text(
        content,
        str(response.headers.get("content-type") or ""),
    )
    if not document_text:
        raise KnowSourceVerificationError("know_source_document_unreadable")
    early_text = document_text[:800]
    if _SOFT_FAILURE.search(document_title) or (
        not document_title and _SOFT_FAILURE.search(early_text)
    ) or "nosuchkey" in early_text.casefold():
        raise KnowSourceVerificationError("know_source_soft_failure")
    identity_text = " ".join((document_title, document_text[:6000]))
    if not _identity_matches(title, identity_text):
        raise KnowSourceVerificationError("know_source_document_identity_mismatch")
    publisher_identity = " ".join((urlsplit(current).hostname or "", identity_text))
    if not _identity_matches(publisher, publisher_identity):
        raise KnowSourceVerificationError("know_source_publisher_mismatch")
    if evidence.casefold() not in document_text.casefold():
        raise KnowSourceVerificationError("know_source_evidence_not_found")
    for date_field in ("publishedAt", "eventAt"):
        date_value = _normalized_text(source.get(date_field))
        if not date_value:
            continue
        years = _DATE_YEAR.findall(date_value)
        if not years or any(year not in document_text for year in years):
            raise KnowSourceVerificationError(f"know_source_{date_field}_mismatch")
    fetched_at = (now or (lambda: datetime.now(timezone.utc)))().astimezone(timezone.utc)
    result = {
        "url": url,
        "resolvedUrl": current,
        "title": title,
        "publisher": publisher,
        "evidence": evidence,
        "retrievedAt": fetched_at.isoformat().replace("+00:00", "Z"),
        "contentFingerprint": hashlib.sha256(document_text.encode("utf-8")).hexdigest(),
    }
    if document_title:
        result["documentTitle"] = document_title[:1000]
    for field in ("locator", "publishedAt", "eventAt"):
        value = _normalized_text(source.get(field))
        if value:
            result[field] = value[:1000]
    return result
