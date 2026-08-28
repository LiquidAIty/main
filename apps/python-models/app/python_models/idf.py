"""The one canonical retained LiquidAIty Input Data File.

The serialized product contract is exactly four ordered sections: actual
bounded graph data, stable saved-Card context, selected tools/grants, then the
current dynamic context. Python rails writes one UTF-8 ``in.idf`` for a Run,
reloads those exact bytes, and only then mechanically projects the native call.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256
from math import ceil
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


IDF_FILENAME = "in.idf"
_FORBIDDEN_SECRET_KEYS = frozenset({
    "apikey", "api_key", "authorization", "bearer", "bearertoken",
    "access_token", "refreshtoken", "refresh_token", "clientsecret",
    "client_secret", "oauthstate", "oauth_state",
})


class InputMaterializationError(ValueError):
    """Secret-safe failure at the retained runtime-input boundary."""


class StableSavedCardContext(BaseModel):
    """Durable configuration read from the receiving PostgreSQL Card."""

    model_config = ConfigDict(extra="forbid")

    projectId: str = ""
    deckId: str = ""
    cardId: str = ""
    cardTitle: str = ""
    cardRevisionId: str = ""
    cardRevision: int | None = None
    cardRevisionSha256: str = ""
    instructions: str = ""
    outputRequirements: str = ""
    runtime: dict[str, Any]
    provider: dict[str, Any]
    runtimeOptions: dict[str, Any] = Field(default_factory=dict)


class GraphDataRecord(BaseModel):
    """One real bounded native graph record embedded in the Run input."""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["selection", "node", "relationship"]
    authority: str
    nativeId: str
    type: str
    content: dict[str, Any]
    provenance: dict[str, Any] = Field(default_factory=dict)
    retrievedAt: str
    sourcePath: str | None = None
    relationshipIds: list[str] = Field(default_factory=list)


class ActualGraphData(BaseModel):
    """Actual selected/resolved native graph data embedded first in the IDF."""

    model_config = ConfigDict(extra="forbid")

    authorities: list[str] = Field(default_factory=list)
    selectedNativeReferences: list[dict[str, Any]] = Field(default_factory=list)
    recordCounts: dict[str, int]
    provenanceSummary: list[dict[str, Any]] = Field(default_factory=list)
    records: list[GraphDataRecord] = Field(default_factory=list)
    modelText: str = ""


class SelectedToolsAndGrants(BaseModel):
    """Effective saved Card tool grants and schemas, distinct from graph data."""

    model_config = ConfigDict(extra="forbid")

    enabledTools: list[str] = Field(default_factory=list)
    toolDefinitions: list[dict[str, Any]] = Field(default_factory=list)
    nativeTools: list[str] = Field(default_factory=list)
    skills: list[str] = Field(default_factory=list)
    toolsets: list[str] = Field(default_factory=list)
    mcpConnectionIds: list[str] = Field(default_factory=list)


class DynamicContext(BaseModel):
    """The final, transient mission and images for this invocation."""

    model_config = ConfigDict(extra="forbid")

    task: str
    images: list[dict[str, Any]] = Field(default_factory=list)


class Idf(BaseModel):
    """One complete model-facing input with exactly four ordered sections."""

    model_config = ConfigDict(extra="forbid")

    # Pydantic preserves declaration order in JSON serialization.
    actualGraphData: ActualGraphData
    stableSavedCardContext: StableSavedCardContext
    selectedToolsAndGrants: SelectedToolsAndGrants
    dynamicContext: DynamicContext


@dataclass(frozen=True)
class MaterializedIdf:
    idf: Idf
    idf_bytes: bytes

    @property
    def idf_sha256(self) -> str:
        return sha256(self.idf_bytes).hexdigest()


def _canonical_line(value: Any) -> bytes:
    # Pydantic field order is the four-part product contract.
    return (
        json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n"
    ).encode("utf-8")


def _timestamp() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _token_estimate(value: str) -> int:
    """Return an intentionally model-agnostic UTF-8/4 planning estimate."""

    return ceil(len(value.encode("utf-8")) / 4) if value else 0


def _input_estimates(idf: Idf) -> dict[str, Any]:
    """Derive inspection estimates without persisting them in model input."""

    estimates: dict[str, Any] = {
        "method": "utf8-bytes-divided-by-4-ceiling",
        "graphContextTokens": _token_estimate(idf.actualGraphData.modelText),
        "systemContextTokens": _token_estimate(
            idf.stableSavedCardContext.instructions
        ),
        "taskTokens": _token_estimate(idf.dynamicContext.task),
        "outputContractTokens": _token_estimate(
            idf.stableSavedCardContext.outputRequirements
        ),
    }
    estimates["totalModelVisibleTokens"] = sum(
        value for key, value in estimates.items() if key.endswith("Tokens")
    )
    return estimates


def _assert_secret_free(value: Any) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            normalized = str(key).replace("-", "_").lower()
            if normalized in _FORBIDDEN_SECRET_KEYS:
                raise InputMaterializationError("input_file_secret_field_forbidden")
            _assert_secret_free(item)
    elif isinstance(value, list):
        for item in value:
            _assert_secret_free(item)


def _source_path(properties: dict[str, Any]) -> str | None:
    for key in ("file", "filePath", "file_path", "sourcePath", "path"):
        value = str(properties.get(key) or "").strip()
        if value:
            return value
    return None


def _graph_records(
    *,
    graph_context: str,
    native_references: list[dict[str, Any]],
    graph_projection: dict[str, Any],
    materialized_at: str,
) -> list[GraphDataRecord]:
    records: list[GraphDataRecord] = []
    retrieved_by_identity = {
        (str(item.get("authority") or ""), str(item.get("nativeId") or "")): str(
            item.get("asOf") or materialized_at
        )
        for item in native_references
        if isinstance(item, dict)
    }
    for reference in native_references:
        if not isinstance(reference, dict):
            raise InputMaterializationError("input_graph_reference_invalid")
        authority = str(reference.get("authority") or "").strip()
        native_id = str(reference.get("nativeId") or "").strip()
        if not authority or not native_id:
            raise InputMaterializationError("input_graph_reference_invalid")
        records.append(GraphDataRecord(
            kind="selection",
            authority=authority,
            nativeId=native_id,
            type=str(reference.get("nativeKind") or "native-reference"),
            content={
                "label": str(reference.get("label") or native_id),
                "reason": str(reference.get("reason") or ""),
                "required": reference.get("required") is True,
                "readOperation": str(reference.get("readOperation") or "exact_read"),
                "selectionScope": dict(reference.get("selectionScope") or {}),
                "materializedContentBytes": int(
                    reference.get("materializedContentBytes") or 0
                ),
                **(
                    {"sourceUrl": str(reference["sourceUrl"])}
                    if str(reference.get("sourceUrl") or "").strip()
                    else {}
                ),
                "truncated": reference.get("truncated") is True,
            },
            provenance=dict(reference.get("provenance") or {}),
            retrievedAt=str(reference.get("asOf") or materialized_at),
            sourcePath=str(reference.get("sourcePath") or "").strip() or None,
        ))
    projection_authority = str(graph_projection.get("authority") or "").strip()
    for node in graph_projection.get("nodes") or []:
        if not isinstance(node, dict):
            raise InputMaterializationError("input_graph_node_invalid")
        authority = str(node.get("authority") or projection_authority or "").strip()
        native_id = str(node.get("id") or node.get("canonicalId") or "").strip()
        properties = dict(node.get("properties") or {})
        if not authority or not native_id:
            raise InputMaterializationError("input_graph_node_invalid")
        records.append(GraphDataRecord(
            kind="node",
            authority=authority,
            nativeId=native_id,
            type=str(node.get("type") or "NativeObject"),
            content={
                "label": str(node.get("label") or native_id),
                "labels": list(node.get("labels") or []),
                "properties": properties,
            },
            provenance=dict(node.get("provenance") or {}),
            retrievedAt=(
                retrieved_by_identity.get((authority, native_id)) or materialized_at
            ),
            sourcePath=_source_path(properties),
        ))
    for edge in graph_projection.get("edges") or []:
        if not isinstance(edge, dict):
            raise InputMaterializationError("input_graph_relationship_invalid")
        native_id = str(edge.get("id") or "").strip()
        authority = str(edge.get("authority") or projection_authority or "").strip()
        source = str(edge.get("source") or "").strip()
        target = str(edge.get("target") or "").strip()
        if not authority or not native_id or not source or not target:
            raise InputMaterializationError("input_graph_relationship_invalid")
        records.append(GraphDataRecord(
            kind="relationship",
            authority=authority,
            nativeId=native_id,
            type=str(edge.get("predicate") or "RELATED"),
            content={
                "sourceNativeId": source,
                "targetNativeId": target,
                "properties": dict(edge.get("properties") or {}),
            },
            provenance=dict(edge.get("provenance") or {}),
            retrievedAt=materialized_at,
            relationshipIds=[native_id],
        ))
    return records


def _record_counts(records: list[GraphDataRecord]) -> dict[str, int]:
    counts = {kind: 0 for kind in (
        "selection", "node", "relationship"
    )}
    for record in records:
        counts[record.kind] += 1
        authority_key = f"authority:{record.authority}"
        type_key = f"type:{record.type}"
        counts[authority_key] = counts.get(authority_key, 0) + 1
        counts[type_key] = counts.get(type_key, 0) + 1
    counts["total"] = len(records)
    return counts


def _provenance_summary(references: list[dict[str, Any]]) -> list[dict[str, Any]]:
    unique: dict[str, dict[str, Any]] = {}
    for reference in references:
        authority = str(reference.get("authority") or "").strip()
        provenance = dict(reference.get("provenance") or {})
        if not authority:
            continue
        unique.setdefault(authority, {
            "authority": authority,
            "readOperations": [],
            "sources": [],
        })
        operation = str(reference.get("readOperation") or "exact_read")
        if operation not in unique[authority]["readOperations"]:
            unique[authority]["readOperations"].append(operation)
        for key in (
            "source", "project", "database", "repository", "repositoryRoot",
            "path", "sourcePath", "url", "sourceUrl",
        ):
            value = str(provenance.get(key) or "").strip()
            if value and value not in unique[authority]["sources"]:
                unique[authority]["sources"].append(value)
        for value in (
            str(reference.get("sourcePath") or "").strip(),
            str(reference.get("sourceUrl") or "").strip(),
        ):
            if value and value not in unique[authority]["sources"]:
                unique[authority]["sources"].append(value)
    return [unique[key] for key in sorted(unique)]


def materialize_idf(
    *,
    stable: dict[str, Any],
    variable: dict[str, Any],
    capabilities: dict[str, Any],
    graph_context: str,
    native_references: list[dict[str, Any]],
    graph_projection: dict[str, Any],
    materialized_at: str | None = None,
) -> MaterializedIdf:
    """Materialize the only model-facing runtime input exactly once."""

    timestamp = materialized_at or _timestamp()
    records = _graph_records(
        graph_context=graph_context,
        native_references=native_references,
        graph_projection=graph_projection,
        materialized_at=timestamp,
    )
    authorities = sorted({
        record.authority for record in records
        if record.authority and record.authority != "mixed"
    })
    graph = ActualGraphData(
        authorities=authorities,
        selectedNativeReferences=[dict(item) for item in native_references],
        recordCounts=_record_counts(records),
        provenanceSummary=_provenance_summary(native_references),
        records=records,
        modelText=graph_context,
    )
    stable_context = StableSavedCardContext(
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
    tools_and_grants = SelectedToolsAndGrants(
        enabledTools=list(capabilities.get("enabledTools") or []),
        toolDefinitions=list(capabilities.get("toolDefinitions") or []),
        nativeTools=list(capabilities.get("nativeTools") or []),
        skills=list(capabilities.get("skills") or []),
        toolsets=list(capabilities.get("toolsets") or []),
        mcpConnectionIds=list(capabilities.get("mcpConnectionIds") or []),
    )
    dynamic_context = DynamicContext(
        task=str(variable.get("task") or ""),
        images=list(variable.get("images") or []),
    )
    idf = Idf(
        actualGraphData=graph,
        stableSavedCardContext=stable_context,
        selectedToolsAndGrants=tools_and_grants,
        dynamicContext=dynamic_context,
    )
    _assert_secret_free(idf.model_dump())
    return load_idf_bytes(_canonical_line(idf.model_dump(mode="json")))


def load_idf_bytes(idf_bytes: bytes) -> MaterializedIdf:
    try:
        value = json.loads(idf_bytes.decode("utf-8"))
        idf = Idf.model_validate(value)
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
        raise InputMaterializationError("input_file_invalid") from error
    if _canonical_line(idf.model_dump(mode="json")) != idf_bytes:
        raise InputMaterializationError("input_data_not_canonical")
    if idf.actualGraphData.recordCounts != _record_counts(idf.actualGraphData.records):
        raise InputMaterializationError("input_graph_record_counts_mismatch")
    _assert_secret_free(idf.model_dump())
    return MaterializedIdf(idf=idf, idf_bytes=idf_bytes)


def _workspace_root() -> Path:
    configured = str(os.environ.get("LIQUIDAITY_RUN_INPUT_ROOT") or "").strip()
    return Path(configured).resolve() if configured else (
        Path(__file__).resolve().parents[4] / "runtime" / "run-inputs"
    ).resolve()


def invocation_workspace(project_id: str, deck_id: str, run_id: str) -> Path:
    identity = "\u0000".join((project_id, deck_id, run_id))
    digest = sha256(identity.encode("utf-8")).hexdigest()
    return _workspace_root() / digest


def write_idf(
    materialized: MaterializedIdf,
    *,
    project_id: str,
    deck_id: str,
    run_id: str,
) -> dict[str, Any]:
    """Write exactly one IDF file and validate the retained bytes."""

    workspace = invocation_workspace(project_id, deck_id, run_id)
    idf_path = workspace / IDF_FILENAME
    try:
        workspace.mkdir(parents=True, exist_ok=False)
        with idf_path.open("xb") as destination:
            destination.write(materialized.idf_bytes)
            destination.flush()
            os.fsync(destination.fileno())
        loaded = load_idf_bytes(idf_path.read_bytes())
    except InputMaterializationError:
        raise
    except OSError as error:
        raise InputMaterializationError("input_file_write_failed") from error
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
) -> MaterializedIdf:
    try:
        idf_path = Path(str(input_file.get("idfPath") or "")).resolve(strict=True)
    except OSError as error:
        raise InputMaterializationError("input_file_unavailable") from error
    if idf_path.name != IDF_FILENAME or _workspace_root() not in idf_path.parents:
        raise InputMaterializationError("input_file_path_invalid")
    materialized = load_idf_bytes(idf_path.read_bytes())
    if str(input_file.get("idfSha256") or "") != materialized.idf_sha256:
        raise InputMaterializationError("input_file_hash_mismatch")
    required_identity = (project_id, deck_id, run_id)
    if any(value is not None for value in (*required_identity, card_id)):
        if not all(isinstance(value, str) and value for value in required_identity):
            raise InputMaterializationError("input_file_expected_identity_invalid")
        assert project_id is not None and deck_id is not None and run_id is not None
        expected_workspace = invocation_workspace(project_id, deck_id, run_id)
        context = materialized.idf.stableSavedCardContext
        if (
            idf_path.parent != expected_workspace
            or context.projectId != project_id
            or context.deckId != deck_id
            or (card_id is not None and context.cardId != card_id)
        ):
            raise InputMaterializationError("input_file_run_identity_mismatch")
    return materialized


def model_task(idf: Idf) -> str:
    """Return the exact graph-first user/task text represented by the IDF."""

    return "\n\n".join(value for value in (
        idf.actualGraphData.modelText.strip(),
        (
            f"Saved Card output requirements:\n"
            f"{idf.stableSavedCardContext.outputRequirements.strip()}"
            if idf.stableSavedCardContext.outputRequirements.strip()
            else ""
        ),
        idf.dynamicContext.task.strip(),
    ) if value)


def kanban_mission(idf: Idf) -> str:
    """Project only the graph-first user body; saved prompt/tools travel natively."""

    return model_task(idf)


def runtime_projection(materialized: MaterializedIdf) -> dict[str, Any]:
    """Mechanically project native-runtime fields from reloaded IDF bytes."""

    idf = materialized.idf
    stable = idf.stableSavedCardContext
    grants = idf.selectedToolsAndGrants
    return {
        "systemPrompt": stable.instructions,
        "task": idf.dynamicContext.task,
        "graphContext": idf.actualGraphData.modelText,
        "outputRequirements": stable.outputRequirements,
        "message": model_task(idf),
        "kanbanMission": kanban_mission(idf),
        "runtime": dict(stable.runtime),
        "provider": dict(stable.provider),
        "runtimeOptions": dict(stable.runtimeOptions),
        "enabledTools": list(grants.enabledTools),
        "toolDefinitions": list(grants.toolDefinitions),
        "nativeTools": list(grants.nativeTools),
        "skills": list(grants.skills),
        "toolsets": list(grants.toolsets),
        "mcpConnectionIds": list(grants.mcpConnectionIds),
        "nativeReferences": list(idf.actualGraphData.selectedNativeReferences),
        "images": list(idf.dynamicContext.images),
        "estimates": _input_estimates(idf),
    }


def idf_public(materialized: MaterializedIdf) -> dict[str, Any]:
    estimates = _input_estimates(materialized.idf)
    return {
        "idf": materialized.idf.model_dump(),
        "inputSummary": {
            "idfBytes": len(materialized.idf_bytes),
            "idfSha256": materialized.idf_sha256,
            "recordCounts": dict(materialized.idf.actualGraphData.recordCounts),
            "authorities": list(materialized.idf.actualGraphData.authorities),
            "estimatedIdfFileTokens": _token_estimate(
                materialized.idf_bytes.decode("utf-8")
            ),
            "estimatedGraphContextTokens": estimates["graphContextTokens"],
            "estimatedSystemContextTokens": estimates["systemContextTokens"],
            "estimatedTaskTokens": estimates["taskTokens"],
            "estimatedOutputContractTokens": estimates["outputContractTokens"],
            "estimatedModelVisibleTokens": estimates["totalModelVisibleTokens"],
            "estimateMethod": estimates["method"],
        },
    }
