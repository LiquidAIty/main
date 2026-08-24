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
            }],
        }),
        None,
    )
    assert event is not None
    assert event["operation"] == "write"
    assert event["nativeNodeIds"] == ["node-a", "node-b"]
    assert event["nativeEdgeIds"] == ["edge-one"]


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
        "engraphis.why", _result({"answer": [{"id": "memory-one"}]}), None
    )
    second = native_attention.build_native_attention_event(
        "engraphis.why", _result({"answer": [{"id": "memory-one"}]}), None
    )
    assert first is not None and second is not None
    assert first["resultHash"] == second["resultHash"]
    assert first["eventId"] != second["eventId"]
