from __future__ import annotations

from typing import Any

import pytest

from engraphis.backends.extractor import StructuredLLMExtractor
from engraphis.core.interfaces import MemoryType, Scope, SearchFilter
from engraphis.service import MemoryService


_GRAPH_HINT_KEYS = frozenset(("entities", "relations", "structured_extraction"))


class _StructuredFixtureLLM:
    provider = "fixture"
    model = "structured-incidence-test"

    def extract_json(self, _prompt: str, _schema: dict[str, Any]) -> dict[str, Any]:
        return {
            "facts": [
                {
                    "content": "The launch thesis remains unresolved.",
                    "title": "Launch thesis",
                    "mtype": "semantic",
                    "importance": 0.7,
                    "keywords": ["launch", "execution"],
                    "entities": ["Rocket Lab", "Neutron"],
                    "relations": [
                        {
                            "source": "Rocket Lab",
                            "relation": "depends on",
                            "target": "Neutron",
                        }
                    ],
                }
            ]
        }


@pytest.fixture()
def service() -> MemoryService:
    value = MemoryService.create(
        ":memory:", extractor="none", graph_extractor="none"
    )
    try:
        yield value
    finally:
        value.close()


def _incidences(service: MemoryService, memory_id: str) -> list[dict[str, Any]]:
    return service.store.list_memory_entities(
        SearchFilter(workspace_id=service._lookup_workspace("incidence-test")),
        memory_ids=[memory_id],
    )


def _remember_trusted_structured_fact(
    service: MemoryService,
    *,
    content: str,
    metadata: dict[str, Any],
    valid_from: float,
) -> str:
    workspace_id = service.store.get_or_create_workspace("incidence-test")
    result = service.engine.remember_with_resolution(
        content,
        workspace_id=workspace_id,
        mtype=MemoryType.SEMANTIC,
        scope=Scope.WORKSPACE,
        metadata=metadata,
        valid_from=valid_from,
        resolve_conflicts=False,
        _trusted_graph_keys=_GRAPH_HINT_KEYS,
    )
    return str(result["id"])


def test_vouched_structured_entities_create_direct_bitemporal_incidences(
    service: MemoryService,
) -> None:
    memory_id = _remember_trusted_structured_fact(
        service,
        content="No extracted entity name appears in this memory body.",
        metadata={
            "entities": ["Rocket Lab", "Neutron"],
            "relations": [
                {
                    "source": "Rocket Lab",
                    "relation": "depends on",
                    "target": "Neutron",
                }
            ],
            "structured_extraction": {
                "entities": ["Rocket Lab", "Neutron"],
                "relations": [
                    {
                        "source": "Rocket Lab",
                        "relation": "depends on",
                        "target": "Neutron",
                    }
                ],
            },
        },
        valid_from=1_700_000_000.0,
    )

    memory = service.store.get_memory(memory_id)
    assert memory is not None
    rows = _incidences(service, memory_id)
    structured = [row for row in rows if row["source_kind"] == "structured_extractor"]
    edge_support = [row for row in rows if row["source_kind"] == "edge_support"]
    assert len(structured) == 2
    assert len(edge_support) == 2
    assert not [row for row in rows if row["source_kind"] == "text_mention"]
    assert {row["valid_from"] for row in structured} == {memory.valid_from}
    assert {row["ingested_at"] for row in structured} == {memory.ingested_at}

    first = structured[0]
    repeated_id = service.store.link_memory_entity(
        memory_id=memory_id,
        entity_id=str(first["entity_id"]),
        workspace_id=str(first["workspace_id"]),
        repo_id=first["repo_id"],
        source_kind="structured_extractor",
        confidence=1.0,
        valid_from=memory.valid_from,
        ingested_at=memory.ingested_at,
        provenance={"source": "structured_extractor", "memory_id": memory_id},
    )
    assert repeated_id == first["id"]
    assert len([
        row for row in _incidences(service, memory_id)
        if row["source_kind"] == "structured_extractor"
    ]) == 2


def test_native_structured_llm_output_uses_the_same_vouched_incidence_path(
    service: MemoryService,
) -> None:
    extractor = StructuredLLMExtractor(_StructuredFixtureLLM())
    facts = extractor.extract("Current pair text")
    assert len(facts) == 1
    assert facts[0].metadata["entities"] == ["Rocket Lab", "Neutron"]

    memory_id = _remember_trusted_structured_fact(
        service,
        content=facts[0].content,
        # The saved-Card/host boundary vouches only for extractor-validated graph
        # fields.  Generic llm_extraction activity remains review-pending by design
        # and is not an executable graph-hint key.
        metadata={
            key: facts[0].metadata[key]
            for key in _GRAPH_HINT_KEYS
            if key in facts[0].metadata
        },
        valid_from=1_700_000_100.0,
    )
    rows = _incidences(service, memory_id)
    assert len([row for row in rows if row["source_kind"] == "structured_extractor"]) == 2


def test_caller_forged_graph_metadata_cannot_create_structured_incidence(
    service: MemoryService,
) -> None:
    result = service.remember(
        "This body does not mention the forged entity.",
        workspace="incidence-test",
        metadata={
            "entities": ["Forged Entity"],
            "structured_extraction": {"entities": ["Forged Entity"]},
        },
        trusted=True,
        resolve_conflicts=False,
    )
    memory_id = str(result["id"])
    memory = service.store.get_memory(memory_id)
    assert memory is not None
    assert memory.metadata["client_supplied_graph"]["source"] == "client_supplied"
    assert not [
        row for row in _incidences(service, memory_id)
        if row["source_kind"] == "structured_extractor"
    ]
    assert not [
        entity for entity in service.store.list_entities(
            SearchFilter(workspace_id=service._lookup_workspace("incidence-test"))
        )
        if entity.name == "Forged Entity"
    ]


def test_text_mentions_remain_distinct_from_structured_extractor_incidence(
    service: MemoryService,
) -> None:
    _remember_trusted_structured_fact(
        service,
        content="Entity names are intentionally absent here.",
        metadata={"entities": ["Rocket Lab"], "structured_extraction": {
            "entities": ["Rocket Lab"]
        }},
        valid_from=1_700_000_200.0,
    )
    workspace_id = service.store.get_or_create_workspace("incidence-test")
    result = service.engine.remember_with_resolution(
        "Rocket Lab appears only as an exact textual mention in this memory.",
        workspace_id=workspace_id,
        mtype=MemoryType.SEMANTIC,
        scope=Scope.WORKSPACE,
        resolve_conflicts=False,
    )
    rows = _incidences(service, str(result["id"]))
    assert len([row for row in rows if row["source_kind"] == "text_mention"]) == 1
    assert not [
        row for row in rows if row["source_kind"] == "structured_extractor"
    ]
    assert not [row for row in rows if row["source_kind"] == "edge_support"]
