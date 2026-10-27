"""Canonical IDF contract, limits, retained bytes, and projection tests."""
# Graph + less = more: less code that does the same work as more code is more useful.
# Entity names the feature; Relationship explains why this file belongs and what it contributes.
# Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
# Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
# Entity: IDF
# Relationship: This file verifies exact four-part bytes, graph/tool/image retention, secret rejection, versioned new-input limits, failed-write cleanup, and historical read compatibility.

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.python_models import idf as idf_module
from app.python_models.card_script import saved_script
from app.python_models.idf import load_idf, materialize_idf, runtime_projection, write_idf
from app.python_models.idf_contract import (
    IDF_FILENAME,
    IDF_IMAGE_BYTES_MAX,
    IDF_IMAGES_MAX,
    IDF_LIMIT_POLICY_VERSION,
    IDF_SECTION_BYTES_MAX,
    IDF_TASK_BYTES_MAX,
    IDF_TOTAL_BYTES_MAX,
    InputMaterializationError,
    canonical_line,
    idf_size_report,
    load_idf_bytes,
)
from app.python_models.idf_projection import idf_public, model_task


def _idf(
    *, graph_context: str = "", secret: bool = False,
    capabilities: dict | None = None, task: str = "Inspect the exact bounded slice.",
    images: list[dict] | None = None, materialized_record_sha256: str = "",
    projection_payload_chars: int = 0,
    stable_extra: dict | None = None, variable_extra: dict | None = None,
    reference_extra: dict | None = None, projection_extra: dict | None = None,
):
    reference = {
        "cbmQualifiedName": "project.module.materialize_idf",
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
        **(
            {"materializedRecordSha256": materialized_record_sha256}
            if materialized_record_sha256 else {}
        ),
        "truncated": False,
        **(reference_extra or {}),
    }
    references = [reference] if graph_context else []
    projection = {
        "graphSystems": ["cbm"] if graph_context else [],
        "nodes": ([{
            "id": "project.module.materialize_idf",
            "graphSystem": "cbm",
            "type": "Function",
            "label": "materialize_idf",
            "labels": ["Function"],
            "properties": {
                "file": "apps/example.py",
                "source": "def materialize_idf(): pass" + ("x" * projection_payload_chars),
            },
            "provenance": {"repository": "C-Projects-LiquidAIty-main"},
        }] if graph_context else []),
        "edges": [],
        **(projection_extra or {}),
    }
    return materialize_idf(
        stable={
            "projectId": "project-one",
            "deckId": "deck-one",
            "cardId": "card-one",
            "cardRevisionId": "revision-one",
            "instructions": "Use the saved Card contract.",
            "outputContract": "Return one bounded result.",
            "runtime": {"kind": "hermes", "mode": "delegate", "profile": "helper"},
            "runtimeOptions": {"reasoningEffort": "high"},
            "provider": {
                "provider": "openai",
                "providerModelId": "gpt-5.6",
                **({"apiKey": "forbidden"} if secret else {}),
            },
            **(stable_extra or {}),
        },
        variable={
            "task": task,
            "images": list(images or []),
            **(variable_extra or {}),
        },
        capabilities={
            "enabledTools": ["cbm.search_graph"],
            "toolDefinitions": [],
            "skills": [],
            "toolsets": [],
            "mcpConnectionIds": ["liquidaity"],
            **(capabilities or {}),
        },
        graph_context=graph_context,
        graph_records=references,
        graph_projection=projection,
        materialized_at="2026-08-23T12:00:00Z",
    )


def _run_telemetry_ledger() -> dict:
    return {
        "attemptEvents": [{"marker": "LEDGER_ATTEMPT_EVENT"}],
        "requestFulfillment": {"marker": "LEDGER_REQUEST_FULFILLMENT"},
        "observationGap": {"marker": "LEDGER_OBSERVATION_GAP"},
        "timingMs": {"marker": "LEDGER_TIMING"},
        "inputTokens": "LEDGER_INPUT_TOKENS",
        "outputTokens": "LEDGER_OUTPUT_TOKENS",
        "totalCostUsd": "LEDGER_COST",
        "toolReceipt": {"marker": "LEDGER_TOOL_RECEIPT"},
        "executionReceipt": {"marker": "LEDGER_EXECUTION_RECEIPT"},
    }


def _all_keys(value) -> set[str]:
    if isinstance(value, dict):
        keys = set(value)
        for item in value.values():
            keys.update(_all_keys(item))
        return keys
    if isinstance(value, list):
        keys: set[str] = set()
        for item in value:
            keys.update(_all_keys(item))
        return keys
    return set()


def test_empty_graph_section_is_valid_and_idf_is_graph_first() -> None:
    materialized = _idf()
    assert materialized.idf.actualGraphData.recordCounts == {
        "node": 0,
        "relationship": 0,
        "selection": 0,
        "total": 0,
    }
    assert materialized.idf.actualGraphData.graphSystems == []
    assert materialized.idf.actualGraphData.records == []
    assert list(json.loads(materialized.idf_bytes)) == [
        "actualGraphData",
        "stableSavedCardContext",
        "selectedToolsAndGrants",
        "dynamicContext",
    ]
    assert load_idf_bytes(materialized.idf_bytes) == materialized


def test_representative_main_and_builder_inputs_fit_the_versioned_policy() -> None:
    encoded_image = "data:image/jpeg;base64," + ("A" * (1024 * 1024))
    main = _idf(
        task="Compare Rocket Lab and SpaceX for a long-term decision. " * 1000,
        graph_context="Relevant and recent Project evidence. " * 8000,
        images=[
            {"name": "market.jpg", "mediaType": "image/jpeg", "dataUrl": encoded_image},
            {"name": "worldview.jpg", "mediaType": "image/jpeg", "dataUrl": encoded_image},
        ],
    )
    builder = _idf(
        task="Implement the approved UI repair and verify it.",
        graph_context="Current source relationship and contract evidence. " * 12000,
        stable_extra={"instructions": "Saved Builder instructions. " * 8000},
        capabilities={
            "toolDefinitions": [
                {
                    "canonicalId": f"cbm.tool_{index}",
                    "description": "Bounded repository operation " + ("x" * 1000),
                }
                for index in range(200)
            ],
        },
    )

    for materialized in (main, builder):
        report = idf_size_report(materialized.idf)
        assert report["policyVersion"] == IDF_LIMIT_POLICY_VERSION
        assert report["totalBytes"] == len(materialized.idf_bytes)
        assert report["totalBytes"] < IDF_TOTAL_BYTES_MAX
        assert all(
            report["sectionBytes"][section] < maximum
            for section, maximum in IDF_SECTION_BYTES_MAX.items()
        )


def test_new_idf_limits_reject_without_truncating_values() -> None:
    with pytest.raises(InputMaterializationError, match="input_task_too_large"):
        _idf(task="x" * (IDF_TASK_BYTES_MAX + 1))
    with pytest.raises(InputMaterializationError, match="input_images_too_many"):
        _idf(images=[{"name": str(index)} for index in range(IDF_IMAGES_MAX + 1)])
    with pytest.raises(InputMaterializationError, match="input_image_too_large"):
        _idf(images=[{
            "name": "large.jpg",
            "mediaType": "image/jpeg",
            "dataUrl": "data:image/jpeg;base64," + ("A" * IDF_IMAGE_BYTES_MAX),
        }])
    with pytest.raises(
        InputMaterializationError,
        match="input_section_too_large:actualGraphData",
    ):
        _idf(graph_context="g" * IDF_SECTION_BYTES_MAX["actualGraphData"])
    with pytest.raises(
        InputMaterializationError,
        match="input_section_too_large:stableSavedCardContext",
    ):
        _idf(stable_extra={
            "instructions": "s" * IDF_SECTION_BYTES_MAX["stableSavedCardContext"],
        })
    with pytest.raises(
        InputMaterializationError,
        match="input_section_too_large:selectedToolsAndGrants",
    ):
        _idf(capabilities={
            "toolDefinitions": [{
                "canonicalId": "large.tool",
                "description": "t" * IDF_SECTION_BYTES_MAX["selectedToolsAndGrants"],
            }],
        })


def test_historical_oversized_idf_remains_readable_but_cannot_be_written_as_new(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    value = json.loads(_idf().idf_bytes)
    value["dynamicContext"]["task"] = "x" * (IDF_TASK_BYTES_MAX + 1)
    historical_bytes = canonical_line(value)
    historical = load_idf_bytes(historical_bytes)
    assert historical.idf_bytes == historical_bytes

    monkeypatch.setenv("LIQUIDAITY_RUN_INPUT_ROOT", str(tmp_path))
    with pytest.raises(InputMaterializationError, match="input_task_too_large"):
        write_idf(
            historical,
            project_id="project-one",
            deck_id="deck-one",
            run_id="oversized-new-run",
        )
    assert not idf_module.invocation_workspace(
        "project-one", "deck-one", "oversized-new-run",
    ).exists()


def test_idf_projection_preserves_exact_user_task_whitespace() -> None:
    exact = "  @builder Reply exactly BUILDER_DIRECT_OK  "
    materialized = _idf(task=exact)
    assert materialized.idf.dynamicContext.task == exact
    assert runtime_projection(materialized)["message"] == exact


def test_worldview_turn_context_is_retained_once_and_projected_for_hermes() -> None:
    image = {
        "schemaVersion": "worldview.turn-context.v1",
        "kind": "worldview-viewport",
        "projectId": "project-one",
        "cardId": "card-one",
        "name": "worldview-viewport.jpg",
        "mediaType": "image/jpeg",
        "sha256": "0" * 64,
        "sizeBytes": 3,
        "dataUrl": "data:image/jpeg;base64,AQID",
        "capturedAt": "2026-09-28T12:00:00Z",
        "viewport": {"imagePixels": {"width": 640, "height": 480}},
        "context": {
            "schemaVersion": "worldview.surface-context.v1",
            "currentView": {
                "ok": True,
                "camera": {"longitude": -74.006, "latitude": 40.7128},
                "place": "New York City",
                "viewScale": "city",
                "enabledLayers": ["flights"],
            },
            "entityContext": {
                "ok": True,
                "selected": {"id": "flight-one", "callsign": "SOURCE 1"},
            },
        },
    }
    materialized = _idf(task="What city is this and what is selected?", images=[image])
    loaded = load_idf_bytes(materialized.idf_bytes)
    projected = runtime_projection(loaded)

    assert projected["images"] == [image]
    assert projected["message"].endswith("What city is this and what is selected?")
    assert "## Current WorldView observations" in projected["message"]
    assert '"place":"New York City"' in projected["message"]
    assert '"id":"flight-one"' in projected["message"]
    assert image["dataUrl"] not in projected["message"]
    assert projected["estimates"]["worldviewContextTokens"] > 0


def test_script_presentation_survives_exact_idf_bytes_and_runtime_projection() -> None:
    source = '''CARD_SCRIPT = {
    "mode": "tool_recipe",
    "input": {"type": "object", "properties": {}},
    "output": {"type": "object", "properties": {"result": {}}, "required": ["result"]},
}
from hermes_tools import SCRIPT, output, tools
tools.cbm.search_graph = SCRIPT
tools.call("cbm.search_graph")
output.emit({"result": {}})
'''
    script = saved_script(
        {"enabled": True, "source": source},
        selected_tools=["cbm.search_graph"],
    )
    presentation = {
        "mode": "script",
    }
    materialized = _idf(capabilities={
        "presentedTools": [],
        "unavailableTools": ["graphiti.search_nodes"],
        "scriptPresentation": presentation,
    }, stable_extra={
        "runtimeOptions": {"reasoningEffort": "high", "script": script},
    })
    loaded = load_idf_bytes(materialized.idf_bytes)
    assert loaded.idf.selectedToolsAndGrants.scriptPresentation == presentation
    assert loaded.idf.selectedToolsAndGrants.unavailableTools == ["graphiti.search_nodes"]
    assert runtime_projection(loaded)["scriptPresentation"] == presentation
    assert runtime_projection(loaded)["unavailableTools"] == ["graphiti.search_nodes"]
    assert runtime_projection(loaded)["cardScript"]["tool_names"] == {
        "cbm.search_graph": "cbm.search_graph",
    }


def test_bounded_graph_identity_provenance_and_model_order_survive() -> None:
    graph = "### CodeGraph\nVerified provider content."
    materialized = _idf(graph_context=graph)
    records = {record.kind: record for record in materialized.idf.actualGraphData.records}
    assert records["selection"].cbmQualifiedName == "project.module.materialize_idf"
    assert records["selection"].content["selectionScope"] == {
        "boundedExpansion": 1, "resultLimit": 4,
    }
    assert records["selection"].sourcePath == "apps/example.py"
    assert records["node"].provenance["repository"] == "C-Projects-LiquidAIty-main"
    assert materialized.idf.actualGraphData.selectedGraphRecords[0]["cbmQualifiedName"] == (
        "project.module.materialize_idf"
    )
    task = model_task(materialized.idf)
    assert task.index(graph) < task.index("Inspect the exact bounded slice.")
    assert "Return one bounded result." not in task
    projected = runtime_projection(load_idf_bytes(materialized.idf_bytes))
    assert projected["message"] == task
    assert "systemPrompt" not in projected
    assert "outputRequirements" not in projected
    assert materialized.idf.stableSavedCardContext.instructions == (
        "Use the saved Card contract."
    )
    assert materialized.idf.stableSavedCardContext.outputRequirements == (
        "Return one bounded result."
    )
    assert projected["enabledTools"] == ["cbm.search_graph"]
    summary = idf_public(materialized)["inputSummary"]
    assert summary["idfBytes"] == len(materialized.idf_bytes)
    assert summary["estimatedGraphContextTokens"] > 0


def test_selected_graph_record_is_not_serialized_again_in_structured_section() -> None:
    graph = "Verified provider properties: " + ("x" * 4_000)
    baseline = _idf(graph_context=graph, projection_payload_chars=4_000)
    compact = _idf(
        graph_context=graph, materialized_record_sha256="a" * 64,
        projection_payload_chars=4_000,
    )
    node = next(
        record for record in compact.idf.actualGraphData.records
        if record.kind == "node"
    )

    assert node.cbmQualifiedName == "project.module.materialize_idf"
    assert node.provenance == {"repository": "C-Projects-LiquidAIty-main"}
    assert node.content["materializedRecord"] == {
        "cbmQualifiedName": "project.module.materialize_idf",
        "sha256": "a" * 64,
    }
    assert "properties" not in node.content
    assert len(compact.idf_bytes) < len(baseline.idf_bytes)


def test_builder_input_has_no_operation_authority() -> None:
    materialized = _idf()
    assert set(materialized.idf.dynamicContext.model_dump()) == {"task", "images"}
    projected = runtime_projection(materialized)
    assert not ({"buildTarget", "builderOperation", "builderGuidance"} & projected.keys())


def test_unrelated_old_idf_with_empty_operation_fields_keeps_exact_bytes() -> None:
    value = json.loads(_idf().idf_bytes)
    value["dynamicContext"] = {
        "task": value["dynamicContext"]["task"], "selectedCardTarget": None,
        "agentBuilderGuidance": None, "agentBuilderOperation": None, "images": [],
    }
    raw = (json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
    loaded = load_idf_bytes(raw)
    assert loaded.idf_bytes == raw
    assert runtime_projection(loaded)["message"] == value["dynamicContext"]["task"]
    value["dynamicContext"]["agentBuilderOperation"] = {"mode": "create"}
    with pytest.raises(InputMaterializationError):
        load_idf_bytes((json.dumps(value, separators=(",", ":")) + "\n").encode())


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


def test_failed_retained_file_validation_removes_workspace_for_same_run_retry(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LIQUIDAITY_RUN_INPUT_ROOT", str(tmp_path))
    materialized = _idf()
    original_load = idf_module._contract.load_idf_bytes

    def reject_retained_bytes(_bytes: bytes):
        raise InputMaterializationError("input_file_invalid")

    monkeypatch.setattr(
        idf_module._contract,
        "load_idf_bytes",
        reject_retained_bytes,
    )

    with pytest.raises(InputMaterializationError, match="input_file_invalid"):
        write_idf(
            materialized,
            project_id="project-one",
            deck_id="deck-one",
            run_id="retryable-run",
        )

    workspace = idf_module.invocation_workspace(
        "project-one",
        "deck-one",
        "retryable-run",
    )
    assert not workspace.exists()

    monkeypatch.setattr(idf_module._contract, "load_idf_bytes", original_load)
    descriptor = write_idf(
        materialized,
        project_id="project-one",
        deck_id="deck-one",
        run_id="retryable-run",
    )
    assert Path(descriptor["idfPath"]).is_file()


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


@pytest.mark.parametrize(
    "secret_key",
    (
        "accessToken",
        "password",
        "token",
        "x-api-key",
        "client-secret",
        "privateKey",
    ),
)
def test_nested_secret_key_variants_are_rejected(secret_key: str) -> None:
    with pytest.raises(
        InputMaterializationError,
        match="input_file_secret_field_forbidden",
    ):
        _idf(capabilities={
            "toolDefinitions": [{"inputSchema": {secret_key: "forbidden"}}],
        })


@pytest.mark.parametrize(
    "url",
    (
        "https://user:password@example.test/path",
        "https://example.test/path?access_token=forbidden",
        "wss://example.test/socket?x-api-key=forbidden",
    ),
)
def test_credential_bearing_urls_are_rejected(url: str) -> None:
    with pytest.raises(
        InputMaterializationError,
        match="input_file_secret_url_forbidden",
    ):
        _idf(task=f"Read {url}")


@pytest.mark.parametrize("number", (float("nan"), float("inf"), float("-inf")))
def test_nonfinite_nested_numbers_are_rejected(number: float) -> None:
    with pytest.raises(
        InputMaterializationError,
        match="input_file_number_nonfinite",
    ):
        _idf(capabilities={
            "toolDefinitions": [{"inputSchema": {"default": number}}],
        })


@pytest.mark.parametrize("root", (b"[]\n", b"null\n", b'"text"\n'))
def test_non_object_idf_root_has_one_domain_error(root: bytes) -> None:
    with pytest.raises(InputMaterializationError, match="input_file_invalid"):
        load_idf_bytes(root)


def test_retired_operation_reports_its_exact_domain_error() -> None:
    value = json.loads(_idf().idf_bytes)
    value["dynamicContext"]["agentBuilderOperation"] = {"mode": "create"}

    with pytest.raises(
        InputMaterializationError,
        match="input_retired_operation_forbidden",
    ):
        load_idf_bytes((
            json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n"
        ).encode())


def test_run_telemetry_ledger_is_not_materialized_or_projected() -> None:
    ledger = _run_telemetry_ledger()
    materialized = _idf(
        stable_extra=ledger,
        capabilities=ledger,
        projection_extra=ledger,
    )
    retained = json.loads(materialized.idf_bytes)
    projected = runtime_projection(load_idf_bytes(materialized.idf_bytes))

    assert list(retained) == [
        "actualGraphData",
        "stableSavedCardContext",
        "selectedToolsAndGrants",
        "dynamicContext",
    ]
    assert not set(ledger) & _all_keys(retained)
    assert not set(ledger) & _all_keys(projected)
    encoded = materialized.idf_bytes.decode("utf-8")
    projected_json = json.dumps(projected, ensure_ascii=False, sort_keys=True)
    for marker in (
        "LEDGER_ATTEMPT_EVENT",
        "LEDGER_REQUEST_FULFILLMENT",
        "LEDGER_OBSERVATION_GAP",
        "LEDGER_TIMING",
        "LEDGER_INPUT_TOKENS",
        "LEDGER_OUTPUT_TOKENS",
        "LEDGER_COST",
        "LEDGER_TOOL_RECEIPT",
        "LEDGER_EXECUTION_RECEIPT",
    ):
        assert marker not in encoded
        assert marker not in projected_json


def test_run_telemetry_ledger_cannot_enter_dynamic_or_reference_input() -> None:
    ledger = _run_telemetry_ledger()
    with pytest.raises(
        InputMaterializationError,
        match="input_dynamic_field_forbidden",
    ):
        _idf(variable_extra=ledger)
    with pytest.raises(
        InputMaterializationError,
        match="input_graph_reference_field_forbidden",
    ):
        _idf(graph_context="bounded", reference_extra=ledger)
    with pytest.raises(
        InputMaterializationError,
        match="input_graph_reference_field_forbidden",
    ):
        _idf(
            graph_context="bounded",
            reference_extra={"provenance": {"executionReceipt": ledger}},
        )


def test_retained_idf_rejects_root_or_reference_run_telemetry_fields() -> None:
    ledger = _run_telemetry_ledger()
    materialized = _idf(graph_context="bounded")

    root_value = json.loads(materialized.idf_bytes)
    root_value.update(ledger)
    with pytest.raises(InputMaterializationError, match="input_file_invalid"):
        load_idf_bytes((
            json.dumps(root_value, ensure_ascii=False, separators=(",", ":"))
            + "\n"
        ).encode())

    reference_value = json.loads(materialized.idf_bytes)
    reference_value["actualGraphData"]["selectedGraphRecords"][0].update(
        ledger
    )
    with pytest.raises(InputMaterializationError, match="input_file_invalid"):
        load_idf_bytes((
            json.dumps(
                reference_value, ensure_ascii=False, separators=(",", ":")
            ) + "\n"
        ).encode())

    nested_reference_value = json.loads(materialized.idf_bytes)
    nested_reference_value["actualGraphData"]["selectedGraphRecords"][0][
        "provenance"
    ]["attemptEvents"] = ledger["attemptEvents"]
    with pytest.raises(InputMaterializationError, match="input_file_invalid"):
        load_idf_bytes((
            json.dumps(
                nested_reference_value,
                ensure_ascii=False,
                separators=(",", ":"),
            ) + "\n"
        ).encode())
