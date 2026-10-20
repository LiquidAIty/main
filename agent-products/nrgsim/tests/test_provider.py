# Entity: OpenStudio Connection Verification
# Relationship: These tests verify unchanged native names/schemas and refusal of unauthenticated human requests.
from pathlib import Path
import sys
import unittest
from unittest.mock import AsyncMock, patch

# tests/ -> nrgsim/ -> agent-products/ -> repo
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "apps" / "python-models"))
from app import mcp_openstudio_provider as provider
from app import mcp_provider_operations
from app.python_models.tool_catalog import materialize_live_tool_catalog
from app.python_models.card_invocation_tools import resolve_effective_card_tools
from mcp.types import Tool


class ProviderTests(unittest.IsolatedAsyncioTestCase):
    def test_unavailable_openstudio_does_not_block_non_modeling_cards(self):
        config, presented, _, _ = resolve_effective_card_tools(
            {"unavailableToolCatalogFamilies": ["openstudio"], "discoveredTools": []},
            options={}, runtime={"kind": "hermes", "profile": "other"},
            ceiling=["calculator"], call_config={}, runtime_options={},
        )
        self.assertEqual(presented, ["calculator"])
        self.assertEqual(config["unavailableTools"], [])

    def test_native_tool_identity_and_schema_preserved(self):
        schema = {"type": "object", "properties": {"num_floors": {"type": "integer", "default": 2}}}
        tool = Tool(name="create_baseline_osm", description="Upstream description.", inputSchema=schema)
        with patch.object(provider, "replace_discovered_external_operations") as register:
            projected = provider.register_tools([tool])
        self.assertEqual(projected[0].name, tool.name)
        self.assertEqual(projected[0].input_schema, schema)
        self.assertEqual(projected[0].description, tool.description)
        definition = register.call_args.args[1][0]
        self.assertEqual(definition.dispatcher_context_arguments, frozenset({"_authenticatedProjectId"}))
        self.assertNotIn("_authenticatedProjectId", definition.parameters_schema["properties"])
        self.assertEqual(definition.external_source_id, "openstudio")
        with patch.object(mcp_provider_operations, "operation_definition", return_value=definition):
            published = mcp_provider_operations.bind_operation_access(projected[0]).model_dump(
                by_alias=True, exclude_none=True)
        raw = {**published, **published["_meta"]["liquidaitySource"]}
        selectable = materialize_live_tool_catalog([raw])
        entry = next(item for item in selectable if item["canonicalId"] == tool.name)
        self.assertEqual(entry["providerToolName"], tool.name)
        self.assertEqual(entry["provider"], "openstudio")
        self.assertEqual(entry["inputSchema"], schema)

    async def test_human_route_refuses_missing_process_authority(self):
        class Request:
            headers = {}
        with patch.dict(provider.os.environ, {"LIQUIDAITY_INTERNAL_MCP_SECRET": "x" * 64}):
            reply = await provider.human_endpoint(Request())
        self.assertEqual(reply.status_code, 403)

    async def test_empty_model_never_serves_previous_geometry(self):
        class Request:
            headers = {"x-liquidaity-internal-mcp-secret": "x" * 64}
            path_params = {"project_id": "4316df04-67de-43b4-94f2-b84fcd789801", "action": "display"}
            method = "GET"
        project = AsyncMock()
        project.view.return_value = {"projection": {"selectableHandles": []}}
        with patch.dict(provider.os.environ, {"LIQUIDAITY_INTERNAL_MCP_SECRET": "x" * 64}):
            with patch.object(provider, "session", return_value=project):
                reply = await provider.human_endpoint(Request())
        self.assertEqual(reply.status_code, 409)


if __name__ == "__main__":
    unittest.main()
