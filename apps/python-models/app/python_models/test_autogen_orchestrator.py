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


def _runtime_request(runtime_mode: str) -> RuntimeRequest:
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
        variable={"task": "exact outer assignment", "selectedNativeReferences": [], "images": []},
        capabilities={
            "enabledTools": [], "toolDefinitions": [], "nativeTools": [],
            "skills": [], "toolsets": [], "mcpConnectionIds": [],
        },
        allocation={"runtimeOptions": {}},
        graph_context="", native_references=[],
        graph_projection={"authority": "", "nodes": [], "edges": []},
    )
    return RuntimeRequest(
        session=ProjectSession(
            sessionId="s", projectId="p", deckId="d", cardId="card:one",
            conversationId="c", turnId="t", route="r",
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
    source = _runtime_request("magentic_one")
    pair = rematerialize_input_pair(
        source.icf.model_dump(), source.igf.model_dump(),
        owner={"kind": "card-run", "runId": "mag-root"},
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
