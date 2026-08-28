"""Mechanical reader of composable Agent Builder data.

IDD is data, not an authenticator or a second runtime schema. Ordinary Card
execution uses its executable contracts and saved grants, not this palette.
"""
from __future__ import annotations

import json
import tomllib
from copy import deepcopy
from hashlib import sha256
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


def _editor_fields(models: list[dict[str, Any]]) -> list[dict[str, Any]]:
    # Existing Card editor wire shape, derived from executable transport types.
    # Labels/layout live in React; there is no copied UI schema in IDD.
    from app.python_models.orchestration_contracts import (
        AutoGenRuntime, CardConfiguration, HermesRuntime,
    )
    runtime_schemas = [HermesRuntime.model_json_schema(), AutoGenRuntime.model_json_schema()]
    schemas = CardConfiguration.model_json_schema()["properties"]
    fields = []
    for name, schema in schemas.items():
        choices = schema.get("anyOf", [schema])
        concrete = next((item for item in choices if item.get("type") != "null"), schema)
        values = concrete.get("enum", [])
        if name == "runtimeKind":
            values = [item["properties"]["kind"]["const"] for item in runtime_schemas]
        elif name == "runtimeMode":
            values = [value for item in runtime_schemas for value in item["properties"]["mode"]["enum"]]
        elif name == "provider":
            values = sorted({item["provider"] for item in models})
        field = {
            "name": name, "label": schema.get("title", name), "path": name,
            "control": "select" if values else {"number": "number", "integer": "integer"}.get(concrete.get("type"), "text"),
            "allowUnset": name not in {"runtimeKind", "runtimeMode", "accessMode"},
        }
        if values:
            field["options"] = [{"value": value, "label": value} for value in values]
        if name in {"modelKey", "tools"}:
            field.update(control="catalog-select" if name == "modelKey" else "catalog-multiselect",
                         catalog="configured-models" if name == "modelKey" else "native-tools")
        for bound in ("minimum", "maximum"):
            if bound in concrete:
                field[bound] = concrete[bound]
        if concrete.get("type") in {"number", "integer"}:
            field["step"] = 0.1 if concrete["type"] == "number" else 1
        fields.append(field)
    return fields


def materialize_card_editor(
    model_options: Any, *, native_options: Any = None, selected_ids: Any = None,
) -> dict[str, Any]:
    """One builder palette. Native source data enriches IDD without becoming IDD."""
    from app.python_models.orchestration_contracts import ModelOption
    from pydantic import ValidationError
    document = load_input_data_dictionary()
    if not isinstance(model_options, list):
        raise IddValidationError("model_catalog_invalid")
    try:
        models = [ModelOption.model_validate(value).model_dump() for value in model_options]
    except ValidationError as error:
        raise IddValidationError("model_catalog_entry_invalid") from error
    if len({(item["provider"], item["key"]) for item in models}) != len(models):
        raise IddValidationError("model_catalog_identity_duplicate")
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
    return {**palette, "fields": _editor_fields(models),
            "catalogs": {"configured-models": models}}
