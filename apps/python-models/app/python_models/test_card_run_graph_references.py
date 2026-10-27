# Graph + less = more: less code that does the same work as more code is more useful.
# Entity names the feature; Relationship explains why this file belongs and what it contributes.
# Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
# Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
# Entity: Run Ledger
# Relationship: This file verifies an exact KnowGraph readback becomes one Project-scoped Run reference and artifact without accepting mismatched graph scope or Run authority.

from __future__ import annotations

from contextlib import nullcontext

from mcp.types import CallToolResult, TextContent

from app.python_models import card_run_graph_references as references


def _result(*, group_id: str = "liquidaity-project-one") -> CallToolResult:
    payload = {
        "message": "Found Know know-one",
        "know": {
            "uuid": "know-one",
            "entity_uuid": "entity-one",
            "group_id": group_id,
            "content_hash": "a" * 64,
        },
    }
    return CallToolResult(
        content=[TextContent(type="text", text="ok")],
        structuredContent={"result": payload},
        isError=False,
    )


class _Cursor:
    def __init__(self) -> None:
        self.one = None
        self.artifact = None

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, query, params):
        text = " ".join(str(query).split())
        if text.startswith("SELECT project_id, card_id, state"):
            self.one = {
                "project_id": "project-one",
                "card_id": "card_knowgraph",
                "state": "running",
            }
        elif text.startswith("INSERT INTO ag_catalog.run_artifacts"):
            self.artifact = {
                "artifact_id": params[0],
                "producing_run_id": params[1],
                "artifact_kind": params[2],
                "locator": params[3],
                "media_type": params[4],
                "content_sha256": params[5],
                "provenance_ref": params[6],
            }
            self.one = None
        elif text.startswith("SELECT artifact_id, producing_run_id"):
            self.one = self.artifact
        elif text.startswith("SELECT locator, provenance_ref"):
            self.one = None
        else:
            raise AssertionError(text)

    def fetchone(self):
        return self.one

    def fetchall(self):
        return [self.artifact] if self.artifact else []


class _Connection:
    def __init__(self, cursor: _Cursor) -> None:
        self._cursor = cursor

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def cursor(self, **_kwargs):
        return nullcontext(self._cursor)


def test_exact_know_readback_becomes_one_run_reference(monkeypatch) -> None:
    cursor = _Cursor()
    observed = []
    monkeypatch.setattr(references, "connect_postgres", lambda: _Connection(cursor))
    monkeypatch.setattr(
        references.agentgraph_run_observations,
        "observe_artifact",
        lambda *args: observed.append(args),
    )

    result = references.record_graphiti_know_readback(
        result=_result(),
        run_id="run-one",
        project_id="project-one",
        card_id="card_knowgraph",
    )

    assert result == {
        "graphitiEpisodeId": "know-one",
        "graphitiEntityId": "entity-one",
    }
    assert cursor.artifact["producing_run_id"] == "run-one"
    assert cursor.artifact["artifact_kind"] == "graphiti-know-reference"
    assert cursor.artifact["locator"] == "know-one"
    assert cursor.artifact["content_sha256"] == "a" * 64
    assert observed and observed[0][0] == "run-one"
    assert references.graph_references_for_run(cursor, "run-one") == [result]


def test_wrong_project_scope_is_rejected_before_run_artifact(monkeypatch) -> None:
    cursor = _Cursor()
    monkeypatch.setattr(references, "connect_postgres", lambda: _Connection(cursor))

    try:
        references.record_graphiti_know_readback(
            result=_result(group_id="liquidaity-another-project"),
            run_id="run-one",
            project_id="project-one",
            card_id="card_knowgraph",
        )
    except Exception as error:
        assert str(error) == "run_graph_reference_project_mismatch"
    else:
        raise AssertionError("project mismatch was accepted")
    assert cursor.artifact is None


def test_provider_acceptance_without_durable_know_readback_records_nothing() -> None:
    accepted = CallToolResult(
        content=[TextContent(type="text", text="accepted")],
        structuredContent={"result": {"know_uuid": "know-one"}},
        isError=False,
    )
    assert references._know_readback(accepted) is None
