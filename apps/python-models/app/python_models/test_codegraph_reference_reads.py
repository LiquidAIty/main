"""Focused exact-symbol read contracts for CodeGraph."""

# Graph + less = more: less code that does the same work as more code is more useful.
# Entity names the feature; Relationship explains why this file belongs and what it contributes.
# Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
# Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
# Entity: CodeGraph
# Relationship: This file verifies exact qualified-symbol reads preserve repository-relative source coordinates, structural predicates, Feature contributions, and grouped caller records without semantic interpretation.
# Entity: Data Anchors
# Relationship: This file verifies exact Symbol hydration uses only the authorized CBM snippet and bounded trace operations.
# Entity: Builder Card
# Relationship: This file verifies the shared Code view is unavailable unless the persisted Builder Card grants every required read operation.
# Entity: Tool Catalog
# Relationship: This file verifies projection, File expansion, and source read each enforce the exact saved CBM grant set.
# Entity: Project Knowledge Graph
# Relationship: This file verifies one File can contribute to multiple Features and the shared workspace receives exact structural expansions and explicit source reads.

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

    monkeypatch.setattr(
        codegraph_reference_reads,
        "call_materializer_read_tools",
        reader,
    )
    record = read_codegraph_exact(
        "project-1",
        "deck_builder",
        "card_helper",
        "project.module.materialize_idf",
        bounded_expansion=1,
    )

    assert record is not None
    assert record["cbmQualifiedName"] == "project.module.materialize_idf"
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

    monkeypatch.setattr(
        codegraph_reference_reads,
        "call_materializer_read_tools",
        reader,
    )
    record = read_codegraph_exact(
        "project-1",
        "deck_builder",
        "card_helper",
        "project.module.materialize_idf",
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
    observed = {}
    monkeypatch.setattr(codegraph_reference_reads, "_REPO_ROOT", tmp_path)
    source_file = tmp_path / "client/src/example.ts"
    source_file.parent.mkdir(parents=True)
    source_file.write_text(
        "/**\n * Entity: CodeGraph\n * Relationship: Renders exact CBM structure.\n *\n"
        " * Entity: Graph Presentation\n * Relationship: Reuses the shared renderer.\n */",
        encoding="utf-8",
    )

    def reader(**kwargs):
        observed.update(kwargs)
        file_page = {
                "cols": ["name", "label", "lines", "in", "out"],
                "groups": [{
                    "qn_prefix": "C-Projects-LiquidAIty-main.client.src.example.ts",
                    "file": "client/src/example.ts",
                    "rows": [["__file__", "File", "", 0, 0]],
                }],
                "has_more": False,
                "truncated": False,
            }
        return [file_page]

    monkeypatch.setattr(codegraph_reference_reads, "call_materializer_read_tools", reader)
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
    assert observed["project_id"] == "project-1"
    assert observed["card_id"] == "builder"
    assert observed["concurrent"] is True
    assert observed["deadline_seconds"] == 30
    assert len(observed["calls"]) == 1
    assert observed["calls"][0][1]["qn_pattern"].endswith(r"\.(apps|client|services|vite)\.")
    assert all(name == "cbm.search_graph" for name, _ in observed["calls"])


def test_projection_does_not_report_ready_when_source_headers_are_unreadable(monkeypatch, tmp_path):
    monkeypatch.setattr(codegraph_reference_reads, "_REPO_ROOT", tmp_path)
    monkeypatch.setattr(codegraph_reference_reads.saved_cards, "load_deck",
                        lambda *_args: _saved_builder(tools=["cbm.search_graph", "cbm.search_code"]))
    monkeypatch.setattr(codegraph_reference_reads, "call_materializer_read_tools", lambda **_: [
        {"cols": ["name", "label"], "groups": [{"qn_prefix": "repo", "file": "client/file.ts",
                                                 "rows": [["file", "File"]]}]},
    ])
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


def test_codegraph_projection_honors_persisted_builder_grants(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        codegraph_reference_reads.saved_cards,
        "load_deck",
        lambda *_args: _saved_builder(tools=["cbm.search_graph"]),
    )
    reader = lambda **_kwargs: pytest.fail("provider must not be called without the saved grant")
    monkeypatch.setattr(codegraph_reference_reads, "call_materializer_read_tools", reader)

    result = read_codegraph_view({
        "projectId": "project-1",
        "deckId": "deck_builder",
        "cardId": "builder",
        "mode": "projection",
    })

    assert result["status"] == "unavailable"
    assert result["errors"] == [{
        "purpose": "authorization",
        "operation": "cbm.search_code",
        "code": "codegraph_saved_tool_not_granted",
    }]


def test_codegraph_file_read_preserves_structural_predicates_and_current_coverage(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        codegraph_reference_reads.saved_cards,
        "load_deck",
        lambda *_args: _saved_builder(tools=["cbm.query_graph", "cbm.check_index_coverage"]),
    )

    def reader(**kwargs):
        assert [name for name, _arguments in kwargs["calls"]] == [
            "cbm.query_graph", "cbm.check_index_coverage",
        ]
        assert "client/src/example.ts" in kwargs["calls"][0][1]["query"]
        return [
            {
                "columns": [
                    "source_qualified_name", "source_name", "source_kind",
                    "source_file_path", "source_start_line", "source_end_line",
                    "predicate", "target_qualified_name", "target_name",
                    "target_kind", "target_file_path", "target_start_line",
                    "target_end_line",
                ],
                "rows": [[
                    "project.example.caller", "caller", "Function",
                    "client/src/example.ts", "10", "20", "CALLS",
                    "project.example.target", "target", "Function",
                    "client/src/target.ts", "5", "9",
                ]],
                "truncated": False,
                "has_more": False,
            },
            {
                "paths": {
                    "cols": ["freshness"],
                    "rows": [["current"]],
                },
            },
        ]

    monkeypatch.setattr(codegraph_reference_reads, "call_materializer_read_tools", reader)
    result = read_codegraph_view({
        "projectId": "project-1",
        "deckId": "deck_builder",
        "cardId": "builder",
        "mode": "file",
        "filePath": "client/src/example.ts",
    })

    assert result["status"] == "ready"
    assert result["freshness"]["status"] == "current"
    assert result["projection"]["edges"][0]["predicate"] == "CALLS"
    assert {node["id"] for node in result["projection"]["nodes"]} == {
        "project.example.caller", "project.example.target",
    }


def test_codegraph_source_read_is_explicit_and_includes_tests(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        codegraph_reference_reads.saved_cards,
        "load_deck",
        lambda *_args: _saved_builder(tools=["cbm.get_code_snippet", "cbm.trace_path"]),
    )
    observed = {}

    def exact(*args, **kwargs):
        observed["args"] = args
        observed["kwargs"] = kwargs
        return {
            "cbmQualifiedName": "C-Projects-LiquidAIty-main.client.example.symbol",
            "content": "export const symbol = true;",
            "truncated": False,
        }

    monkeypatch.setattr(codegraph_reference_reads, "read_codegraph_exact", exact)
    result = read_codegraph_view({
        "projectId": "project-1",
        "deckId": "deck_builder",
        "cardId": "builder",
        "mode": "source",
        "qualifiedName": "C-Projects-LiquidAIty-main.client.example.symbol",
    })

    assert result["status"] == "ready"
    assert result["selectedSymbol"]["content"].startswith("export")
    assert observed["kwargs"] == {
        "bounded_expansion": 2,
        "result_limit": codegraph_reference_reads.MAX_GRAPH_REFERENCE_RESULTS,
        "include_tests": True,
    }


def test_file_source_uses_exact_cbm_file_identity_and_reports_clipping(monkeypatch):
    monkeypatch.setattr(codegraph_reference_reads.saved_cards, "load_deck",
                        lambda *_args: _saved_builder(tools=["cbm.get_code_snippet"]))
    qualified = "C-Projects-LiquidAIty-main.client.src.example.ts.__file__"

    def reader(**kwargs):
        assert kwargs["calls"] == [("cbm.get_code_snippet", {
            "project": "C-Projects-LiquidAIty-main", "qualified_name": qualified,
            "include_neighbors": False, "source_mode": "full", "max_output_tokens": 64_000,
            "format": "json",
        })]
        return [{"qualified_name": qualified, "label": "File", "source": "export const value = 1;",
                 "file_path": "client/src/example.ts", "start_line": 1, "end_line": 1,
                 "source_truncated": True}]

    monkeypatch.setattr(codegraph_reference_reads, "call_materializer_read_tools", reader)
    result = read_codegraph_view({"projectId": "project-1", "deckId": "deck_builder",
                                 "cardId": "builder", "mode": "source", "qualifiedName": qualified})
    assert result["status"] == "partial"
    assert result["selectedSymbol"]["recordKind"] == "file"
    assert result["selectedSymbol"]["truncated"] is True
    assert result["selectedSymbol"]["content"] == "export const value = 1;"


def test_file_source_rejects_wrong_provider_identity(monkeypatch):
    monkeypatch.setattr(codegraph_reference_reads.saved_cards, "load_deck",
                        lambda *_args: _saved_builder(tools=["cbm.get_code_snippet"]))
    monkeypatch.setattr(codegraph_reference_reads, "call_materializer_read_tools", lambda **_: [{
        "qualified_name": "different.file", "label": "File", "source": "wrong content",
    }])
    result = read_codegraph_view({"projectId": "project-1", "deckId": "deck_builder",
                                 "cardId": "builder", "mode": "source",
                                 "qualifiedName": "C-Projects-LiquidAIty-main.client.example.ts.__file__"})
    assert result["status"] == "unavailable"
    assert result["selectedSymbol"] is None
