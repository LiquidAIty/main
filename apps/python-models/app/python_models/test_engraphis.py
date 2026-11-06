"""Engraphis mechanics in a disposable store; never product acceptance data."""

# Graph + less = more: less code that does the same work as more code is more useful.
# Entity names the feature; Relationship explains why this file belongs and what it contributes.
# Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
# Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
# Entity: ThinkGraph
# Relationship: This file exercises Project scoping, Smart operations, retirement, deletion isolation, and bounded Entity projection against a disposable real Engraphis store.
#
# Entity: Tool Catalog
# Relationship: This file verifies published Engraphis operations match the installed Smart interface and preserve explicit effect metadata and Project injection.
#
# Entity: Project Knowledge Graph
# Relationship: This file verifies bounded ThinkGraph projections preserve real provider identities without claiming loaded product acceptance.

import asyncio
import time
import pytest

from app.python_models import engraphis as service_adapter
from app.python_models import engraphis_operations as operations
from app.python_models import thinkgraph_projection as projection_adapter


@pytest.fixture(scope="module")
def engraphis_adapter(tmp_path_factory):
    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(service_adapter, "DATABASE_ROOT", tmp_path_factory.mktemp("engraphis"))
        patch.setattr(service_adapter, "_services", {})
        patch.setattr(service_adapter, "project_principal", lambda project: {
            "id": "fixture-user", "email": "fixture@example.test", "role": "member",
        })
        patch.setattr(operations, "project_principal", service_adapter.project_principal)
        started = time.perf_counter()
        service_adapter.get_service("project-one")
        print(f"\nEngraphis cold initialization: {time.perf_counter() - started:.3f}s")
        try:
            yield service_adapter
        finally:
            service_adapter.close_engine()


def call(engraphis_adapter, name, **arguments):
    return asyncio.run(operations.invoke_tool("project-one", name, arguments))


def test_service_keeps_engraphis_with_automatic_llm_extraction_disabled(engraphis_adapter):
    from engraphis.service import MemoryService
    service = engraphis_adapter.get_service("project-one")
    assert type(service) is MemoryService
    assert service.engine.extractor is None
    assert service.engine.graph_extractor is None
    assert engraphis_adapter.get_service("project-one") is service


def test_private_workspace_deletion_requires_confirmation_and_preserves_other_workspace(engraphis_adapter):
    saved = call(engraphis_adapter, "engraphis_remember", content="Disposable erasure fixture.")
    other = asyncio.run(operations.invoke_tool("project-two", "engraphis_remember",
        {"content": "Unrelated workspace fixture."}))
    mid = saved["id"]
    with pytest.raises(ValueError):
        operations.private_operation("project-one", "delete_workspace", {})
    with pytest.raises(ValueError):
        operations.private_operation("project-one", "delete_workspace", {"confirmed": True, "workspace": "project-two"})
    assert operations.inspect(
        "project-one", "engraphisMemoryId", mid,
    )["memory"]["content"]
    result = operations.private_operation("project-one", "delete_workspace", {"confirmed": True})
    assert result["deleted"] is True
    assert result["workspace"] == "project-one"
    with pytest.raises(ValueError):
        operations.inspect("project-one", "engraphisMemoryId", mid)
    scene = projection_adapter.projection("project-one")
    assert scene["counts"] == {"nodes": 0, "edges": 0}
    assert operations.inspect(
        "project-two", "engraphisMemoryId", other["id"],
    )["memory"]["content"]
    assert "delete_workspace" not in operations.WRITE_TOOLS


def test_catalog_matches_the_installed_smart_interface_without_added_graph_fields():
    from engraphis.mcp_server import smart_mcp

    async def inspect_catalog():
        original = {t.name: t for t in await smart_mcp.list_tools()}
        exposed = {t["name"]: t for t in operations.engraphis_tools_from_registrations()}
        return original, exposed

    original, exposed = asyncio.run(inspect_catalog())
    assert exposed.keys() == original.keys()
    for name, tool in original.items():
        expected = tool.model_dump(by_alias=True, exclude_none=True)
        schema = expected["inputSchema"]
        schema.get("properties", {}).pop("workspace", None)
        if "workspace" in schema.get("required", []):
            schema["required"].remove("workspace")
        schema["additionalProperties"] = False
        assert exposed[name] == expected
    assert operations.READ_TOOLS | operations.WRITE_TOOLS == original.keys()
    assert "engraphis_recall_context" in operations.WRITE_TOOLS
    assert original["engraphis_recall_context"].annotations.model_dump(
        by_alias=True,
    )["readOnlyHint"] is False
    assert "retrieval/accounting receipt" in next(
        definition.description
        for definition in operations.operation_definitions()
        if definition.canonical_id == "engraphis_recall_context"
    )
    assert next(
        definition.description
        for definition in operations.operation_definitions()
        if definition.canonical_id == "engraphis_remember_entities"
    ).startswith("Atomically store one durable memory per exact Entity")


def test_operation_definitions_can_initialize_inside_an_active_event_loop():
    previous = operations.OPERATION_DEFINITIONS
    operations.OPERATION_DEFINITIONS = None

    async def initialize():
        return operations.operation_definitions()

    try:
        definitions = asyncio.run(initialize())
    finally:
        operations.OPERATION_DEFINITIONS = previous

    assert {definition.canonical_id for definition in definitions} == (
        operations.READ_TOOLS | operations.WRITE_TOOLS
    )


def test_recall_paraphrase_scope_and_truthful_receipt_effect(engraphis_adapter):
    saved = call(engraphis_adapter, "engraphis_remember", content="I enjoy learning how satellites are built and who supplies their components.", title="Satellite suppliers")
    service = engraphis_adapter.get_service("project-one")
    before = int(service.store.conn.execute(
        "SELECT COUNT(*) AS n FROM operation_receipts"
    ).fetchone()["n"])
    recalled = call(engraphis_adapter, "engraphis_recall_context", query="Who makes spacecraft parts?", k=6, token_budget=600)
    assert saved["id"] in [source["id"] for source in recalled["sources"]]
    after = int(service.store.conn.execute(
        "SELECT COUNT(*) AS n FROM operation_receipts"
    ).fetchone()["n"])
    assert after > before
    assert recalled["semantic_support"] is True
    with pytest.raises(ValueError):
        asyncio.run(operations.invoke_tool("project-two", "engraphis_get_memory", {"memory_id": saved["id"]}))
    with pytest.raises(ValueError, match="scope_is_owned"):
        call(engraphis_adapter, "engraphis_recall_context", query="parts", workspace="project-two")


def test_stats_result_is_engine_output(engraphis_adapter):
    expected = engraphis_adapter.get_service("project-one").stats(workspace="project-one")
    discovered = call(
        engraphis_adapter,
        "engraphis_discover_actions",
        task="statistics",
        category="",
        intent="read",
        limit=3,
    )
    stats = next(
        action for action in discovered["actions"]
        if action["canonical_action"] == "stats"
    )
    actual = call(
        engraphis_adapter,
        "engraphis_execute_read",
        capability_id=stats["capability_id"],
        schema_digest=stats["schema_digest"],
        arguments={},
    )
    assert actual["canonical_action"] == "stats"
    assert actual["result"] == expected


def test_inspector_removal_retires_only_selected_memory(engraphis_adapter):
    saved = call(engraphis_adapter, "engraphis_remember", content="Disposable erasure fixture.")
    with pytest.raises(ValueError):
        operations.private_operation("project-two", "retire", {"memoryId": saved["id"]})
    result = operations.private_operation("project-one", "retire", {"memoryId": saved["id"]})
    assert result["status"] == "retired"
    recalled = call(engraphis_adapter, "engraphis_recall_context", query="Disposable erasure fixture", k=20)
    assert saved["id"] not in [item["id"] for item in recalled["sources"]]
    projected = projection_adapter.projection("project-one")
    assert all(saved["id"] != evidence["id"] for node in projected["nodes"]
               for evidence in node["properties"]["evidence"])


def test_inspector_removal_retires_only_selected_relationship(engraphis_adapter):
    from engraphis.core.interfaces import Edge, Node

    service = engraphis_adapter.get_service("project-one")
    workspace_id = service.store.get_or_create_workspace("project-edge-remove")
    source = service.store.upsert_entity(Node(
        id="", name="Source", ntype="person_or_concept", workspace_id=workspace_id,
    ))
    target = service.store.upsert_entity(Node(
        id="", name="Target", ntype="person_or_concept", workspace_id=workspace_id,
    ))
    edge_id = service.store.upsert_edge(Edge(
        id="",
        src=source,
        dst=target,
        relation="SUPPORTS",
        workspace_id=workspace_id,
    ))

    result = operations.private_operation(
        "project-edge-remove", "retire_relationship", {"edgeId": edge_id},
    )

    assert result == {"ok": True, "edgeId": edge_id, "operation": "retire"}
    row = service.store.conn.execute(
        "SELECT valid_to FROM edges WHERE id=?", (edge_id,),
    ).fetchone()
    assert row["valid_to"] is not None
    with pytest.raises(ValueError, match="engraphis_relationship_not_found"):
        operations.private_operation(
            "project-one", "retire_relationship", {"edgeId": edge_id},
        )


def test_discovered_read_uses_engine_schema_and_project_binding(engraphis_adapter):
    discovered = call(engraphis_adapter, "engraphis_discover_actions", task="stats", intent="read", limit=3)
    action = next(item for item in discovered["actions"] if item["canonical_action"] == "stats")
    arguments = {"capability_id": action["capability_id"], "schema_digest": action["schema_digest"], "arguments": {}}
    actual = call(engraphis_adapter, "engraphis_execute_read", **arguments)
    expected = engraphis_adapter.get_service("project-one").stats(workspace="project-one")
    assert actual["result"] == expected
    with pytest.raises(ValueError, match="scope_is_owned_by_project"):
        call(engraphis_adapter, "engraphis_execute_read", **{**arguments, "arguments": {"workspace": "project-two"}})


def test_entity_id_projection_uses_only_bounded_direct_neighborhood(
    monkeypatch: pytest.MonkeyPatch,
):
    class Result:
        @staticmethod
        def fetchone():
            return {"id": "workspace-one"}

        @staticmethod
        def fetchall():
            return []

    class Connection:
        @staticmethod
        def execute(*_args, **_kwargs):
            return Result()

    class Store:
        conn = Connection()

        @staticmethod
        def list_memory_entities(*_args, **_kwargs):
            return []

    class Service:
        store = Store()

        @staticmethod
        def graph_scene(**_kwargs):
            raise AssertionError("bounded projection must not read the complete scene")

        @staticmethod
        def stats(**_kwargs):
            return {"embedding": {"ready": True}}

    nodes = [{
        "id": "center" if index == 0 else f"neighbor-{index:02d}",
        "name": "Center" if index == 0 else f"Neighbor {index}",
        "type": "Concept",
        "canonical_id": "center" if index == 0 else f"neighbor-{index:02d}",
        "focus": index == 0,
    } for index in range(25)]
    edges = [{
        "id": f"edge-{index:02d}",
        "source_id": "center",
        "source_name": "Center",
        "target_id": f"neighbor-{index:02d}",
        "target_name": f"Neighbor {index}",
        "relation": "EXPLAINS",
        "relationship_strength": 0.5,
        "label_confidence": 0.5,
        "distribution": {"EXPLAINS": 0.5, "QUALIFIES": 0.5},
    } for index in range(1, 25)]
    bounded_calls = []

    def bounded(*_args, **kwargs):
        bounded_calls.append(kwargs)
        return {
            "nodes": nodes,
            "incident_edges": edges,
            "truncated": False,
            "incomplete": True,
            "limits": {"edge_source_limit_hit": True},
        }

    def latest(*_args, canonical_id, **_kwargs):
        return {
            "entity_id": canonical_id,
            "memory_id": f"memory-{canonical_id}",
            "title": f"Stored Think {canonical_id}",
            "content": f"Stored Think for {canonical_id}",
            "summary": f"Stored Think for {canonical_id}",
            "relations": [],
            "ingested_at": 1.0,
            "valid_from": 1.0,
            "valid_to": None,
        }

    monkeypatch.setattr(projection_adapter, "get_service", lambda _project: Service())
    monkeypatch.setattr(projection_adapter, "bounded_graph_snapshot", bounded)
    monkeypatch.setattr(
        projection_adapter,
        "endpoint_thinks",
        lambda *args, canonical_id, **kwargs: [
            latest(*args, canonical_id=canonical_id, **kwargs),
        ],
    )

    result = projection_adapter.projection("project-one", "center")

    assert len(bounded_calls) == 1
    assert bounded_calls[0]["entity_ids"] == ["center"]
    assert bounded_calls[0]["edge_limit"] == 24
    assert bounded_calls[0]["think_limit"] == 0
    assert result["counts"] == {"nodes": 25, "edges": 24}
    assert sum(
        bool(node["properties"]["evidence"]) for node in result["nodes"]
    ) == 24
    assert result["truncated"] is True
    assert result["incomplete"] is True
    assert result["bounds"]["edgeSourceLimitHit"] is True
    assert result["bounds"]["neighborLimit"] == 24
