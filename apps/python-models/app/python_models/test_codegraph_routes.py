"""Bounded route contract for the in-app CodeGraph reader."""

# Entity: CodeGraph
# Relationship: This file verifies the Python CodeGraph route accepts only the fixed saved scope and returns the provider-backed result without semantic reshaping.
# Entity: Project Knowledge Graph
# Relationship: This file verifies invalid graph-read modes remain HTTP failures rather than success-shaped shared-workspace projections.

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app import graph_routes
from app.python_models import codegraph_reference_reads


def test_codegraph_route_returns_the_reader_result(monkeypatch: pytest.MonkeyPatch) -> None:
    expected = {
        "schemaVersion": "codegraph.read.v1",
        "status": "ready",
        "mode": "projection",
    }
    monkeypatch.setattr(codegraph_reference_reads, "read_codegraph_view", lambda payload: {
        **expected,
        "request": payload,
    })
    payload = {
        "projectId": "project-1",
        "deckId": "deck_builder",
        "cardId": "builder",
        "mode": "projection",
    }

    result = graph_routes.codegraph_read(payload)

    assert result == {**expected, "request": payload}


def test_codegraph_route_projects_validation_as_http_400(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def invalid(_payload):
        raise ValueError("codegraph_read_mode_invalid")

    monkeypatch.setattr(codegraph_reference_reads, "read_codegraph_view", invalid)
    with pytest.raises(HTTPException) as raised:
        graph_routes.codegraph_read({"mode": "raw-provider-call"})
    assert raised.value.status_code == 400
    assert raised.value.detail == "codegraph_read_mode_invalid"
