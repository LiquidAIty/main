"""The one canonical retained LiquidAIty Input Data File.

An IDF contains the bounded native graph evidence first, followed by the saved
Card and current task, the effective execution configuration, and the output
requirements for one invocation.  Python rails serializes exactly one UTF-8
``in.idf`` file, retains it through the existing Run artifact catalog, reloads
those exact bytes, and only then mechanically projects the native runtime call.

The nested context and graph record shapes are useful internal schemas.  They
are not separate files or competing runtime-input authorities.
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

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.python_models.idd import (
    IddValidationError,
    load_input_data_dictionary,
    validate_record,
)


IDF_FORMAT = "liquidaity.input-data"
INPUT_FORMAT_VERSION = 1
IDF_FILENAME = "in.idf"
_FORBIDDEN_SECRET_KEYS = frozenset({
    "apikey", "api_key", "authorization", "bearer", "bearertoken",
    "access_token", "refreshtoken", "refresh_token", "clientsecret",
    "client_secret", "oauthstate", "oauth_state",
})


class InputMaterializationError(ValueError):
    """Secret-safe failure at the retained runtime-input boundary."""


class Icf(BaseModel):
    """Internal Card/task context schema embedded in the one IDF."""

    model_config = ConfigDict(extra="forbid")

    projectId: str = ""
    deckId: str = ""
    cardId: str = ""
    cardTitle: str = ""
    cardRevisionId: str = ""
    cardRevision: int | None = None
    cardRevisionSha256: str = ""
    instructions: str = ""
    task: str
    conversationId: str = ""
    senderCardId: str = ""
    originatingRunId: str = ""
    images: list[dict[str, Any]] = Field(default_factory=list)


class IgfRecord(BaseModel):
    """One bounded native graph record embedded in the one IDF."""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["selection", "node", "relationship", "materialized-context"]
    authority: str
    nativeId: str
    type: str
    content: dict[str, Any]
    provenance: dict[str, Any] = Field(default_factory=dict)
    retrievedAt: str
    sourcePath: str | None = None
    relationshipIds: list[str] = Field(default_factory=list)


class IgfDocument(BaseModel):
    """Internal bounded graph-evidence schema embedded first in the IDF."""

    model_config = ConfigDict(extra="forbid")

    recipe: dict[str, Any]
    authorities: list[str] = Field(default_factory=list)
    selectedNativeReferences: list[dict[str, Any]] = Field(default_factory=list)
    recordCounts: dict[str, int]
    provenanceSummary: list[dict[str, Any]] = Field(default_factory=list)
    records: list[IgfRecord] = Field(default_factory=list)
    modelText: str = ""


class ExecutionInput(BaseModel):
    """Exact saved runtime configuration, grants, and tool schemas."""

    model_config = ConfigDict(extra="forbid")

    runtime: dict[str, Any]
    provider: dict[str, Any]
    runtimeOptions: dict[str, Any] = Field(default_factory=dict)
    enabledTools: list[str] = Field(default_factory=list)
    toolDefinitions: list[dict[str, Any]] = Field(default_factory=list)
    nativeTools: list[str] = Field(default_factory=list)
    skills: list[str] = Field(default_factory=list)
    toolsets: list[str] = Field(default_factory=list)
    mcpConnectionIds: list[str] = Field(default_factory=list)


class OutputInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    requirements: str = ""


class Idf(BaseModel):
    """One complete model-facing input, ordered graph then context then execution."""

    model_config = ConfigDict(extra="forbid")

    # Field order is serialization order. Graph evidence is deliberately first.
    igf: IgfDocument
    icf: Icf
    execution: ExecutionInput
    output: OutputInput
    format: Literal[IDF_FORMAT] = IDF_FORMAT
    version: Literal[INPUT_FORMAT_VERSION] = INPUT_FORMAT_VERSION
    owner: dict[str, Any]
    materializedAt: str
    idd: dict[str, Any]
    estimates: dict[str, Any]

    @field_validator("owner", "idd", "estimates")
    @classmethod
    def _require_object(cls, value: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(value, dict):
            raise ValueError("input_data_object_invalid")
        return value


@dataclass(frozen=True)
class MaterializedIdf:
    idf: Idf
    idf_bytes: bytes

    @property
    def idf_sha256(self) -> str:
        return sha256(self.idf_bytes).hexdigest()


def _canonical_line(value: Any) -> bytes:
    # Pydantic field order is part of the format: graph evidence must stay first.
    return (
        json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n"
    ).encode("utf-8")


def _timestamp() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _token_estimate(value: str) -> int:
    """Return an intentionally model-agnostic UTF-8/4 planning estimate."""

    return ceil(len(value.encode("utf-8")) / 4) if value else 0


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


def _validate_idd_record(name: str, value: dict[str, Any]) -> None:
    try:
        validate_record(name, value)
    except IddValidationError as error:
        raise InputMaterializationError(str(error)) from error


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
) -> list[IgfRecord]:
    records: list[IgfRecord] = []
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
        records.append(IgfRecord(
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
        records.append(IgfRecord(
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
        records.append(IgfRecord(
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
    if graph_context:
        authorities = sorted({
            str(reference.get("authority") or "").strip()
            for reference in native_references
            if isinstance(reference, dict) and str(reference.get("authority") or "").strip()
        })
        records.append(IgfRecord(
            kind="materialized-context",
            authority=authorities[0] if len(authorities) == 1 else "mixed",
            nativeId="liquidaity:materialized-graph-context",
            type="text/markdown",
            content={"text": graph_context},
            provenance={"selectedNativeReferences": len(native_references)},
            retrievedAt=materialized_at,
        ))
    return records


def _record_counts(records: list[IgfRecord]) -> dict[str, int]:
    counts = {kind: 0 for kind in (
        "selection", "node", "relationship", "materialized-context"
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
    owner: dict[str, Any],
    stable: dict[str, Any],
    variable: dict[str, Any],
    capabilities: dict[str, Any],
    allocation: dict[str, Any],
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
    for record in records:
        _validate_idd_record("input-graph-record", record.model_dump(exclude_none=True))
    graph = IgfDocument(
        recipe={
            "ordering": "graph-before-card-context",
            "scope": "bounded-selected-native-evidence",
            "nativeAuthoritiesRemainCanonical": True,
        },
        authorities=authorities,
        selectedNativeReferences=[dict(item) for item in native_references],
        recordCounts=_record_counts(records),
        provenanceSummary=_provenance_summary(native_references),
        records=records,
        modelText=graph_context,
    )
    context = Icf(
        projectId=str(stable.get("projectId") or ""),
        deckId=str(stable.get("deckId") or ""),
        cardId=str(stable.get("cardId") or ""),
        cardTitle=str(stable.get("cardTitle") or ""),
        cardRevisionId=str(stable.get("cardRevisionId") or ""),
        cardRevision=stable.get("cardRevision"),
        cardRevisionSha256=str(stable.get("cardRevisionSha256") or ""),
        instructions=str(stable.get("instructions") or ""),
        task=str(variable.get("task") or ""),
        conversationId=str(variable.get("conversationId") or ""),
        senderCardId=str(variable.get("senderCardId") or ""),
        originatingRunId=str(variable.get("originatingRunId") or ""),
        images=list(variable.get("images") or []),
    )
    execution = ExecutionInput(
        runtime=dict(stable.get("runtime") or {}),
        provider=dict(stable.get("provider") or {}),
        runtimeOptions=dict(allocation.get("runtimeOptions") or {}),
        enabledTools=list(capabilities.get("enabledTools") or []),
        toolDefinitions=list(capabilities.get("toolDefinitions") or []),
        nativeTools=list(capabilities.get("nativeTools") or []),
        skills=list(capabilities.get("skills") or []),
        toolsets=list(capabilities.get("toolsets") or []),
        mcpConnectionIds=list(capabilities.get("mcpConnectionIds") or []),
    )
    output = OutputInput(requirements=str(stable.get("outputContract") or ""))
    estimates = {
        "method": "utf8-bytes-divided-by-4-ceiling",
        "graphContextTokens": _token_estimate(graph_context),
        "systemContextTokens": _token_estimate(context.instructions),
        "taskTokens": _token_estimate(context.task),
        "outputContractTokens": _token_estimate(output.requirements),
    }
    estimates["totalModelVisibleTokens"] = sum(
        value for key, value in estimates.items() if key.endswith("Tokens")
    )
    dictionary = load_input_data_dictionary()["dictionary"]
    idf = Idf(
        igf=graph,
        icf=context,
        execution=execution,
        output=output,
        owner=dict(owner),
        materializedAt=timestamp,
        idd={"name": str(dictionary["name"]), "version": int(dictionary["version"])},
        estimates=estimates,
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
    if idf.igf.recordCounts != _record_counts(idf.igf.records):
        raise InputMaterializationError("input_graph_record_counts_mismatch")
    if idf.igf.modelText:
        materialized = [
            record for record in idf.igf.records
            if record.kind == "materialized-context"
        ]
        if len(materialized) != 1 or str(materialized[0].content.get("text") or "") != idf.igf.modelText:
            raise InputMaterializationError("input_graph_model_text_mismatch")
    _assert_secret_free(idf.model_dump())
    for record in idf.igf.records:
        _validate_idd_record("input-graph-record", record.model_dump(exclude_none=True))
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
        owner = materialized.idf.owner
        if (
            idf_path.parent != expected_workspace
            or owner.get("kind") != "card-run"
            or owner.get("projectId") != project_id
            or owner.get("deckId") != deck_id
            or owner.get("runId") != run_id
            or (card_id is not None and owner.get("cardId") != card_id)
        ):
            raise InputMaterializationError("input_file_run_identity_mismatch")
    return materialized


def model_task(idf: Idf) -> str:
    """Return the exact graph-first user/task text represented by the IDF."""

    return "\n\n".join(value for value in (
        idf.igf.modelText.strip(),
        idf.icf.task.strip(),
        (
            f"Output requirements:\n{idf.output.requirements.strip()}"
            if idf.output.requirements.strip()
            else ""
        ),
    ) if value)


def runtime_projection(materialized: MaterializedIdf) -> dict[str, Any]:
    """Mechanically project native-runtime fields from reloaded IDF bytes."""

    idf = materialized.idf
    return {
        "systemPrompt": idf.icf.instructions,
        "task": idf.icf.task,
        "graphContext": idf.igf.modelText,
        "outputRequirements": idf.output.requirements,
        "message": model_task(idf),
        "runtime": dict(idf.execution.runtime),
        "provider": dict(idf.execution.provider),
        "runtimeOptions": dict(idf.execution.runtimeOptions),
        "enabledTools": list(idf.execution.enabledTools),
        "toolDefinitions": list(idf.execution.toolDefinitions),
        "nativeTools": list(idf.execution.nativeTools),
        "skills": list(idf.execution.skills),
        "toolsets": list(idf.execution.toolsets),
        "mcpConnectionIds": list(idf.execution.mcpConnectionIds),
        "nativeReferences": list(idf.igf.selectedNativeReferences),
        "images": list(idf.icf.images),
        "estimates": dict(idf.estimates),
    }


def idf_public(materialized: MaterializedIdf) -> dict[str, Any]:
    return {
        "idf": materialized.idf.model_dump(),
        "inputSummary": {
            "idfBytes": len(materialized.idf_bytes),
            "idfSha256": materialized.idf_sha256,
            "recordCounts": dict(materialized.idf.igf.recordCounts),
            "authorities": list(materialized.idf.igf.authorities),
            "estimatedIdfFileTokens": _token_estimate(
                materialized.idf_bytes.decode("utf-8")
            ),
            "estimatedGraphContextTokens": materialized.idf.estimates.get(
                "graphContextTokens", 0
            ),
            "estimatedModelVisibleTokens": materialized.idf.estimates.get(
                "totalModelVisibleTokens", 0
            ),
            "estimateMethod": materialized.idf.estimates.get("method"),
        },
    }
