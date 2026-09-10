from __future__ import annotations

import pytest


def test_codegraph_ui_reads_saved_scope_and_rejects_effects(monkeypatch):
    from app.python_models import card_domain, data_anchor
    monkeypatch.setattr(card_domain, "load_deck", lambda p, d: {
        "projectId": p, "deck": {"nodes": [{"id": "saved-main"}]}})
    calls = []
    def read(**kwargs):
        calls.append(kwargs)
        return [{"projects": [{"name": "native-project"}]}]
    monkeypatch.setattr(data_anchor, "call_read_tools_via_mcp", read)
    scope = {"projectId": "p", "deckId": "d", "cardId": "saved-main"}
    assert data_anchor.read_codegraph_tool({**scope, "name": "list_projects"})["projects"]
    assert calls[0]["card_id"] == "saved-main"
    assert calls[0]["calls"] == [("cbm.list_projects", {})]
    with pytest.raises(ValueError, match="not_allowed"):
        data_anchor.read_codegraph_tool({**scope, "name": "delete_project"})
    with pytest.raises(ValueError, match="saved_card"):
        data_anchor.read_codegraph_tool({**scope, "cardId": "absent", "name": "list_projects"})
    with pytest.raises(ValueError, match="project_mismatch"):
        data_anchor.read_codegraph_tool({**scope, "name": "index_status", "arguments": {"project": "other"}})
    assert len(calls) == 1

from app.python_models.data_anchor import (
    DataAnchorError,
    empty_graph_projection,
    read_codegraph_exact,
    read_knowgraph_exact,
    read_thinkgraph_exact,
    resolve_data_anchors,
    search_knowgraph_hybrid,
    prepare_main_context,
)
from app.python_models import engraphis, data_anchor


def test_codegraph_projection_preserves_returned_ids_direction_and_type(monkeypatch):
    # Captured columns/rows from the app-published CBM query_graph, September 8.
    prefix = "C-Projects-LiquidAIty-main.client.src.features.agentbuilder.state.useAgentBuilderGraphAttention."
    source, target = prefix + "overlayAuthoritativeGraphAttention", prefix + "retain"
    nodes = f'rows: 1  (cols: a.qualified_name a.name a.label id(a))\n  {source} overlayAuthoritativeGraphAttention Function "2130"\ntotal: 1\n'
    edges = f'rows: 1  (cols: a.qualified_name a.name a.label id(a) b.qualified_name b.name b.label id(b) id(r) type(r))\n  {source} overlayAuthoritativeGraphAttention Function "2130" {target} retain Function "2131" "17367" CALLS\ntotal: 1\n'
    observed = []
    def read(**kwargs):
        observed.append(kwargs)
        return [{"text": nodes}, {"text": edges}]
    monkeypatch.setattr(data_anchor, "call_read_tools_via_mcp", read)
    result = data_anchor._read_codegraph_projection("p", "d", "card", {"node_ids": [source], "expand": True})
    assert [node["id"] for node in result["nodes"]] == [source, target]
    assert result["edges"] == [{"id": "17367", "source": source, "target": target,
        "predicate": "CALLS", "properties": {}, "provenance": {
            "project": "C-Projects-LiquidAIty-main", "edgeId": "17367", "tool": "cbm.query_graph"}}]
    assert result["nodes"][0]["provenance"]["nodeId"] == "2130"
    assert all(name == "cbm.query_graph" for name, _ in observed[0]["calls"])
    assert "MATCH (a)-[r]->(b)" in observed[0]["calls"][1][1]["query"]


def test_codegraph_empty_and_changed_wire_format_do_not_create_records(monkeypatch):
    def read(**kwargs):
        results = []
        for _, args in kwargs["calls"]:
            columns = args["query"].split(" RETURN ")[1].split(" LIMIT ")[0].replace(",", "")
            results.append({"text": f'rows: 0  (cols: {columns})\ntotal: 0\nhint: "Query returned no results."'})
        return results
    monkeypatch.setattr(data_anchor, "call_read_tools_via_mcp", read)
    result = data_anchor._read_codegraph_projection("p", "d", "card", {"node_ids": ["absent"]})
    assert result["nodes"] == result["edges"] == []
    with pytest.raises(DataAnchorError, match="format_invalid"):
        data_anchor._cbm_table({"text": "unrecognized format"}, ["a"])
    with pytest.raises(DataAnchorError, match="rows_invalid"):
        data_anchor._cbm_table({"text": "rows: 1  (cols: a)\ntotal: 0"}, ["a"])


def test_main_preload_keeps_native_ids_bounds_and_independent_failures():
    import json
    observed = []
    def reader(**kwargs):
        observed.append(kwargs)
        return [
            {"sources": [{"id": "decision-1", "summary": "Consider conflicting sources"}] * 4},
            {"ok": False, "error": "read_timeout", "_readDurationMs": 2000},
            {"runs": [{"runId": "run-1", "state": "completed", "nativeReferences": [{"nativeId": "fact-1", "authority": "KnowGraph"}]}]},
        ]
    tools = ["engraphis_recall_context", "graphiti.search_memory_facts", "cbm.search_graph", "agentgraph.inspect"]
    result = prepare_main_context("p", "d", "main", "conversation", "How should we show sources?", tools, mcp_reader=reader)
    assert observed[0]["deadline_seconds"] == 2
    assert observed[0]["concurrent"] is True
    assert observed[0]["conversation_id"] == "conversation"
    assert [ref["nativeId"] for ref in result["references"]] == ["decision-1", "run-1"]
    assert result["reads"][1]["state"] == "read_timeout"
    assert json.loads(result["text"])[1]["data"]["nativeReferences"][0]["nativeId"] == "fact-1"
    assert "cbm.search_graph" not in [name for name, _ in observed[0]["calls"]]
    assert len(json.dumps([result["text"], result["references"]]).encode()) < 8100


def test_main_preload_does_not_widen_grants_or_invent_conversation():
    calls = []
    result = prepare_main_context("p", "d", "main", "", "A question", ["agentgraph.inspect"],
        mcp_reader=lambda **kwargs: calls.append(kwargs))
    assert calls == []
    assert result["references"] == []


def test_main_preload_preserves_every_reference_in_native_packed_context():
    import json
    sources = [{"id": f"mem_source_{index}", "title": f"Subject {index}"} for index in range(6)]
    context = "Native packed context for all six returned sources."
    result = prepare_main_context("p", "d", "main", "conversation", "subjects",
        ["engraphis_recall_context"], mcp_reader=lambda **_: [{
            "sources": sources, "context": context, "usage": {"omitted_count": 2},
        }])
    records = json.loads(result["text"])
    assert records[0]["context"] == context
    assert records[0]["sources"] == sources
    assert records[0]["truncated"] is True
    assert [ref["nativeId"] for ref in result["references"]] == [row["id"] for row in sources]
    assert all(ref["readOperation"] == "engraphis_recall_context" for ref in result["references"])
    assert len(records) == 1  # The same notes need not occupy Main's input twice.
    assert len(json.dumps([records, result["references"]], ensure_ascii=False).encode()) <= 8000


def test_main_preload_does_not_treat_raw_sentence_code_matches_as_evidence():
    tools = ["cbm.search_graph", "cbm.search_code", "cbm.trace_path"]
    result = prepare_main_context("p", "d", "main", "conversation", "Should we keep an old claim?", tools,
        mcp_reader=lambda **_: pytest.fail("Raw conversational text must not preload code matches"))
    assert result == {"text": "", "references": [], "reads": []}
    assert tools == ["cbm.search_graph", "cbm.search_code", "cbm.trace_path"]


def test_main_preload_retains_fact_provenance_and_handles_large_records():
    import json
    result = prepare_main_context("p", "d", "main", "conversation", "sources", ["graphiti.search_memory_facts"],
        mcp_reader=lambda **kwargs: [{"facts": [{"uuid": "edge-1", "fact": "é" * 2000,
            "episodes": ["episode-1"], "valid_at": "2026-09-07", "source_node_uuid": "source", "target_node_uuid": "target"}]}])
    record = json.loads(result["text"])[0]
    assert record["truncated"] is True
    assert record["data"]["episodes"] == ["episode-1"]
    assert record["data"]["valid_at"] == "2026-09-07"
    assert result["references"][0]["nativeId"] == "edge-1"
    assert len(json.dumps([record, result["references"][0]], ensure_ascii=False).encode()) <= 2000


@pytest.fixture
def native_graph(tmp_path, monkeypatch):
    import io
    import json
    from urllib.error import HTTPError
    from engraphis.service import MemoryService
    # Native persistence/relationship fixture; hash embedding is not semantic proof.
    service = MemoryService.create(str(tmp_path / "memory.sqlite"), embed_model="hash",
                                   extractor="none", graph_extractor="none")
    monkeypatch.setattr(engraphis, "_service", service)
    first = service.remember("Current native graph content", workspace="project-1", title="Current fact")["id"]
    second = service.remember("Project-scoped native engine content", workspace="project-1", title="Native memory")["id"]
    service.link(first, second, workspace="project-1", relation="supports", reason="Retained native evidence")
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


def test_exact_thinkgraph_read_is_project_scoped_and_read_only(native_graph) -> None:
    service, first, _ = native_graph
    before = service.store.conn.total_changes
    record = read_thinkgraph_exact("project-1", first)

    assert record is not None
    assert record["nativeId"] == first
    assert record["content"] == "Current native graph content"
    assert read_thinkgraph_exact("other-project", first) is None
    assert service.store.conn.total_changes == before


def test_exact_thinkgraph_read_accepts_project_scoped_native_engraphis_id(native_graph) -> None:
    _, _, second = native_graph
    record = read_thinkgraph_exact("project-1", second)

    assert record is not None
    assert record["nativeId"] == second
    assert record["recordId"] == second
    assert record["content"] == "Project-scoped native engine content"


def test_required_anchor_materializes_real_data_and_stable_reference(native_graph) -> None:
    _, first, _ = native_graph
    seed, references = resolve_data_anchors(
        "project-1",
        [{
            "authority": "ThinkGraph",
            "nativeId": first,
            "reason": "start from the current fact",
            "boundedExpansion": 0,
            "required": True,
        }],
    )

    assert "Current native graph content" in seed
    assert "Selection reason (guidance, not verified fact)" in seed
    assert "Verified native content" in seed
    assert references[0]["nativeId"] == first
    assert references[0]["authority"] == "ThinkGraph"
    assert references[0]["label"] == "Current fact"
    assert references[0]["selectionScope"] == {"boundedExpansion": 0}
    assert references[0]["materializedContentBytes"] == len(
        "Current native graph content".encode("utf-8")
    )


class _FakeNeo4jResult:
    def __init__(self, rows):
        self._rows = rows

    def data(self):
        return self._rows


def test_thinkgraph_handoff_preserves_native_entities_relationships_and_bounds(native_graph):
    service, first, second = native_graph
    before = service.store.conn.total_changes
    projection = empty_graph_projection("project-1")
    text, refs = resolve_data_anchors("project-1", [{
        "authority": "ThinkGraph", "nativeId": first, "reason": "Use related evidence",
        "boundedExpansion": 1, "resultLimit": 2, "required": True,
    }], graph_projection=projection)
    assert {node["id"] for node in projection["nodes"]} == {first, second}
    assert len(projection["edges"]) == 1
    edge = projection["edges"][0]
    assert (edge["source"], edge["target"], edge["predicate"]) == (first, second, "supports")
    assert edge["properties"]["reason"] == "Retained native evidence"
    assert first in text and second in text and "supports" in text
    assert refs[0]["nativeId"] == first
    assert service.store.conn.total_changes == before
    bounded = read_thinkgraph_exact("project-1", first, bounded_expansion=1, result_limit=1)
    assert bounded["relationshipEvidence"] == [] and bounded["truncated"] is True


class _FakeNeo4jSession:
    def __init__(self, rows):
        self._rows = list(rows)

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def run(self, _query, **_params):
        return _FakeNeo4jResult(self._rows.pop(0))


class _FakeNeo4jDriver:
    def __init__(self, rows):
        self._rows = rows
        self.closed = False

    def session(self, **_kwargs):
        return _FakeNeo4jSession(self._rows)

    def close(self):
        self.closed = True


def test_knowgraph_exact_read_preserves_project_native_identity_and_provenance() -> None:
    driver = _FakeNeo4jDriver([[{
        "nativeId": "entity-1",
        "labels": ["Entity"],
        "properties": {
            "name": "Bounded entity",
            "group_id": "liquidaity-project-1",
            "source": "native-test",
            "name_embedding": [0.1] * 4096,
        },
    }], [{
        "nodes": [{"nativeId": "entity-1", "labels": ["Entity"], "properties": {
            "name_embedding": [0.1] * 4096,
        }}],
        "relationships": [],
    }]])

    record = read_knowgraph_exact(
        "project-1",
        "entity-1",
        bounded_expansion=1,
        driver_factory=lambda: driver,
    )

    assert record is not None
    assert record["nativeId"] == "entity-1"
    assert record["provenance"]["group_id"] == "liquidaity-project-1"
    assert record["relationshipEvidence"][0]["nodes"][0]["nativeId"] == "entity-1"
    assert "name_embedding" not in record["properties"]
    assert "name_embedding" not in record["relationshipEvidence"][0]["nodes"][0]["properties"]
    assert driver.closed is True


def test_native_projection_contains_only_ids_returned_in_model_bound_graph_data(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    record = {
        "authority": "KnowGraph",
        "nativeId": "entity-1",
        "nativeKind": "node",
        "type": "Entity",
        "title": "Alpha",
        "content": "current sourced Alpha record",
        "properties": {"name": "Alpha"},
        "relationshipEvidence": [{
            "nodes": [
                {"nativeId": "entity-1", "labels": ["Entity"], "properties": {"name": "Alpha"}},
                {"nativeId": "entity-2", "labels": ["Entity"], "properties": {"name": "Beta"}},
            ],
            "relationships": [{
                "nativeId": "fact-1",
                "type": "SUPPORTS",
                "sourceNativeId": "entity-1",
                "targetNativeId": "entity-2",
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
            "authority": "KnowGraph",
            "nativeId": "entity-1",
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
    assert all(native_id in seed for native_id in ("entity-1", "entity-2", "fact-1"))
    assert references[0]["nativeId"] == "entity-1"


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
        "card_coder",
        "project.module.materialize_idf",
        bounded_expansion=1,
        mcp_reader=reader,
    )

    assert record is not None
    assert record["nativeId"] == "project.module.materialize_idf"
    assert record["properties"]["file"] == "apps/python-models/app/python_models/idf.py"
    assert record["relationshipEvidence"]["callers"][0]["qualified_name"].endswith("caller")
    assert [name for name, _args in observed["calls"]] == [
        "cbm.index_status", "cbm.get_code_snippet", "cbm.trace_path",
    ]
    assert observed["calls"][2][1]["format"] == "json"


def test_codegraph_exact_read_normalizes_native_grouped_trace_json() -> None:
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
        "card_coder",
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
        if calls[0][0] == "graphiti.get_episodes":
            return [{"episodes": [{
                "uuid": "episode-1", "name": "Source episode",
                "source_description": "unit source",
            }]}]
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
            }]},
        ]

    result = search_knowgraph_hybrid(
        "project-1", "deck_builder", "card-helper", "Alpha",
        exact_records=[{
            "authority": "KnowGraph", "nativeId": "explicit-1", "type": "Entity",
            "title": "Explicit", "content": "{}", "properties": {},
            "relationshipEvidence": [], "provenance": {}, "asOf": "current",
            "readOperation": "neo4j.project_scoped_exact",
            "_selectionReason": "passed by the prior Card",
        }],
        entity_types=["Company"], edge_types=["SUPPORTS"],
        valid_at_after="2026-01-01T00:00:00Z",
        max_nodes=3, max_facts=3, bounded_expansion=1,
        mcp_reader=reader,
    )

    assert [record["nativeId"] for record in result["records"]] == [
        "explicit-1", "entity-1", "fact-1", "fact-2", "entity-2",
    ]
    assert result["records"][2]["provenance"]["episodes"][0]["uuid"] == "episode-1"
    assert result["truncated"] is False
    assert len(observed) == 3


def test_optional_hybrid_search_returns_honest_empty_context(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.python_models.data_anchor.search_knowgraph_hybrid",
        lambda *_args, **_kwargs: {
            "query": "missing", "records": [], "truncated": False,
            "bounds": {"maxNodes": 3, "maxFacts": 3, "maxExpansionDepth": 1},
        },
    )
    anchor = {
        "authority": "KnowGraph", "reason": "look for current context",
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


def test_missing_required_anchor_fails_before_provider(native_graph, monkeypatch) -> None:
    monkeypatch.setattr(
        "app.python_models.data_anchor.read_knowgraph_exact",
        lambda *_args, **_kwargs: None,
    )
    with pytest.raises(DataAnchorError, match="data_anchor_required_not_found"):
        resolve_data_anchors("project-1", [{
            "authority": "KnowGraph", "nativeId": "episode:one", "reason": "required",
            "boundedExpansion": 0, "required": True,
        }])
    with pytest.raises(DataAnchorError, match="data_anchor_required_not_found"):
        resolve_data_anchors("project-1", [{
            "authority": "ThinkGraph", "nativeId": "missing", "reason": "required",
            "boundedExpansion": 0, "required": True,
        }])
