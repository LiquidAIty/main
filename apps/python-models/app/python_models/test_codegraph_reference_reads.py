"""Focused exact-symbol read contracts for CodeGraph."""

# Entity: CodeGraph
# Relationship: This file verifies exact qualified-symbol reads preserve repository-relative source coordinates, structural predicates, Feature contributions, and grouped caller records without semantic interpretation.
# Entity: Builder Card
# Relationship: This file verifies the shared Code view is unavailable unless the persisted Builder Card grants every required read operation.
# Entity: Tool Catalog
# Relationship: This file verifies projection, File expansion, and source read each enforce the exact saved CBM grant set.
# Entity: Project Knowledge Graph
# Relationship: This file verifies one File can contribute to multiple Features and the shared workspace receives exact authorized structural expansions, pointer reads, and explicit source reads.

from __future__ import annotations

import pytest

from app.python_models import codegraph_reference_reads
from app.python_models.codegraph_reference_reads import (
    read_codegraph_exact,
    read_codegraph_view,
)


def _saved_builder(*, tools: list[str]) -> dict:
    return {
        "projectId": "project-1",
        "deck": {
            "id": "deck_builder",
            "nodes": [{
                "id": "builder",
                "enabled": True,
                "runtime": {"kind": "hermes", "profile": "builder"},
                "runtimeOptions": {"tools": tools},
                "_cardRevisionId": "revision-1",
                "_cardRevision": 7,
            }],
        },
        "meta": {"deckRevision": "deck-revision-1"},
    }


def test_codegraph_exact_read_uses_official_mcp_calls_and_qualified_symbol(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    observed = {}

    def reader(**kwargs):
        observed.update(kwargs)
        return [
            {
                "qualified_name": "project.module.resolve_graph_pointer",
                "name": "resolve_graph_pointer",
                "label": "Function",
                "file_path": "C:/Projects/LiquidAIty/main/apps/python-models/app/python_models/idf.py",
                "start_line": 37,
                "end_line": 78,
                "source": "def resolve_graph_pointer():\n    pass",
                "signature": "()",
                "fp": "current-fingerprint",
            },
            {"callers": [{"qualified_name": "project.module.caller"}], "callees": []},
        ]

    monkeypatch.setattr(
        codegraph_reference_reads,
        "call_graph_read_tools",
        reader,
    )
    record = read_codegraph_exact(
        "project-1",
        "deck_builder",
        "card_helper",
        "project.module.resolve_graph_pointer",
        bounded_expansion=1,
    )

    assert record is not None
    assert record["cbmQualifiedName"] == "project.module.resolve_graph_pointer"
    assert record["properties"]["file"] == "apps/python-models/app/python_models/idf.py"
    assert record["relationshipEvidence"]["callers"][0]["qualified_name"].endswith("caller")
    assert [name for name, _args in observed["calls"]] == [
        "cbm.get_code_snippet", "cbm.trace_path",
    ]
    assert all(arguments["format"] == "json" for _, arguments in observed["calls"])


def test_codegraph_exact_read_normalizes_provider_grouped_trace_json(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def reader(**_kwargs):
        return [
            {
                "qualified_name": "project.module.resolve_graph_pointer",
                "name": "resolve_graph_pointer",
                "label": "Function",
                "file_path": "apps/python-models/app/python_models/idf.py",
                "source": "def resolve_graph_pointer():\n    pass",
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

    monkeypatch.setattr(
        codegraph_reference_reads,
        "call_graph_read_tools",
        reader,
    )
    record = read_codegraph_exact(
        "project-1",
        "deck_builder",
        "card_helper",
        "project.module.resolve_graph_pointer",
        bounded_expansion=1,
    )

    assert record is not None
    assert record["relationshipEvidence"]["callers"] == [{
        "name": "caller",
        "hop": 1,
        "qualified_name": "project.module.caller",
    }]


def test_codegraph_projection_preserves_one_file_with_multiple_feature_memberships(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    monkeypatch.setattr(
        codegraph_reference_reads.saved_cards,
        "load_deck",
        lambda *_args: _saved_builder(tools=["cbm.search_graph", "cbm.search_code"]),
    )
    monkeypatch.setattr(codegraph_reference_reads, "_REPO_ROOT", tmp_path)
    source_file = tmp_path / "client/src/example.ts"
    source_file.parent.mkdir(parents=True)
    source_file.write_text(
        "/**\n * Entity: CodeGraph\n * Relationship: Renders exact CBM structure.\n *\n"
        " * Entity: Graph Presentation\n * Relationship: Reuses the shared renderer.\n */",
        encoding="utf-8",
    )

    monkeypatch.setattr(codegraph_reference_reads, "call_graph_read_tools",
                        lambda **_: pytest.fail("annotation projection must not call CBM"))
    result = read_codegraph_view({
        "projectId": "project-1",
        "deckId": "deck_builder",
        "cardId": "builder",
        "mode": "projection",
    })

    assert result["status"] == "ready"
    projection = result["projection"]
    files = [node for node in projection["nodes"] if node["type"] == "File"]
    features = [node for node in projection["nodes"] if node["type"] == "Feature"]
    assert len(files) == 1
    assert len(features) == 2
    assert len(projection["edges"]) == 2
    assert files[0]["properties"]["features"] == ["CodeGraph", "Graph Presentation"]
    assert files[0]["id"] == "source-file:client/src/example.ts"
    assert files[0]["properties"]["sourceAuthority"] == "repository-file"
    assert "qualifiedName" not in files[0]["properties"]


def test_projection_does_not_report_ready_when_source_headers_are_unreadable(monkeypatch, tmp_path):
    monkeypatch.setattr(codegraph_reference_reads, "_REPO_ROOT", tmp_path)
    monkeypatch.setattr(codegraph_reference_reads.saved_cards, "load_deck",
                        lambda *_args: _saved_builder(tools=["cbm.search_graph", "cbm.search_code"]))
    monkeypatch.setattr(codegraph_reference_reads, "_source_file_paths", lambda: ["client/file.ts"])
    result = read_codegraph_view({"projectId": "project-1", "deckId": "deck_builder",
                                 "cardId": "builder", "mode": "projection"})
    assert result["status"] == "unavailable"
    assert result["projection"]["metadata"]["classifiedFileCount"] == 0
    assert result["errors"] == [{"purpose": "feature-annotations", "operation": "source-header",
                                 "code": "codegraph_source_header_unavailable", "filePath": "client/file.ts"}]


def test_header_reads_preserve_the_line_80_boundary_and_reject_outside_paths(monkeypatch, tmp_path):
    root = tmp_path / "repo"
    source_file = root / "client/edge.ts"
    source_file.parent.mkdir(parents=True)
    source_file.write_text("\n" * 79 + "// Entity: Boundary\n// Relationship: Last eligible pair.\n"
                           "// Entity: Too late\n// Relationship: Must not enter the graph.\n", encoding="utf-8")
    (tmp_path / "outside.py").write_text("# Entity: Private\n# Relationship: Not repository source.\n", encoding="utf-8")
    monkeypatch.setattr(codegraph_reference_reads, "_REPO_ROOT", root)
    contributions, errors = codegraph_reference_reads._feature_contributions([
        "client/edge.ts", "../outside.py",
    ])
    assert [item["feature"] for item in contributions] == ["Boundary"]
    assert contributions[0]["entityLine"] == 80
    assert contributions[0]["relationshipLine"] == 81
    assert errors[0]["filePath"] == "../outside.py"


def test_annotation_graph_and_file_text_are_independent_of_cbm_and_builder_grants(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    monkeypatch.setattr(codegraph_reference_reads, "_REPO_ROOT", tmp_path)
    source = tmp_path / "client/example.ts"
    source.parent.mkdir()
    source.write_text("// Entity: Example\n// Relationship: Explains this file.\nexport const value = 1;", encoding="utf-8")
    monkeypatch.setattr(codegraph_reference_reads.saved_cards, "load_deck",
                        lambda *_: pytest.fail("annotation graph must not depend on a saved agent"))
    monkeypatch.setattr(codegraph_reference_reads, "call_graph_read_tools",
                        lambda **_: pytest.fail("annotation graph must not call CBM"))

    result = read_codegraph_view({
        "projectId": "project-1",
        "deckId": "deck_builder",
        "cardId": "builder",
        "mode": "projection",
    })

    assert result["status"] == "ready"
    assert result["projection"]["counts"] == {"nodes": 2, "edges": 1}
    opened = read_codegraph_view({"projectId": "project-1", "deckId": "deck_builder", "cardId": "builder",
                                 "mode": "source", "filePath": "client/example.ts"})
    assert opened["status"] == "ready"
    assert opened["fileSource"]["content"] == source.read_text(encoding="utf-8")
    assert opened["fileSource"]["graphSystem"] == "repository"
    assert "cbmQualifiedName" not in opened["fileSource"]


def _query_rows(rows, **pagination):
    return {"columns": ["selected", "neighbor", "predicate"], "rows": rows, **pagination}


def test_codegraph_file_set_uses_two_cbm_queries_not_per_file_symbol_traces(monkeypatch):
    monkeypatch.setattr(codegraph_reference_reads.saved_cards, "load_deck",
                        lambda *_: _saved_builder(tools=["cbm.query_graph"]))
    observed = []
    def reader(**kwargs):
        observed.append(kwargs)
        assert len(kwargs["calls"]) == 2
        for operation, arguments in kwargs["calls"]:
            assert operation == "cbm.query_graph"
            assert '"client/a.ts", "client/b.ts"' in arguments["query"]
            assert "RETURN DISTINCT" in arguments["query"]
            assert "CALLS|IMPORTS" in arguments["query"]
        return [
            _query_rows([["client/a.ts", "client/target.ts", "CALLS"],
                         ["client/a.ts", "client/target.ts", "IMPORTS"],
                         ["client/a.ts", "client/a.ts", "CALLS"],
                         ["client/a.ts", "<python-builtins>", "CALLS"],
                         ["client/b.ts", "", ""]]),
            _query_rows([["client/b.ts", "client/caller.ts", "CALLS"]]),
        ]
    monkeypatch.setattr(codegraph_reference_reads, "call_graph_read_tools", reader)
    result = read_codegraph_view({"projectId": "project-1", "deckId": "deck_builder", "cardId": "builder",
                                 "mode": "file", "filePaths": ["client/a.ts", "client/b.ts"]})
    assert result["status"] == "ready"
    assert len(observed) == 1
    assert observed[0]["concurrent"] is True
    assert observed[0]["deadline_seconds"] == 30
    assert {(edge["source"], edge["predicate"], edge["target"]) for edge in result["projection"]["edges"]} == {
        ("source-file:client/a.ts", "CALLS", "source-file:client/target.ts"),
        ("source-file:client/a.ts", "IMPORTS", "source-file:client/target.ts"),
        ("source-file:client/caller.ts", "CALLS", "source-file:client/b.ts"),
    }
    assert all(node["properties"]["recordKind"] == "file" for node in result["projection"]["nodes"])
    assert result["projection"]["metadata"]["selectedFilePaths"] == ["client/a.ts", "client/b.ts"]


def test_file_query_pages_are_complete_without_a_total_neighbor_limit(monkeypatch):
    calls = []
    def reader(**kwargs):
        calls.extend(kwargs["calls"])
        if len(calls) == 2:
            return [
                _query_rows([["client/a.ts", "client/one.ts", "CALLS"]],
                            has_more=True, truncated=True, next_cursor="page-two"),
                _query_rows([["client/a.ts", "", ""]]),
            ]
        assert len(kwargs["calls"]) == 1
        assert kwargs["calls"][0][1]["cursor"] == "page-two"
        return [_query_rows([["client/a.ts", "client/two.ts", "CALLS"]])]
    monkeypatch.setattr(codegraph_reference_reads, "call_graph_read_tools", reader)
    result = codegraph_reference_reads._read_codegraph_files(
        {"projectId": "project-1", "deckId": "deck_builder", "cardId": "builder",
         "tools": {"cbm.query_graph"}}, ["client/a.ts"])
    assert result["status"] == "ready" and not result["truncated"]
    assert len(result["projection"]["edges"]) == 2
    assert len(result["projection"]["nodes"]) == 3


def test_nonadvancing_query_cursor_is_incomplete_not_ready(monkeypatch):
    monkeypatch.setattr(codegraph_reference_reads, "call_graph_read_tools",
        lambda **kwargs: [_query_rows([["client/a.ts", "", ""]], has_more=True, next_cursor="same")
                          for _ in kwargs["calls"]])
    result = codegraph_reference_reads._read_codegraph_files(
        {"projectId": "project-1", "deckId": "deck_builder", "cardId": "builder",
         "tools": {"cbm.query_graph"}}, ["client/a.ts"])
    assert result["status"] == "partial" and result["truncated"]
    assert result["errors"][0]["code"] == "codegraph_cursor_not_advancing"
    assert result["projection"]["nodes"][0]["properties"]["structuralComplete"] is False


def test_missing_indexed_file_and_failed_query_do_not_become_empty_success(monkeypatch):
    monkeypatch.setattr(codegraph_reference_reads, "call_graph_read_tools",
        lambda **kwargs: [_query_rows([]), {"error": "read_timeout"}])
    result = codegraph_reference_reads._read_codegraph_files(
        {"projectId": "project-1", "deckId": "deck_builder", "cardId": "builder",
         "tools": {"cbm.query_graph"}}, ["client/missing.ts"])
    assert result["status"] == "partial"
    assert {error["code"] for error in result["errors"]} == {"read_timeout", "codegraph_file_not_indexed"}
    assert result["projection"]["nodes"][0]["properties"]["structuralComplete"] is False


def test_query_rejects_rows_outside_the_requested_file_set(monkeypatch):
    monkeypatch.setattr(codegraph_reference_reads, "call_graph_read_tools",
        lambda **kwargs: [_query_rows([["client/a.ts", "", ""],
                                     ["client/unselected.ts", "client/other.ts", "CALLS"]]),
                          _query_rows([["client/a.ts", "", ""]])])
    result = codegraph_reference_reads._read_codegraph_files(
        {"projectId": "project-1", "deckId": "deck_builder", "cardId": "builder",
         "tools": {"cbm.query_graph"}}, ["client/a.ts"])
    assert result["status"] == "partial"
    assert result["errors"][0]["code"] == "codegraph_result_scope_invalid"
    assert result["projection"]["edges"] == []


def test_file_expansion_requires_saved_query_grant_before_provider_call(monkeypatch):
    monkeypatch.setattr(codegraph_reference_reads.saved_cards, "load_deck",
                        lambda *_: _saved_builder(tools=["cbm.search_graph", "cbm.get_code_snippet", "cbm.trace_path"]))
    monkeypatch.setattr(codegraph_reference_reads, "call_graph_read_tools",
                        lambda **_: pytest.fail("ungranted query must not run"))
    result = read_codegraph_view({"projectId": "project-1", "deckId": "deck_builder", "cardId": "builder",
                                 "mode": "file", "filePaths": ["client/example.ts"]})
    assert result["status"] == "unavailable"
    assert result["errors"][0]["operation"] == "cbm.query_graph"


def test_file_source_reads_repository_text_without_symbol_tools(monkeypatch, tmp_path):
    monkeypatch.setattr(codegraph_reference_reads, "_REPO_ROOT", tmp_path)
    source = tmp_path / "client/src/example.ts"
    source.parent.mkdir(parents=True)
    source.write_text("export const value = 1;", encoding="utf-8")
    monkeypatch.setattr(codegraph_reference_reads, "call_graph_read_tools",
                        lambda **_: pytest.fail("file text must not call a symbol reader"))
    monkeypatch.setattr(codegraph_reference_reads.saved_cards, "load_deck",
                        lambda *_: pytest.fail("file text must not load an agent"))
    result = read_codegraph_view({"projectId": "project-1", "deckId": "deck_builder", "cardId": "builder",
                                 "mode": "source", "filePath": "client/src/example.ts"})
    assert result["status"] == "ready"
    assert result["fileSource"]["content"] == "export const value = 1;"
    assert result["fileSource"]["graphSystem"] == "repository"
    assert result["fileSource"]["recordKind"] == "file"
    assert result["fileSource"]["sourceReference"] == "source-file:client/src/example.ts"
    assert "cbmQualifiedName" not in result["fileSource"]
    assert result["projection"] is None


def test_browser_source_refuses_symbol_selection_before_any_provider_call(monkeypatch):
    monkeypatch.setattr(codegraph_reference_reads, "call_graph_read_tools",
                        lambda **_: pytest.fail("symbol read must not run"))
    with pytest.raises(ValueError, match="codegraph_symbol_selection_not_supported"):
        read_codegraph_view({"projectId": "project-1", "deckId": "deck_builder", "cardId": "builder",
                             "mode": "source", "qualifiedName": "C-Projects-LiquidAIty-main.client.example.run"})


def test_repository_source_reports_its_display_limit_and_refuses_outside_paths(monkeypatch, tmp_path):
    source = tmp_path / "client/example.ts"
    source.parent.mkdir(parents=True)
    source.write_text("0123456789abcdef", encoding="utf-8")
    monkeypatch.setattr(codegraph_reference_reads, "_REPO_ROOT", tmp_path)
    monkeypatch.setattr(codegraph_reference_reads, "_MAX_FILE_SOURCE_CHARS", 10)
    payload = {"projectId": "project-1", "deckId": "deck_builder", "cardId": "builder",
               "mode": "source", "filePath": "client/example.ts"}
    clipped = read_codegraph_view(payload)
    assert clipped["status"] == "partial"
    assert clipped["fileSource"]["content"] == "0123456789"
    assert clipped["fileSource"]["truncated"] is True
    refused = read_codegraph_view({**payload, "filePath": "../outside.py"})
    assert refused["status"] == "unavailable" and refused["fileSource"] is None
