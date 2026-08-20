from __future__ import annotations

import json
import sqlite3

import pytest

from app.python_models.data_anchor import (
    DataAnchorError,
    read_thinkgraph_exact,
    resolve_data_anchors,
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


def test_unimplemented_or_missing_required_anchor_fails_before_provider(tmp_path) -> None:
    path = _database(tmp_path)
    with pytest.raises(DataAnchorError, match="data_anchor_resolver_unavailable:KnowGraph"):
        resolve_data_anchors("project-1", [{
            "authority": "KnowGraph", "nativeId": "episode:one", "reason": "required",
            "boundedExpansion": 0, "required": True,
        }], thinkgraph_db_path=path)
    with pytest.raises(DataAnchorError, match="data_anchor_required_not_found"):
        resolve_data_anchors("project-1", [{
            "authority": "ThinkGraph", "nativeId": "missing", "reason": "required",
            "boundedExpansion": 0, "required": True,
        }], thinkgraph_db_path=path)
