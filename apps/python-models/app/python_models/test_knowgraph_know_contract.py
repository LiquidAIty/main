# Entity: KnowGraph
# Relationship: This file verifies the atomic Know schema, deterministic deduplication, safe provenance URLs, and explicit legacy paired-record compatibility.

from __future__ import annotations

import json

import pytest

from app.python_models.knowgraph_know_contract import (
    KNOW_SCHEMA_VERSION,
    LEGACY_KNOW_SCHEMA_VERSION,
    encode_know_payload,
    know_episode_uuid,
    know_from_properties,
    normalize_know_payload,
)


def _source(url: str = "https://example.test/source") -> dict:
    return {
        "url": url,
        "resolvedUrl": url,
        "title": "Primary source",
        "publisher": "Example",
        "evidence": "This is the exact supporting passage from the source document.",
        "retrievedAt": "2026-10-20T08:00:00Z",
        "contentFingerprint": "a" * 64,
    }


def _legacy_side(url: str) -> dict:
    return {
        "body": "One historical evidence-backed point.",
        "citations": [{"url": url, "title": "Primary source"}],
    }


@pytest.mark.parametrize(
    "url",
    (
        "javascript:alert(1)",
        "http://example.test/source",
        "https://user:password@example.test/source",
        "https://example.test/source?access_token=secret",
        "https://example.test\\@attacker.test/source",
        "https://example.test/source\nmalformed",
    ),
)
def test_atomic_know_rejects_unsafe_source_urls_before_encoding(url: str) -> None:
    payload = {
        "schemaVersion": KNOW_SCHEMA_VERSION,
        "observation": "A compact observation.",
        "interpretation": "A bounded interpretation.",
        "source": _source(url),
    }

    assert normalize_know_payload(payload) is None
    with pytest.raises(
        ValueError,
        match="know_requires_observation_interpretation_and_verified_source",
    ):
        encode_know_payload(
            payload["observation"],
            payload["source"],
            payload["interpretation"],
        )


@pytest.mark.parametrize("relation", ("supports", "challenges", "context"))
def test_atomic_know_preserves_optional_direction_and_one_source(relation: str) -> None:
    direction = {
        "proposition": "Rocket Lab can compound launch and space-systems revenue.",
        "relation": relation,
    }
    content, urls, dedupe_key = encode_know_payload(
        "Rocket Lab reported one source-backed operating result.",
        _source("https://example.test/source?document=10#page=2"),
        "The result changes one bounded assumption but does not decide the thesis.",
        direction,
    )
    decoded = know_from_properties({"content": content})

    assert decoded is not None
    assert decoded["schemaVersion"] == "know.v2"
    assert decoded["direction"] == direction
    assert decoded["source"]["url"] == "https://example.test/source?document=10#page=2"
    assert json.loads(urls) == ["https://example.test/source?document=10#page=2"]
    assert decoded["dedupeKey"] == dedupe_key


def test_neutral_atomic_know_is_valid_without_direction() -> None:
    content, _urls, _dedupe_key = encode_know_payload(
        "The filing states the quarter-end cash balance.",
        _source(),
        "This is useful financing context without taking a positive or negative side.",
    )

    decoded = know_from_properties({"content": content})

    assert decoded is not None
    assert "direction" not in decoded
    assert "idea" not in decoded
    assert "counterIdea" not in decoded


def test_same_source_backed_observation_has_one_deterministic_episode_identity() -> None:
    first = encode_know_payload(
        "The filing states the quarter-end cash balance.",
        _source(),
        "This bounds near-term runway analysis.",
    )[2]
    second = encode_know_payload(
        "The filing states the quarter-end cash balance.",
        _source(),
        "A different display interpretation does not create new evidence.",
    )[2]

    assert first == second
    assert know_episode_uuid("project-one", "Rocket Lab", first) == know_episode_uuid(
        "project-one", "Rocket Lab", second,
    )
    assert know_episode_uuid("project-one", "Rocket Lab", first) != know_episode_uuid(
        "project-one", "AST SpaceMobile", first,
    )


def test_historical_paired_know_remains_explicitly_legacy_and_readable() -> None:
    content = json.dumps({
        "schemaVersion": LEGACY_KNOW_SCHEMA_VERSION,
        "idea": _legacy_side("https://example.test/for"),
        "counterIdea": _legacy_side("https://example.test/against"),
    })

    decoded = know_from_properties({"content": content})

    assert decoded is not None
    assert decoded["schemaVersion"] == "know.v1"
    assert decoded["legacy"] is True
    assert decoded["idea"]["body"]
    assert decoded["counterIdea"]["body"]


def test_historical_unsafe_stored_citation_is_not_projected_as_a_know() -> None:
    content = json.dumps({
        "schemaVersion": LEGACY_KNOW_SCHEMA_VERSION,
        "idea": _legacy_side("data:text/html,unsafe"),
        "counterIdea": _legacy_side("https://example.test/counter"),
    })

    assert know_from_properties({"content": content}) is None
