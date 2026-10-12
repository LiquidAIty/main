"""Literal two-sided Know payload validation and projection."""

from __future__ import annotations

import json
from typing import Any


KNOW_SCHEMA_VERSION = "know.v1"
_CITATION_FIELDS = ("url", "title", "publisher", "locator", "supports")


def _citation(value: Any) -> dict[str, str] | None:
    if not isinstance(value, dict):
        return None
    url = str(value.get("url") or "").strip()
    if not url:
        return None
    result = {"url": url}
    for field in _CITATION_FIELDS[1:]:
        text = str(value.get(field) or "").strip()
        if text:
            result[field] = text
    return result


def _side(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    body = str(value.get("body") or "").strip()
    if not body:
        return None
    citations: list[dict[str, str]] = []
    seen_urls: set[str] = set()
    raw_citations = value.get("citations")
    if not isinstance(raw_citations, list):
        return None
    for raw_citation in raw_citations:
        citation = _citation(raw_citation)
        if citation is None or citation["url"] in seen_urls:
            continue
        seen_urls.add(citation["url"])
        citations.append(citation)
    if not citations:
        return None
    detail = str(value.get("detail") or "").strip()
    return {
        "body": body,
        **({"detail": detail} if detail else {}),
        "citations": citations,
    }


def normalize_know_payload(value: Any) -> dict[str, Any] | None:
    """Return one valid atomic Know or ``None`` without inferring missing meaning."""

    if not isinstance(value, dict):
        return None
    if value.get("schemaVersion") != KNOW_SCHEMA_VERSION:
        return None
    idea = _side(value.get("idea"))
    counter_idea = _side(value.get("counterIdea"))
    if idea is None or counter_idea is None:
        return None
    return {
        "schemaVersion": KNOW_SCHEMA_VERSION,
        "idea": idea,
        "counterIdea": counter_idea,
    }


def know_from_properties(properties: dict[str, Any]) -> dict[str, Any] | None:
    """Read the exact structured Know stored in one Graphiti episode."""

    content = properties.get("content")
    if not isinstance(content, str) or not content.strip():
        return None
    try:
        decoded = json.loads(content)
    except (TypeError, ValueError):
        return None
    return normalize_know_payload(decoded)


def encode_know_payload(
    idea: Any,
    counter_idea: Any,
) -> tuple[str, str]:
    """Encode one Know and its exact citation URL list for Graphiti provenance."""

    payload = normalize_know_payload({
        "schemaVersion": KNOW_SCHEMA_VERSION,
        "idea": idea,
        "counterIdea": counter_idea,
    })
    if payload is None:
        raise ValueError("know_requires_cited_idea_and_counter_idea")
    urls = list(dict.fromkeys(
        citation["url"]
        for side in (payload["idea"], payload["counterIdea"])
        for citation in side["citations"]
    ))
    return (
        json.dumps(
            payload,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ),
        json.dumps(urls, ensure_ascii=False, separators=(",", ":")),
    )


def know_word_count(know: dict[str, Any]) -> int:
    """Count every human-readable body/detail field in one valid Know."""

    texts = [
        str(side.get(field) or "")
        for side in (know["idea"], know["counterIdea"])
        for field in ("body", "detail")
    ]
    return sum(len(text.split()) for text in texts)
