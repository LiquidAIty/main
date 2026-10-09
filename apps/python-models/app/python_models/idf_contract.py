"""Literal schema and byte contract for the canonical retained IDF."""

from __future__ import annotations

import json
from dataclasses import dataclass
from hashlib import sha256
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.python_models.graph_reference_contracts import (
    GraphRecordReference,
    graph_record_identity,
)


IDF_FILENAME = "in.idf"
_FORBIDDEN_SECRET_KEYS = frozenset({
    "apikey", "api_key", "authorization", "bearer", "bearertoken",
    "access_token", "refreshtoken", "refresh_token", "clientsecret",
    "client_secret", "oauthstate", "oauth_state",
})
_SELECTED_GRAPH_RECORD_FIELDS = frozenset({
    "engraphisMemoryId", "engraphisEntityId", "engraphisRelationshipId",
    "graphitiEpisodeId", "graphitiEntityId", "graphitiRelationshipId",
    "cbmQualifiedName", "label", "reason", "asOf",
    "required", "readOperation", "contentSha256", "provenance",
    "selectionScope", "materializedContentBytes", "materializedRecordSha256",
    "sourcePath", "sourceUrl", "truncated",
})
_RUN_TELEMETRY_REFERENCE_KEYS = frozenset({
    "attemptEvents", "requestFulfillment", "observationGap", "timingMs",
    "inputTokens", "outputTokens", "cachedTokens", "reasoningTokens",
    "costUsd", "totalCostUsd", "toolReceipt", "executionReceipt",
})


class InputMaterializationError(ValueError):
    """Secret-safe failure at the retained runtime-input boundary."""


def _reference_contains_run_telemetry(value: Any) -> bool:
    if isinstance(value, dict):
        return bool(set(value) & _RUN_TELEMETRY_REFERENCE_KEYS) or any(
            _reference_contains_run_telemetry(item) for item in value.values()
        )
    if isinstance(value, list):
        return any(_reference_contains_run_telemetry(item) for item in value)
    return False


def _invalid_graph_reference(reference: Any) -> bool:
    return (
        not isinstance(reference, dict)
        or bool(set(reference) - _SELECTED_GRAPH_RECORD_FIELDS)
        or _reference_contains_run_telemetry(reference)
    )


def assert_materialization_graph_references(
    references: list[dict[str, Any]],
) -> None:
    if any(_invalid_graph_reference(reference) for reference in references):
        raise InputMaterializationError("input_graph_reference_field_forbidden")


class StableSavedCardContext(BaseModel):
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


class GraphDataRecord(GraphRecordReference):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["selection", "node", "relationship"]
    type: str
    content: dict[str, Any]
    provenance: dict[str, Any] = Field(default_factory=dict)
    retrievedAt: str
    sourcePath: str | None = None
    relationshipIds: list[str] = Field(default_factory=list)


class ActualGraphData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    graphSystems: list[str] = Field(default_factory=list)
    selectedGraphRecords: list[dict[str, Any]] = Field(default_factory=list)
    recordCounts: dict[str, int]
    provenanceSummary: list[dict[str, Any]] = Field(default_factory=list)
    records: list[GraphDataRecord] = Field(default_factory=list)
    modelText: str = ""

    @field_validator("selectedGraphRecords", mode="before")
    @classmethod
    def reject_non_reference_fields(cls, value: Any) -> Any:
        if not isinstance(value, list):
            raise ValueError("input_graph_references_invalid")
        if any(_invalid_graph_reference(item) for item in value):
            raise ValueError("input_graph_reference_field_forbidden")
        return value


class SelectedToolsAndGrants(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabledTools: list[str] = Field(default_factory=list)
    unavailableTools: list[str] = Field(default_factory=list)
    unavailableToolReasons: dict[str, str] = Field(default_factory=dict)
    presentedTools: list[str] = Field(default_factory=list)
    toolDefinitions: list[dict[str, Any]] = Field(default_factory=list)
    scriptPresentation: dict[str, Any] = Field(default_factory=lambda: {
        "mode": "selected-mcp",
    })
    skills: list[str] = Field(default_factory=list)
    toolsets: list[str] = Field(default_factory=list)
    mcpConnectionIds: list[str] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def preserve_pre_presentation_idfs(cls, value: Any) -> Any:
        """Old retained Runs used one list for both grant and presentation."""

        if isinstance(value, dict) and "presentedTools" not in value:
            value = {**value, "presentedTools": list(value.get("enabledTools") or [])}
        return value


class DynamicContext(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task: str
    images: list[dict[str, Any]] = Field(default_factory=list)


class Idf(BaseModel):
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


def canonical_line(value: Any) -> bytes:
    # Pydantic field order is the four-part product contract.
    return (
        json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n"
    ).encode("utf-8")


def assert_secret_free(value: Any) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            normalized = str(key).replace("-", "_").lower()
            if normalized in _FORBIDDEN_SECRET_KEYS:
                raise InputMaterializationError("input_file_secret_field_forbidden")
            assert_secret_free(item)
    elif isinstance(value, list):
        for item in value:
            assert_secret_free(item)


def record_counts(records: list[GraphDataRecord]) -> dict[str, int]:
    counts = {kind: 0 for kind in ("selection", "node", "relationship")}
    for record in records:
        counts[record.kind] += 1
        id_field, _ = graph_record_identity(record.model_dump(exclude_none=True))
        graph_system = (
            "engraphis" if id_field.startswith("engraphis")
            else "graphiti" if id_field.startswith("graphiti")
            else "cbm"
        )
        system_key = f"graphSystem:{graph_system}"
        type_key = f"type:{record.type}"
        counts[system_key] = counts.get(system_key, 0) + 1
        counts[type_key] = counts.get(type_key, 0) + 1
    counts["total"] = len(records)
    return counts


def load_idf_bytes(idf_bytes: bytes) -> MaterializedIdf:
    try:
        value = json.loads(idf_bytes.decode("utf-8"))
        # Older unrelated Runs serialized empty construction fields. Preserve their
        # exact bytes/hash on inspection without retaining an operation runtime.
        dynamic = dict(value.get("dynamicContext") or {})
        retired = {key: dynamic.pop(key) for key in (
            "selectedCardTarget", "agentBuilderGuidance", "agentBuilderOperation"
        ) if key in dynamic}
        if any(item is not None for item in retired.values()):
            raise InputMaterializationError("input_retired_operation_forbidden")
        idf = Idf.model_validate({**value, "dynamicContext": dynamic})
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
        raise InputMaterializationError("input_file_invalid") from error
    canonical = idf.model_dump(mode="json")
    if retired:
        current = canonical["dynamicContext"]
        canonical["dynamicContext"] = {
            key: retired[key] if key in retired else current[key]
            for key in value["dynamicContext"]
        }
        if set(dynamic) != set(current):
            raise InputMaterializationError("input_data_not_canonical")
    if canonical_line(canonical) != idf_bytes:
        raise InputMaterializationError("input_data_not_canonical")
    if idf.actualGraphData.recordCounts != record_counts(idf.actualGraphData.records):
        raise InputMaterializationError("input_graph_record_counts_mismatch")
    assert_secret_free(idf.model_dump())
    return MaterializedIdf(idf=idf, idf_bytes=idf_bytes)
