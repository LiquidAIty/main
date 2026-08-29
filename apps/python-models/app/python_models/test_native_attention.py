from __future__ import annotations

import copy
import json

from mcp.types import CallToolResult, TextContent

from app.python_models import native_attention


def _result(payload: dict) -> CallToolResult:
    return CallToolResult(
        content=[TextContent(type="text", text=json.dumps(payload))],
        structuredContent={"result": payload},
    )


def test_cbm_search_graph_emits_only_exact_returned_ids_and_keeps_result_unchanged() -> None:
    result = _result({
        "total": 2,
        "results": [
            {"qualified_name": "pkg._runtime_owner", "name": "_runtime_owner"},
            {"qualified_name": "pkg.test_runtime_owner", "name": "test_runtime_owner"},
        ],
    })
    before = copy.deepcopy(result.model_dump())
    event = native_attention.build_native_attention_event(
        "cbm.search_graph",
        result,
        {
            "projectId": "project-one",
            "deckId": "deck-one",
            "conversationId": "conversation-one",
            "parentRunId": "run-one",
            "mainCardId": "card-main",
        },
    )
    assert event is not None
    assert event["authority"] == "codegraph"
    assert event["operation"] == "read"
    assert event["nativeNodeIds"] == ["pkg._runtime_owner", "pkg.test_runtime_owner"]
    assert event["nativeEdgeIds"] == []
    assert event["cardId"] == "card-main"
    assert event["runId"] == "run-one"
    assert result.model_dump() == before


def test_current_cbm_tabular_results_emit_exact_symbol_and_file_references() -> None:
    result = CallToolResult(
        content=[TextContent(type="text", text="current native CBM result")],
        structuredContent={
            "cols": ["qn", "label", "file", "lines"],
            "rows": [[
                "C-Projects-LiquidAIty-main.apps.python-models.app.python_models.idf.materialize_idf",
                "Function",
                "apps/python-models/app/python_models/idf.py",
                "37-78",
            ]],
        },
    )
    before = copy.deepcopy(result.model_dump())

    event = native_attention.build_native_attention_event(
        "cbm.search_code",
        result,
        {
            "projectId": "project-one",
            "deckId": "deck-one",
            "conversationId": "conversation-one",
            "parentRunId": "coder-run-one",
            "mainCardId": "card_local_coder",
        },
    )

    assert event is not None
    assert event["nativeNodeIds"] == [
        "C-Projects-LiquidAIty-main.apps.python-models.app.python_models.idf.materialize_idf",
        "apps/python-models/app/python_models/idf.py",
    ]
    assert event["runId"] == "coder-run-one"
    assert event["cardId"] == "card_local_coder"
    assert result.model_dump() == before


def test_current_cbm_grouped_and_files_results_preserve_only_returned_objects() -> None:
    grouped = CallToolResult(
        content=[],
        structuredContent={
            "cols": ["name", "label", "lines"],
            "groups": [{
                "prefix": "C-Projects-LiquidAIty-main.apps.python-models.app.python_models.idf",
                "file": "apps/python-models/app/python_models/idf.py",
                "rows": [["materialize_idf", "Function", "356-446"]],
            }],
        },
    )
    grouped_event = native_attention.build_native_attention_event(
        "cbm.search_graph", grouped, None,
    )
    assert grouped_event is not None
    assert grouped_event["nativeNodeIds"] == [
        "C-Projects-LiquidAIty-main.apps.python-models.app.python_models.idf.materialize_idf",
        "apps/python-models/app/python_models/idf.py",
    ]

    files_event = native_attention.build_native_attention_event(
        "cbm.search_code",
        _result({"files": ["apps/python-models/app/python_models/idf.py"]}),
        None,
    )
    assert files_event is not None
    assert files_event["nativeNodeIds"] == [
        "apps/python-models/app/python_models/idf.py",
    ]


def test_alias_is_canonical_and_unknown_identity_stays_null() -> None:
    event = native_attention.build_native_attention_event(
        "mcp__main_runtime_abcd__cbm_search_graph",
        _result({"results": [{"qualified_name": "pkg._runtime_owner"}]}),
        None,
    )
    assert event is not None
    assert event["toolName"] == "cbm.search_graph"
    assert event["projectId"] is None
    assert event["runId"] is None
    assert event["cardId"] is None


def test_non_graph_and_graph_results_without_stable_ids_emit_nothing() -> None:
    assert native_attention.build_native_attention_event(
        "web_search", _result({"results": [{"url": "https://example.com"}]}), None
    ) is None
    assert native_attention.build_native_attention_event(
        "graphiti.search_nodes", _result({"nodes": [{"name": "no uuid"}]}), None
    ) is None
    assert native_attention.build_native_attention_event(
        "graphiti.graph_write_guess", _result({"nodes": [{"uuid": "node-one"}]}), None
    ) is None


def test_declared_write_contract_extracts_graphiti_nodes_and_edge() -> None:
    event = native_attention.build_native_attention_event(
        "graphiti.add_triplet",
        _result({
            "nodes": [{"uuid": "node-a"}, {"uuid": "node-b"}],
            "edges": [{
                "uuid": "edge-one",
                "source_node_uuid": "node-a",
                "target_node_uuid": "node-b",
                "name": "USES",
                "group_id": "group-one",
            }],
        }),
        None,
    )
    assert event is not None
    assert event["operation"] == "write"
    assert event["nativeNodeIds"] == ["node-a", "node-b"]
    assert event["nativeEdgeIds"] == ["edge-one"]
    assert event["nativeEdges"] == [{
        "id": "edge-one",
        "source": "node-a",
        "target": "node-b",
        "predicate": "USES",
        "provenance": {"group_id": "group-one"},
    }]


def test_constellation_context_uses_returned_nodes_and_does_not_invent_edge_ids() -> None:
    event = native_attention.build_native_attention_event(
        "constellation.context",
        _result({
            "nodes": [{"id": "memory-a"}, {"id": "memory-b"}],
            "edges": [{
                "from": "memory-a", "to": "memory-b", "type": "builds_on",
                "strength": 0.8,
            }],
        }),
        None,
    )

    assert event is not None
    assert event["nativeNodeIds"] == ["memory-a", "memory-b"]
    assert event["nativeEdgeIds"] == []
    assert event["nativeEdges"] == []


def test_current_constellation_read_and_write_operations_preserve_native_ids() -> None:
    updated = native_attention.build_native_attention_event(
        "constellation.update_memory",
        _result({"ok": True, "id": "memory-a", "updatedFields": ["tags"]}),
        None,
    )
    assert updated is not None
    assert updated["operation"] == "write"
    assert updated["nativeNodeIds"] == ["memory-a"]

    pair = native_attention.build_native_attention_event(
        "constellation.adjust_edge_pair",
        _result({"nodeA": "memory-a", "nodeB": "memory-b", "updated": 2}),
        None,
    )
    assert pair is not None
    assert pair["nativeNodeIds"] == ["memory-a", "memory-b"]

    edge = native_attention.build_native_attention_event(
        "constellation.inspect_edge",
        _result({"edge": {
            "id": 12,
            "source": "memory-a",
            "target": "memory-b",
            "edge_type": "builds_on",
        }}),
        None,
    )
    assert edge is not None
    assert edge["operation"] == "read"
    assert edge["nativeEdgeIds"] == ["12"]
    assert edge["nativeEdges"] == [{
        "id": "12",
        "source": "memory-a",
        "target": "memory-b",
        "predicate": "builds_on",
    }]


def test_constellation_receipts_without_native_ids_do_not_fake_attention() -> None:
    assert native_attention.build_native_attention_event(
        "constellation.semantic_status",
        _result({"state": "ready", "model": "Xenova/bge-m3"}),
        None,
    ) is None
    assert native_attention.build_native_attention_event(
        "constellation.autonomy_status",
        _result({"run": {"id": "not-a-memory-node", "state": "running"}}),
        None,
    ) is None


def test_duplicate_ids_are_deduplicated_and_caps_are_deterministic(
    monkeypatch,
) -> None:
    monkeypatch.setattr(native_attention, "NATIVE_ATTENTION_NODE_LIMIT", 2)
    event = native_attention.build_native_attention_event(
        "cbm.search_graph",
        _result({"results": [
            {"qualified_name": "pkg.a"},
            {"qualified_name": "pkg.a"},
            {"qualified_name": "pkg.b"},
            {"qualified_name": "pkg.c"},
        ]}),
        None,
    )
    assert event is not None
    assert event["nativeNodeIds"] == ["pkg.a", "pkg.b"]
    assert event["truncated"] is True


def test_result_hash_is_stable_for_the_same_normalized_reference_set() -> None:
    first = native_attention.build_native_attention_event(
        "constellation.context", _result({"nodes": [{"id": "memory-one"}]}), None
    )
    second = native_attention.build_native_attention_event(
        "constellation.context", _result({"nodes": [{"id": "memory-one"}]}), None
    )
    assert first is not None and second is not None
    assert first["resultHash"] == second["resultHash"]
    assert first["eventId"] != second["eventId"]


def test_self_inspection_never_creates_native_graph_attention():
    assert native_attention.build_native_attention_event("agentgraph.inspect", _result({
        "cards": [{"cardId": "card-one"}], "runs": [{"runId": "run-one"}],
        "id": "not-a-memory", "symbols": [{"fqname": "not-cbm"}],
    }), None) is None


def test_graphiti_pending_completion_and_deletion_contracts_never_invent_ids():
    pending = native_attention.build_native_attention_event("graphiti.add_memory", {"phase": "pending"}, None)
    assert pending["phase"] == "pending"
    assert pending["nativeNodeIds"] == pending["nativeEdgeIds"] == []
    # Queue acknowledgements alone cannot claim any completed graph write.
    assert native_attention.build_native_attention_event("graphiti.add_memory", _result({"message": "queued"}), None) is None
    completed = native_attention.build_native_attention_event("graphiti.add_memory", {
        "phase": "completed", "episodes": [{"uuid": "episode-one"}],
        "nodes": [{"uuid": "node-one"}], "edges": [],
    }, None)
    assert completed["nativeNodeIds"] == ["episode-one", "node-one"]
    assert completed["phase"] == "completed"
    for name, node_ids, edge_ids in (("delete_episode", ["native-uuid"], []),
                                    ("delete_entity_edge", [], ["native-uuid"])):
        event = native_attention.build_native_attention_event(f"graphiti.{name}", _result({"message": "deleted"}),
                                                             None, arguments={"uuid": "native-uuid"})
        assert event["change"] == "delete"
        assert event["nativeNodeIds"] == node_ids and event["nativeEdgeIds"] == edge_ids
        assert native_attention.build_native_attention_event(f"graphiti.{name}", _result({"error": "not found"}),
                                                            None, arguments={"uuid": "native-uuid"}) is None
        assert native_attention.build_native_attention_event(f"graphiti.{name}", _result({"message": "deleted"}), None) is None
    cleared = native_attention.build_native_attention_event("graphiti.clear_graph", _result({"message": "cleared"}),
                                                           None, arguments={"group_ids": ["project-group"]})
    assert cleared["change"] == "clear" and cleared["scopeGroupIds"] == ["project-group"]
    assert cleared["nativeNodeIds"] == cleared["nativeEdgeIds"] == []


def test_current_native_cbm_trace_json_keeps_nested_qualified_ids():
    event = native_attention.build_native_attention_event("cbm.trace_path", {
        "function": "pkg.target", "callers": {"cols": ["name", "hop"],
            "groups": [{"qn_prefix": "pkg", "rows": [["caller", 1]]}]},
    }, None)
    assert event["nativeNodeIds"] == ["pkg.target", "pkg.caller"]
    assert event["nativeEdges"] == []
