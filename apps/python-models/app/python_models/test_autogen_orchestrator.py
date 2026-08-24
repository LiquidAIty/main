"""Focused guards for the native AutoGen orchestration boundary."""

import asyncio

import pytest

from app.python_models import autogen_orchestrator
from app.python_models.autogen_orchestrator import orchestrate_runtime
from app.python_models.icf import (
    materialize_input_pair,
    rematerialize_input_pair,
    write_input_pair,
)
from app.python_models.orchestration_contracts import (
    ProjectSession,
    RuntimeInputFiles,
    RuntimeRequest,
    StoredRuntimeRequest,
)

MODEL = "gpt-5.6"


def _runtime_request(runtime_mode: str, *, graph_grounded: bool = False) -> RuntimeRequest:
    references = ([{
        "authority": "CodeGraph",
        "nativeId": "project.module.materialize_input_pair",
        "nativeKind": "node",
        "label": "materialize_input_pair",
        "reason": "Use the canonical input owner.",
        "asOf": "2026-08-23T12:00:00Z",
        "required": True,
        "readOperation": "cbm.get_code_snippet",
        "provenance": {"repository": "C-Projects-LiquidAIty-main"},
        "sourcePath": "apps/python-models/app/python_models/icf.py",
        "selectionScope": {"boundedExpansion": 0, "resultLimit": 1},
        "materializedContentBytes": 36,
        "truncated": False,
    }] if graph_grounded else [])
    graph_context = (
        "### CodeGraph\nVerified native content:\ndef materialize_input_pair(...): ..."
        if graph_grounded else ""
    )
    pair = materialize_input_pair(
        owner={"kind": "test"},
        stable={
            "instructions": "Saved prompt", "outputContract": "",
            "runtime": {"kind": "autogen", "mode": runtime_mode},
            "provider": {
                "accessMode": "openai-api", "provider": "openai",
                "modelKey": MODEL, "providerModelId": MODEL,
            },
        },
        variable={"task": "exact outer assignment", "selectedNativeReferences": references, "images": []},
        capabilities={
            "enabledTools": [], "toolDefinitions": [], "nativeTools": [],
            "skills": [], "toolsets": [], "mcpConnectionIds": [],
        },
        allocation={"runtimeOptions": {}},
        graph_context=graph_context, native_references=references,
        graph_projection={
            "authority": "codegraph" if graph_grounded else "",
            "nodes": ([{
                "id": "project.module.materialize_input_pair",
                "authority": "CodeGraph",
                "type": "Function",
                "label": "materialize_input_pair",
                "properties": {
                    "file": "apps/python-models/app/python_models/icf.py",
                    "source": "def materialize_input_pair(...): ...",
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
        icf=pair.icf,
        igf=pair.igf,
        inputFiles=RuntimeInputFiles(
            workspace="test", icfPath="test/in.icf", igfPath="test/in.igf",
            icfSha256=pair.icf_sha256, igfSha256=pair.igf_sha256,
            icfBytes=len(pair.icf_bytes), igfBytes=len(pair.igf_bytes),
        ),
    )


def test_dispatch_selects_single_assistant_inside_python() -> None:
    context = _runtime_request("assistant")
    assert autogen_orchestrator._configured_runtime_handler(
        context.icf.stable["runtime"],
    ) is autogen_orchestrator.run_configured_card


def test_dispatch_selects_mag_one_inside_python() -> None:
    context = _runtime_request("magentic_one")
    assert autogen_orchestrator._configured_runtime_handler(
        context.icf.stable["runtime"],
    ) is autogen_orchestrator.orchestrate_runtime


def test_orchestrate_rejects_non_magentic_materialization() -> None:
    with pytest.raises(RuntimeError, match="orchestrator_card_required"):
        asyncio.run(orchestrate_runtime(_runtime_request("assistant")))


def test_mag_one_boundary_loads_the_exact_retained_pair_provider_free(
    tmp_path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("LIQUIDAITY_RUN_INPUT_ROOT", str(tmp_path))
    source = _runtime_request("magentic_one", graph_grounded=True)
    pair = rematerialize_input_pair(
        source.icf.model_dump(), source.igf.model_dump(),
        owner={
            "kind": "card-run", "projectId": "p", "deckId": "d",
            "cardId": "card:one", "runId": "mag-root",
        },
    )
    descriptor = write_input_pair(
        pair, project_id="p", deck_id="d", run_id="mag-root",
    )
    stored = StoredRuntimeRequest(
        session=source.session,
        inputFiles=RuntimeInputFiles.model_validate(descriptor),
        participants=source.participants,
    )
    loaded = autogen_orchestrator.load_stored_runtime_request(stored)
    assert loaded.icf.model_dump() == pair.icf.model_dump()
    assert loaded.igf.model_dump() == pair.igf.model_dump()
    assert loaded.inputFiles.icfSha256 == pair.icf_sha256
    assert loaded.inputFiles.igfSha256 == pair.igf_sha256
    assert loaded.igf.header.recordCounts["selection"] == 1
    assert loaded.igf.header.recordCounts["node"] == 1
    assert loaded.igf.header.recordCounts["materialized-context"] == 1
    assert loaded.icf.variable["selectedNativeReferences"][0]["nativeId"] == (
        "project.module.materialize_input_pair"
    )
