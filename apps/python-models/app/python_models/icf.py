"""Canonical LiquidAIty Input Context and Input Graph materializer.

One invocation is represented by exactly two deterministic UTF-8 inputs:
``in.icf`` describes the Card/task/capability allocation and ``in.igf``
contains the bounded native graph materialization.  Runtime projections are
loaded from the serialized bytes; there is no alternate in-memory execution
shape.
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


ICF_FORMAT = "liquidaity.input-context"
IGF_FORMAT = "liquidaity.input-graph"
INPUT_FORMAT_VERSION = 1
ICF_FILENAME = "in.icf"
IGF_FILENAME = "in.igf"
_HASH_RULE = "sha256-entire-file-utf8"
_FORBIDDEN_SECRET_KEYS = frozenset({
    "apikey", "api_key", "authorization", "bearer", "bearertoken",
    "access_token", "refreshtoken", "refresh_token", "clientsecret",
    "client_secret", "oauthstate", "oauth_state",
})


class InputMaterializationError(ValueError):
    """Secret-safe failure at the retained runtime-input boundary."""


class Icf(BaseModel):
    """One concrete Card invocation validated against ``LiquidAIty.idd``."""

    model_config = ConfigDict(extra="forbid")

    format: Literal[ICF_FORMAT] = ICF_FORMAT
    version: Literal[INPUT_FORMAT_VERSION] = INPUT_FORMAT_VERSION
    idd: dict[str, Any]
    stable: dict[str, Any]
    variable: dict[str, Any]
    capabilities: dict[str, Any]
    allocation: dict[str, Any]
    graphInput: dict[str, Any]
    estimates: dict[str, Any]

    @field_validator(
        "idd", "stable", "variable", "capabilities", "allocation",
        "graphInput", "estimates",
    )
    @classmethod
    def _require_object(cls, value: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(value, dict):
            raise ValueError("input_context_object_invalid")
        return value


class IgfHeader(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["header"] = "header"
    format: Literal[IGF_FORMAT] = IGF_FORMAT
    version: Literal[INPUT_FORMAT_VERSION] = INPUT_FORMAT_VERSION
    owner: dict[str, Any]
    materializedAt: str
    authorities: list[str] = Field(default_factory=list)
    selectedNativeReferences: list[dict[str, Any]] = Field(default_factory=list)
    recordCounts: dict[str, int]
    provenanceSummary: list[dict[str, Any]] = Field(default_factory=list)
    contentHashRule: Literal[_HASH_RULE] = _HASH_RULE


class IgfRecord(BaseModel):
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
    model_config = ConfigDict(extra="forbid")

    header: IgfHeader
    records: list[IgfRecord] = Field(default_factory=list)


@dataclass(frozen=True)
class MaterializedInputPair:
    icf: Icf
    igf: IgfDocument
    icf_bytes: bytes
    igf_bytes: bytes

    @property
    def icf_sha256(self) -> str:
        return sha256(self.icf_bytes).hexdigest()

    @property
    def igf_sha256(self) -> str:
        return sha256(self.igf_bytes).hexdigest()


def _canonical_line(value: Any) -> bytes:
    return (
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        + "\n"
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
                "reason": str(reference.get("reason") or ""),
                "required": reference.get("required") is True,
                "readOperation": str(reference.get("readOperation") or "exact_read"),
                "truncated": reference.get("truncated") is True,
            },
            provenance=dict(reference.get("provenance") or {}),
            retrievedAt=str(reference.get("asOf") or materialized_at),
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
                retrieved_by_identity.get((authority, native_id))
                or materialized_at
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
        for key in ("source", "project", "database", "repository", "path"):
            value = str(provenance.get(key) or "").strip()
            if value and value not in unique[authority]["sources"]:
                unique[authority]["sources"].append(value)
    return [unique[key] for key in sorted(unique)]


def materialize_input_pair(
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
) -> MaterializedInputPair:
    """Materialize and validate the only ICF/IGF execution representation."""

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
    selected = [
        {"authority": str(item.get("authority") or ""), "nativeId": str(item.get("nativeId") or "")}
        for item in native_references
    ]
    header = IgfHeader(
        owner=dict(owner),
        materializedAt=timestamp,
        authorities=authorities,
        selectedNativeReferences=selected,
        recordCounts=_record_counts(records),
        provenanceSummary=_provenance_summary(native_references),
    )
    _validate_idd_record("input-graph-header", header.model_dump())
    for record in records:
        _validate_idd_record("input-graph-record", record.model_dump(exclude_none=True))
    igf = IgfDocument(header=header, records=records)
    igf_bytes = b"".join([
        _canonical_line(header.model_dump()),
        *(_canonical_line(record.model_dump(exclude_none=True)) for record in records),
    ])

    dictionary = load_input_data_dictionary()["dictionary"]
    task = str(variable.get("task") or "")
    instructions = str(stable.get("instructions") or "")
    output_requirements = str(stable.get("outputContract") or "")
    estimates = {
        "method": "utf8-bytes-divided-by-4-ceiling",
        "systemContextTokens": _token_estimate(instructions),
        "taskTokens": _token_estimate(task),
        "outputContractTokens": _token_estimate(output_requirements),
        "graphContextTokens": _token_estimate(graph_context),
    }
    estimates["totalModelVisibleTokens"] = sum(
        value for key, value in estimates.items()
        if key.endswith("Tokens") and key != "totalModelVisibleTokens"
    )
    icf = Icf(
        idd={
            "name": str(dictionary["name"]),
            "version": int(dictionary["version"]),
            "format": str(dictionary["icfFormat"]),
        },
        stable=dict(stable),
        variable=dict(variable),
        capabilities=dict(capabilities),
        allocation=dict(allocation),
        graphInput={
            "filename": IGF_FILENAME,
            "format": IGF_FORMAT,
            "version": INPUT_FORMAT_VERSION,
            "bytes": len(igf_bytes),
            "sha256": sha256(igf_bytes).hexdigest(),
            "recordCounts": dict(header.recordCounts),
            "authorities": list(header.authorities),
        },
        estimates=estimates,
    )
    _assert_secret_free(icf.model_dump())
    _assert_secret_free(igf.model_dump())
    _validate_idd_record("input-context-file", icf.model_dump())
    icf_bytes = _canonical_line(icf.model_dump())
    return load_input_pair_bytes(icf_bytes, igf_bytes)


def rematerialize_input_pair(
    icf: dict[str, Any],
    igf: dict[str, Any],
    *,
    owner: dict[str, Any],
) -> MaterializedInputPair:
    """Replace preview ownership and produce the exact retained execution pair."""

    parsed_icf = Icf.model_validate(icf)
    parsed_igf = IgfDocument.model_validate(igf)
    graph_context = ""
    references: list[dict[str, Any]] = []
    projection = {"authority": "", "nodes": [], "edges": []}
    for record in parsed_igf.records:
        if record.kind == "materialized-context":
            graph_context = str(record.content.get("text") or "")
        elif record.kind == "selection":
            references.append({
                "authority": record.authority,
                "nativeId": record.nativeId,
                "nativeKind": record.type,
                "reason": str(record.content.get("reason") or ""),
                "asOf": record.retrievedAt,
                "required": record.content.get("required") is True,
                "readOperation": str(record.content.get("readOperation") or "exact_read"),
                "provenance": dict(record.provenance),
                "truncated": record.content.get("truncated") is True,
            })
        elif record.kind == "node":
            projection["nodes"].append({
                "id": record.nativeId,
                "authority": record.authority,
                "type": record.type,
                "label": str(record.content.get("label") or record.nativeId),
                "labels": list(record.content.get("labels") or []),
                "properties": dict(record.content.get("properties") or {}),
                "provenance": dict(record.provenance),
            })
        elif record.kind == "relationship":
            projection["edges"].append({
                "id": record.nativeId,
                "authority": record.authority,
                "predicate": record.type,
                "source": str(record.content.get("sourceNativeId") or ""),
                "target": str(record.content.get("targetNativeId") or ""),
                "properties": dict(record.content.get("properties") or {}),
                "provenance": dict(record.provenance),
            })
    return materialize_input_pair(
        owner=owner,
        stable=parsed_icf.stable,
        variable=parsed_icf.variable,
        capabilities=parsed_icf.capabilities,
        allocation=parsed_icf.allocation,
        graph_context=graph_context,
        native_references=references,
        graph_projection=projection,
    )


def load_input_pair_bytes(icf_bytes: bytes, igf_bytes: bytes) -> MaterializedInputPair:
    try:
        icf_value = json.loads(icf_bytes.decode("utf-8"))
        lines = igf_bytes.decode("utf-8").splitlines()
        if not lines:
            raise InputMaterializationError("input_graph_header_missing")
        header_value = json.loads(lines[0])
        record_values = [json.loads(line) for line in lines[1:]]
        icf = Icf.model_validate(icf_value)
        igf = IgfDocument.model_validate({"header": header_value, "records": record_values})
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
        if isinstance(error, InputMaterializationError):
            raise
        raise InputMaterializationError("input_files_invalid") from error
    if _canonical_line(icf.model_dump()) != icf_bytes:
        raise InputMaterializationError("input_context_not_canonical")
    canonical_igf = b"".join([
        _canonical_line(igf.header.model_dump()),
        *(_canonical_line(record.model_dump(exclude_none=True)) for record in igf.records),
    ])
    if canonical_igf != igf_bytes:
        raise InputMaterializationError("input_graph_not_canonical")
    if igf.header.recordCounts != _record_counts(igf.records):
        raise InputMaterializationError("input_graph_record_counts_mismatch")
    graph_input = icf.graphInput
    if (
        graph_input.get("filename") != IGF_FILENAME
        or graph_input.get("format") != IGF_FORMAT
        or graph_input.get("version") != INPUT_FORMAT_VERSION
        or graph_input.get("bytes") != len(igf_bytes)
        or graph_input.get("sha256") != sha256(igf_bytes).hexdigest()
        or graph_input.get("recordCounts") != igf.header.recordCounts
        or graph_input.get("authorities") != igf.header.authorities
    ):
        raise InputMaterializationError("input_graph_reference_mismatch")
    _assert_secret_free(icf.model_dump())
    _assert_secret_free(igf.model_dump())
    _validate_idd_record("input-context-file", icf.model_dump())
    _validate_idd_record("input-graph-header", igf.header.model_dump())
    for record in igf.records:
        _validate_idd_record("input-graph-record", record.model_dump(exclude_none=True))
    return MaterializedInputPair(icf=icf, igf=igf, icf_bytes=icf_bytes, igf_bytes=igf_bytes)


def _workspace_root() -> Path:
    configured = str(os.environ.get("LIQUIDAITY_RUN_INPUT_ROOT") or "").strip()
    return Path(configured).resolve() if configured else (
        Path(__file__).resolve().parents[4] / "runtime" / "run-inputs"
    ).resolve()


def invocation_workspace(
    project_id: str,
    deck_id: str,
    run_id: str,
) -> Path:
    identity = "\u0000".join((project_id, deck_id, run_id))
    digest = sha256(identity.encode("utf-8")).hexdigest()
    return _workspace_root() / digest


def write_input_pair(
    pair: MaterializedInputPair,
    *,
    project_id: str,
    deck_id: str,
    run_id: str,
) -> dict[str, Any]:
    """Write exactly two files, then load them back as execution authority."""

    workspace = invocation_workspace(project_id, deck_id, run_id)
    try:
        workspace.mkdir(parents=True, exist_ok=False)
        igf_path = workspace / IGF_FILENAME
        icf_path = workspace / ICF_FILENAME
        with igf_path.open("xb") as destination:
            destination.write(pair.igf_bytes)
            destination.flush()
            os.fsync(destination.fileno())
        with icf_path.open("xb") as destination:
            destination.write(pair.icf_bytes)
            destination.flush()
            os.fsync(destination.fileno())
        loaded = load_input_pair_bytes(icf_path.read_bytes(), igf_path.read_bytes())
    except InputMaterializationError:
        raise
    except OSError as error:
        raise InputMaterializationError("input_files_write_failed") from error
    return {
        "workspace": str(workspace),
        "icfPath": str(icf_path),
        "igfPath": str(igf_path),
        "icfSha256": loaded.icf_sha256,
        "igfSha256": loaded.igf_sha256,
        "icfBytes": len(loaded.icf_bytes),
        "igfBytes": len(loaded.igf_bytes),
    }


def load_input_pair(input_files: dict[str, Any]) -> MaterializedInputPair:
    try:
        icf_path = Path(str(input_files.get("icfPath") or "")).resolve(strict=True)
        igf_path = Path(str(input_files.get("igfPath") or "")).resolve(strict=True)
    except OSError as error:
        raise InputMaterializationError("input_files_unavailable") from error
    if icf_path.name != ICF_FILENAME or igf_path.name != IGF_FILENAME or icf_path.parent != igf_path.parent:
        raise InputMaterializationError("input_file_paths_invalid")
    root = _workspace_root()
    if root not in icf_path.parents:
        raise InputMaterializationError("input_file_paths_invalid")
    pair = load_input_pair_bytes(icf_path.read_bytes(), igf_path.read_bytes())
    if (
        str(input_files.get("icfSha256") or "") != pair.icf_sha256
        or str(input_files.get("igfSha256") or "") != pair.igf_sha256
    ):
        raise InputMaterializationError("input_file_hash_mismatch")
    return pair


def runtime_projection(pair: MaterializedInputPair) -> dict[str, Any]:
    """Mechanically project native-runtime fields from validated file bytes."""

    graph_context = ""
    for record in pair.igf.records:
        if record.kind == "materialized-context":
            graph_context = str(record.content.get("text") or "")
            break
    stable = pair.icf.stable
    variable = pair.icf.variable
    capabilities = pair.icf.capabilities
    allocation = pair.icf.allocation
    return {
        "systemPrompt": str(stable.get("instructions") or ""),
        "outputRequirements": str(stable.get("outputContract") or ""),
        "task": str(variable.get("task") or ""),
        "graphContext": graph_context,
        "runtime": dict(stable.get("runtime") or {}),
        "provider": dict(stable.get("provider") or {}),
        "runtimeOptions": dict(allocation.get("runtimeOptions") or {}),
        "enabledTools": list(capabilities.get("enabledTools") or []),
        "toolDefinitions": list(capabilities.get("toolDefinitions") or []),
        "nativeTools": list(capabilities.get("nativeTools") or []),
        "skills": list(capabilities.get("skills") or []),
        "toolsets": list(capabilities.get("toolsets") or []),
        "mcpConnectionIds": list(capabilities.get("mcpConnectionIds") or []),
        "nativeReferences": list(variable.get("selectedNativeReferences") or []),
        "images": list(variable.get("images") or []),
        "estimates": dict(pair.icf.estimates),
    }


def input_pair_public(pair: MaterializedInputPair) -> dict[str, Any]:
    return {
        "icf": pair.icf.model_dump(),
        "igf": pair.igf.model_dump(),
        "inputSummary": {
            "icfBytes": len(pair.icf_bytes),
            "igfBytes": len(pair.igf_bytes),
            "icfSha256": pair.icf_sha256,
            "igfSha256": pair.igf_sha256,
            "recordCounts": dict(pair.igf.header.recordCounts),
            "authorities": list(pair.igf.header.authorities),
            "estimatedModelVisibleTokens": pair.icf.estimates.get("totalModelVisibleTokens", 0),
            "estimateMethod": pair.icf.estimates.get("method"),
        },
    }
