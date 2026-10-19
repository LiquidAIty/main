# Entity: MCP Host
# Relationship: This file verifies the public MCP server advertises its exact purpose, stable initialization metadata, and current source-backed catalog identity.
# Entity: Tool Catalog
# Relationship: This file verifies provider tools have human-readable titles and every source-default Card tool belongs to the canonical catalog.

import re
from pathlib import Path

from app import mcp_host, mcp_observability, mcp_provider_operations
from app.python_models.tool_catalog import code_owned_tool_projection
from app.python_models.tool_registry import operation_definition
from mcp.types import Tool


def test_public_server_metadata_is_goal_directed_and_uses_only_advertised_tools():
    assert mcp_host._PUBLIC_MCP_NAME == "LiquidAIty"
    assert mcp_host._PUBLIC_MCP_DESCRIPTION.startswith("Use LiquidAIty when")
    assert "Use only tools advertised for this connection" in mcp_host._PUBLIC_MCP_DESCRIPTION
    assert "main.submit" not in mcp_host._PUBLIC_MCP_DESCRIPTION
    assert "accepted operation is not completed work" in mcp_host._PUBLIC_MCP_DESCRIPTION
    context = operation_definition("main.context")
    assert context is not None
    assert "canonical frozen host catalog" in context.description
    assert "smaller tool list" in context.description
    initialization = mcp_host.server.create_initialization_options().model_dump(
        by_alias=True,
        exclude_none=True,
    )
    assert initialization["capabilities"]["tools"]["listChanged"] is False


def test_source_current_hash_covers_every_code_owned_catalog_owner():
    normalized = {
        path.replace("\\", "/") for path in mcp_observability.CATALOG_SOURCE_PATHS
    }
    assert any(path.endswith("/mcp_host.py") for path in normalized)
    assert any(path.endswith("/mcp_provider_operations.py") for path in normalized)
    assert any(path.endswith("/application_operation_catalog.py") for path in normalized)
    assert any(path.endswith("/agent_canvas_card_operations.py") for path in normalized)
    assert any(path.endswith("/mag_one_operation.py") for path in normalized)
    assert any(path.endswith("/project_graph_operations.py") for path in normalized)
    assert any(path.endswith("/saved_canvas_tools.py") for path in normalized)
    assert any(path.endswith("/saved_card_operation_schema.py") for path in normalized)
    assert any(path.endswith("/saved_card_operation_validation.py") for path in normalized)
    assert any(path.endswith("/python_models/engraphis_operations.py") for path in normalized)
    assert any(path.endswith("/python_models/general_tool_operations.py") for path in normalized)
    assert any(path.endswith("/python_models/graph_reference_contracts.py") for path in normalized)
    assert any(path.endswith("/python_models/market_sec_tool_operations.py") for path in normalized)
    assert any(path.endswith("/python_models/saved_card_contract.py") for path in normalized)
    assert any(path.endswith("/python_models/tool_catalog.py") for path in normalized)
    assert any(path.endswith("/python_models/tool_registry.py") for path in normalized)
    assert any(path.endswith("/python_models/trading_tool_operations.py") for path in normalized)
    assert any(path.endswith("/python_models/worldsignals_tool_operations.py") for path in normalized)
    assert len(mcp_observability.catalog_source_sha256()) == 64


def test_exposed_provider_tools_have_human_readable_titles():
    cbm_tools = [
        Tool(
            name=name,
            description=f"Provider description for {name}.",
            inputSchema={"type": "object", "properties": {}},
        )
        for name in sorted(
            mcp_provider_operations._CARD_CATALOG_PROVIDER_TOOL_NAMES["cbm"]
        )
    ]
    graphiti_tools = [
        Tool(
            name=name,
            description=f"Provider description for {name}.",
            inputSchema={"type": "object", "properties": {}},
        )
        for name in sorted(
            mcp_provider_operations._CARD_CATALOG_PROVIDER_TOOL_NAMES["graphiti"]
        )
    ]

    projected = [
        *mcp_provider_operations.namespace_provider_tools("cbm", cbm_tools),
        *mcp_provider_operations.namespace_provider_tools("graphiti", graphiti_tools),
    ]

    assert projected
    assert all(tool.title and tool.title != tool.name for tool in projected)
    titles = {tool.name: tool.title for tool in projected}
    assert titles["cbm.search_graph"] == "Search CodeGraph structure"
    assert titles["graphiti.search_nodes"] == "Search KnowGraph entities"


def test_source_default_card_tools_are_members_of_the_canonical_catalog():
    repo_root = Path(__file__).resolve().parents[4]
    deck_source = (
        repo_root / "apps" / "backend" / "src" / "decks" / "defaultProjectDeck.ts"
    ).read_text(encoding="utf-8")
    selected: set[str] = set()
    for _name, body in re.findall(
        r"const\s+([A-Z_]+_TOOLS)\s*=\s*\[(.*?)\];",
        deck_source,
        flags=re.DOTALL,
    ):
        selected.update(re.findall(r"['\"]([^'\"]+)['\"]", body))

    catalog_ids = {
        descriptor["canonicalId"] for descriptor in code_owned_tool_projection()
    }
    for provider, names in mcp_provider_operations._CARD_CATALOG_PROVIDER_TOOL_NAMES.items():
        prefix = mcp_provider_operations.PROVIDER_PREFIXES[provider]
        catalog_ids.update(prefix + name for name in names)

    assert selected
    assert selected <= catalog_ids, sorted(selected - catalog_ids)
