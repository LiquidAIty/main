from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.python_models.idf import (
    IDF_FILENAME,
    InputMaterializationError,
    idf_public,
    load_idf,
    load_idf_bytes,
    materialize_idf,
    model_task,
    runtime_projection,
    write_idf,
)


def _idf(*, graph_context: str = "", secret: bool = False):
    reference = {
        "authority": "CodeGraph",
        "nativeId": "project.module.materialize_idf",
        "nativeKind": "node",
        "reason": "Bound the coding task.",
        "asOf": "2026-08-23T12:00:00Z",
        "required": True,
        "readOperation": "get_code_snippet",
        "provenance": {"repository": "C-Projects-LiquidAIty-main"},
        "label": "materialize_idf",
        "sourcePath": "apps/example.py",
        "sourceUrl": "https://example.test/source",
        "selectionScope": {"boundedExpansion": 1, "resultLimit": 4},
        "materializedContentBytes": 18,
        "truncated": False,
    }
    references = [reference] if graph_context else []
    projection = {
        "authority": "CodeGraph" if graph_context else "",
        "nodes": ([{
            "id": "project.module.materialize_idf",
            "authority": "CodeGraph",
            "type": "Function",
            "label": "materialize_idf",
            "labels": ["Function"],
            "properties": {"file": "apps/example.py", "source": "def materialize_idf(): pass"},
            "provenance": {"repository": "C-Projects-LiquidAIty-main"},
        }] if graph_context else []),
        "edges": [],
    }
    return materialize_idf(
        owner={
            "kind": "card-run",
            "projectId": "project-one",
            "deckId": "deck-one",
            "cardId": "card-one",
            "runId": "run-one",
        },
        stable={
            "projectId": "project-one",
            "deckId": "deck-one",
            "cardId": "card-one",
            "cardRevisionId": "revision-one",
            "instructions": "Use the saved Card contract.",
            "outputContract": "Return one bounded result.",
            "runtime": {"kind": "hermes", "mode": "delegate", "profile": "coder"},
            "provider": {
                "provider": "openai",
                "providerModelId": "gpt-5.6",
                **({"apiKey": "forbidden"} if secret else {}),
            },
        },
        variable={
            "task": "Inspect the exact bounded slice.",
            "selectedNativeReferences": references,
            "images": [],
        },
        capabilities={
            "enabledTools": ["codegraph.search_graph"],
            "toolDefinitions": [],
            "nativeTools": [],
            "skills": [],
            "toolsets": [],
            "mcpConnectionIds": ["liquidaity"],
        },
        allocation={"runtimeOptions": {"reasoningEffort": "high", "maxTokens": 1200}},
        graph_context=graph_context,
        native_references=references,
        graph_projection=projection,
        materialized_at="2026-08-23T12:00:00Z",
    )


def test_empty_graph_section_is_valid_and_idf_is_graph_first() -> None:
    materialized = _idf()
    assert materialized.idf.igf.recordCounts == {
        "materialized-context": 0,
        "node": 0,
        "relationship": 0,
        "selection": 0,
        "total": 0,
    }
    assert materialized.idf.igf.authorities == []
    assert materialized.idf.igf.records == []
    assert materialized.idf_bytes.index(b'"igf"') < materialized.idf_bytes.index(b'"icf"')
    assert load_idf_bytes(materialized.idf_bytes) == materialized


def test_bounded_graph_identity_provenance_and_model_order_survive() -> None:
    graph = "### CodeGraph\nVerified native content."
    materialized = _idf(graph_context=graph)
    records = {record.kind: record for record in materialized.idf.igf.records}
    assert records["selection"].nativeId == "project.module.materialize_idf"
    assert records["selection"].content["selectionScope"] == {
        "boundedExpansion": 1, "resultLimit": 4,
    }
    assert records["selection"].sourcePath == "apps/example.py"
    assert records["node"].provenance["repository"] == "C-Projects-LiquidAIty-main"
    assert materialized.idf.igf.selectedNativeReferences[0]["nativeId"] == (
        "project.module.materialize_idf"
    )
    task = model_task(materialized.idf)
    assert task.index(graph) < task.index("Inspect the exact bounded slice.")
    assert task.index("Inspect the exact bounded slice.") < task.index("Output requirements:")
    projected = runtime_projection(load_idf_bytes(materialized.idf_bytes))
    assert projected["message"] == task
    assert projected["enabledTools"] == ["codegraph.search_graph"]
    summary = idf_public(materialized)["inputSummary"]
    assert summary["idfBytes"] == len(materialized.idf_bytes)
    assert summary["estimatedGraphContextTokens"] == materialized.idf.estimates["graphContextTokens"]


def test_each_run_writes_one_file_and_reloads_exact_bytes(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LIQUIDAITY_RUN_INPUT_ROOT", str(tmp_path))
    materialized = _idf(graph_context="bounded")
    descriptor = write_idf(
        materialized,
        project_id="project-one",
        deck_id="deck-one",
        run_id="run-one",
    )
    workspace = Path(descriptor["workspace"])
    assert [path.name for path in workspace.iterdir()] == [IDF_FILENAME]
    loaded = load_idf(
        descriptor,
        project_id="project-one",
        deck_id="deck-one",
        run_id="run-one",
        card_id="card-one",
    )
    assert loaded.idf_bytes == materialized.idf_bytes
    assert descriptor["idfSha256"] == materialized.idf_sha256


def test_run_identity_rejects_cross_run_file_reuse(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LIQUIDAITY_RUN_INPUT_ROOT", str(tmp_path))
    descriptor = write_idf(
        _idf(), project_id="project-one", deck_id="deck-one", run_id="run-one"
    )
    with pytest.raises(InputMaterializationError, match="input_file_run_identity_mismatch"):
        load_idf(
            descriptor,
            project_id="project-one",
            deck_id="deck-one",
            run_id="two",
        )


def test_noncanonical_or_secret_bearing_idf_fails_closed() -> None:
    materialized = _idf()
    value = json.loads(materialized.idf_bytes)
    value["format"] = "wrong"
    corrupted = (json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
    with pytest.raises(InputMaterializationError, match="input_file_invalid"):
        load_idf_bytes(corrupted)
    with pytest.raises(InputMaterializationError, match="input_file_secret_field_forbidden"):
        _idf(secret=True)
