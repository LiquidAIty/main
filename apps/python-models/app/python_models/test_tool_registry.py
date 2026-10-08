"""Focused coverage for the deterministic tool registry primitives."""
import json
from copy import deepcopy

from app.python_models.tool_registry import (
    OperationDefinition,
    ToolCatalogError,
    ToolRegistry,
    build_default_tool_registry,
    external_mcp_manifest,
    graphiti_operation_policy,
    operation_definition,
    operation_definitions,
    project_server_injected_schema,
    replace_discovered_external_operations,
    normalize_live_tool_catalog,
    tool_calculator,
    tool_current_datetime,
    tool_manifest,
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


def test_manifest_is_registry_backed_no_duplicate_entries():
    manifest = tool_manifest()
    ids = [m["name"] for m in manifest]
    assert ids == sorted(set(ids))  # one entry per registered tool, deduped
    assert "retrieve_knowgraph_context" not in ids


def test_manifest_publishes_only_factual_private_runtime_contracts():
    manifest = {entry["name"]: entry for entry in tool_manifest()}
    calculator = manifest["calculator"]
    assert calculator["kind"] == "tool"
    assert calculator["sourceId"] == "python_runtime"
    assert calculator["namespace"] == "python"
    assert calculator["providerToolName"] == "calculator"
    assert calculator["connectionKind"] == "private-runtime"
    assert calculator["enabled"] is True
    assert calculator["inputSchema"]["type"] == "object"
    assert calculator["outputSchema"]
    assert "capability" not in calculator
    assert "agentCompatibility" not in calculator


def test_every_code_owned_publisher_contract_has_complete_effect_metadata():
    required_hints = {
        "readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint",
    }
    for item in [*tool_manifest(), *external_mcp_manifest()]:
        assert item["title"]
        assert item["description"]
        assert item["inputSchema"]["type"] == "object"
        assert required_hints.issubset(item["annotations"]), item["name"]
        assert item["annotations"]["readOnlyHint"] is (item["access"] == "read")


def test_live_catalog_preserves_title_security_and_effect_metadata():
    source = next(item for item in external_mcp_manifest() if item["name"] == "run_mag_one")
    source["securitySchemes"] = [{"type": "oauth2", "scopes": ["liquidaity.main"]}]
    reference = next(
        item for item in normalize_live_tool_catalog([source])
        if item["canonicalId"] == "run_mag_one"
    )
    assert reference["displayName"] == "Mag One"
    contract = reference["contracts"][0]
    assert contract["title"] == source["title"]
    assert contract["description"] == source["description"]
    assert contract["inputSchema"] == source["inputSchema"]
    assert contract["annotations"] == source["annotations"]
    assert contract["securitySchemes"] == source["securitySchemes"]


def test_authenticated_projection_may_remove_server_owned_schema_fields_only_per_contract():
    private = next(item for item in tool_manifest() if item["name"] == "canvas.inspect")
    public = next(item for item in external_mcp_manifest() if item["name"] == "canvas.inspect")
    public["inputSchema"] = project_server_injected_schema(
        public["canonicalInputSchema"],
        frozenset(public["serverInjectedArguments"]),
    )
    public["authenticatedProjection"] = True

    reference = normalize_live_tool_catalog([private, public])[0]

    assert reference["canonicalId"] == "canvas.inspect"
    assert len(reference["contracts"]) == 2
    by_kind = {contract["connectionKind"]: contract for contract in reference["contracts"]}
    assert "projectId" in by_kind["private-runtime"]["inputSchema"]["properties"]
    assert "projectId" not in by_kind["external-mcp"]["inputSchema"]["properties"]
    assert by_kind["external-mcp"]["serverInjectedArguments"] == ["deckId", "projectId"]

    malformed = deepcopy(public)
    malformed["inputSchema"]["properties"]["includeCatalog"]["type"] = "string"
    with pytest.raises(ToolCatalogError, match="tool_catalog_schema_projection_mismatch:canvas.inspect"):
        normalize_live_tool_catalog([private, malformed])

    public["description"] = "Drifted operation metadata."
    with pytest.raises(ToolCatalogError, match="tool_catalog_definition_mismatch:canvas.inspect"):
        normalize_live_tool_catalog([private, public])


def test_manifest_exposes_no_secrets_endpoints_or_db_config():
    manifest = tool_manifest()
    blob = json.dumps(manifest).lower()
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

    collect_sensitive_keys(manifest)
    assert sensitive_keys == []


def test_canonical_operation_ids_and_publisher_views_are_unique_and_permitted():
    definitions = operation_definitions()
    ids = [definition.canonical_id for definition in definitions]
    assert len(ids) == len(set(ids))
    by_id = {definition.canonical_id: definition for definition in definitions}
    internal = tool_manifest()
    external = external_mcp_manifest()
    assert len(internal) == len({item["name"] for item in internal})
    assert len(external) == len({item["name"] for item in external})
    assert all("internal-plugin" in by_id[item["name"]].publishers for item in internal)
    assert all(
        "external-mcp" in by_id[item["name"]].publishers
        and by_id[item["name"]].external_source_id == "main_mcp"
        for item in external
    )


def test_calculator_is_one_internal_operation_and_is_not_republished_by_mcp():
    assert sum(item["name"] == "calculator" for item in tool_manifest()) == 1
    assert all(item["name"] != "calculator" for item in external_mcp_manifest())
    definition = operation_definition("calculator")
    assert definition is not None
    assert definition.publishers == frozenset({"internal-plugin"})


def test_engraphis_is_internal_while_cbm_comes_only_from_live_discovery():
    internal_names = [item["name"] for item in tool_manifest()]
    assert internal_names.count("engraphis_recall_context") == 1
    assert internal_names.count("engraphis_get_memory") == 1
    assert operation_definition("cbm.unfamiliar_current_tool") is None
    assert operation_definition("graphiti.search_nodes") is None
    assert graphiti_operation_policy("graphiti.search_nodes")["access"] == "read"
    assert "cbm.search_graph" not in internal_names
    assert "graphiti.search_nodes" not in internal_names

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
    normalize_live_tool_catalog([
        *tool_manifest(),
        *external_mcp_manifest(),
        {
            "name": "cbm.search_graph",
            "providerToolName": "search_graph",
            "sourceId": "cbm",
            "namespace": "cbm",
            "connectionKind": "external-mcp",
            "publication": "external-mcp",
            "description": "CBM search.",
            "title": "Search CodeGraph",
            "access": "read",
            "available": True,
            "grantEligible": True,
            "inputSchema": {"type": "object", "properties": {}},
            "canonicalInputSchema": {"type": "object", "properties": {}},
            "serverInjectedArguments": [],
            "dispatcherContextArguments": [],
            "dispatcherOwner": "app.mcp_host._call_cbm",
            "annotations": {
                "readOnlyHint": True,
                "destructiveHint": False,
                "idempotentHint": True,
                "openWorldHint": False,
            },
        },
    ])
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
    assert normalize_live_tool_catalog(tool_manifest())


def test_combined_publisher_contracts_have_no_duplicate_discovery_tuple():
    references = normalize_live_tool_catalog([*tool_manifest(), *external_mcp_manifest()])
    tuples = [
        (reference["canonicalId"], contract["sourceId"], contract["providerToolName"])
        for reference in references
        for contract in reference["contracts"]
    ]
    assert len(tuples) == len(set(tuples))
