"""Mechanical reader of composable Agent Builder data.

IDD is data, not an authenticator or a second runtime schema. Ordinary Card
execution uses its executable contracts and saved grants, not this palette.
"""
from __future__ import annotations

import json
import tomllib
from copy import deepcopy
from hashlib import sha256
from importlib import import_module
from pathlib import Path
from typing import Any

IDD_PATH = Path(__file__).resolve().parents[4] / "LiquidAIty.idd"


class IddValidationError(ValueError):
    """Secret-safe structural error in builder data or native projections."""


def load_input_data_dictionary() -> dict[str, Any]:
    try:
        with IDD_PATH.open("rb") as source:
            document = tomllib.load(source)
    except (OSError, tomllib.TOMLDecodeError) as error:
        raise IddValidationError("idd_load_failed") from error
    if document.get("dictionary", {}).get("name") != "LiquidAIty":
        raise IddValidationError("idd_metadata_invalid")
    for name in ("types", "objects", "templates"):
        if not isinstance(document.get(name), dict):
            raise IddValidationError("idd_builder_declarations_invalid")
    for definition in document["objects"].values():
        if (definition.get("type") not in document["types"]
                or definition.get("cardinality") not in {"required", "optional", "repeatable"}):
            raise IddValidationError("idd_object_type_or_cardinality_invalid")
    for template in document["templates"]:
        template_objects(document, template)
    return document


def template_objects(document: dict[str, Any], template_id: str) -> list[str]:
    """Compose explicit template inheritance; no role/name-based routing."""
    result: list[str] = []
    visited: set[str] = set()

    def collect(identity: str) -> None:
        if identity in visited:
            raise IddValidationError("idd_template_cycle")
        definition = document["templates"].get(identity)
        if not isinstance(definition, dict):
            raise IddValidationError("idd_template_unknown")
        visited.add(identity)
        if definition.get("extends"):
            collect(definition["extends"])
        values = definition.get("objects", [])
        if not isinstance(values, list):
            raise IddValidationError("idd_template_objects_invalid")
        for object_id in values:
            if object_id not in document["objects"]:
                raise IddValidationError("idd_template_object_unknown")
            if object_id not in result:
                result.append(object_id)
        visited.remove(identity)

    collect(template_id)
    return result


def builder_fingerprint(value: Any) -> str:
    """Cache invalidation only. Never a permission, input authority or checksum gate."""
    return sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                             separators=(",", ":")).encode("utf-8")).hexdigest()


def template_runtime(document: dict[str, Any], template_id: str) -> dict[str, str]:
    """Resolve the creation binding declared by a template or its base."""
    template_objects(document, template_id)
    definition = document["templates"][template_id]
    if "runtime" in definition:
        binding = definition["runtime"]
        if (not isinstance(binding, dict) or set(binding) != {"kind", "mode"}
                or not all(isinstance(value, str) and value for value in binding.values())):
            raise IddValidationError("idd_template_runtime_invalid")
        return dict(binding)
    if definition.get("extends"):
        return template_runtime(document, definition["extends"])
    raise IddValidationError("idd_template_runtime_missing")


def _editor_fields(models: list[dict[str, Any]], document: dict[str, Any]) -> list[dict[str, Any]]:
    """Resolve the checked-in field definitions against their executable owners."""
    editor = document.get("cardEditor", {})
    schemas = {}
    for key, qualified_name in editor.get("schemas", {}).items():
        module_name, type_name = qualified_name.rsplit(".", 1)
        schemas[key] = getattr(import_module(module_name), type_name).model_json_schema()
    fields = []
    seen = set()
    for definition in editor.get("fields", []):
        name = definition["name"]
        if name in seen:
            raise IddValidationError("idd_editor_field_duplicate")
        seen.add(name)
        sources = definition.get("sources", [definition.get("source")])
        resolved = []
        for reference in sources:
            owner, property_name = reference.split(".", 1)
            try:
                resolved.append((schemas[owner], schemas[owner]["properties"][property_name]))
            except KeyError as error:
                raise IddValidationError("idd_editor_source_unknown") from error
        schema = resolved[0][1]
        choices = schema.get("anyOf", [schema])
        concrete = next((item for item in choices if item.get("type") != "null"), schema)
        options = []
        for owner_schema, property_schema in resolved:
            alternatives = property_schema.get("anyOf", [property_schema])
            value_schema = next((item for item in alternatives if item.get("type") != "null"), property_schema)
            values = value_schema.get("enum", [value_schema["const"]] if "const" in value_schema else [])
            for value in values:
                if value in definition.get("exclude", []):
                    continue
                option = {"value": value, "label": value}
                if definition.get("filteredBy") == "runtimeKind":
                    option["when"] = {"runtimeKind": owner_schema["properties"]["kind"]["const"]}
                options.append(option)
        if definition.get("catalogProperty"):
            # The transport supplies current catalog values, never an IDD copy.
            values = sorted({item[definition["catalogProperty"]] for item in models})
            options = [{"value": value, "label": value} for value in values]
        field = {
            **{key: deepcopy(value) for key, value in definition.items()
               if key not in {"source", "sources", "exclude", "catalogProperty"}},
            "control": definition.get("control") or ("select" if options else
                {"number": "number", "integer": "integer"}.get(concrete.get("type"), "text")),
            "allowUnset": definition.get("allowUnset", True),
            "valueSchema": deepcopy(schema),
        }
        definitions = resolved[0][0].get("$defs", {})
        required_definitions = {}

        def include_references(value: Any) -> None:
            if isinstance(value, list):
                for child in value:
                    include_references(child)
            elif isinstance(value, dict):
                reference = value.get("$ref", "")
                if reference.startswith("#/$defs/"):
                    key = reference.removeprefix("#/$defs/")
                    if key not in required_definitions:
                        if key not in definitions:
                            raise IddValidationError("idd_editor_reference_unknown")
                        required_definitions[key] = deepcopy(definitions[key])
                        include_references(definitions[key])
                for child in value.values():
                    include_references(child)

        include_references(schema)
        if required_definitions:
            field["valueSchema"]["$defs"] = required_definitions
        if options:
            field["options"] = options
        for bound in ("minimum", "maximum"):
            if bound in concrete:
                field[bound] = concrete[bound]
        fields.append(field)
    if not fields:
        raise IddValidationError("idd_editor_fields_missing")
    return fields


def materialize_runtime_options(model_options: Any, *, document: dict[str, Any] | None = None) -> dict[str, Any]:
    """The human editor receives only the resolved configuration slice of IDD."""
    from app.python_models.orchestration_contracts import ModelOption
    from pydantic import ValidationError
    if not isinstance(model_options, list):
        raise IddValidationError("model_catalog_invalid")
    try:
        models = [ModelOption.model_validate(value).model_dump() for value in model_options]
    except ValidationError as error:
        raise IddValidationError("model_catalog_entry_invalid") from error
    if len({(item["provider"], item["key"]) for item in models}) != len(models):
        raise IddValidationError("model_catalog_identity_duplicate")
    return {"fields": _editor_fields(models, document or load_input_data_dictionary()),
            "catalogs": {"configured-models": models}}


def materialize_card_editor(
    model_options: Any, *, native_options: Any = None, selected_ids: Any = None,
) -> dict[str, Any]:
    """One builder palette. Native source data enriches IDD without becoming IDD."""
    document = load_input_data_dictionary()
    runtime_options = materialize_runtime_options(model_options, document=document)
    models = runtime_options["catalogs"]["configured-models"]
    selected = set(selected_ids or [])
    if not all(isinstance(value, str) for value in selected):
        raise IddValidationError("builder_selection_invalid")
    options: dict[str, dict[str, Any]] = {}

    def add(identity: str, kind: str, owner: str, source: str, schema: dict[str, Any],
            available: bool = True, diagnostics: list[str] | None = None) -> None:
        if identity in options:
            raise IddValidationError("builder_option_identity_duplicate")
        options[identity] = {
            "id": identity, "kind": kind, "owner": owner, "source": source,
            "availability": "available" if available else "unavailable",
            "selected": identity in selected, "effective": False,
            "schema": deepcopy(schema), "diagnostics": diagnostics or [],
        }

    for identity, definition in document["templates"].items():
        add(identity, "template", "LiquidAIty", "LiquidAIty.idd", definition)
    for model in models:
        add("model:" + model["provider"] + ":" + model["key"], "model",
            "configured-models", "configured-models", model)
    if native_options is not None and not isinstance(native_options, list):
        raise IddValidationError("builder_native_options_invalid")
    for native in native_options or []:
        if (not isinstance(native, dict)
                or any(not isinstance(native.get(key), str) or not native[key]
                       for key in ("id", "kind", "owner", "source"))
                or not isinstance(native.get("schema", {}), dict)):
            raise IddValidationError("builder_native_option_invalid")
        available = native.get("available", True) is True
        diagnostics = []
        if native["kind"] == "tool" and native.get("schema", {}).get("type") != "object":
            diagnostics.append("native_input_schema_unavailable")
        # Unclassified host effects remain visible but cannot become capabilities.
        if native["owner"] == "LiquidAIty" and native["kind"] == "tool":
            policy = next((item for item in document["operations"] if item["id"] == native["id"]), None)
            if policy is None:
                available = False
                diagnostics.append("liquidaity_effect_unclassified")
        add(native["id"], native["kind"], native["owner"], native["source"],
            native.get("schema", {}), available, diagnostics)
    for identity in sorted(selected - options.keys()):
        add(identity, "unresolved", "unknown", "saved-card", {}, False, ["saved_selection_stale"])
    palette = {
        "dictionary": document["dictionary"],
        "types": document["types"], "objects": document["objects"],
        "templates": document["templates"], "relationships": document["relationships"],
        "operations": document["operations"],
        "options": [options[key] for key in sorted(options)],
    }
    # Selection is not source freshness and never implies effective authorization.
    palette["fingerprint"] = builder_fingerprint({
        "idd": document, "models": models, "native": native_options or [],
    })
    return {**palette, **runtime_options}
