# Entity: KnowGraph
# Relationship: Verifies each two-sided Know rejects unsafe citation URLs while preserving safe cited evidence through encoding and property readback.

from __future__ import annotations

import json

import pytest

from app.python_models.knowgraph_know_contract import (
    KNOW_SCHEMA_VERSION,
    encode_know_payload,
    know_from_properties,
    normalize_know_payload,
)


def _side(url: str) -> dict:
    return {
        "body": "One evidence-backed point.",
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
def test_know_rejects_unsafe_citation_urls_before_encoding(url: str) -> None:
    payload = {
        "schemaVersion": KNOW_SCHEMA_VERSION,
        "idea": _side(url),
        "counterIdea": _side("https://example.test/counter"),
    }

    assert normalize_know_payload(payload) is None
    with pytest.raises(ValueError, match="know_requires_cited_idea_and_counter_idea"):
        encode_know_payload(payload["idea"], payload["counterIdea"])


def test_know_preserves_safe_https_citations_and_readback() -> None:
    idea = _side("https://example.test/source?document=10#page=2")
    counter = _side("https://example.test/counter")

    content, urls = encode_know_payload(idea, counter)
    decoded = know_from_properties({"content": content})

    assert decoded is not None
    assert decoded["idea"]["citations"][0]["url"] == idea["citations"][0]["url"]
    assert json.loads(urls) == [
        "https://example.test/source?document=10#page=2",
        "https://example.test/counter",
    ]


def test_legacy_unsafe_stored_citation_is_not_projected_as_a_know() -> None:
    content = json.dumps({
        "schemaVersion": KNOW_SCHEMA_VERSION,
        "idea": _side("data:text/html,unsafe"),
        "counterIdea": _side("https://example.test/counter"),
    })

    assert know_from_properties({"content": content}) is None
