"""Sole materializer and retained-file owner for one canonical Run ``in.idf``."""

from __future__ import annotations

import os
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from typing import Any

from app.python_models import idf_contract as _contract
from app.python_models import idf_graph_records as _graph
from app.python_models import idf_projection as _projection


def _timestamp() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def materialize_idf(
    *,
    stable: dict[str, Any],
    variable: dict[str, Any],
    capabilities: dict[str, Any],
    graph_context: str,
    graph_records: list[dict[str, Any]],
    graph_projection: dict[str, Any],
    materialized_at: str | None = None,
) -> _contract.MaterializedIdf:
    """Materialize the only model-facing runtime input exactly once."""

    if set(variable) - {"task", "images"}:
        raise _contract.InputMaterializationError("input_dynamic_field_forbidden")
    _contract.assert_materialization_graph_references(graph_records)
    timestamp = materialized_at or _timestamp()
    records = _graph.build_graph_records(
        graph_records=graph_records,
        graph_projection=graph_projection,
        materialized_at=timestamp,
    )
    graph = _contract.ActualGraphData(
        graphSystems=_graph.graph_systems(records),
        selectedGraphRecords=[dict(item) for item in graph_records],
        recordCounts=_contract.record_counts(records),
        provenanceSummary=_graph.provenance_summary(graph_records),
        records=records,
        modelText=graph_context,
    )
    stable_context = _contract.StableSavedCardContext(
        projectId=str(stable.get("projectId") or ""),
        deckId=str(stable.get("deckId") or ""),
        cardId=str(stable.get("cardId") or ""),
        cardTitle=str(stable.get("cardTitle") or ""),
        cardRevisionId=str(stable.get("cardRevisionId") or ""),
        cardRevision=stable.get("cardRevision"),
        cardRevisionSha256=str(stable.get("cardRevisionSha256") or ""),
        instructions=str(stable.get("instructions") or ""),
        outputRequirements=str(stable.get("outputContract") or ""),
        runtime=dict(stable.get("runtime") or {}),
        provider=dict(stable.get("provider") or {}),
        runtimeOptions=dict(stable.get("runtimeOptions") or {}),
    )
    enabled_tools = list(capabilities.get("enabledTools") or [])
    tools_and_grants = _contract.SelectedToolsAndGrants(
        enabledTools=enabled_tools,
        unavailableTools=list(capabilities.get("unavailableTools") or []),
        unavailableToolReasons=dict(capabilities.get("unavailableToolReasons") or {}),
        presentedTools=list(
            capabilities.get("presentedTools")
            if "presentedTools" in capabilities else enabled_tools
        ),
        toolDefinitions=list(capabilities.get("toolDefinitions") or []),
        scriptPresentation=dict(capabilities.get("scriptPresentation") or {
            "mode": "selected-mcp",
        }),
        skills=list(capabilities.get("skills") or []),
        toolsets=list(capabilities.get("toolsets") or []),
        mcpConnectionIds=list(capabilities.get("mcpConnectionIds") or []),
    )
    idf = _contract.Idf(
        actualGraphData=graph,
        stableSavedCardContext=stable_context,
        selectedToolsAndGrants=tools_and_grants,
        dynamicContext=_contract.DynamicContext(
            task=str(variable.get("task") or ""),
            images=list(variable.get("images") or []),
        ),
    )
    _contract.assert_secret_free(idf.model_dump())
    return _contract.load_idf_bytes(
        _contract.canonical_line(idf.model_dump(mode="json"))
    )


def _run_input_root() -> Path:
    configured = str(os.environ.get("LIQUIDAITY_RUN_INPUT_ROOT") or "").strip()
    return Path(configured).resolve() if configured else (
        Path(__file__).resolve().parents[4] / "runtime" / "run-inputs"
    ).resolve()


def invocation_workspace(project_id: str, deck_id: str, run_id: str) -> Path:
    identity = "\u0000".join((project_id, deck_id, run_id))
    return _run_input_root() / sha256(identity.encode("utf-8")).hexdigest()


def write_idf(
    materialized: _contract.MaterializedIdf,
    *,
    project_id: str,
    deck_id: str,
    run_id: str,
) -> dict[str, Any]:
    """Write exactly one IDF file and validate the retained bytes."""

    workspace = invocation_workspace(project_id, deck_id, run_id)
    idf_path = workspace / _contract.IDF_FILENAME
    try:
        workspace.mkdir(parents=True, exist_ok=False)
        with idf_path.open("xb") as destination:
            destination.write(materialized.idf_bytes)
            destination.flush()
            os.fsync(destination.fileno())
        loaded = _contract.load_idf_bytes(idf_path.read_bytes())
    except _contract.InputMaterializationError:
        raise
    except OSError as error:
        raise _contract.InputMaterializationError("input_file_write_failed") from error
    return {
        "workspace": str(workspace),
        "idfPath": str(idf_path),
        "idfSha256": loaded.idf_sha256,
        "idfBytes": len(loaded.idf_bytes),
    }


def load_idf(
    input_file: dict[str, Any],
    *,
    project_id: str | None = None,
    deck_id: str | None = None,
    run_id: str | None = None,
    card_id: str | None = None,
) -> _contract.MaterializedIdf:
    try:
        idf_path = Path(str(input_file.get("idfPath") or "")).resolve(strict=True)
    except OSError as error:
        raise _contract.InputMaterializationError("input_file_unavailable") from error
    if idf_path.name != _contract.IDF_FILENAME or _run_input_root() not in idf_path.parents:
        raise _contract.InputMaterializationError("input_file_path_invalid")
    materialized = _contract.load_idf_bytes(idf_path.read_bytes())
    if str(input_file.get("idfSha256") or "") != materialized.idf_sha256:
        raise _contract.InputMaterializationError("input_file_hash_mismatch")
    required_identity = (project_id, deck_id, run_id)
    if any(value is not None for value in (*required_identity, card_id)):
        if not all(isinstance(value, str) and value for value in required_identity):
            raise _contract.InputMaterializationError(
                "input_file_expected_identity_invalid"
            )
        assert project_id is not None and deck_id is not None and run_id is not None
        expected_workspace = invocation_workspace(project_id, deck_id, run_id)
        context = materialized.idf.stableSavedCardContext
        if (
            idf_path.parent != expected_workspace
            or context.projectId != project_id
            or context.deckId != deck_id
            or (card_id is not None and context.cardId != card_id)
        ):
            raise _contract.InputMaterializationError(
                "input_file_run_identity_mismatch"
            )
    return materialized


def runtime_projection(
    materialized: _contract.MaterializedIdf,
) -> dict[str, Any]:
    """Mechanically project Hermes runtime fields from reloaded IDF bytes."""

    idf = materialized.idf
    stable = idf.stableSavedCardContext
    grants = idf.selectedToolsAndGrants
    return {
        "task": idf.dynamicContext.task,
        "graphContext": idf.actualGraphData.modelText,
        "message": _projection.model_task(idf),
        "taskGraphMission": _projection.model_task(idf),
        "runtime": dict(stable.runtime),
        "provider": dict(stable.provider),
        "runtimeOptions": dict(stable.runtimeOptions),
        "enabledTools": list(grants.enabledTools),
        "unavailableTools": list(grants.unavailableTools),
        "unavailableToolReasons": dict(grants.unavailableToolReasons),
        "presentedTools": list(grants.presentedTools),
        "toolDefinitions": list(grants.toolDefinitions),
        "scriptPresentation": dict(grants.scriptPresentation),
        "skills": list(grants.skills),
        "toolsets": list(grants.toolsets),
        "mcpConnectionIds": list(grants.mcpConnectionIds),
        "graphRecords": list(idf.actualGraphData.selectedGraphRecords),
        "images": list(idf.dynamicContext.images),
        "estimates": _projection.input_estimates(idf),
    }
