"""Focused coverage for the deterministic tool registry primitives."""
import json
from copy import deepcopy

from app.python_models.tool_registry import (
    OperationDefinition,
    ToolCatalogError,
    ToolRegistry,
    build_default_tool_registry,
    graphiti_operation_policy,
    materialize_live_tool_catalog,
    materialize_live_tool_catalog_with_failures,
    operation_catalog_descriptor,
    operation_definition,
    operation_definitions,
    provider_tool_catalog_descriptor,
    replace_discovered_external_operations,
    static_tool_catalog,
    tool_calculator,
    tool_current_datetime,
    validate_live_tool_catalog,
    web_search_tool,
)
from app.python_models.orchestration_contracts import ToolSpec
import pytest


def test_calculator_evaluates_arithmetic():
    assert tool_calculator("2 + 3 * 4") == "14.0"


def test_registry_never_injects_unselected_reads():
    registry = build_default_tool_registry()
    assert registry.resolve_selected([]) == []
    assert [tool.name for tool in registry.resolve_selected(["calculator"])] == ["calculator"]


def test_current_datetime_returns_iso_like_string():
    value = tool_current_datetime()
    assert isinstance(value, str) and len(value) >= 10


def test_web_search_adapter_returns_the_declared_structured_object(monkeypatch):
    async def search(**_arguments):
        return json.dumps({"ok": True, "query": "rk", "result_count": 0, "results": []})

    monkeypatch.setattr("app.python_models.tool_registry.web_search", search)
    result = __import__("asyncio").run(web_search_tool("rk"))
    assert result == {"ok": True, "query": "rk", "result_count": 0, "results": []}
    assert build_default_tool_registry().spec("web_search").outputSchema["type"] == "object"


def test_default_registry_exposes_known_tools():
    registry = build_default_tool_registry()
    names = registry.known_names()
    assert isinstance(names, list)
    assert len(names) >= 1


def test_worldsignals_batch_uses_the_provider_command_contract():
    registry = build_default_tool_registry()
    spec = registry.spec("worldsignals.batch")
    assert spec is not None
    command = spec.inputSchema["properties"]["commands"]["items"]
    assert command["required"] == ["cmd"]
    assert command["properties"] == {
        "cmd": {"type": "string", "minLength": 1},
        "args": {"type": "object"},
    }
    assert command["additionalProperties"] is False


def test_worldsignals_package_exposes_query_only_and_requires_runtime_scope():
    registry = build_default_tool_registry()
    spec = registry.spec("worldsignals.package")
    assert spec is not None
    assert spec.access == "read"
    assert set(spec.inputSchema["properties"]) == {
        "command", "reason", "arguments", "domains", "sourceRefs",
        "maxAgeSeconds", "limit",
    }
    assert spec.inputSchema["required"] == ["command", "reason"]
    assert "projectId" not in spec.inputSchema["properties"]
    with pytest.raises(RuntimeError, match="worldsignals_package_card_context_required"):
        registry._adapters["worldsignals.package"](
            command="get_summary",
            reason="Read one bounded source result.",
        )


def test_duplicate_registry_identity_is_rejected():
    registry = ToolRegistry()
    spec = ToolSpec(
        name="one_tool",
        description="One test tool.",
        enabled=True,
        access="read",
        inputSchema={"type": "object", "properties": {}, "required": []},
        outputSchema={"type": "string"},
    )
    registry.register(spec, lambda: "one")
    with pytest.raises(RuntimeError, match="card_tool_already_registered: one_tool"):
        registry.register(spec, lambda: "two")


def test_catalog_is_definition_backed_with_no_duplicate_entries():
    catalog = static_tool_catalog()
    ids = [item["canonicalId"] for item in catalog]
    assert ids == sorted(set(ids))
    assert "retrieve_knowgraph_context" not in ids
    assert "current_datetime" in ids
    assert "web_search" not in ids


def test_catalog_publishes_one_factual_flat_definition():
    catalog = {entry["canonicalId"]: entry for entry in static_tool_catalog()}
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
    for item in static_tool_catalog():
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
    catalog = static_tool_catalog()
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
    catalog = static_tool_catalog()
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
        item for item in static_tool_catalog()
        if item["canonicalId"] == "calculator"
    ]
    assert len(calculator) == 1
    assert calculator[0]["provider"] == "python_runtime"
    assert calculator[0]["publications"] == ["card-runtime"]


def test_engraphis_is_internal_while_cbm_comes_only_from_live_discovery():
    code_owned_names = [item["canonicalId"] for item in static_tool_catalog()]
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
        "dispatcherOwner": "app.mcp_host._call_cbm",
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
    assert projected["dispatcherOwner"] == "app.mcp_host._call_cbm"
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
        "dispatcherOwner": "app.mcp_host._call_cbm",
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
