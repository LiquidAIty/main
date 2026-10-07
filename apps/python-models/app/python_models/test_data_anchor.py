from __future__ import annotations

import json
import pytest


def test_codegraph_ui_reads_saved_scope_and_rejects_effects(monkeypatch):
    from app.python_models import card_domain, data_anchor
    monkeypatch.setattr(card_domain, "load_deck", lambda p, d: {
        "projectId": p, "deck": {"nodes": [{"id": "saved-main"}]}})
    calls = []
    def read(**kwargs):
        calls.append(kwargs)
        return [{"projects": [{"name": "cbm-project"}]}]
    monkeypatch.setattr(data_anchor, "call_read_tools_via_mcp", read)
    scope = {"projectId": "p", "deckId": "d", "cardId": "saved-main"}
    assert data_anchor.read_codegraph_tool({**scope, "name": "list_projects"})["projects"]
    assert calls[0]["card_id"] == "saved-main"
    assert calls[0]["calls"] == [("cbm.list_projects", {"format": "json"})]
    with pytest.raises(ValueError, match="not_allowed"):
        data_anchor.read_codegraph_tool({**scope, "name": "delete_project"})
    with pytest.raises(ValueError, match="saved_card"):
        data_anchor.read_codegraph_tool({**scope, "cardId": "absent", "name": "list_projects"})
    with pytest.raises(ValueError, match="project_mismatch"):
        data_anchor.read_codegraph_tool({**scope, "name": "index_status", "arguments": {"project": "other"}})
    assert len(calls) == 1

    monkeypatch.setattr(
        data_anchor,
        "call_read_tools_via_mcp",
        lambda **_kwargs: (_ for _ in ()).throw(ExceptionGroup(
            "transport closed",
            [RuntimeError("materializer_mcp_read_failed:cbm.list_projects")],
        )),
    )
    with pytest.raises(data_anchor.DataAnchorError, match="codegraph_unavailable"):
        data_anchor.read_codegraph_tool({**scope, "name": "list_projects"})

from app.python_models.data_anchor import (
    append_canonical_subject_directory,
    assemble_canonical_subject_directory,
    DataAnchorError,
    empty_graph_projection,
    read_codegraph_exact,
    read_knowgraph_episodes_exact,
    read_knowgraph_exact,
    read_thinkgraph_exact,
    resolve_data_anchors,
    search_knowgraph_hybrid,
)
from app.python_models import engraphis, data_anchor


def test_codegraph_projection_preserves_returned_ids_direction_and_type(monkeypatch):
    prefix = "C-Projects-LiquidAIty-main.client.src.features.agentbuilder.state.useAgentBuilderKnowledgeGraphs."
    source, target = prefix + "withSettlementHeat", prefix + "observeThinkGraphRevision"
    node_columns = ["a.qualified_name", "a.name", "a.label", "id(a)"]
    edge_columns = [
        *node_columns,
        "b.qualified_name", "b.name", "b.label", "id(b)", "id(r)", "type(r)",
    ]
    nodes = {"columns": node_columns, "rows": [[
        source, "withSettlementHeat", "Function", 2130,
    ]], "total": 1}
    edges = {"columns": edge_columns, "rows": [[
        source, "withSettlementHeat", "Function", 2130,
        target, "observeThinkGraphRevision", "Function", 2131, 17367, "CALLS",
    ]], "total": 1}
    observed = []
    def read(**kwargs):
        observed.append(kwargs)
        return [nodes, edges]
    monkeypatch.setattr(data_anchor, "call_read_tools_via_mcp", read)
    result = data_anchor._read_codegraph_projection("p", "d", "card", {"node_ids": [source], "expand": True})
    assert [node["id"] for node in result["nodes"]] == [source, target]
    assert result["edges"] == [{"id": "17367", "source": source, "target": target,
        "predicate": "CALLS", "properties": {}, "provenance": {
            "project": "C-Projects-LiquidAIty-main", "edgeId": "17367", "tool": "cbm.query_graph"}}]
    assert result["nodes"][0]["provenance"]["nodeId"] == "2130"
    assert all(name == "cbm.query_graph" for name, _ in observed[0]["calls"])
    assert all(arguments["format"] == "json" for _, arguments in observed[0]["calls"])
    assert "MATCH (a)-[r]->(b)" in observed[0]["calls"][1][1]["query"]


def test_codegraph_empty_and_changed_wire_format_do_not_create_records(monkeypatch):
    def read(**kwargs):
        results = []
        for _, args in kwargs["calls"]:
            columns = [
                column.strip()
                for column in args["query"].split(" RETURN ")[1].split(" LIMIT ")[0].split(",")
            ]
            results.append({"columns": columns, "rows": [], "total": 0})
        return results
    monkeypatch.setattr(data_anchor, "call_read_tools_via_mcp", read)
    result = data_anchor._read_codegraph_projection("p", "d", "card", {"node_ids": ["absent"]})
    assert result["nodes"] == result["edges"] == []
    with pytest.raises(DataAnchorError, match="format_invalid"):
        data_anchor._cbm_table({"columns": ["other"], "rows": []}, ["a"])
    with pytest.raises(DataAnchorError, match="rows_invalid"):
        data_anchor._cbm_table({"columns": ["a"], "rows": [["one"]], "total": 0}, ["a"])


@pytest.fixture
def engraphis_graph(tmp_path, monkeypatch):
    import io
    import json
    from urllib.error import HTTPError
    from engraphis.service import MemoryService
    # Engraphis persistence/relationship fixture; hash embedding is not semantic proof.
    service = MemoryService.create(str(tmp_path / "memory.sqlite"), embed_model="hash",
                                   extractor="none", graph_extractor="none")
    monkeypatch.setattr(engraphis, "_service", service)
    first = service.remember("Current Engraphis graph content", workspace="project-1", title="Current fact")["id"]
    second = service.remember("Project-scoped Engraphis engine content", workspace="project-1", title="Engraphis memory")["id"]
    service.link(first, second, workspace="project-1", relation="supports", reason="Retained Engraphis evidence")
    def read(request, **kwargs):
        assert request.full_url.endswith("/thinkgraph/operation")
        payload = json.loads(request.data)
        assert payload["operation"] == "inspect"
        try:
            result = engraphis.private_operation(payload["projectId"], "inspect", payload["arguments"])
        except ValueError as error:
            raise HTTPError(request.full_url, 409, str(error), {}, io.BytesIO())
        return io.BytesIO(json.dumps(result).encode())
    monkeypatch.setattr(data_anchor, "urlopen", read)
    yield service, first, second
    service.close()


def test_exact_thinkgraph_read_is_project_scoped_and_read_only(engraphis_graph) -> None:
    service, first, _ = engraphis_graph
    before = service.store.conn.total_changes
    record = read_thinkgraph_exact("project-1", "engraphisMemoryId", first)

    assert record is not None
    assert record["engraphisMemoryId"] == first
    assert record["content"] == "Current Engraphis graph content"
    assert read_thinkgraph_exact(
        "other-project", "engraphisMemoryId", first,
    ) is None
    assert service.store.conn.total_changes == before


def test_exact_thinkgraph_read_accepts_project_scoped_engraphis_id(engraphis_graph) -> None:
    _, _, second = engraphis_graph
    record = read_thinkgraph_exact("project-1", "engraphisMemoryId", second)

    assert record is not None
    assert record["engraphisMemoryId"] == second
    assert record["recordId"] == second
    assert record["content"] == "Project-scoped Engraphis engine content"


def test_think_handoff_prefers_self_contained_thinks_and_keeps_engraphis_evidence(
    monkeypatch,
) -> None:
    import io
    import json

    provider_payload = {
        "entity": {
            "canonical_id": "entity-one",
            "type": "person_or_concept",
            "label": "Jev",
            "member_ids": ["entity-one"],
            "relations": [],
            "history": [],
            "truncation": {"relations": False, "evidence": False, "history": False},
            "evidence": [
                {
                    "memory_id": "mem_think",
                    "excerpt": "Self-contained structured Think.",
                    "metadata": {"thinkgraph_origin": {"authority": "thinkgraph"}},
                },
                {
                    "memory_id": "mem_other",
                    "excerpt": "Other Engraphis evidence.",
                    "metadata": {"provenance": {"source": "test"}},
                },
            ],
        }
    }
    monkeypatch.setattr(
        data_anchor,
        "urlopen",
        lambda *_args, **_kwargs: io.BytesIO(json.dumps(provider_payload).encode()),
    )

    record = read_thinkgraph_exact(
        "project-1", "engraphisEntityId", "entity-one",
    )

    assert record["portableKind"] == "think"
    assert record["content"] == "Self-contained structured Think."
    assert [item["memory_id"] for item in record["metadata"]["thinks"]] == [
        "mem_think"
    ]
    assert [item["memory_id"] for item in record["metadata"]["evidence"]] == [
        "mem_other"
    ]


def test_required_anchor_materializes_real_data_and_stable_reference(engraphis_graph) -> None:
    _, first, _ = engraphis_graph
    seed, references = resolve_data_anchors(
        "project-1",
        [{
            "engraphisMemoryId": first,
            "reason": "start from the current fact",
            "boundedExpansion": 0,
            "required": True,
        }],
    )

    assert "Current Engraphis graph content" in seed
    assert "Selection reason (guidance, not verified fact)" in seed
    assert "Verified provider content" in seed
    assert references[0]["engraphisMemoryId"] == first
    assert references[0]["label"] == "Current fact"
    assert references[0]["selectionScope"] == {"boundedExpansion": 0}
    assert references[0]["materializedContentBytes"] == len(
        "Current Engraphis graph content".encode("utf-8")
    )


def test_exact_repeated_provider_payload_is_rendered_once_without_losing_distinct_records(
    monkeypatch,
) -> None:
    shared_metadata = {"thinkgraph_origin": {
        "authority": "thinkgraph", "body": "x" * 2_000,
    }}

    def read(_project_id, _deck_id, _card_id, anchor, **_kwargs):
        entity_id = anchor["engraphisEntityId"]
        distinct = entity_id == "entity-three"
        return {
            "graphSystem": "engraphis", "engraphisEntityId": entity_id,
            "recordKind": "entity", "type": "person_or_concept", "title": entity_id,
            "content": "different content" if distinct else "same exact content " * 40,
            "metadata": (
                {"thinkgraph_origin": {
                    "authority": "thinkgraph", "body": "different",
                }}
                if distinct else shared_metadata
            ),
            "provenance": {"engine": "engraphis", "memberIds": [entity_id]},
            "asOf": "current", "readOperation": "graph_entity",
            "relationshipEvidence": [], "resultLimit": 1, "truncated": False,
        }

    monkeypatch.setattr(data_anchor, "_read_exact_anchor_record", read)
    anchors = [{
        "engraphisEntityId": entity_id,
        "reason": f"select {entity_id}", "boundedExpansion": 0,
        "required": True,
    } for entity_id in ("entity-one", "entity-two", "entity-three")]
    seed, references = resolve_data_anchors("project-1", anchors)

    assert [reference["engraphisEntityId"] for reference in references] == [
        "entity-one", "entity-two", "entity-three",
    ]
    assert seed.count("\"body\":\"" + "x" * 2_000 + "\"") == 1
    assert seed.count(("same exact content " * 40).strip()) == 1
    assert '"engraphisEntityId":"entity-one"' in seed
    assert "different content" in seed and '"body":"different"' in seed
    assert len({reference["materializedRecordSha256"] for reference in references}) == 3


class _FakeNeo4jResult:
    def __init__(self, rows):
        self._rows = rows

    def data(self):
        return self._rows


def test_thinkgraph_memory_reference_does_not_materialize_memory_nodes(engraphis_graph):
    service, first, second = engraphis_graph
    before = service.store.conn.total_changes
    projection = empty_graph_projection("project-1")
    text, refs = resolve_data_anchors("project-1", [{
        "engraphisMemoryId": first, "reason": "Use related evidence",
        "boundedExpansion": 1, "resultLimit": 2, "required": True,
    }], graph_projection=projection)
    assert projection["nodes"] == []
    assert projection["edges"] == []
    assert first in text and second in text and "supports" in text
    assert refs[0]["engraphisMemoryId"] == first
    assert service.store.conn.total_changes == before
    bounded = read_thinkgraph_exact(
        "project-1", "engraphisMemoryId", first,
        bounded_expansion=1, result_limit=1,
    )
    assert bounded["relationshipEvidence"] == [] and bounded["truncated"] is True


class _FakeNeo4jSession:
    def __init__(self, rows, calls):
        self._rows = list(rows)
        self._calls = calls

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def run(self, query, **params):
        self._calls.append((query, params))
        return _FakeNeo4jResult(self._rows.pop(0))


class _FakeNeo4jDriver:
    def __init__(self, rows):
        self._rows = rows
        self.calls = []
        self.closed = False

    def session(self, **_kwargs):
        return _FakeNeo4jSession(self._rows, self.calls)

    def close(self):
        self.closed = True


def _subject(graph_system: str, index: int) -> dict[str, str]:
    id_field = (
        "engraphisEntityId" if graph_system == "ThinkGraph" else "graphitiEntityId"
    )
    return {
        id_field: f"{graph_system.lower()}-{index:03d}",
        "canonicalName": f"Subject {graph_system} {index:03d}",
        "entityKind": "person_or_concept" if graph_system == "ThinkGraph" else "Entity",
    }


def test_complete_subject_directory_keeps_all_37_plus_11_headers_without_truncation() -> None:
    directory = assemble_canonical_subject_directory(
        "project-1",
        {"complete": True, "count": 37, "revision": "think-r1",
         "subjects": [_subject("ThinkGraph", index) for index in range(37)]},
        {"complete": True, "count": 11, "revision": "know-r1",
         "subjects": [_subject("KnowGraph", index) for index in range(11)]},
        read_duration_ms=12.3456,
    )

    assert directory["complete"] is True
    assert directory["counts"] == {"engraphis": 37, "graphiti": 11, "total": 48}
    assert len(directory["subjects"]) == 48
    assert directory["bytes"] > 0
    assert directory["estimatedTokens"] == (directory["bytes"] + 3) // 4
    assert directory["bytes"] < data_anchor._GRAPH_SEED_LIMIT
    assert directory["readDurationMs"] == 12.346
    model_context = append_canonical_subject_directory("", directory)
    assert "Complete Cross-Graph Subject Directory" in model_context
    assert "Subject ThinkGraph 036" in model_context
    assert "Subject KnowGraph 010" in model_context


@pytest.mark.parametrize(
    "mutate,error",
    [
        (lambda source: source.update(complete=False), "authority_incomplete"),
        (lambda source: source.update(count=2), "authority_invalid"),
    ],
)
def test_subject_directory_rejects_incomplete_count_mismatch_and_duplicate(
    mutate,
    error: str,
) -> None:
    think = {"complete": True, "count": 1, "revision": "think-r1",
             "subjects": [_subject("ThinkGraph", 1)]}
    mutate(think)
    with pytest.raises(DataAnchorError, match=error):
        assemble_canonical_subject_directory(
            "project-1", think,
            {"complete": True, "count": 0, "revision": "know-empty", "subjects": []},
        )


def test_subject_directory_rejects_duplicate_authority_provider_identity() -> None:
    duplicate = _subject("ThinkGraph", 1)
    with pytest.raises(DataAnchorError, match="subject_duplicate"):
        assemble_canonical_subject_directory(
            "project-1",
            {"complete": True, "count": 2, "revision": "think-r1",
             "subjects": [duplicate, dict(duplicate)]},
            {"complete": True, "count": 0, "revision": "know-empty", "subjects": []},
        )


def test_subject_directory_rejects_ambiguous_same_authority_canonical_name() -> None:
    first = _subject("ThinkGraph", 1)
    second = {**_subject("ThinkGraph", 2), "canonicalName": first["canonicalName"]}
    with pytest.raises(DataAnchorError, match="subject_name_duplicate"):
        assemble_canonical_subject_directory(
            "project-1",
            {"complete": True, "count": 2, "revision": "think-r1",
             "subjects": [first, second]},
            {"complete": True, "count": 0, "revision": "know-empty", "subjects": []},
        )


def test_subject_directory_preserves_writer_canonical_name_bytes() -> None:
    think = _subject("ThinkGraph", 1)
    know = _subject("KnowGraph", 1)
    think["canonicalName"] = "  Writer-preserved subject  "
    know["canonicalName"] = "Writer-preserved subject"

    directory = assemble_canonical_subject_directory(
        "project-1",
        {"complete": True, "count": 1, "revision": "think-r1",
         "subjects": [think]},
        {"complete": True, "count": 1, "revision": "know-r1",
         "subjects": [know]},
    )

    assert [item["canonicalName"] for item in directory["subjects"]] == [
        "  Writer-preserved subject  ", "Writer-preserved subject",
    ]


def test_subject_directory_rejects_combined_context_over_existing_limit() -> None:
    directory = assemble_canonical_subject_directory(
        "project-1",
        {"complete": True, "count": 0, "revision": "think-empty", "subjects": []},
        {"complete": True, "count": 0, "revision": "know-empty", "subjects": []},
    )
    with pytest.raises(DataAnchorError, match="data_anchor_seed_limit_exceeded"):
        append_canonical_subject_directory("x" * data_anchor._GRAPH_SEED_LIMIT, directory)


def test_knowgraph_exact_read_preserves_project_graphiti_identity_and_provenance() -> None:
    driver = _FakeNeo4jDriver([[{
        "graphitiId": "entity-1",
        "labels": ["Entity"],
        "properties": {
            "name": "Bounded entity",
            "group_id": "liquidaity-project-1",
            "source": "graphiti-test",
            "name_embedding": [0.1] * 4096,
        },
    }], [{
        "nodes": [{"graphitiId": "entity-1", "labels": ["Entity"], "properties": {
            "name_embedding": [0.1] * 4096,
        }}],
        "relationships": [],
    }]])

    record = read_knowgraph_exact(
        "project-1",
        "graphitiEntityId",
        "entity-1",
        bounded_expansion=1,
        driver_factory=lambda: driver,
    )

    assert record is not None
    assert record["graphitiEntityId"] == "entity-1"
    assert record["provenance"]["group_id"] == "liquidaity-project-1"
    assert record["relationshipEvidence"][0]["nodes"][0]["graphitiId"] == "entity-1"
    assert "name_embedding" not in record["properties"]
    assert "name_embedding" not in record["relationshipEvidence"][0]["nodes"][0]["properties"]
    assert driver.closed is True


def test_knowgraph_exact_episode_hydration_uses_requested_ids_and_project_scope() -> None:
    driver = _FakeNeo4jDriver([[{
        "uuid": "episode-2",
        "properties": {
            "name": "Primary source",
            "group_id": "liquidaity-project-1",
            "source_url": "https://example.test/source",
            "valid_at": "2026-09-23T12:00:00Z",
            "content": "source body",
            "content_embedding": [0.1] * 12,
        },
    }, {
        "uuid": "unrequested",
        "properties": {"group_id": "liquidaity-project-1"},
    }]])

    episodes = read_knowgraph_episodes_exact(
        "project-1", ["episode-1", "episode-2"], driver_factory=lambda: driver,
    )

    assert [episode["uuid"] for episode in episodes] == ["episode-2"]
    assert episodes[0]["source_url"] == "https://example.test/source"
    assert episodes[0]["content_preview"] == "source body"
    assert "content_embedding" not in episodes[0]
    query, params = driver.calls[0]
    assert "MATCH (episode:Episodic)" in query
    assert params["episodeIds"] == ["episode-1", "episode-2"]
    assert params["scopeIds"] == ["project-1", "liquidaity-project-1"]
    assert driver.closed is True


def test_knowgraph_exact_fact_returns_portable_know_with_exact_sources() -> None:
    driver = _FakeNeo4jDriver([[], [{
        "graphitiId": "fact-1",
        "labels": ["RELATES_TO"],
        "properties": {
            "name": "partners with",
            "fact": "Alpha partners with Beta.",
            "group_id": "liquidaity-project-1",
            "episodes": ["episode-1"],
            "created_at": "2026-09-23T12:00:00Z",
            "valid_at": "2026-09-01T00:00:00Z",
            "jev_relation_winner": "ASSOCIATED_WITH",
            "jev_relation_distribution_json": json.dumps({"ASSOCIATED_WITH": 1.0}),
            "jev_label_confidence": 1.0,
            "jev_requested_model": "typesafe/jev-1.13",
            "jev_resolved_model": "typesafe/jev-1.13",
            "jev_evaluated_at": "2026-09-24T12:00:00Z",
            "jev_question_schema_version": "knowgraph.relationship-choice.v2",
            "jev_ontology_version": "jev.semantic-relationships.v1",
            "jev_ontology_hash": "hash-1",
        },
        "sourceGraphitiId": "entity-a",
        "targetGraphitiId": "entity-b",
        "endpointNodes": [
            {"graphitiId": "entity-a", "labels": ["Entity"], "properties": {"name": "Alpha"}},
            {"graphitiId": "entity-b", "labels": ["Entity"], "properties": {"name": "Beta"}},
        ],
    }]])
    episode = {
        "uuid": "episode-1", "source_url": "https://example.test/alpha-beta",
        "valid_at": "2026-09-01T00:00:00Z",
    }

    record = read_knowgraph_exact(
        "project-1", "graphitiRelationshipId", "fact-1",
        driver_factory=lambda: driver,
        episode_reader=lambda project_id, ids: [episode]
        if project_id == "project-1" and ids == ["episode-1"] else [],
    )

    assert record is not None
    assert record["portableKind"] == "know"
    assert record["graphitiRelationshipId"] == "fact-1"
    assert record["know"] == {
        "portableKind": "know",
        "graphitiFactUuid": "fact-1",
        "sourceEntity": {"uuid": "entity-a", "name": "Alpha"},
        "targetEntity": {"uuid": "entity-b", "name": "Beta"},
        "graphitiRelation": "partners with",
        "fact": "Alpha partners with Beta.",
        "supportingEpisodeUuids": ["episode-1"],
        "supportingEpisodes": [episode],
        "createdAt": "2026-09-23T12:00:00Z",
        "referenceTime": None,
        "validAt": "2026-09-01T00:00:00Z",
        "invalidAt": None,
        "expiredAt": None,
        "temporalStatus": "current",
        "jevCanonicalRelation": "ASSOCIATED_WITH",
        "relationship_strength": 1.0,
        "jev": {
            "graphitiFactUuid": "fact-1",
            "status": "success",
            "winner": "ASSOCIATED_WITH",
            "distribution": {"ASSOCIATED_WITH": 1.0},
            "label_confidence": 1.0,
            "requested_model": "typesafe/jev-1.13",
            "resolved_model": "typesafe/jev-1.13",
            "evaluated_at": "2026-09-24T12:00:00Z",
            "question_schema_version": "knowgraph.relationship-choice.v2",
            "vocabulary_version": "jev.semantic-relationships.v1",
            "vocabulary_hash": "hash-1",
        },
    }
    assert record["jev"]["winner"] == "ASSOCIATED_WITH"
    assert record["provenance"]["episodes"] == [episode]


def test_knowgraph_exact_fact_preserves_graphiti_fact_when_jev_readback_is_malformed() -> None:
    driver = _FakeNeo4jDriver([[], [{
        "graphitiId": "fact-malformed",
        "labels": ["RELATES_TO"],
        "properties": {
            "name": "supports",
            "fact": "Alpha supports Beta.",
            "group_id": "liquidaity-project-1",
            "episodes": ["episode-1"],
            "jev_relation_winner": "PROVIDES",
            # A persisted Jev annotation is optional enrichment. This malformed
            # distribution must not erase or reinterpret the Graphiti fact.
            "jev_relation_distribution_json": json.dumps({"ASSOCIATED_WITH": 1.0}),
            "jev_label_confidence": 1.0,
        },
        "sourceGraphitiId": "entity-a",
        "targetGraphitiId": "entity-b",
        "endpointNodes": [
            {"graphitiId": "entity-a", "labels": ["Entity"], "properties": {"name": "Alpha"}},
            {"graphitiId": "entity-b", "labels": ["Entity"], "properties": {"name": "Beta"}},
        ],
    }]])
    episode = {"uuid": "episode-1", "source_url": "https://example.test/source"}

    record = read_knowgraph_exact(
        "project-1",
        "graphitiRelationshipId",
        "fact-malformed",
        driver_factory=lambda: driver,
        episode_reader=lambda project_id, ids: [episode]
        if project_id == "project-1" and ids == ["episode-1"] else [],
    )

    assert record is not None
    assert record["graphitiRelationshipId"] == "fact-malformed"
    assert record["know"]["graphitiFactUuid"] == "fact-malformed"
    assert record["know"]["graphitiRelation"] == "supports"
    assert record["know"]["fact"] == "Alpha supports Beta."
    assert record["know"]["sourceEntity"] == {"uuid": "entity-a", "name": "Alpha"}
    assert record["know"]["targetEntity"] == {"uuid": "entity-b", "name": "Beta"}
    assert record["know"]["supportingEpisodes"] == [episode]
    assert "jev" not in record["know"]
    assert "jevCanonicalRelation" not in record["know"]
    assert "relationship_strength" not in record["know"]
    assert driver.closed is True


def test_provider_projection_contains_only_ids_returned_in_model_bound_graph_data(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    record = {
        "graphSystem": "graphiti",
        "graphitiEntityId": "entity-1",
        "recordKind": "entity",
        "type": "Entity",
        "title": "Alpha",
        "content": "current sourced Alpha record",
        "properties": {"name": "Alpha"},
        "relationshipEvidence": [{
            "nodes": [
                {"graphitiId": "entity-1", "labels": ["Entity"], "properties": {"name": "Alpha"}},
                {"graphitiId": "entity-2", "labels": ["Entity"], "properties": {"name": "Beta"}},
            ],
            "relationships": [{
                "graphitiId": "fact-1",
                "type": "SUPPORTS",
                    "sourceId": "entity-1",
                    "targetId": "entity-2",
                "properties": {"source": "primary"},
            }],
        }],
        "provenance": {"source": "primary"},
        "asOf": "current",
        "readOperation": "neo4j.project_scoped_exact",
        "resultLimit": 8,
        "truncated": False,
    }
    monkeypatch.setattr(
        "app.python_models.data_anchor.read_knowgraph_exact",
        lambda *_args, **_kwargs: record,
    )
    projection = empty_graph_projection("project-1")
    seed, references = resolve_data_anchors(
        "project-1",
            [{
                "graphitiEntityId": "entity-1",
            "reason": "start from sourced evidence",
            "boundedExpansion": 1,
            "resultLimit": 8,
            "required": True,
        }],
        graph_projection=projection,
    )

    assert {node["id"] for node in projection["nodes"]} == {"entity-1", "entity-2"}
    assert [(edge["id"], edge["source"], edge["target"]) for edge in projection["edges"]] == [
        ("fact-1", "entity-1", "entity-2"),
    ]
    assert all(graphiti_id in seed for graphiti_id in ("entity-1", "entity-2", "fact-1"))
    assert references[0]["graphitiEntityId"] == "entity-1"


def test_codegraph_exact_read_uses_official_mcp_calls_and_qualified_symbol() -> None:
    observed = {}

    def reader(**kwargs):
        observed.update(kwargs)
        return [
            {"project": "C-Projects-LiquidAIty-main", "status": "ready", "nodes": 8, "edges": 16},
            {
                "qualified_name": "project.module.materialize_idf",
                "name": "materialize_idf",
                "label": "Function",
                "file_path": "C:/Projects/LiquidAIty/main/apps/python-models/app/python_models/idf.py",
                "start_line": 37,
                "end_line": 78,
                "source": "def materialize_idf():\n    pass",
                "signature": "()",
                "fp": "current-fingerprint",
            },
            {"callers": [{"qualified_name": "project.module.caller"}], "callees": []},
        ]

    record = read_codegraph_exact(
        "project-1",
        "deck_builder",
        "card_helper",
        "project.module.materialize_idf",
        bounded_expansion=1,
        mcp_reader=reader,
    )

    assert record is not None
    assert record["cbmQualifiedName"] == "project.module.materialize_idf"
    assert record["properties"]["file"] == "apps/python-models/app/python_models/idf.py"
    assert record["relationshipEvidence"]["callers"][0]["qualified_name"].endswith("caller")
    assert [name for name, _args in observed["calls"]] == [
        "cbm.index_status", "cbm.get_code_snippet", "cbm.trace_path",
    ]
    assert all(arguments["format"] == "json" for _, arguments in observed["calls"])


def test_codegraph_exact_read_normalizes_provider_grouped_trace_json() -> None:
    def reader(**_kwargs):
        return [
            {"project": "C-Projects-LiquidAIty-main", "status": "ready"},
            {
                "qualified_name": "project.module.materialize_idf",
                "name": "materialize_idf",
                "label": "Function",
                "file_path": "apps/python-models/app/python_models/idf.py",
                "source": "def materialize_idf():\n    pass",
            },
            {
                "callers": {
                    "cols": ["name", "hop"],
                    "groups": [{
                        "qn_prefix": "project.module",
                        "rows": [["caller", 1]],
                    }],
                },
                "callees": {"cols": ["name", "hop"], "groups": []},
            },
        ]

    record = read_codegraph_exact(
        "project-1",
        "deck_builder",
        "card_helper",
        "project.module.materialize_idf",
        bounded_expansion=1,
        mcp_reader=reader,
    )

    assert record is not None
    assert record["relationshipEvidence"]["callers"] == [{
        "name": "caller",
        "hop": 1,
        "qualified_name": "project.module.caller",
    }]


def test_hybrid_knowgraph_search_is_concurrent_centered_ranked_and_provenanced() -> None:
    observed = []

    def reader(**kwargs):
        observed.append(kwargs)
        calls = kwargs["calls"]
        centered = "center_node_uuid" in calls[0][1]
        if centered:
            assert calls[0][1]["center_node_uuid"] == "explicit-1"
            return [
                {"nodes": [{"uuid": "entity-2", "name": "Nearby"}]},
                {"facts": [{
                    "uuid": "fact-2", "fact": "Nearby supports Alpha",
                    "source_node_uuid": "entity-2", "target_node_uuid": "entity-1",
                }]},
            ]
        assert kwargs["concurrent"] is True
        assert calls[0][1]["entity_types"] == ["Company"]
        assert calls[1][1]["edge_types"] == ["SUPPORTS"]
        assert calls[1][1]["valid_at_after"] == "2026-01-01T00:00:00Z"
        return [
            {"nodes": [{"uuid": "entity-1", "name": "Alpha", "aliases": ["A"]}]},
            {"facts": [{
                "uuid": "fact-1", "fact": "Alpha is current",
                "source_node_uuid": "entity-1", "target_node_uuid": "entity-2",
                "valid_at": "2026-01-02T00:00:00Z", "episode_uuids": ["episode-1"],
                "jev_relation_winner": "ASSOCIATED_WITH",
                "jev_relation_distribution_json": json.dumps({"ASSOCIATED_WITH": 1.0}),
                "jev_label_confidence": 1.0,
            }]},
        ]

    result = search_knowgraph_hybrid(
        "project-1", "deck_builder", "card-helper", "Alpha",
        exact_records=[{
            "graphSystem": "graphiti", "graphitiEntityId": "explicit-1",
            "recordKind": "entity", "type": "Entity",
            "title": "Explicit", "content": "{}", "properties": {},
            "relationshipEvidence": [], "provenance": {}, "asOf": "current",
            "readOperation": "neo4j.project_scoped_exact",
            "_selectionReason": "passed by the prior Card",
        }],
        entity_types=["Company"], edge_types=["SUPPORTS"],
        valid_at_after="2026-01-01T00:00:00Z",
        max_nodes=3, max_facts=3, bounded_expansion=1,
        mcp_reader=reader,
        episode_reader=lambda project_id, ids: [{
            "uuid": "episode-1", "name": "Source episode",
            "source_description": "unit source",
        }] if project_id == "project-1" and ids == ["episode-1"] else [],
    )

    assert [
        record.get("graphitiEntityId") or record.get("graphitiRelationshipId")
        for record in result["records"]
    ] == [
        "explicit-1", "entity-1", "fact-1", "fact-2", "entity-2",
    ]
    assert result["records"][2]["provenance"]["episodes"][0]["uuid"] == "episode-1"
    assert result["records"][2]["jev"]["winner"] == "ASSOCIATED_WITH"
    assert result["truncated"] is False
    assert len(observed) == 2


def test_optional_hybrid_search_returns_honest_empty_context(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.python_models.data_anchor.search_knowgraph_hybrid",
        lambda *_args, **_kwargs: {
            "query": "missing", "records": [], "truncated": False,
            "bounds": {"maxNodes": 3, "maxFacts": 3, "maxExpansionDepth": 1},
        },
    )
    anchor = {
        "reason": "look for current context",
        "boundedExpansion": 1, "required": False, "searchDynamicInput": True,
        "maxNodes": 3, "maxFacts": 3,
    }
    seed, references = resolve_data_anchors(
        "project-1", [anchor], deck_id="deck_builder", card_id="card-helper",
        search_text="missing",
    )
    assert "No current project-scoped KnowGraph" in seed
    assert references == []

    anchor["required"] = True
    with pytest.raises(DataAnchorError, match="data_anchor_required_search_empty"):
        resolve_data_anchors(
            "project-1", [anchor], deck_id="deck_builder", card_id="card-helper",
            search_text="missing",
        )


def test_missing_required_anchor_fails_before_provider(engraphis_graph, monkeypatch) -> None:
    monkeypatch.setattr(
        "app.python_models.data_anchor.read_knowgraph_exact",
        lambda *_args, **_kwargs: None,
    )
    with pytest.raises(DataAnchorError, match="data_anchor_required_not_found"):
        resolve_data_anchors("project-1", [{
            "graphitiEpisodeId": "episode:one", "reason": "required",
            "boundedExpansion": 0, "required": True,
        }])
    with pytest.raises(DataAnchorError, match="data_anchor_required_not_found"):
        resolve_data_anchors("project-1", [{
            "engraphisMemoryId": "missing", "reason": "required",
            "boundedExpansion": 0, "required": True,
        }])
