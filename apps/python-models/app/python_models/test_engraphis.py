"""Native mechanics in a disposable store; never product acceptance data."""
import asyncio
import time

import pytest

from app.python_models import engraphis as adapter


@pytest.fixture(scope="module")
def native(tmp_path_factory):
    original = adapter.DATABASE
    adapter.DATABASE = tmp_path_factory.mktemp("engraphis") / "memory.sqlite"
    started = time.perf_counter()
    adapter.get_service()
    print(f"\nnative cold initialization: {time.perf_counter() - started:.3f}s")
    yield adapter
    adapter.close_engine()
    adapter.DATABASE = original


def call(native, name, **arguments):
    return asyncio.run(native.invoke_tool("project-one", name, arguments))


def test_service_keeps_native_engraphis_with_automatic_llm_extraction_disabled(native):
    from engraphis.service import MemoryService
    service = native.get_service()
    assert type(service) is MemoryService
    assert service.engine.extractor is None
    assert service.engine.graph_extractor is not None
    assert native.get_service() is service


def test_private_workspace_deletion_requires_confirmation_and_preserves_other_workspace(native):
    saved = call(native, "engraphis_remember", content="Disposable erasure fixture.")
    other = asyncio.run(native.invoke_tool("project-two", "engraphis_remember",
        {"content": "Unrelated workspace fixture."}))
    mid = saved["id"]
    with pytest.raises(ValueError):
        native.private_operation("project-one", "delete_workspace", {})
    with pytest.raises(ValueError):
        native.private_operation("project-one", "delete_workspace", {"confirmed": True, "workspace": "project-two"})
    assert native.inspect("project-one", mid)["memory"]["content"]
    result = native.private_operation("project-one", "delete_workspace", {"confirmed": True})
    assert result["deleted"] is True
    assert result["workspace"] == "project-one"
    with pytest.raises(ValueError):
        native.inspect("project-one", mid)
    scene = native.projection("project-one")
    assert scene["counts"] == {"nodes": 0, "edges": 0}
    assert native.inspect("project-two", other["id"])["memory"]["content"]
    assert "delete_workspace" not in native.WRITE_TOOLS


def test_catalog_matches_both_installed_interfaces_without_added_graph_fields():
    from engraphis.mcp_server import classic_mcp, smart_mcp
    import tomllib
    from pathlib import Path
    async def inspect_catalog():
        original = {t.name: t for t in await smart_mcp.list_tools()}
        original.update({t.name: t for t in await classic_mcp.list_tools()})
        exposed = {t["name"]: t for t in await adapter.native_tools()}
        return original, exposed
    original, exposed = asyncio.run(inspect_catalog())
    assert exposed.keys() == original.keys()
    for name, tool in original.items():
        expected = tool.model_dump(exclude_none=True)
        schema = expected["inputSchema"]
        schema.get("properties", {}).pop("workspace", None)
        if "workspace" in schema.get("required", []):
            schema["required"].remove("workspace")
        schema["additionalProperties"] = False
        if name == "engraphis_recall_context":
            expected["annotations"].update(readOnlyHint=True, idempotentHint=True)
        assert exposed[name] == expected
    with (Path(__file__).resolve().parents[4] / "LiquidAIty.idd").open("rb") as source:
        policies = tomllib.load(source)["operations"]
    declared = {p["id"] for p in policies if p["namespace"] == "engraphis"}
    assert declared == original.keys()
    assert adapter.READ_TOOLS | adapter.WRITE_TOOLS == original.keys()


def test_operation_definitions_can_initialize_inside_an_active_event_loop():
    previous = adapter._OPERATION_DEFINITIONS
    adapter._OPERATION_DEFINITIONS = None

    async def initialize():
        return adapter.operation_definitions()

    try:
        definitions = asyncio.run(initialize())
    finally:
        adapter._OPERATION_DEFINITIONS = previous

    assert {definition.canonical_id for definition in definitions} == (
        adapter.READ_TOOLS | adapter.WRITE_TOOLS
    )


def test_readonly_paraphrase_and_scope(native):
    saved = call(native, "engraphis_remember", content="I enjoy learning how satellites are built and who supplies their components.", title="Satellite suppliers")
    service = native.get_service()
    before = service.store.conn.total_changes
    recalled = call(native, "engraphis_recall_context", query="Who makes spacecraft parts?", k=6, token_budget=600)
    assert saved["id"] in [source["id"] for source in recalled["sources"]]
    assert service.store.conn.total_changes == before
    assert recalled["semantic_support"] is True
    with pytest.raises(ValueError):
        asyncio.run(native.invoke_tool("project-two", "engraphis_get_memory", {"memory_id": saved["id"]}))
    with pytest.raises(ValueError, match="scope_is_owned"):
        call(native, "engraphis_recall_context", query="parts", workspace="project-two")


def test_stats_result_is_engine_output(native):
    expected = native.get_service().stats(workspace="project-one")
    actual = call(native, "engraphis_stats")
    assert actual == expected


def test_inspector_removal_retires_only_selected_memory(native):
    saved = call(native, "engraphis_remember", content="Disposable erasure fixture.")
    with pytest.raises(ValueError):
        native.private_operation("project-two", "retire", {"nativeId": saved["id"]})
    result = native.private_operation("project-one", "retire", {"nativeId": saved["id"]})
    assert result["status"] == "retired"
    recalled = call(native, "engraphis_recall_context", query="Disposable erasure fixture", k=20)
    assert saved["id"] not in [item["id"] for item in recalled["sources"]]
    projected = native.projection("project-one")
    assert all(saved["id"] != evidence["id"] for node in projected["nodes"]
               for evidence in node["properties"]["evidence"])


def test_discovered_read_uses_engine_schema_and_project_binding(native):
    discovered = call(native, "engraphis_discover_actions", task="stats", intent="read", limit=3)
    action = next(item for item in discovered["actions"] if item["canonical_action"] == "stats")
    arguments = {"capability_id": action["capability_id"], "schema_digest": action["schema_digest"], "arguments": {}}
    actual = call(native, "engraphis_execute_read", **arguments)
    expected = native.get_service().stats(workspace="project-one")
    assert actual["result"] == expected
    with pytest.raises(ValueError, match="scope_is_owned_by_project"):
        call(native, "engraphis_execute_read", **{**arguments, "arguments": {"workspace": "project-two"}})
