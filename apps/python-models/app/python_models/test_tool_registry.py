"""Focused coverage for the deterministic tool registry primitives."""
import json
from copy import deepcopy

from app.python_models.operation_definition import OperationDefinition
from app.python_models.python_tool_definitions import (
    python_operation_definitions,
    tool_calculator,
    tool_current_datetime,
    web_search_tool,
)
from app.python_models.tool_catalog import (
    ToolCatalogError,
    code_owned_tool_projection,
    materialize_live_tool_catalog,
    operation_catalog_descriptor,
    provider_tool_catalog_descriptor,
    validate_live_tool_catalog,
)
from app.python_models.tool_registry import (
    card_tool_selection_is_eligible,
    graphiti_operation_policy,
    operation_definition,
    operation_definitions,
    replace_discovered_external_operations,
)
import pytest


def test_calculator_evaluates_arithmetic():
    assert tool_calculator("2 + 3 * 4") == "14.0"


def test_current_datetime_returns_iso_like_string():
    value = tool_current_datetime()
    assert isinstance(value, str) and len(value) >= 10


def test_card_selection_uses_the_live_definition_availability_and_grant_flag():
    assert card_tool_selection_is_eligible("calculator") is True
    assert card_tool_selection_is_eligible("main.context") is False
    assert card_tool_selection_is_eligible("not_a_real_tool") is False


def test_web_search_adapter_returns_the_declared_structured_object(monkeypatch):
    async def search(**_arguments):
        return json.dumps({"ok": True, "query": "rk", "result_count": 0, "results": []})

    monkeypatch.setattr("app.python_models.python_tool_definitions.web_search", search)
    result = __import__("asyncio").run(web_search_tool("rk"))
    assert result == {"ok": True, "query": "rk", "result_count": 0, "results": []}
    definition = next(
        item for item in python_operation_definitions()
        if item.canonical_id == "web_search"
    )
    assert definition.output_schema["type"] == "object"


def test_worldsignals_batch_uses_the_provider_command_contract():
    definition = next(
        item for item in python_operation_definitions()
        if item.canonical_id == "worldsignals.batch"
    )
    command = definition.parameters_schema["properties"]["commands"]["items"]
    assert command["required"] == ["cmd"]
    assert command["properties"] == {
        "cmd": {"type": "string", "minLength": 1},
        "args": {"type": "object"},
    }
    assert command["additionalProperties"] is False


def test_worldsignals_package_exposes_query_only_and_requires_runtime_scope():
    definition = next(
        item for item in python_operation_definitions()
        if item.canonical_id == "worldsignals.package"
    )
    assert definition.access == "read"
    assert set(definition.parameters_schema["properties"]) == {
        "command", "reason", "arguments", "domains", "sourceRefs",
        "maxAgeSeconds", "limit",
    }
    assert definition.parameters_schema["required"] == ["command", "reason"]
    assert "projectId" not in definition.parameters_schema["properties"]
    with pytest.raises((TypeError, ValueError), match="worldsignals_package_card_context_required|argument"):
        definition.handler(
            command="get_summary",
            reason="Read one bounded source result.",
        )


def test_catalog_is_definition_backed_with_no_duplicate_entries():
    catalog = code_owned_tool_projection()
    ids = [item["canonicalId"] for item in catalog]
    assert ids == sorted(set(ids))
    assert "retrieve_knowgraph_context" not in ids
    assert "current_datetime" in ids
    assert "web_search" not in ids


def test_catalog_publishes_one_factual_flat_definition():
    catalog = {
        entry["canonicalId"]: entry for entry in code_owned_tool_projection()
    }
    calculator = catalog["calculator"]
    assert calculator["provider"] == "python_runtime"
    assert calculator["namespace"] == "python"
    assert calculator["providerToolName"] == "calculator"
    assert calculator["publications"] == ["card-runtime"]
    assert calculator["available"] is True
    assert calculator["inputSchema"]["type"] == "object"
    assert calculator["outputSchema"]
    assert "contracts" not in calculator
    assert "sourceIds" not in calculator


def test_every_code_owned_publisher_contract_has_complete_effect_metadata():
    required_hints = {
        "readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint",
    }
    for item in code_owned_tool_projection():
        assert item["displayName"]
        assert item["description"]
        assert item["inputSchema"]["type"] == "object"
        assert required_hints.issubset(item["annotations"]), item["canonicalId"]
        assert item["annotations"]["readOnlyHint"] is (item["access"] == "read")


def test_live_catalog_preserves_title_security_and_effect_metadata():
    definition = operation_definition("run_mag_one")
    assert definition is not None
    descriptor = operation_catalog_descriptor(definition)
    assert descriptor["displayName"] == "Mag One"
    assert descriptor["description"] == definition.description
    assert descriptor["annotations"] == definition.annotations
    assert descriptor["provider"] == "main_mcp"
    assert descriptor["publications"] == ["card-runtime", "external-mcp"]


def test_authenticated_projection_may_remove_only_declared_server_owned_fields():
    definition = operation_definition("canvas.inspect")
    assert definition is not None
    reference = operation_catalog_descriptor(definition)
    assert "projectId" in reference["canonicalInputSchema"]["properties"]
    assert "projectId" not in reference["inputSchema"]["properties"]
    assert reference["serverInjectedArguments"] == ["deckId", "projectId"]

    malformed = deepcopy(reference)
    malformed["inputSchema"]["properties"]["includeCatalog"]["type"] = "string"
    with pytest.raises(ToolCatalogError, match="tool_catalog_schema_projection_mismatch:canvas.inspect"):
        validate_live_tool_catalog([malformed])


def test_manifest_exposes_no_secrets_endpoints_or_db_config():
    catalog = code_owned_tool_projection()
    blob = json.dumps(catalog).lower()
    for forbidden in ["bolt://", "neo4j_uri", "12434", "services/knowgraph", "bearer "]:
        assert forbidden not in blob

    sensitive_keys: list[str] = []

    def collect_sensitive_keys(value, path: str = ""):
        if isinstance(value, dict):
            for key, child in value.items():
                next_path = f"{path}.{key}" if path else key
                if any(term in key.lower() for term in ("password", "secret", "api_key", "apikey", "bearer")):
                    sensitive_keys.append(next_path)
                collect_sensitive_keys(child, next_path)
        elif isinstance(value, list):
            for index, child in enumerate(value):
                collect_sensitive_keys(child, f"{path}[{index}]")

    collect_sensitive_keys(catalog)
    assert sensitive_keys == []


def test_canonical_operation_ids_and_publisher_views_are_unique_and_permitted():
    definitions = operation_definitions()
    ids = [definition.canonical_id for definition in definitions]
    assert len(ids) == len(set(ids))
    by_id = {definition.canonical_id: definition for definition in definitions}
    catalog = code_owned_tool_projection()
    assert len(catalog) == len({item["canonicalId"] for item in catalog})
    for item in catalog:
        definition = by_id[item["canonicalId"]]
        expected_publications = []
        if definition.publishers & {"internal-plugin", "internal-runtime"}:
            expected_publications.append("card-runtime")
        if "external-mcp" in definition.publishers:
            expected_publications.append("external-mcp")
        assert item["publications"] == expected_publications
        assert item["provider"] == definition.external_source_id
        assert item["providerToolName"] == definition.canonical_id
        assert item["dispatcherOwner"] == definition.dispatcher_owner
        assert item["canonicalInputSchema"] == {
            **definition.parameters_schema,
            "additionalProperties": definition.parameters_schema.get(
                "additionalProperties", False
            ),
        }


def test_calculator_is_one_internal_operation_and_is_not_republished_by_mcp():
    definition = operation_definition("calculator")
    assert definition is not None
    assert definition.publishers == frozenset({"internal-plugin"})
    calculator = [
        item for item in code_owned_tool_projection()
        if item["canonicalId"] == "calculator"
    ]
    assert len(calculator) == 1
    assert calculator[0]["provider"] == "python_runtime"
    assert calculator[0]["publications"] == ["card-runtime"]


def test_forecast_market_bars_has_one_literal_trading_definition():
    definition = operation_definition("forecast_market_bars")
    assert definition is not None
    assert definition.title == "Forecast market bars"
    assert definition.external_source_id == "python_runtime"
    assert definition.namespace == "trading"
    assert definition.dispatcher_owner == (
        "app.python_models.trading_forecast.forecast_market_bars"
    )
    assert definition.publishers == frozenset({"internal-plugin"})
    assert definition.access == "read"
    assert definition.grant_eligible is True
    assert definition.server_injected_arguments == frozenset()
    assert definition.parameters_schema == {
        "type": "object",
        "properties": {
            "symbol": {"type": "string", "minLength": 1},
            "timeframe": {
                "type": "string",
                "pattern": r"^[1-9][0-9]*(Min|Hour|Day|Week|Month)$",
            },
            "start": {"type": ["string", "null"]},
            "end": {"type": ["string", "null"]},
            "history_limit": {
                "type": "integer", "minimum": 16, "maximum": 400,
                "default": 128,
            },
            "horizon": {
                "type": "integer", "minimum": 1, "maximum": 20,
                "default": 5,
            },
        },
        "required": ["symbol", "timeframe"],
        "additionalProperties": False,
    }
    assert definition.annotations == {
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    }


def test_engraphis_is_internal_while_cbm_comes_only_from_live_discovery():
    code_owned_names = [
        item["canonicalId"] for item in code_owned_tool_projection()
    ]
    assert code_owned_names.count("engraphis_recall_context") == 1
    assert code_owned_names.count("engraphis_get_memory") == 1
    assert operation_definition("cbm.unfamiliar_current_tool") is None
    assert operation_definition("graphiti.search_nodes") is None
    assert graphiti_operation_policy("graphiti.search_nodes")["access"] == "read"
    assert "cbm.search_graph" not in code_owned_names
    assert "graphiti.search_nodes" not in code_owned_names

    definition = OperationDefinition(
        canonical_id="cbm.unfamiliar_current_tool",
        description="A tool discovered from the current official CBM server.",
        parameters_schema={"type": "object", "properties": {}},
        handler=lambda **_arguments: None,
        available=True,
        publishers=frozenset({"external-mcp"}),
        access="write",
        namespace="cbm",
        external_source_id="cbm",
    )
    try:
        replace_discovered_external_operations("cbm", [definition])
        discovered = operation_definition("cbm.unfamiliar_current_tool")
        assert discovered is definition
        assert discovered.publishers == frozenset({"external-mcp"})
        assert discovered.external_source_id == "cbm"
    finally:
        replace_discovered_external_operations("cbm", [])


def test_discovered_publisher_contracts_never_mutate_canonical_definitions(monkeypatch):
    definitions = operation_definitions()
    before = tuple(
        (item.canonical_id, item.publishers, id(item.handler)) for item in definitions
    )
    provider = {
        "name": "cbm.search_graph",
        "providerToolName": "search_graph",
        "sourceId": "cbm",
        "namespace": "cbm",
        "connectionKind": "external-mcp",
        "publication": "external-mcp",
        "description": "CBM search.",
        "title": "Search repository structure",
        "access": "read",
        "available": True,
        "grantEligible": True,
        "inputSchema": {"type": "object", "properties": {}},
        "canonicalInputSchema": {"type": "object", "properties": {}},
        "serverInjectedArguments": [],
        "dispatcherContextArguments": [],
        "dispatcherOwner": "app.mcp_provider_operations._call_cbm",
        "authenticatedProjection": True,
        "annotations": {
            "readOnlyHint": True,
            "destructiveHint": False,
            "idempotentHint": True,
            "openWorldHint": False,
        },
    }
    catalog = materialize_live_tool_catalog([provider])
    projected = next(
        item for item in catalog if item["canonicalId"] == "cbm.search_graph"
    )
    assert projected["provider"] == "cbm"
    assert projected["providerToolName"] == "search_graph"
    assert projected["dispatcherOwner"] == (
        "app.mcp_provider_operations._call_cbm"
    )
    after = tuple(
        (item.canonical_id, item.publishers, id(item.handler))
        for item in operation_definitions()
    )
    assert after == before

    from app.python_models import idd

    monkeypatch.setattr(
        idd,
        "load_input_data_dictionary",
        lambda: (_ for _ in ()).throw(AssertionError("runtime_loaded_idd")),
    )
    assert materialize_live_tool_catalog([])


def test_combined_publisher_contracts_have_no_duplicate_discovery_tuple():
    provider = {
        "name": "cbm.search_graph",
        "providerToolName": "search_graph",
        "sourceId": "cbm",
        "namespace": "cbm",
        "connectionKind": "external-mcp",
        "publication": "external-mcp",
        "description": "CBM search.",
        "title": "Search repository structure",
        "access": "read",
        "available": True,
        "grantEligible": True,
        "inputSchema": {"type": "object", "properties": {}},
        "canonicalInputSchema": {"type": "object", "properties": {}},
        "serverInjectedArguments": [],
        "dispatcherContextArguments": [],
        "dispatcherOwner": "app.mcp_provider_operations._call_cbm",
        "authenticatedProjection": True,
        "annotations": {
            "readOnlyHint": True,
            "destructiveHint": False,
            "idempotentHint": True,
            "openWorldHint": False,
        },
    }
    references = materialize_live_tool_catalog([provider])
    tuples = [
        (item["canonicalId"], item["provider"], item["providerToolName"])
        for item in references
    ]
    assert len(tuples) == len(set(tuples))

    with pytest.raises(ToolCatalogError, match="tool_catalog_duplicate_id"):
        validate_live_tool_catalog([
            provider_tool_catalog_descriptor(provider),
            provider_tool_catalog_descriptor(provider),
        ])
