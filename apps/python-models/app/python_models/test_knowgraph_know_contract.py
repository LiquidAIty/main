# Entity: KnowGraph
# Relationship: This file verifies first-class Know property reads and safe citation provenance without an encoded episode-body schema.

from __future__ import annotations

import pytest

from app.python_models.knowgraph_know_contract import (
    know_from_properties,
    safe_source_url,
)


def _properties(url: str = "https://example.test/source") -> dict:
    return {
        "content": "Ordinary plain-text Graphiti episode content.",
        "observation": "The filing states the quarter-end cash balance.",
        "interpretation": "This bounds near-term runway analysis.",
        "citation_url": url,
        "citation_resolved_url": url,
        "citation_title": "Primary source",
        "citation_publisher": "Example",
        "citation_evidence": "This is the exact supporting passage from the source document.",
        "citation_retrieved_at": "2026-10-20T08:00:00Z",
        "citation_content_fingerprint": "a" * 64,
        "content_hash": "b" * 64,
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
def test_know_rejects_unsafe_citation_urls(url: str) -> None:
    assert safe_source_url(url) is None
    assert know_from_properties(_properties(url)) is None


@pytest.mark.parametrize("relation", ("supports", "challenges", "context"))
def test_know_reads_typed_reasoning_citation_and_direction(relation: str) -> None:
    properties = {
        **_properties("https://example.test/source?document=10#page=2"),
        "proposition": "Rocket Lab can compound launch and space-systems revenue.",
        "direction": relation,
    }

    know = know_from_properties(properties)

    assert know == {
        "kind": "Know",
        "observation": properties["observation"],
        "interpretation": properties["interpretation"],
        "citation": {
            "url": properties["citation_url"],
            "resolvedUrl": properties["citation_resolved_url"],
            "title": "Primary source",
            "publisher": "Example",
            "evidence": properties["citation_evidence"],
            "retrievedAt": "2026-10-20T08:00:00Z",
            "contentFingerprint": "a" * 64,
        },
        "direction": {
            "proposition": properties["proposition"],
            "relation": relation,
        },
        "contentHash": "b" * 64,
    }


def test_neutral_know_is_valid_without_direction() -> None:
    know = know_from_properties(_properties())

    assert know is not None
    assert know["kind"] == "Know"
    assert "direction" not in know


def test_episode_json_does_not_create_a_know_without_typed_properties() -> None:
    assert know_from_properties({
        "content": '{"observation":"episode text is not typed Know authority"}',
    }) is None


def test_incomplete_citation_does_not_project_as_a_know() -> None:
    properties = _properties()
    del properties["citation_evidence"]

    assert know_from_properties(properties) is None
