"""Generic interpreter for the repository-owned ``LiquidAIty.idd`` file.

All product definitions live in the literal IDD. This module is only its
mechanical reader/validator; it contains no copied record, island, tool, or
operation catalog.
"""

from __future__ import annotations

import json
import re
import tomllib
from copy import deepcopy
from functools import lru_cache
from pathlib import Path
from typing import Any


IDD_PATH = Path(__file__).resolve().parents[4] / "LiquidAIty.idd"
_OPENING_ISLAND = re.compile(r"^\[([A-Z][A-Z0-9_]*)(?:\s+([^\]]+))?\]$")
_ATTRIBUTE = re.compile(r"([A-Za-z][A-Za-z0-9_-]*)=([^\s]+)")


class IddValidationError(ValueError):
    """Secret-safe structural failure reported by the literal IDD boundary."""


@lru_cache(maxsize=1)
def load_input_data_dictionary() -> dict[str, Any]:
    try:
        with IDD_PATH.open("rb") as source:
            document = tomllib.load(source)
    except (OSError, tomllib.TOMLDecodeError) as error:
        raise IddValidationError("idd_load_failed") from error

    metadata = document.get("dictionary")
    catalogs = document.get("catalogs")
    records = document.get("records")
    editor_fields = document.get("editorFields")
    islands = document.get("islands")
    if not isinstance(metadata, dict) or metadata.get("name") != "LiquidAIty":
        raise IddValidationError("idd_metadata_invalid")
    if not isinstance(records, list) or not records:
        raise IddValidationError("idd_records_invalid")
    if not isinstance(catalogs, list) or not catalogs:
        raise IddValidationError("idd_catalogs_invalid")
    if not isinstance(editor_fields, list) or not editor_fields:
        raise IddValidationError("idd_editor_fields_invalid")
    if not isinstance(islands, list) or not islands:
        raise IddValidationError("idd_islands_invalid")

    record_names: set[str] = set()
    for definition in records:
        if not isinstance(definition, dict):
            raise IddValidationError("idd_record_invalid")
        name = definition.get("name")
        fields = definition.get("fields")
        if not isinstance(name, str) or not name or name in record_names:
            raise IddValidationError("idd_record_name_invalid")
        if not isinstance(fields, list):
            raise IddValidationError(f"idd_record_fields_invalid:{name}")
        field_names: set[str] = set()
        for field in fields:
            field_name = field.get("name") if isinstance(field, dict) else None
            if not isinstance(field_name, str) or not field_name or field_name in field_names:
                raise IddValidationError(f"idd_field_name_invalid:{name}")
            if field.get("type") not in {
                "string", "boolean", "integer", "number",
                "object", "string-array", "object-array",
            }:
                raise IddValidationError(f"idd_field_type_invalid:{name}.{field_name}")
            values = field.get("values")
            if values is not None and (
                not isinstance(values, list) or not all(isinstance(value, str) for value in values)
            ):
                raise IddValidationError(f"idd_field_values_invalid:{name}.{field_name}")
            field_names.add(field_name)
        record_names.add(name)

    catalog_names: set[str] = set()
    for definition in catalogs:
        if not isinstance(definition, dict):
            raise IddValidationError("idd_catalog_invalid")
        name = definition.get("name")
        record_name = definition.get("record")
        identity_fields = definition.get("identityFields")
        if not isinstance(name, str) or not name or name in catalog_names:
            raise IddValidationError("idd_catalog_name_invalid")
        if record_name not in record_names:
            raise IddValidationError(f"idd_catalog_record_invalid:{name}")
        if (
            not isinstance(identity_fields, list)
            or not identity_fields
            or not all(isinstance(field, str) and field for field in identity_fields)
        ):
            raise IddValidationError(f"idd_catalog_identity_invalid:{name}")
        catalog_names.add(name)

    editor_field_names: set[str] = set()
    for definition in editor_fields:
        if not isinstance(definition, dict):
            raise IddValidationError("idd_editor_field_invalid")
        name = definition.get("name")
        if not isinstance(name, str) or not name or name in editor_field_names:
            raise IddValidationError("idd_editor_field_name_invalid")
        if definition.get("control") not in {
            "select", "catalog-select", "catalog-multiselect", "number", "integer",
        }:
            raise IddValidationError(f"idd_editor_field_control_invalid:{name}")
        catalog_name = definition.get("catalog")
        if catalog_name is not None and catalog_name not in catalog_names:
            raise IddValidationError(f"idd_editor_field_catalog_invalid:{name}")
        options = definition.get("options", [])
        if not isinstance(options, list):
            raise IddValidationError(f"idd_editor_field_options_invalid:{name}")
        option_values: set[str] = set()
        for option in options:
            value = option.get("value") if isinstance(option, dict) else None
            label = option.get("label") if isinstance(option, dict) else None
            if (
                not isinstance(value, str)
                or not value
                or value in option_values
                or not isinstance(label, str)
                or not label
            ):
                raise IddValidationError(f"idd_editor_field_option_invalid:{name}")
            option_values.add(value)
        for numeric_key in ("minimum", "maximum", "step"):
            numeric_value = definition.get(numeric_key)
            if numeric_value is not None and (
                not isinstance(numeric_value, (int, float)) or isinstance(numeric_value, bool)
            ):
                raise IddValidationError(f"idd_editor_field_bound_invalid:{name}.{numeric_key}")
        editor_field_names.add(name)

    island_names: set[str] = set()
    for definition in islands:
        name = definition.get("name") if isinstance(definition, dict) else None
        if not isinstance(name, str) or not name or name in island_names:
            raise IddValidationError("idd_island_name_invalid")
        if not isinstance(definition.get("language"), str):
            raise IddValidationError(f"idd_island_language_invalid:{name}")
        allowed = definition.get("allowedAttributes", [])
        required = definition.get("requiredAttributes", [])
        if (
            not isinstance(allowed, list)
            or not isinstance(required, list)
            or not all(isinstance(value, str) for value in [*allowed, *required])
            or not set(required).issubset(set(allowed))
        ):
            raise IddValidationError(f"idd_island_attributes_invalid:{name}")
        island_names.add(name)
    return document


def _named_definition(group: str, name: str) -> dict[str, Any] | None:
    for definition in load_input_data_dictionary()[group]:
        if definition["name"] == name:
            return definition
    return None


def _matches_type(value: Any, field_type: str) -> bool:
    if field_type == "string":
        return isinstance(value, str)
    if field_type == "boolean":
        return isinstance(value, bool)
    if field_type == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if field_type == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if field_type == "object":
        return isinstance(value, dict)
    if field_type == "string-array":
        return isinstance(value, list) and all(isinstance(item, str) for item in value)
    if field_type == "object-array":
        return isinstance(value, list) and all(isinstance(item, dict) for item in value)
    return False


def validate_record(name: str, value: Any) -> dict[str, Any]:
    """Validate a structured storage record using only the literal IDD rules."""
    definition = _named_definition("records", name)
    if definition is None or not isinstance(value, dict):
        raise IddValidationError(f"idd_record_value_invalid:{name}")
    fields = {field["name"]: field for field in definition["fields"]}
    if definition.get("allowUnknownFields") is not True and set(value) - set(fields):
        raise IddValidationError(f"idd_record_field_unknown:{name}")
    for field_name, field in fields.items():
        if field.get("required") is True and field_name not in value:
            raise IddValidationError(f"idd_record_field_required:{name}.{field_name}")
        if field_name not in value:
            continue
        if not _matches_type(value[field_name], field["type"]):
            raise IddValidationError(f"idd_record_field_invalid:{name}.{field_name}")
        values = field.get("values")
        if values is not None and value[field_name] not in values:
            raise IddValidationError(f"idd_record_field_invalid:{name}.{field_name}")
    return value


def materialize_catalog(name: str, values: Any) -> list[dict[str, Any]]:
    """Validate current native catalog values against one literal IDD catalog."""
    definition = _named_definition("catalogs", name)
    if definition is None or not isinstance(values, list):
        raise IddValidationError(f"idd_catalog_value_invalid:{name}")
    record_name = definition["record"]
    identity_fields = definition["identityFields"]
    materialized: list[dict[str, Any]] = []
    identities: set[tuple[Any, ...]] = set()
    for value in values:
        validated = validate_record(record_name, value)
        identity = tuple(validated.get(field_name) for field_name in identity_fields)
        if identity in identities:
            raise IddValidationError(f"idd_catalog_identity_duplicate:{name}")
        identities.add(identity)
        materialized.append(deepcopy(validated))
    return materialized


def _declared_tool_references() -> dict[str, dict[str, Any]]:
    """Read permanent tool declarations from the literal IDD without adding policy."""
    groups = load_input_data_dictionary().get("toolGroups")
    if not isinstance(groups, list):
        raise IddValidationError("idd_tool_groups_invalid")
    references: dict[str, dict[str, Any]] = {}
    for group in groups:
        if not isinstance(group, dict):
            raise IddValidationError("idd_tool_group_invalid")
        namespace = group.get("namespace")
        name_prefix = group.get("namePrefix")
        source_id = group.get("sourceId")
        group_kind = group.get("kind")
        publication = group.get("publication")
        tools = group.get("tools")
        if (
            not isinstance(namespace, str)
            or not isinstance(name_prefix, str)
            or not isinstance(source_id, str)
            or group_kind not in {"tool", "agent"}
            or publication not in {"external-mcp", "private-runtime"}
            or not isinstance(tools, list)
        ):
            raise IddValidationError("idd_tool_group_invalid")
        for tool in tools:
            if not isinstance(tool, dict):
                raise IddValidationError("idd_tool_declaration_invalid")
            native_name = tool.get("name")
            if not isinstance(native_name, str) or not native_name:
                raise IddValidationError("idd_tool_declaration_name_invalid")
            canonical_id = name_prefix + native_name
            required_binding = tool.get("requiredCallerRuntimeBinding")
            if required_binding is not None and (
                not isinstance(required_binding, str) or not required_binding
            ):
                raise IddValidationError("idd_tool_permission_invalid")
            current = references.get(canonical_id)
            declared_source = tool.get("sourceId", source_id)
            if current is not None:
                if current["kind"] != tool.get("kind", group_kind):
                    raise IddValidationError("idd_tool_declaration_kind_conflict")
                current_requirement = current.get("requiredCallerRuntimeBinding")
                if (
                    required_binding is not None
                    and current_requirement is not None
                    and required_binding != current_requirement
                ):
                    raise IddValidationError("idd_tool_permission_conflict")
                if declared_source not in current["sourceIds"]:
                    current["sourceIds"].append(declared_source)
                if required_binding is not None:
                    current["requiredCallerRuntimeBinding"] = required_binding
                continue
            reference = {
                "canonicalId": canonical_id,
                "kind": tool.get("kind", group_kind),
                "namespace": tool.get("namespace", namespace),
                "sourceIds": [declared_source],
                "displayName": tool.get("displayName", canonical_id),
                "shortDescription": tool.get("description", ""),
                "availability": "disabled",
                "contracts": [],
            }
            if required_binding is not None:
                reference["requiredCallerRuntimeBinding"] = required_binding
            references[canonical_id] = validate_record(
                "tool-catalog-reference", reference
            )
    return references


def required_tool_caller_runtime_binding(name: str) -> str | None:
    """Return an explicit IDD permission requirement; never infer one from a name."""
    reference = _declared_tool_references().get(name)
    if reference is None:
        return None
    value = reference.get("requiredCallerRuntimeBinding")
    return value if isinstance(value, str) and value else None


def materialize_tool_catalog(discovered: Any) -> list[dict[str, Any]]:
    """Combine permanent IDD declarations with factual live native contracts.

    Discovery contributes only native contract data and current availability.
    The function does not infer risk, compatibility, runtime ownership, graph
    meaning, or card assignability from tool names or descriptions.
    """
    if not isinstance(discovered, list):
        raise IddValidationError("idd_tool_discovery_invalid")
    references = deepcopy(_declared_tool_references())
    seen_contracts: set[tuple[str, str, str]] = set()
    for raw in discovered:
        if not isinstance(raw, dict):
            raise IddValidationError("idd_tool_discovery_entry_invalid")
        canonical_id = raw.get("name")
        source_id = raw.get("sourceId")
        native_name = raw.get("nativeName")
        namespace = raw.get("namespace")
        connection_kind = raw.get("connectionKind")
        input_schema = raw.get("inputSchema")
        if (
            not isinstance(canonical_id, str)
            or not canonical_id
            or not isinstance(source_id, str)
            or not source_id
            or not isinstance(native_name, str)
            or not native_name
            or not isinstance(namespace, str)
            or not namespace
            or not isinstance(connection_kind, str)
            or not connection_kind
            or not isinstance(input_schema, dict)
        ):
            raise IddValidationError("idd_tool_discovery_contract_invalid")
        output_schema = raw.get("outputSchema")
        annotations = raw.get("annotations")
        security_schemes = raw.get("securitySchemes")
        if output_schema is not None and not isinstance(output_schema, dict):
            raise IddValidationError("idd_tool_discovery_output_schema_invalid")
        if annotations is not None and not isinstance(annotations, dict):
            raise IddValidationError("idd_tool_discovery_annotations_invalid")
        if security_schemes is not None and (
            not isinstance(security_schemes, list)
            or not all(isinstance(item, dict) for item in security_schemes)
        ):
            raise IddValidationError("idd_tool_discovery_security_invalid")
        kind = raw.get("kind", "tool")
        if kind not in {"tool", "agent"}:
            raise IddValidationError("idd_tool_discovery_kind_invalid")
        available = raw.get("available", raw.get("enabled", True)) is not False
        contract_key = (canonical_id, source_id, native_name)
        if contract_key in seen_contracts:
            raise IddValidationError("idd_tool_discovery_duplicate")
        seen_contracts.add(contract_key)
        contract: dict[str, Any] = {
            "sourceId": source_id,
            "nativeName": native_name,
            "connectionKind": connection_kind,
            "available": available,
            "description": raw.get("description", ""),
            "inputSchema": deepcopy(input_schema),
        }
        if output_schema is not None:
            contract["outputSchema"] = deepcopy(output_schema)
        if annotations is not None:
            contract["annotations"] = deepcopy(annotations)
        if security_schemes is not None:
            contract["securitySchemes"] = deepcopy(security_schemes)
        reference = references.get(canonical_id)
        if reference is None:
            reference = {
                "canonicalId": canonical_id,
                "kind": kind,
                "namespace": namespace,
                "sourceIds": [],
                "displayName": raw.get("title") or canonical_id,
                "shortDescription": raw.get("description", ""),
                "availability": "disabled",
                "contracts": [],
            }
            references[canonical_id] = reference
        if source_id not in reference["sourceIds"]:
            reference["sourceIds"].append(source_id)
        reference["contracts"].append(contract)
        if available:
            reference["availability"] = "available"
    return [
        deepcopy(validate_record("tool-catalog-reference", references[key]))
        for key in sorted(references)
    ]


def materialize_card_editor(model_options: Any) -> dict[str, Any]:
    """Return the public IDD slice consumed by the existing card editor."""
    document = load_input_data_dictionary()
    metadata = document["dictionary"]
    return {
        "dictionary": {
            "name": metadata["name"],
            "version": metadata["version"],
            "idfFormat": metadata["idfFormat"],
        },
        "fields": deepcopy(document["editorFields"]),
        "catalogs": {
            "configured-models": materialize_catalog("configured-models", model_options),
        },
    }


def _attributes(name: str, raw: str | None, definition: dict[str, Any]) -> dict[str, str]:
    parsed: dict[str, str] = {}
    if raw:
        position = 0
        for match in _ATTRIBUTE.finditer(raw):
            if raw[position:match.start()].strip():
                raise IddValidationError(f"idd_island_attributes_invalid:{name}")
            key = match.group(1)
            if key in parsed:
                raise IddValidationError(f"idd_island_attribute_duplicate:{name}.{key}")
            parsed[key] = match.group(2)
            position = match.end()
        if raw[position:].strip():
            raise IddValidationError(f"idd_island_attributes_invalid:{name}")
    allowed = set(definition.get("allowedAttributes", []))
    required = set(definition.get("requiredAttributes", []))
    if set(parsed) - allowed:
        raise IddValidationError(f"idd_island_attribute_unknown:{name}")
    if required - set(parsed):
        raise IddValidationError(f"idd_island_attribute_required:{name}")
    return parsed


def validate_idf_islands(markdown: str) -> dict[str, list[dict[str, Any]]]:
    """Validate IDD-known bracket islands; ordinary text and unknown tags stay inert."""
    found: dict[str, list[dict[str, Any]]] = {}
    lines = markdown.splitlines()
    index = 0
    while index < len(lines):
        opening = _OPENING_ISLAND.fullmatch(lines[index].strip())
        if opening is None:
            index += 1
            continue
        name, raw_attributes = opening.groups()
        definition = _named_definition("islands", name)
        if definition is None:
            index += 1
            continue
        attributes = _attributes(name, raw_attributes, definition)
        closing = f"[/{name}]"
        index += 1
        content_lines: list[str] = []
        while index < len(lines) and lines[index].strip() != closing:
            content_lines.append(lines[index])
            index += 1
        if index >= len(lines):
            raise IddValidationError(f"idd_island_unclosed:{name}")
        index += 1
        content = "\n".join(content_lines)
        if not content.strip():
            raise IddValidationError(f"idd_island_empty:{name}")
        if definition["language"] == "json":
            try:
                json.loads(content)
            except json.JSONDecodeError as error:
                raise IddValidationError(f"idd_island_json_invalid:{name}") from error
        values = found.setdefault(name, [])
        values.append({"attributes": attributes, "content": content})
        if definition.get("repeatable") is not True and len(values) > 1:
            raise IddValidationError(f"idd_island_duplicate:{name}")
    return found
