"""Focused provider-free guards for the native AutoGen IDF boundary."""

import asyncio

import pytest

from app.python_models import autogen_orchestrator
from app.python_models.autogen_orchestrator import orchestrate_runtime
from app.python_models.idf import materialize_idf, write_idf
from app.python_models.orchestration_contracts import (
    ProjectSession,
    RuntimeInputFile,
    RuntimeRequest,
    StoredRuntimeRequest,
)


MODEL = "gpt-5.6"


def _runtime_request(runtime_mode: str, *, graph_grounded: bool = False) -> RuntimeRequest:
    references = ([{
        "authority": "CodeGraph",
        "nativeId": "project.module.materialize_idf",
        "nativeKind": "node",
        "label": "materialize_idf",
        "reason": "Use the canonical input owner.",
        "asOf": "2026-08-23T12:00:00Z",
        "required": True,
        "readOperation": "cbm.get_code_snippet",
        "provenance": {"repository": "C-Projects-LiquidAIty-main"},
        "sourcePath": "apps/python-models/app/python_models/idf.py",
        "selectionScope": {"boundedExpansion": 0, "resultLimit": 1},
        "materializedContentBytes": 36,
        "truncated": False,
    }] if graph_grounded else [])
    graph_context = (
        "### CodeGraph\nVerified native content:\ndef materialize_idf(...): ..."
        if graph_grounded else ""
    )
    materialized = materialize_idf(
        owner={
            "kind": "card-run", "projectId": "p", "deckId": "d",
            "cardId": "card:one", "runId": "mag-root",
        },
        stable={
            "instructions": "Saved prompt", "outputContract": "",
            "runtime": {"kind": "autogen", "mode": runtime_mode},
            "provider": {
                "accessMode": "openai-api", "provider": "openai",
                "modelKey": MODEL, "providerModelId": MODEL,
            },
        },
        variable={"task": "exact outer assignment", "images": []},
        capabilities={
            "enabledTools": [], "toolDefinitions": [], "nativeTools": [],
            "skills": [], "toolsets": [], "mcpConnectionIds": [],
        },
        allocation={"runtimeOptions": {}},
        graph_context=graph_context,
        native_references=references,
        graph_projection={
            "authority": "CodeGraph" if graph_grounded else "",
            "nodes": ([{
                "id": "project.module.materialize_idf",
                "authority": "CodeGraph",
                "type": "Function",
                "label": "materialize_idf",
                "properties": {
                    "file": "apps/python-models/app/python_models/idf.py",
                    "source": "def materialize_idf(...): ...",
                },
                "provenance": {"repository": "C-Projects-LiquidAIty-main"},
            }] if graph_grounded else []),
            "edges": [],
        },
    )
    return RuntimeRequest(
        session=ProjectSession(
            sessionId="s", projectId="p", deckId="d", cardId="card:one",
            conversationId="c", turnId="t", runId="mag-root", route="r",
            orchestrator=(
                "magentic_one" if runtime_mode == "magentic_one"
                else "assistant_agent"
            ),
            startedAt="now",
        ),
        idf=materialized.idf,
        inputFile=RuntimeInputFile(
            workspace="test", idfPath="test/in.idf",
            idfSha256=materialized.idf_sha256,
            idfBytes=len(materialized.idf_bytes),
        ),
    )


def test_dispatch_selects_single_assistant_inside_python() -> None:
    context = _runtime_request("assistant")
    assert autogen_orchestrator._configured_runtime_handler(
        context.idf.execution.runtime,
    ) is autogen_orchestrator.run_configured_card


def test_dispatch_selects_mag_one_inside_python() -> None:
    context = _runtime_request("magentic_one")
    assert autogen_orchestrator._configured_runtime_handler(
        context.idf.execution.runtime,
    ) is autogen_orchestrator.orchestrate_runtime


def test_orchestrate_rejects_non_magentic_materialization() -> None:
    with pytest.raises(RuntimeError, match="orchestrator_card_required"):
        asyncio.run(orchestrate_runtime(_runtime_request("assistant")))


def test_mag_one_boundary_reloads_exact_retained_idf_provider_free(
    tmp_path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("LIQUIDAITY_RUN_INPUT_ROOT", str(tmp_path))
    source = _runtime_request("magentic_one", graph_grounded=True)
    # Use the canonical serializer owned by the materializer for the retained proof.
    materialized = materialize_idf(
        owner=source.idf.owner,
        stable={
            "instructions": source.idf.icf.instructions,
            "outputContract": source.idf.output.requirements,
            "runtime": source.idf.execution.runtime,
            "provider": source.idf.execution.provider,
        },
        variable={"task": source.idf.icf.task, "images": source.idf.icf.images},
        capabilities=source.idf.execution.model_dump(exclude={"runtime", "provider", "runtimeOptions"}),
        allocation={"runtimeOptions": source.idf.execution.runtimeOptions},
        graph_context=source.idf.igf.modelText,
        native_references=source.idf.igf.selectedNativeReferences,
        graph_projection={
            "authority": "CodeGraph",
            "nodes": [record.content | {
                "id": record.nativeId,
                "authority": record.authority,
                "type": record.type,
                "provenance": record.provenance,
            } for record in source.idf.igf.records if record.kind == "node"],
            "edges": [],
        },
        materialized_at=source.idf.materializedAt,
    )
    descriptor = write_idf(materialized, project_id="p", deck_id="d", run_id="mag-root")
    stored = StoredRuntimeRequest(
        session=source.session,
        inputFile=RuntimeInputFile.model_validate(descriptor),
        participants=source.participants,
    )
    loaded = autogen_orchestrator.load_stored_runtime_request(stored)
    assert loaded.idf.model_dump() == materialized.idf.model_dump()
    assert loaded.inputFile.idfSha256 == materialized.idf_sha256
    assert loaded.idf.igf.recordCounts["selection"] == 1
    assert loaded.idf.igf.recordCounts["node"] == 1
    assert loaded.idf.igf.recordCounts["materialized-context"] == 1
    assert loaded.idf.igf.selectedNativeReferences[0]["nativeId"] == (
        "project.module.materialize_idf"
    )
