"""Engraphis mechanics in a disposable store; never product acceptance data."""
import asyncio
import time
from types import SimpleNamespace

import pytest

from app.python_models import engraphis as adapter


@pytest.fixture(scope="module")
def engraphis_adapter(tmp_path_factory):
    original = adapter.DATABASE
    adapter.DATABASE = tmp_path_factory.mktemp("engraphis") / "memory.sqlite"
    started = time.perf_counter()
    adapter.get_service()
    print(f"\nEngraphis cold initialization: {time.perf_counter() - started:.3f}s")
    yield adapter
    adapter.close_engine()
    adapter.DATABASE = original


def call(engraphis_adapter, name, **arguments):
    return asyncio.run(engraphis_adapter.invoke_tool("project-one", name, arguments))


def test_service_keeps_engraphis_with_automatic_llm_extraction_disabled(engraphis_adapter):
    from engraphis.service import MemoryService
    service = engraphis_adapter.get_service()
    assert type(service) is MemoryService
    assert service.engine.extractor is None
    assert service.engine.graph_extractor is None
    assert engraphis_adapter.get_service() is service


def test_private_workspace_deletion_requires_confirmation_and_preserves_other_workspace(engraphis_adapter):
    saved = call(engraphis_adapter, "engraphis_remember", content="Disposable erasure fixture.")
    other = asyncio.run(engraphis_adapter.invoke_tool("project-two", "engraphis_remember",
        {"content": "Unrelated workspace fixture."}))
    mid = saved["id"]
    with pytest.raises(ValueError):
        engraphis_adapter.private_operation("project-one", "delete_workspace", {})
    with pytest.raises(ValueError):
        engraphis_adapter.private_operation("project-one", "delete_workspace", {"confirmed": True, "workspace": "project-two"})
    assert engraphis_adapter.inspect(
        "project-one", "engraphisMemoryId", mid,
    )["memory"]["content"]
    result = engraphis_adapter.private_operation("project-one", "delete_workspace", {"confirmed": True})
    assert result["deleted"] is True
    assert result["workspace"] == "project-one"
    with pytest.raises(ValueError):
        engraphis_adapter.inspect("project-one", "engraphisMemoryId", mid)
    scene = engraphis_adapter.projection("project-one")
    assert scene["counts"] == {"nodes": 0, "edges": 0}
    assert engraphis_adapter.inspect(
        "project-two", "engraphisMemoryId", other["id"],
    )["memory"]["content"]
    assert "delete_workspace" not in engraphis_adapter.WRITE_TOOLS


def test_catalog_matches_both_installed_interfaces_without_added_graph_fields():
    from engraphis.mcp_server import classic_mcp, smart_mcp
    import tomllib
    from pathlib import Path
    async def inspect_catalog():
        original = {t.name: t for t in await smart_mcp.list_tools()}
        original.update({t.name: t for t in await classic_mcp.list_tools()})
        exposed = {t["name"]: t for t in await adapter.engraphis_tools()}
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


def test_readonly_paraphrase_and_scope(engraphis_adapter):
    saved = call(engraphis_adapter, "engraphis_remember", content="I enjoy learning how satellites are built and who supplies their components.", title="Satellite suppliers")
    service = engraphis_adapter.get_service()
    before = service.store.conn.total_changes
    recalled = call(engraphis_adapter, "engraphis_recall_context", query="Who makes spacecraft parts?", k=6, token_budget=600)
    assert saved["id"] in [source["id"] for source in recalled["sources"]]
    assert service.store.conn.total_changes == before
    assert recalled["semantic_support"] is True
    with pytest.raises(ValueError):
        asyncio.run(engraphis_adapter.invoke_tool("project-two", "engraphis_get_memory", {"memory_id": saved["id"]}))
    with pytest.raises(ValueError, match="scope_is_owned"):
        call(engraphis_adapter, "engraphis_recall_context", query="parts", workspace="project-two")


def test_stats_result_is_engine_output(engraphis_adapter):
    expected = engraphis_adapter.get_service().stats(workspace="project-one")
    actual = call(engraphis_adapter, "engraphis_stats")
    assert actual == expected


def test_inspector_removal_retires_only_selected_memory(engraphis_adapter):
    saved = call(engraphis_adapter, "engraphis_remember", content="Disposable erasure fixture.")
    with pytest.raises(ValueError):
        engraphis_adapter.private_operation("project-two", "retire", {"memoryId": saved["id"]})
    result = engraphis_adapter.private_operation("project-one", "retire", {"memoryId": saved["id"]})
    assert result["status"] == "retired"
    recalled = call(engraphis_adapter, "engraphis_recall_context", query="Disposable erasure fixture", k=20)
    assert saved["id"] not in [item["id"] for item in recalled["sources"]]
    projected = engraphis_adapter.projection("project-one")
    assert all(saved["id"] != evidence["id"] for node in projected["nodes"]
               for evidence in node["properties"]["evidence"])


def test_discovered_read_uses_engine_schema_and_project_binding(engraphis_adapter):
    discovered = call(engraphis_adapter, "engraphis_discover_actions", task="stats", intent="read", limit=3)
    action = next(item for item in discovered["actions"] if item["canonical_action"] == "stats")
    arguments = {"capability_id": action["capability_id"], "schema_digest": action["schema_digest"], "arguments": {}}
    actual = call(engraphis_adapter, "engraphis_execute_read", **arguments)
    expected = engraphis_adapter.get_service().stats(workspace="project-one")
    assert actual["result"] == expected
    with pytest.raises(ValueError, match="scope_is_owned_by_project"):
        call(engraphis_adapter, "engraphis_execute_read", **{**arguments, "arguments": {"workspace": "project-two"}})


def _focus_request(candidate_count: int = 10) -> dict:
    center_members = [
        {
            "authority": "ThinkGraph",
            "entityId": "center-think",
            "title": "Shared center",
            "description": "The stored Think description.",
        },
        {
            "authority": "KnowGraph",
            "entityId": "center-know",
            "title": "Shared center",
            "description": None,
        },
    ]
    candidates = []
    for index in range(candidate_count):
        authority = "ThinkGraph" if index % 2 == 0 else "KnowGraph"
        center_entity_id = "center-think" if authority == "ThinkGraph" else "center-know"
        visual_id = "visual-paired" if index < 2 else f"visual-{index}"
        entity_id = f"subject-{index}"
        candidates.append({
            "visualId": visual_id,
            "authority": authority,
            "entityId": entity_id,
            "title": f"Subject {index}",
            "description": None if index == 1 else f"Stored engraphis_adapter description {index}.",
            "incidentRelationships": [{
                "edgeId": f"visual-edge-{index}",
                "relationshipId": f"engraphis_adapter-edge-{index}",
                "sourceVisualId": "visual-center",
                "sourceId": center_entity_id,
                "sourceTitle": "Shared center",
                "targetVisualId": visual_id,
                "targetId": entity_id,
                "targetTitle": f"Subject {index}",
                "predicate": "EXPLAINS",
                "direction": "outgoing",
                "relationshipWeight": 0.31 + index / 100,
            }],
        })
    return {
        "schemaVersion": "jev-focus.request.v1",
        "sourceRevision": "combined-projection:17",
        "projectId": "project-one",
        "center": {
            "visualId": "visual-center",
            "title": "Shared center",
            "providerMembers": center_members,
        },
        "candidates": candidates,
    }


def test_focus_jev_makes_one_subject_choice_and_selects_eight_visual_bundles(
    monkeypatch: pytest.MonkeyPatch,
):
    payload = _focus_request()
    choice_ids = [
        adapter._focus_choice_id(candidate["authority"], candidate["entityId"])
        for candidate in payload["candidates"]
    ]
    values = [0.24, 0.01, 0.18, 0.15, 0.12, 0.10, 0.075, 0.075, 0.04, 0.01]
    distribution = dict(zip(choice_ids, values, strict=True))
    calls = []

    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "id": "focus-decision-one",
                "provider": "OpenRouter",
                "model": adapter.JEV_MODEL,
                "answers": {
                    "focus": {
                        "type": "choice",
                        "choice": choice_ids[0],
                        "confidence": 0.61,
                        "probabilities": distribution,
                    },
                },
            }

    class Client:
        def __init__(self, **options):
            assert options == {"timeout": 45.0, "follow_redirects": False}

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def post(self, endpoint, **kwargs):
            calls.append((endpoint, kwargs))
            return Response()

    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(adapter.httpx, "Client", Client)

    decision = adapter.decide_graph_focus(payload)

    assert len(calls) == 1
    assert calls[0][0] == adapter.JEV_ENDPOINT
    body = calls[0][1]["json"]
    assert list(body["questions"]) == ["focus"]
    assert set(body["questions"]["focus"]["criteria"]) == set(choice_ids)
    assert len(body["state"]["connected_subject_options"]) == 10
    assert all(
        "relationshipWeight" not in relationship
        for option in body["state"]["connected_subject_options"]
        for relationship in option["incident_relationships"]
    )
    assert decision["sourceRevision"] == "combined-projection:17"
    assert decision["decisionId"] == "focus-decision-one"
    assert decision["confidence"] == pytest.approx(0.61)
    assert decision["distribution"] == distribution
    assert len(decision["candidates"]) == len(payload["candidates"])
    assert {candidate["rank"] for candidate in decision["candidates"]} == set(range(1, 11))
    assert decision["candidates"][0]["selected"] is True
    assert decision["candidates"][1]["selected"] is True
    assert decision["candidates"][9]["selected"] is False
    assert decision["candidates"][7]["rank"] < decision["candidates"][6]["rank"]
    assert len({
        candidate["visualId"]
        for candidate in decision["candidates"] if candidate["selected"]
    }) == 8
    assert decision["candidates"][0]["incidentRelationships"][0][
        "relationshipWeight"
    ] == pytest.approx(0.31)


def test_focus_jev_rejects_incomplete_or_non_exact_distribution():
    choice_ids = ("focus-one", "focus-two")
    for probabilities in (
        {"focus-one": 1.0},
        {"focus-one": 0.8, "focus-two": 0.3},
    ):
        with pytest.raises(adapter.JevGraphError) as failure:
            adapter._validate_jev_focus_response(
                {
                    "id": "focus-decision",
                    "answers": {
                        "focus": {
                            "type": "choice",
                            "choice": "focus-one",
                            "confidence": 0.5,
                            "probabilities": probabilities,
                        },
                    },
                },
                choice_ids,
            )
        assert failure.value.status == "invalid"
        assert failure.value.error_code == "jev_focus_response_invalid"

    with pytest.raises(adapter.JevGraphError) as missing_id:
        adapter._validate_jev_focus_response(
            {
                "answers": {
                    "focus": {
                        "type": "choice",
                        "choice": "focus-one",
                        "confidence": 0.5,
                        "probabilities": {"focus-one": 0.6, "focus-two": 0.4},
                    },
                },
            },
            choice_ids,
        )
    assert missing_id.value.error_code == "jev_focus_response_invalid"

    with pytest.raises(adapter.JevGraphError) as null_id:
        adapter._validate_jev_focus_response(
            {
                "id": None,
                "answers": {
                    "focus": {
                        "type": "choice",
                        "choice": "focus-one",
                        "confidence": 0.5,
                        "probabilities": {"focus-one": 0.6, "focus-two": 0.4},
                    },
                },
            },
            choice_ids,
        )
    assert null_id.value.error_code == "jev_focus_response_invalid"


def test_focus_jev_reports_unavailable_and_timeout_without_fake_output(
    monkeypatch: pytest.MonkeyPatch,
):
    payload = _focus_request(1)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    with pytest.raises(adapter.JevGraphError) as unavailable:
        adapter.decide_graph_focus(payload)
    assert unavailable.value.status == "unavailable"
    assert unavailable.value.error_code == "jev_focus_openrouter_key_unavailable"

    class Client:
        def __init__(self, **_options):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def post(self, *_args, **_kwargs):
            raise adapter.httpx.ReadTimeout("slow focus decision")

    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(adapter.httpx, "Client", Client)
    with pytest.raises(adapter.JevGraphError) as timeout:
        adapter.decide_graph_focus(payload)
    assert timeout.value.status == "timeout"
    assert timeout.value.error_code == "jev_focus_timeout"


def test_focus_request_rejects_center_candidates_and_nonincident_records():
    payload = _focus_request(1)
    payload["candidates"][0]["entityId"] = "center-think"
    with pytest.raises(adapter.JevGraphError, match="jev_focus_request_invalid"):
        adapter._validated_focus_request(payload)

    payload = _focus_request(1)
    payload["candidates"][0]["incidentRelationships"][0]["sourceVisualId"] = "other"
    with pytest.raises(adapter.JevGraphError, match="jev_focus_request_invalid"):
        adapter._validated_focus_request(payload)


def test_entity_id_projection_uses_only_bounded_direct_neighborhood(
    monkeypatch: pytest.MonkeyPatch,
):
    class Result:
        @staticmethod
        def fetchone():
            return {"id": "workspace-one"}

    class Connection:
        @staticmethod
        def execute(*_args, **_kwargs):
            return Result()

    class Store:
        conn = Connection()

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

    monkeypatch.setattr(adapter, "get_service", lambda: Service())
    monkeypatch.setattr(adapter, "_bounded_graph_snapshot", bounded)
    monkeypatch.setattr(
        adapter,
        "_endpoint_thinks",
        lambda *args, canonical_id, **kwargs: [
            latest(*args, canonical_id=canonical_id, **kwargs),
        ],
    )

    result = adapter.projection("project-one", "center")

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
