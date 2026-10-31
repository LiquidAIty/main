"""Read and validate first-class Graphiti Know properties."""

# Graph + less = more: less code that does the same work as more code is more useful.
# Entity names the feature; Relationship explains why this file belongs and what it contributes.
# Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
# Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
# Entity: KnowGraph
# Relationship: This file validates typed Know and citation properties and decodes bounded research-origin records from first-class Graphiti nodes.

from __future__ import annotations

import re
import json
from typing import Any
from urllib.parse import parse_qsl, urlsplit


KNOW_DIRECTION_RELATIONS = frozenset({"supports", "challenges", "context"})
_SECRET_QUERY_KEY = re.compile(
    r"(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|authorization)",
    re.IGNORECASE,
)


def safe_source_url(value: Any) -> str | None:
    """Return one credential-free HTTPS URL shape or ``None``."""

    url = str(value or "").strip()
    if (
        not url
        or len(url) > 2048
        or "\\" in url
        or any(ord(character) < 32 or ord(character) == 127 for character in url)
    ):
        return None
    try:
        parsed = urlsplit(url)
        port = parsed.port
    except ValueError:
        return None
    del port
    if (
        parsed.scheme.lower() != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or any(
            _SECRET_QUERY_KEY.search(key)
            for key, _value in parse_qsl(parsed.query, keep_blank_values=True)
        )
    ):
        return None
    return url


def _text(value: Any, *, maximum: int) -> str | None:
    text = str(value or "").strip()
    return text if text and len(text) <= maximum else None


def citation_from_properties(properties: dict[str, Any]) -> dict[str, str] | None:
    url = safe_source_url(properties.get("citation_url"))
    title = _text(properties.get("citation_title"), maximum=1000)
    publisher = _text(properties.get("citation_publisher"), maximum=1000)
    evidence = _text(properties.get("citation_evidence"), maximum=12000)
    if url is None or title is None or publisher is None or evidence is None:
        return None
    citation = {
        "url": url,
        "title": title,
        "publisher": publisher,
        "evidence": evidence,
    }
    optional = {
        "locator": ("citation_locator", 1000, False),
        "publishedAt": ("citation_published_at", 1000, False),
        "eventAt": ("citation_event_at", 1000, False),
        "resolvedUrl": ("citation_resolved_url", 2048, True),
        "retrievedAt": ("citation_retrieved_at", 1000, False),
        "documentTitle": ("citation_document_title", 1000, False),
        "contentFingerprint": ("citation_content_fingerprint", 128, False),
    }
    for public_name, (property_name, maximum, url_field) in optional.items():
        text = _text(properties.get(property_name), maximum=maximum)
        if text is None:
            continue
        if url_field and safe_source_url(text) is None:
            return None
        citation[public_name] = text
    return citation


def know_from_properties(properties: dict[str, Any]) -> dict[str, Any] | None:
    """Read one typed ``Episodic:Know`` node without parsing its episode content."""

    observation = _text(properties.get("observation"), maximum=8000)
    interpretation = _text(properties.get("interpretation"), maximum=8000)
    citation = citation_from_properties(properties)
    if observation is None or interpretation is None or citation is None:
        return None
    proposition = _text(properties.get("proposition"), maximum=4000)
    relation = str(properties.get("direction") or "").strip().lower()
    if bool(proposition) != bool(relation):
        return None
    if relation and relation not in KNOW_DIRECTION_RELATIONS:
        return None
    content_hash = _text(properties.get("content_hash"), maximum=64)
    origins = []
    for raw in properties.get("research_origins") or []:
        try:
            origin = json.loads(raw)
        except (ValueError, TypeError):
            continue
        if (isinstance(origin, dict) and isinstance(origin.get("requestId"), str)
                and isinstance(origin.get("thinkIds"), list) and isinstance(origin.get("entityNames"), list)):
            origins.append(origin)
    return {
        "kind": "Know",
        "observation": observation,
        "interpretation": interpretation,
        "citation": citation,
        **(
            {"direction": {"proposition": proposition, "relation": relation}}
            if proposition and relation
            else {}
        ),
        **({"contentHash": content_hash} if content_hash else {}),
        **({"researchOrigins": origins[-12:], "researchOriginCount": len(origins)} if origins else {}),
    }


def know_word_count(know: dict[str, Any]) -> int:
    """Count the human-readable reasoning carried by one Know."""

    return sum(
        len(str(know.get(field) or "").split())
        for field in ("observation", "interpretation")
    )
