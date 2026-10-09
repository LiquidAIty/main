"""Typed cross-authority graph-record and selected-anchor contracts."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, model_validator

from app.python_models.card_configuration_contracts import RequiredRuntimeString


GraphRecordIdField = Literal[
    "engraphisMemoryId",
    "engraphisEntityId",
    "engraphisRelationshipId",
    "graphitiEpisodeId",
    "graphitiEntityId",
    "graphitiRelationshipId",
    "cbmQualifiedName",
]
GRAPH_RECORD_ID_FIELDS: tuple[str, ...] = (
    "engraphisMemoryId",
    "engraphisEntityId",
    "engraphisRelationshipId",
    "graphitiEpisodeId",
    "graphitiEntityId",
    "graphitiRelationshipId",
    "cbmQualifiedName",
)
DATA_ANCHOR_ID_FIELDS: tuple[str, ...] = (
    "engraphisMemoryId",
    "engraphisEntityId",
    "graphitiEpisodeId",
    "graphitiEntityId",
    "graphitiRelationshipId",
    "cbmQualifiedName",
)


def graph_record_identity(value: dict[str, Any]) -> tuple[str, str]:
    populated = [
        field
        for field in GRAPH_RECORD_ID_FIELDS
        if str(value.get(field) or "").strip()
    ]
    if len(populated) != 1:
        raise ValueError("graph_record_identity_invalid")
    field = populated[0]
    return field, str(value[field]).strip()


def graph_record_fields(
    field: GraphRecordIdField,
    identifier: str,
) -> dict[str, str]:
    value = str(identifier or "").strip()
    if field not in GRAPH_RECORD_ID_FIELDS or not value:
        raise ValueError("graph_record_identity_invalid")
    return {field: value}


def _validate_graph_record(
    model: BaseModel,
    *,
    fields: tuple[str, ...] = GRAPH_RECORD_ID_FIELDS,
    allow_missing: bool,
) -> BaseModel:
    populated = [
        field
        for field in fields
        if str(getattr(model, field, None) or "").strip()
    ]
    if allow_missing and not populated:
        return model
    if len(populated) != 1:
        raise ValueError("graph_record_identity_invalid")
    return model


class GraphRecordReference(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    engraphisMemoryId: RequiredRuntimeString | None = None
    engraphisEntityId: RequiredRuntimeString | None = None
    engraphisRelationshipId: RequiredRuntimeString | None = None
    graphitiEpisodeId: RequiredRuntimeString | None = None
    graphitiEntityId: RequiredRuntimeString | None = None
    graphitiRelationshipId: RequiredRuntimeString | None = None
    cbmQualifiedName: RequiredRuntimeString | None = None

    @model_validator(mode="after")
    def require_exact_provider_identity(self):
        return _validate_graph_record(self, allow_missing=False)


class DataAnchorReference(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    engraphisMemoryId: RequiredRuntimeString | None = None
    engraphisEntityId: RequiredRuntimeString | None = None
    graphitiEpisodeId: RequiredRuntimeString | None = None
    graphitiEntityId: RequiredRuntimeString | None = None
    graphitiRelationshipId: RequiredRuntimeString | None = None
    cbmQualifiedName: RequiredRuntimeString | None = None
    reason: str
    priority: int
    boundedExpansion: int
    resultLimit: int = 24
    required: bool

    @model_validator(mode="after")
    def require_exact_readable_identity(self):
        return _validate_graph_record(
            self,
            fields=DATA_ANCHOR_ID_FIELDS,
            allow_missing=False,
        )


class GraphReference(GraphRecordReference):
    reason: RequiredRuntimeString
    asOf: RequiredRuntimeString
    required: bool = False
