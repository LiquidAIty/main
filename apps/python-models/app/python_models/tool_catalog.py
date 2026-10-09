"""Deterministic projection of canonical operations into the selectable catalog."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from app.python_models.operation_definition import OperationDefinition


class ToolCatalogError(ValueError):
    """Secret-safe structural error in one authoritative live tool catalog."""


_CATALOG_PUBLICATIONS = frozenset({"card-runtime", "external-mcp"})
_CATALOG_ANNOTATIONS = frozenset({
    "readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint",
})
_CARD_CATALOG_EXCLUDED_IDS = frozenset({
    # KnowGraph owns outside research through its saved profile Web toolset.
    "web_search",
    # Retained operator/governance operations are not ordinary Card choices.
    "engraphis_conflict_review",
    "engraphis_session",
    "engraphis_update_memory",
})
_LIVE_PROVIDER_CATALOG_SOURCES = frozenset({"cbm", "graphiti"})


def project_server_injected_schema(
    canonical_schema: dict[str, Any],
    server_injected_arguments: frozenset[str] | set[str] | list[str] | tuple[str, ...],
) -> dict[str, Any]:
    """Remove only explicitly declared server-injected top-level arguments."""

    if not isinstance(canonical_schema, dict) or canonical_schema.get("type") != "object":
        raise ToolCatalogError("tool_catalog_canonical_schema_invalid")
    declared = tuple(server_injected_arguments)
    if (
        any(not isinstance(field, str) or not field for field in declared)
        or len(declared) != len(set(declared))
    ):
        raise ToolCatalogError("tool_catalog_server_injected_arguments_invalid")
    projected = deepcopy(canonical_schema)
    properties = projected.get("properties")
    canonical_properties = canonical_schema.get("properties")
    if not isinstance(properties, dict) or not isinstance(canonical_properties, dict):
        if declared:
            raise ToolCatalogError("tool_catalog_server_injected_argument_unknown")
        return projected
    unknown = sorted(set(declared) - set(canonical_properties))
    if unknown:
        raise ToolCatalogError(
            "tool_catalog_server_injected_argument_unknown:" + ",".join(unknown)
        )
    for field in declared:
        properties.pop(field, None)
    required = projected.get("required")
    if isinstance(required, list):
        projected["required"] = [field for field in required if field not in declared]
    return projected


def operation_catalog_descriptor(definition: OperationDefinition) -> dict[str, Any]:
    """Project one canonical operation into its one model-facing definition."""

    publications = []
    if definition.publishers & {"internal-plugin", "internal-runtime"}:
        publications.append("card-runtime")
    if "external-mcp" in definition.publishers:
        publications.append("external-mcp")
    if not publications:
        raise ToolCatalogError(
            f"tool_catalog_publication_missing:{definition.canonical_id}"
        )
    annotations = deepcopy(definition.annotations or {})
    if not _CATALOG_ANNOTATIONS.issubset(annotations):
        missing = ",".join(sorted(_CATALOG_ANNOTATIONS - set(annotations)))
        raise ToolCatalogError(
            f"tool_catalog_annotations_missing:{definition.canonical_id}:{missing}"
        )
    canonical_schema = deepcopy(definition.parameters_schema)
    canonical_schema.setdefault("additionalProperties", False)
    input_schema = project_server_injected_schema(
        canonical_schema,
        definition.server_injected_arguments,
    )
    descriptor: dict[str, Any] = {
        "canonicalId": definition.canonical_id,
        "provider": definition.external_source_id,
        "providerToolName": definition.canonical_id,
        "namespace": definition.namespace,
        "publications": publications,
        "displayName": definition.title or definition.canonical_id,
        "description": definition.description,
        "available": definition.available,
        "grantEligible": definition.grant_eligible,
        "access": definition.access,
        "inputSchema": input_schema,
        "canonicalInputSchema": canonical_schema,
        "serverInjectedArguments": sorted(definition.server_injected_arguments),
        "dispatcherContextArguments": sorted(
            definition.dispatcher_context_arguments
        ),
        "dispatcherOwner": definition.dispatcher_owner,
        "annotations": annotations,
    }
    if definition.output_schema is not None:
        descriptor["outputSchema"] = deepcopy(definition.output_schema)
    if definition.required_caller_runtime is not None:
        descriptor.update({
            "requiredCallerRuntimeKind": definition.required_caller_runtime[0],
            "requiredCallerRuntimeMode": definition.required_caller_runtime[1],
        })
    return descriptor


def code_owned_tool_projection() -> list[dict[str, Any]]:
    """Return one selectable descriptor per available code-owned operation."""

    from app.python_models.tool_registry import code_owned_operation_definitions

    return [
        operation_catalog_descriptor(definition)
        for definition in code_owned_operation_definitions()
        if (
            definition.available
            and definition.canonical_id not in _CARD_CATALOG_EXCLUDED_IDS
        )
    ]


def provider_tool_catalog_descriptor(raw: Any) -> dict[str, Any] | None:
    """Project one authenticated live provider declaration into the catalog."""

    if not isinstance(raw, dict):
        raise ToolCatalogError("tool_catalog_provider_entry_invalid")
    source_id = str(raw.get("sourceId") or "").strip()
    if source_id not in _LIVE_PROVIDER_CATALOG_SOURCES:
        return None
    canonical_id = str(raw.get("name") or "").strip()
    provider_tool_name = str(raw.get("providerToolName") or "").strip()
    namespace = str(raw.get("namespace") or "").strip()
    connection_kind = str(raw.get("connectionKind") or "").strip()
    publication = str(raw.get("publication") or "").strip()
    title = str(raw.get("title") or canonical_id).strip()
    description = raw.get("description")
    available = raw.get("available")
    grant_eligible = raw.get("grantEligible")
    access = str(raw.get("access") or "").strip()
    input_schema = raw.get("inputSchema")
    canonical_schema = raw.get("canonicalInputSchema")
    server_injected = raw.get("serverInjectedArguments")
    dispatcher_context = raw.get("dispatcherContextArguments")
    dispatcher_owner = str(raw.get("dispatcherOwner") or "").strip()
    annotations = raw.get("annotations")
    output_schema = raw.get("outputSchema")
    caller_kind = raw.get("requiredCallerRuntimeKind")
    caller_mode = raw.get("requiredCallerRuntimeMode")
    if (
        not canonical_id
        or not provider_tool_name
        or not namespace
        or connection_kind != "external-mcp"
        or publication != "external-mcp"
        or not title
        or not isinstance(description, str)
        or not isinstance(available, bool)
        or not isinstance(grant_eligible, bool)
        or access not in {"read", "write"}
        or not isinstance(input_schema, dict)
        or input_schema.get("type") != "object"
        or not isinstance(canonical_schema, dict)
        or canonical_schema.get("type") != "object"
        or not isinstance(server_injected, list)
        or not isinstance(dispatcher_context, list)
        or not dispatcher_owner
        or not isinstance(annotations, dict)
        or not _CATALOG_ANNOTATIONS.issubset(annotations)
        or (output_schema is not None and not isinstance(output_schema, dict))
        or bool(caller_kind) != bool(caller_mode)
    ):
        raise ToolCatalogError(
            f"tool_catalog_provider_definition_invalid:{canonical_id or source_id}"
        )
    descriptor: dict[str, Any] = {
        "canonicalId": canonical_id,
        "provider": source_id,
        "providerToolName": provider_tool_name,
        "namespace": namespace,
        "publications": ["card-runtime", "external-mcp"],
        "displayName": title,
        "description": description,
        "available": available,
        "grantEligible": grant_eligible,
        "access": access,
        "inputSchema": deepcopy(input_schema),
        "canonicalInputSchema": deepcopy(canonical_schema),
        "serverInjectedArguments": list(server_injected),
        "dispatcherContextArguments": list(dispatcher_context),
        "dispatcherOwner": dispatcher_owner,
        "annotations": deepcopy(annotations),
    }
    if output_schema is not None:
        descriptor["outputSchema"] = deepcopy(output_schema)
    if caller_kind is not None:
        descriptor.update({
            "requiredCallerRuntimeKind": caller_kind,
            "requiredCallerRuntimeMode": caller_mode,
        })
    return descriptor


def materialize_live_tool_catalog(descriptors: Any) -> list[dict[str, Any]]:
    """Build the flat Card catalog from code owners plus live providers."""

    if not isinstance(descriptors, list):
        raise ToolCatalogError("tool_catalog_invalid")
    provider_definitions = [
        definition
        for raw in descriptors
        if (definition := provider_tool_catalog_descriptor(raw)) is not None
    ]
    return validate_live_tool_catalog([
        *code_owned_tool_projection(),
        *provider_definitions,
    ])


def materialize_live_tool_catalog_with_failures(
    descriptors: Any,
) -> tuple[list[dict[str, Any]], dict[str, str]]:
    """Build a usable per-Run catalog while isolating malformed definitions."""

    if not isinstance(descriptors, list):
        raise ToolCatalogError("tool_catalog_invalid")
    from app.python_models.tool_registry import code_owned_operation_definitions

    definitions: list[dict[str, Any]] = []
    failures: dict[str, str] = {}
    for definition in code_owned_operation_definitions():
        if (
            not definition.available
            or definition.canonical_id in _CARD_CATALOG_EXCLUDED_IDS
        ):
            continue
        try:
            definitions.append(operation_catalog_descriptor(definition))
        except ToolCatalogError as error:
            failures[definition.canonical_id] = str(error)
    for index, raw in enumerate(descriptors):
        key = (
            str(raw.get("name") or "").strip()
            if isinstance(raw, dict)
            else ""
        ) or f"catalog-entry-{index}"
        try:
            definition = provider_tool_catalog_descriptor(raw)
            if definition is not None:
                definitions.append(definition)
        except ToolCatalogError as error:
            failures[key] = str(error)
    valid, validation_failures = validate_live_tool_catalog_with_failures(
        definitions
    )
    failures.update(validation_failures)
    return valid, failures


def validate_live_tool_catalog(descriptors: Any) -> list[dict[str, Any]]:
    """Validate one flat, duplicate-free model-facing tool catalog."""

    if not isinstance(descriptors, list):
        raise ToolCatalogError("tool_catalog_invalid")
    validated: dict[str, dict[str, Any]] = {}
    for raw in descriptors:
        if not isinstance(raw, dict):
            raise ToolCatalogError("tool_catalog_entry_invalid")
        canonical_id = str(raw.get("canonicalId") or "").strip()
        provider = str(raw.get("provider") or "").strip()
        provider_tool_name = str(raw.get("providerToolName") or "").strip()
        namespace = str(raw.get("namespace") or "").strip()
        display_name = str(raw.get("displayName") or "").strip()
        description = raw.get("description")
        publications = raw.get("publications")
        available = raw.get("available")
        grant_eligible = raw.get("grantEligible")
        access = str(raw.get("access") or "").strip()
        input_schema = raw.get("inputSchema")
        canonical_schema = raw.get("canonicalInputSchema")
        server_injected = raw.get("serverInjectedArguments")
        dispatcher_context = raw.get("dispatcherContextArguments")
        dispatcher_owner = str(raw.get("dispatcherOwner") or "").strip()
        annotations = raw.get("annotations")
        output_schema = raw.get("outputSchema")
        caller_kind = raw.get("requiredCallerRuntimeKind")
        caller_mode = raw.get("requiredCallerRuntimeMode")
        if (
            not canonical_id or not provider or not provider_tool_name
            or not namespace or not display_name or not isinstance(description, str)
            or not isinstance(publications, list) or not publications
            or len(publications) != len(set(publications))
            or not set(publications) <= _CATALOG_PUBLICATIONS
            or not isinstance(available, bool)
            or not isinstance(grant_eligible, bool)
            or access not in {"read", "write"}
            or not isinstance(input_schema, dict) or input_schema.get("type") != "object"
            or not isinstance(canonical_schema, dict) or canonical_schema.get("type") != "object"
            or not isinstance(server_injected, list)
            or not isinstance(dispatcher_context, list)
            or not dispatcher_owner
            or not isinstance(annotations, dict)
            or not _CATALOG_ANNOTATIONS.issubset(annotations)
        ):
            raise ToolCatalogError(
                f"tool_catalog_definition_invalid:{canonical_id or 'unknown'}"
            )
        if canonical_id in validated:
            raise ToolCatalogError(f"tool_catalog_duplicate_id:{canonical_id}")
        if annotations.get("readOnlyHint") is not (access == "read"):
            raise ToolCatalogError(f"tool_catalog_access_mismatch:{canonical_id}")
        if (
            any(not isinstance(field, str) or not field for field in server_injected)
            or len(server_injected) != len(set(server_injected))
            or any(not isinstance(field, str) or not field for field in dispatcher_context)
            or len(dispatcher_context) != len(set(dispatcher_context))
            or not set(server_injected) <= set(dispatcher_context)
        ):
            raise ToolCatalogError(f"tool_catalog_scope_invalid:{canonical_id}")
        if input_schema != project_server_injected_schema(
            canonical_schema, server_injected
        ):
            raise ToolCatalogError(
                f"tool_catalog_schema_projection_mismatch:{canonical_id}"
            )
        if output_schema is not None and not isinstance(output_schema, dict):
            raise ToolCatalogError(f"tool_catalog_output_schema_invalid:{canonical_id}")
        if bool(caller_kind) != bool(caller_mode) or (
            caller_kind is not None
            and (
                caller_kind != "hermes"
                or caller_mode not in {"main", "delegate", "magentic_one"}
            )
        ):
            raise ToolCatalogError(f"tool_catalog_caller_scope_invalid:{canonical_id}")
        validated[canonical_id] = deepcopy(raw)
    return [validated[key] for key in sorted(validated)]


def validate_live_tool_catalog_with_failures(
    descriptors: Any,
) -> tuple[list[dict[str, Any]], dict[str, str]]:
    """Exclude malformed definitions independently without merging identities."""

    if not isinstance(descriptors, list):
        raise ToolCatalogError("tool_catalog_invalid")
    valid: list[dict[str, Any]] = []
    failures: dict[str, str] = {}
    seen: set[str] = set()
    for index, raw in enumerate(descriptors):
        canonical_id = (
            str(raw.get("canonicalId") or "").strip()
            if isinstance(raw, dict) else ""
        )
        key = canonical_id or f"catalog-entry-{index}"
        if key in seen:
            failures[key] = f"tool_catalog_duplicate_id:{key}"
            valid = [item for item in valid if item.get("canonicalId") != key]
            continue
        seen.add(key)
        try:
            valid.extend(validate_live_tool_catalog([raw]))
        except ToolCatalogError as error:
            failures[key] = str(error)
    return valid, failures
