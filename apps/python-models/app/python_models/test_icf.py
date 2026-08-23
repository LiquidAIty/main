from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.python_models.icf import (
    ICF_FILENAME,
    IGF_FILENAME,
    InputMaterializationError,
    load_input_pair,
    load_input_pair_bytes,
    materialize_input_pair,
    runtime_projection,
    write_input_pair,
)


def _pair(*, graph_context: str = "", secret: bool = False):
    reference = {
        "authority": "CodeGraph",
        "nativeId": "project.module.symbol",
        "nativeKind": "node",
        "reason": "Bound the coding task.",
        "asOf": "2026-08-23T12:00:00Z",
        "required": True,
        "readOperation": "get_code_snippet",
        "provenance": {"repository": "C-Projects-LiquidAIty-main"},
        "truncated": False,
    }
    references = [reference] if graph_context else []
    projection = {
        "authority": "codegraph" if graph_context else "",
        "nodes": ([{
            "id": "project.module.symbol",
            "authority": "CodeGraph",
            "type": "Function",
            "label": "symbol",
            "labels": ["Function"],
            "properties": {"file": "apps/example.py", "source": "def symbol(): pass"},
            "provenance": {"repository": "C-Projects-LiquidAIty-main"},
        }] if graph_context else []),
        "edges": [],
    }
    return materialize_input_pair(
        owner={"kind": "card-run", "runId": "run-one"},
        stable={
            "projectId": "project-one",
            "deckId": "deck-one",
            "cardId": "card-one",
            "cardRevisionId": "revision-one",
            "instructions": "Use the saved Card contract.",
            "outputContract": "Return one bounded result.",
            "runtime": {"kind": "hermes", "mode": "delegate", "profile": "coder"},
            "provider": {"provider": "openai", "providerModelId": "gpt-5.6"},
            **({"apiKey": "forbidden"} if secret else {}),
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


def test_empty_igf_is_mandatory_canonical_and_hash_linked() -> None:
    pair = _pair()
    assert pair.icf.graphInput["filename"] == IGF_FILENAME
    assert pair.icf.graphInput["recordCounts"] == {
        "materialized-context": 0,
        "node": 0,
        "relationship": 0,
        "selection": 0,
        "total": 0,
    }
    assert pair.igf.header.authorities == []
    assert pair.igf.records == []
    assert pair.igf_bytes.count(b"\n") == 1
    assert pair.icf.graphInput["sha256"] == pair.igf_sha256
    assert pair.icf.estimates["graphContextTokens"] == 0
    assert pair.icf.estimates["totalModelVisibleTokens"] > 0
    assert load_input_pair_bytes(pair.icf_bytes, pair.igf_bytes) == pair


def test_graph_igf_preserves_native_identity_content_path_and_provenance() -> None:
    pair = _pair(graph_context="### CodeGraph\nVerified native content.")
    records = {record.kind: record for record in pair.igf.records}
    assert records["selection"].nativeId == "project.module.symbol"
    assert records["node"].content["properties"]["source"] == "def symbol(): pass"
    assert records["node"].sourcePath == "apps/example.py"
    assert records["node"].provenance["repository"] == "C-Projects-LiquidAIty-main"
    assert records["materialized-context"].content["text"].startswith("### CodeGraph")
    projected = runtime_projection(load_input_pair_bytes(pair.icf_bytes, pair.igf_bytes))
    assert projected["task"] == "Inspect the exact bounded slice."
    assert projected["graphContext"] == "### CodeGraph\nVerified native content."
    assert projected["enabledTools"] == ["codegraph.search_graph"]


def test_concurrent_runs_write_isolated_workspaces_with_exactly_two_files(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LIQUIDAITY_RUN_INPUT_ROOT", str(tmp_path))
    pair = _pair(graph_context="bounded")
    first = write_input_pair(pair, project_id="p", deck_id="d", run_id="one")
    second = write_input_pair(pair, project_id="p", deck_id="d", run_id="two")
    assert first["workspace"] != second["workspace"]
    for descriptor in (first, second):
        workspace = Path(descriptor["workspace"])
        assert sorted(path.name for path in workspace.iterdir()) == [ICF_FILENAME, IGF_FILENAME]
        loaded = load_input_pair(descriptor)
        assert loaded.icf_bytes == pair.icf_bytes
        assert loaded.igf_bytes == pair.igf_bytes


def test_corrupt_or_secret_bearing_input_fails_closed() -> None:
    pair = _pair()
    value = json.loads(pair.icf_bytes)
    value["graphInput"]["sha256"] = "0" * 64
    corrupted = (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode()
    with pytest.raises(InputMaterializationError, match="input_graph_reference_mismatch"):
        load_input_pair_bytes(corrupted, pair.igf_bytes)
    with pytest.raises(InputMaterializationError, match="input_file_secret_field_forbidden"):
        _pair(secret=True)
