"""Atomic Know validation, encoding, legacy read compatibility, and deduplication."""
# Entity: KnowGraph
# Relationship: This file validates and encodes one verified sourced observation while retaining explicit read compatibility for historical paired Knows.

from __future__ import annotations

import hashlib
import json
import re
from typing import Any
from urllib.parse import parse_qsl, urlsplit
from uuid import UUID, uuid5


KNOW_SCHEMA_VERSION = "know.v2"
LEGACY_KNOW_SCHEMA_VERSION = "know.v1"
KNOW_EPISODE_NAMESPACE = UUID("771f50fc-36d8-4dfc-9b08-f884d7bc134c")
KNOW_DIRECTION_RELATIONS = frozenset({"supports", "challenges", "context"})
_LEGACY_CITATION_FIELDS = ("url", "title", "publisher", "locator", "supports")
_SOURCE_TEXT_FIELDS = (
    "title", "publisher", "evidence", "locator", "publishedAt", "eventAt",
    "resolvedUrl", "retrievedAt", "documentTitle", "contentFingerprint",
)
_SECRET_QUERY_KEY = re.compile(
    r"(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|authorization)",
    re.IGNORECASE,
)


def safe_source_url(value: Any) -> str | None:
    """Return one credential-free HTTPS URL shape or ``None``.

    Network address and document verification happen at the acceptance boundary;
    this structural check also keeps historical records safe to render.
    """

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
        or any(_SECRET_QUERY_KEY.search(key) for key, _value in parse_qsl(
            parsed.query,
            keep_blank_values=True,
        ))
    ):
        return None
    return url


def _text(value: Any, *, maximum: int) -> str | None:
    text = str(value or "").strip()
    return text if text and len(text) <= maximum else None


def _legacy_citation(value: Any) -> dict[str, str] | None:
    if not isinstance(value, dict):
        return None
    url = safe_source_url(value.get("url"))
    if url is None:
        return None
    result = {"url": url}
    for field in _LEGACY_CITATION_FIELDS[1:]:
        text = str(value.get(field) or "").strip()
        if text:
            result[field] = text
    return result


def _legacy_side(value: Any) -> dict[str, Any] | None:
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
        citation = _legacy_citation(raw_citation)
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


def _legacy_know(value: dict[str, Any]) -> dict[str, Any] | None:
    idea = _legacy_side(value.get("idea"))
    counter_idea = _legacy_side(value.get("counterIdea"))
    if idea is None or counter_idea is None:
        return None
    return {
        "schemaVersion": LEGACY_KNOW_SCHEMA_VERSION,
        "legacy": True,
        "idea": idea,
        "counterIdea": counter_idea,
    }


def _source(value: Any) -> dict[str, str] | None:
    if not isinstance(value, dict):
        return None
    url = safe_source_url(value.get("url"))
    title = _text(value.get("title"), maximum=1000)
    publisher = _text(value.get("publisher"), maximum=1000)
    evidence = _text(value.get("evidence"), maximum=12000)
    if url is None or title is None or publisher is None or evidence is None:
        return None
    result = {
        "url": url,
        "title": title,
        "publisher": publisher,
        "evidence": evidence,
    }
    for field in _SOURCE_TEXT_FIELDS:
        if field in result:
            continue
        maximum = 2048 if field == "resolvedUrl" else 1000
        if field == "contentFingerprint":
            maximum = 128
        text = _text(value.get(field), maximum=maximum)
        if text is not None:
            if field == "resolvedUrl" and safe_source_url(text) is None:
                return None
            result[field] = text
    return result


def _direction(value: Any) -> dict[str, str] | None:
    if value is None:
        return {}
    if not isinstance(value, dict):
        return None
    proposition = _text(value.get("proposition"), maximum=4000)
    relation = str(value.get("relation") or "").strip().lower()
    if proposition is None or relation not in KNOW_DIRECTION_RELATIONS:
        return None
    return {"proposition": proposition, "relation": relation}


def normalize_atomic_know_payload(value: Any) -> dict[str, Any] | None:
    """Return one valid atomic Know without inferring source or direction."""

    if not isinstance(value, dict) or value.get("schemaVersion") != KNOW_SCHEMA_VERSION:
        return None
    observation = _text(value.get("observation"), maximum=8000)
    interpretation = _text(value.get("interpretation"), maximum=8000)
    source = _source(value.get("source"))
    direction = _direction(value.get("direction"))
    if observation is None or interpretation is None or source is None or direction is None:
        return None
    dedupe_key = _text(value.get("dedupeKey"), maximum=128)
    return {
        "schemaVersion": KNOW_SCHEMA_VERSION,
        "observation": observation,
        "interpretation": interpretation,
        "source": source,
        **({"direction": direction} if direction else {}),
        **({"dedupeKey": dedupe_key} if dedupe_key else {}),
    }


def normalize_know_payload(value: Any) -> dict[str, Any] | None:
    """Read either the active atomic schema or an explicit historical schema."""

    if not isinstance(value, dict):
        return None
    if value.get("schemaVersion") == KNOW_SCHEMA_VERSION:
        return normalize_atomic_know_payload(value)
    if value.get("schemaVersion") == LEGACY_KNOW_SCHEMA_VERSION:
        return _legacy_know(value)
    return None


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


def know_dedupe_key(observation: str, source: dict[str, str]) -> str:
    """Stable identity for one source-backed observation, independent of display title."""

    material = json.dumps({
        "observation": " ".join(observation.casefold().split()),
        "sourceUrl": str(source.get("resolvedUrl") or source.get("url") or "").casefold(),
        "evidence": " ".join(str(source.get("evidence") or "").casefold().split()),
    }, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def know_episode_uuid(project_id: str, entity_name: str, dedupe_key: str) -> str:
    """Deterministic Graphiti episode UUID that makes duplicate acceptance idempotent."""

    return str(uuid5(
        KNOW_EPISODE_NAMESPACE,
        f"{str(project_id).strip()}\0{str(entity_name).strip().casefold()}\0{dedupe_key}",
    ))


def encode_know_payload(
    observation: Any,
    source: Any,
    interpretation: Any,
    direction: Any = None,
) -> tuple[str, str, str]:
    """Encode one verified atomic Know, one source URL, and its dedupe key."""

    initial = normalize_atomic_know_payload({
        "schemaVersion": KNOW_SCHEMA_VERSION,
        "observation": observation,
        "interpretation": interpretation,
        "source": source,
        **({"direction": direction} if direction is not None else {}),
    })
    if initial is None:
        raise ValueError("know_requires_observation_interpretation_and_verified_source")
    dedupe_key = know_dedupe_key(initial["observation"], initial["source"])
    payload = {**initial, "dedupeKey": dedupe_key}
    return (
        json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
        json.dumps([
            payload["source"].get("resolvedUrl") or payload["source"]["url"],
        ], ensure_ascii=False, separators=(",", ":")),
        dedupe_key,
    )


def know_word_count(know: dict[str, Any]) -> int:
    """Count every human-readable field without relabeling historical records."""

    if know.get("schemaVersion") == KNOW_SCHEMA_VERSION:
        texts = [know.get("observation"), know.get("interpretation")]
    else:
        texts = [
            side.get(field)
            for side in (know.get("idea") or {}, know.get("counterIdea") or {})
            for field in ("body", "detail")
        ]
    return sum(len(str(text or "").split()) for text in texts)
