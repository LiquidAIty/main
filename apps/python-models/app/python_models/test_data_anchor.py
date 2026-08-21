from __future__ import annotations

import json
import sqlite3

import pytest

from app.python_models.data_anchor import (
    DataAnchorError,
    empty_graph_projection,
    read_codegraph_exact,
    read_knowgraph_exact,
    read_thinkgraph_exact,
    resolve_data_anchors,
    search_knowgraph_hybrid,
)


def _database(tmp_path):
    path = tmp_path / "thinkgraph.sqlite"
    with sqlite3.connect(path) as connection:
        connection.executescript("""
            CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL);
            CREATE TABLE repos (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL);
            CREATE TABLE memories (
              id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, repo_id TEXT NOT NULL,
              mtype TEXT, title TEXT, content TEXT, metadata TEXT, provenance TEXT,
              valid_from REAL, valid_to REAL, ingested_at REAL
            );
        """)
        connection.execute("INSERT INTO workspaces VALUES (?, ?)", ("workspace-1", "project-1"))
        connection.execute("INSERT INTO repos VALUES (?, ?, ?)", ("repo-1", "workspace-1", "thinkgraph"))
        connection.execute(
            "INSERT INTO memories VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                "physical-1", "workspace-1", "repo-1", "semantic", "Current fact",
                "Current native graph content", json.dumps({"canonicalId": "fact:one"}),
                json.dumps({"source": "unit"}), 1.0, None, 2.0,
            ),
        )
        connection.execute(
            "INSERT INTO memories VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                "mem-native-1", "workspace-1", "repo-1", "semantic",
                "Native Engraphis memory", "Project-scoped native MCP content",
                json.dumps({}), json.dumps({"source": "agent"}),
                2.0, None, 3.0,
            ),
        )
    return path


def test_exact_thinkgraph_read_is_project_scoped_and_read_only(tmp_path) -> None:
    path = _database(tmp_path)
    before = path.stat().st_mtime_ns
    record = read_thinkgraph_exact("project-1", "fact:one", db_path=path)

    assert record is not None
    assert record["nativeId"] == "fact:one"
    assert record["content"] == "Current native graph content"
    assert read_thinkgraph_exact("other-project", "fact:one", db_path=path) is None
    assert path.stat().st_mtime_ns == before


def test_exact_thinkgraph_read_accepts_project_scoped_native_engraphis_id(tmp_path) -> None:
    path = _database(tmp_path)
    record = read_thinkgraph_exact("project-1", "mem-native-1", db_path=path)

    assert record is not None
    assert record["nativeId"] == "mem-native-1"
    assert record["recordId"] == "mem-native-1"
    assert record["content"] == "Project-scoped native MCP content"


def test_required_anchor_materializes_real_data_and_stable_reference(tmp_path) -> None:
    seed, references = resolve_data_anchors(
        "project-1",
        [{
            "authority": "ThinkGraph",
            "nativeId": "fact:one",
            "reason": "start from the current fact",
            "boundedExpansion": 0,
            "required": True,
        }],
        thinkgraph_db_path=_database(tmp_path),
    )

    assert "Current native graph content" in seed
    assert "Selection reason (guidance, not verified fact)" in seed
    assert "Verified native content" in seed
    assert references[0]["nativeId"] == "fact:one"
    assert references[0]["authority"] == "ThinkGraph"


class _FakeNeo4jResult:
    def __init__(self, rows):
        self._rows = rows

    def data(self):
        return self._rows


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
        },
    }], [{
        "nodes": [{"nativeId": "entity-1", "labels": ["Entity"], "properties": {}}],
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


def test_missing_required_anchor_fails_before_provider(tmp_path, monkeypatch) -> None:
    path = _database(tmp_path)
    monkeypatch.setattr(
        "app.python_models.data_anchor.read_knowgraph_exact",
        lambda *_args, **_kwargs: None,
    )
    with pytest.raises(DataAnchorError, match="data_anchor_required_not_found"):
        resolve_data_anchors("project-1", [{
            "authority": "KnowGraph", "nativeId": "episode:one", "reason": "required",
            "boundedExpansion": 0, "required": True,
        }], thinkgraph_db_path=path)
    with pytest.raises(DataAnchorError, match="data_anchor_required_not_found"):
        resolve_data_anchors("project-1", [{
            "authority": "ThinkGraph", "nativeId": "missing", "reason": "required",
            "boundedExpansion": 0, "required": True,
        }], thinkgraph_db_path=path)
