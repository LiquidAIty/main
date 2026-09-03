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


def _idf(
    *, graph_context: str = "", secret: bool = False,
    selected_target: bool = False, builder_operation: bool = False,
    builder_mode: str = "edit",
):
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
    operation = None
    if builder_operation:
        operation = ({
            "mode": "create",
            "deckRevision": "deck-revision-one",
            "workspaceRoot": "C:/Projects/agents",
            "cbmProject": None,
            "allowedFields": [
                "templateId", "title", "role", "prompt", "runtime", "model", "tools",
            ],
            "templateId": "template_assist",
            "title": "New Assistant",
            "role": "A bounded specialist",
            "prompt": "Perform only the assigned specialist task.",
            "tools": ["web_search"],
            "runtime": {"kind": "autogen", "mode": "assistant"},
            "model": {
                "provider": "openai",
                "modelKey": "gpt-5.6-luna",
                "providerModelId": "gpt-5.6-luna",
                "accessMode": "chatgpt-account",
            },
        } if builder_mode == "create" else {
            "mode": "edit",
            "deckRevision": "deck-revision-one",
            "workspaceRoot": "C:/Projects/agents",
            "cbmProject": None,
            "allowedFields": ["prompt", "tools"],
            "templateId": "template_assist",
            "title": "Selected Assistant",
            "role": "Selected specialist",
            "prompt": "Complete the revised bounded mission.",
            "tools": ["web_search"],
            "targetCardId": "selected-card",
            "targetCardRevisionId": "selected-revision-one",
        })
    return materialize_idf(
        stable={
            "projectId": "project-one",
            "deckId": "deck-one",
            "cardId": "card-one",
            "cardRevisionId": "revision-one",
            "instructions": "Use the saved Card contract.",
            "outputContract": "Return one bounded result.",
            "runtime": {"kind": "hermes", "mode": "delegate", "profile": "coder"},
            "runtimeOptions": {"reasoningEffort": "high", "maxTokens": 1200},
            "provider": {
                "provider": "openai",
                "providerModelId": "gpt-5.6",
                **({"apiKey": "forbidden"} if secret else {}),
            },
        },
        variable={
            "task": "Inspect the exact bounded slice.",
            "selectedCardTarget": ({
                "cardId": "selected-card",
                "cardRevisionId": "selected-revision-one",
                "deckRevision": "deck-revision-one",
                "title": "Selected Assistant",
                "templateId": "template_assist",
                "role": "Selected specialist",
                "prompt": "Complete the selected bounded mission.",
                "outputContract": {"type": "object"},
                "runtime": {"kind": "autogen", "mode": "assistant"},
                "runtimeOptions": {"tools": ["web_search"]},
            } if selected_target else None),
            "agentBuilderGuidance": ({
                "vision": {
                    "sourcePath": "PLAN.md", "sourceSha256": "a" * 64,
                    "content": "## Agent Builder product vision\nBuild one Card.",
                },
                "idd": {
                    "sourcePath": "LiquidAIty.idd", "sourceSha256": "b" * 64,
                    "content": {"template": {"id": "template_assist"}},
                },
                "skill": {
                    "sourcePath": "Hermes/.hermes/profiles/builder/skills/build/SKILL.md",
                    "sourceSha256": "c" * 64, "content": "Build exactly one Card.",
                },
            } if builder_operation else None),
            "agentBuilderOperation": operation,
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
        graph_context=graph_context,
        native_references=references,
        graph_projection=projection,
        materialized_at="2026-08-23T12:00:00Z",
    )


def test_empty_graph_section_is_valid_and_idf_is_graph_first() -> None:
    materialized = _idf()
    assert materialized.idf.actualGraphData.recordCounts == {
        "node": 0,
        "relationship": 0,
        "selection": 0,
        "total": 0,
    }
    assert materialized.idf.actualGraphData.authorities == []
    assert materialized.idf.actualGraphData.records == []
    assert list(json.loads(materialized.idf_bytes)) == [
        "actualGraphData",
        "stableSavedCardContext",
        "selectedToolsAndGrants",
        "dynamicContext",
    ]
    assert load_idf_bytes(materialized.idf_bytes) == materialized


def test_bounded_graph_identity_provenance_and_model_order_survive() -> None:
    graph = "### CodeGraph\nVerified native content."
    materialized = _idf(graph_context=graph)
    records = {record.kind: record for record in materialized.idf.actualGraphData.records}
    assert records["selection"].nativeId == "project.module.materialize_idf"
    assert records["selection"].content["selectionScope"] == {
        "boundedExpansion": 1, "resultLimit": 4,
    }
    assert records["selection"].sourcePath == "apps/example.py"
    assert records["node"].provenance["repository"] == "C-Projects-LiquidAIty-main"
    assert materialized.idf.actualGraphData.selectedNativeReferences[0]["nativeId"] == (
        "project.module.materialize_idf"
    )
    task = model_task(materialized.idf)
    assert (
        task.index(graph)
        < task.index("Return one bounded result.")
        < task.index("Inspect the exact bounded slice.")
    )
    projected = runtime_projection(load_idf_bytes(materialized.idf_bytes))
    assert projected["message"] == task
    assert projected["outputRequirements"] == "Return one bounded result."
    assert projected["enabledTools"] == ["codegraph.search_graph"]
    summary = idf_public(materialized)["inputSummary"]
    assert summary["idfBytes"] == len(materialized.idf_bytes)
    assert summary["estimatedGraphContextTokens"] > 0


def test_selected_card_target_is_retained_and_projected_before_the_mission() -> None:
    materialized = _idf(selected_target=True, builder_operation=True)
    target = materialized.idf.dynamicContext.selectedCardTarget
    assert target is not None
    assert target.cardId == "selected-card"
    assert target.cardRevisionId == "selected-revision-one"
    message = model_task(materialized.idf)
    assert message.index("Agent Builder guidance") < message.index(
        "Agent Builder operation"
    )
    assert message.index("Agent Builder operation") < message.index(
        "Selected Agent Builder target"
    )
    assert message.index("Selected Agent Builder target") < message.index(
        "Inspect the exact bounded slice."
    )
    projection = runtime_projection(materialized)
    assert projection["buildTarget"]["deckRevision"] == "deck-revision-one"
    assert projection["builderOperation"] == {
        "mode": "edit",
        "deckRevision": "deck-revision-one",
        "workspaceRoot": "C:/Projects/agents",
        "cbmProject": None,
        "allowedFields": ["prompt", "tools"],
        "templateId": "template_assist",
        "title": "Selected Assistant",
        "role": "Selected specialist",
        "prompt": "Complete the revised bounded mission.",
        "tools": ["web_search"],
        "runtime": None,
        "model": None,
        "targetCardId": "selected-card",
        "targetCardRevisionId": "selected-revision-one",
    }
    assert projection["builderGuidance"]["vision"]["sourcePath"] == "PLAN.md"


def test_agent_builder_create_authority_round_trips_through_the_canonical_idf() -> None:
    materialized = _idf(builder_operation=True, builder_mode="create")

    projection = runtime_projection(load_idf_bytes(materialized.idf_bytes))

    assert projection["buildTarget"] is None
    assert projection["builderOperation"] == {
        "mode": "create",
        "deckRevision": "deck-revision-one",
        "workspaceRoot": "C:/Projects/agents",
        "cbmProject": None,
        "allowedFields": [
            "templateId", "title", "role", "prompt", "runtime", "model", "tools",
        ],
        "templateId": "template_assist",
        "title": "New Assistant",
        "role": "A bounded specialist",
        "prompt": "Perform only the assigned specialist task.",
        "tools": ["web_search"],
        "runtime": {"kind": "autogen", "mode": "assistant"},
        "model": {
            "provider": "openai",
            "modelKey": "gpt-5.6-luna",
            "providerModelId": "gpt-5.6-luna",
            "accessMode": "chatgpt-account",
        },
        "targetCardId": None,
        "targetCardRevisionId": None,
    }


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
