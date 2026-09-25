"""Native mechanics in a disposable store; never product acceptance data."""
import asyncio
import time
from types import SimpleNamespace

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


def test_attention_fast_recall_maps_direct_think_incidence_to_canonical_entity():
    class Result:
        def __init__(self, row):
            self.row = row

        def fetchone(self):
            return self.row

    entity_rows = {
        "entity-member": {
            "id": "entity-member",
            "name": "Member name",
            "etype": "person_or_concept",
            "canonical_id": "entity-canonical",
        },
        "entity-canonical": {
            "id": "entity-canonical",
            "name": "Canonical decision",
            "etype": "person_or_concept",
            "canonical_id": None,
        },
    }

    class Connection:
        def execute(self, statement, parameters):
            if statement.startswith("SELECT id FROM workspaces"):
                assert parameters == ("project-one",)
                return Result({"id": "workspace-one"})
            if statement.startswith("SELECT id, name, etype, canonical_id FROM entities"):
                return Result(entity_rows.get(parameters[0]))
            pytest.fail(f"unexpected attention SQL: {statement}")

    def memory(title):
        return SimpleNamespace(
            title=title,
            mtype=adapter.MemoryType.EPISODIC,
            metadata={
                "thinkgraph_origin": {"authority": "thinkgraph"},
                "structured_extraction": {
                    "think": {"kind": "DECISION", "summary": f"{title} summary"},
                },
            },
        )

    class Store:
        conn = Connection()

        def list_memory_entities(self, scoped_filter, *, memory_ids):
            assert scoped_filter.workspace_id == "workspace-one"
            assert memory_ids == ["mem-one", "mem-two"]
            return [
                {
                    "memory_id": "mem-one",
                    "entity_id": "entity-member",
                    "source_kind": "structured_extractor",
                },
                {
                    "memory_id": "mem-one",
                    "entity_id": "entity-canonical",
                    "source_kind": "text_mention",
                },
                {
                    "memory_id": "mem-two",
                    "entity_id": "entity-canonical",
                    "source_kind": "structured_extractor",
                },
            ]

        def get_memories(self, memory_ids):
            assert memory_ids == ["mem-one", "mem-two"]
            return {
                "mem-one": memory("First"),
                "mem-two": memory("Second"),
            }

    class Service:
        store = Store()

        def __init__(self):
            self.recall_arguments = None

        def recall(self, **arguments):
            self.recall_arguments = arguments
            return {
                "semantic_support": True,
                "degraded_mode": False,
                "memories": [
                    {
                        "id": "mem-one",
                        "title": "First",
                        "relative_score": 0.9,
                        "absolute_support": 0.8,
                    },
                    {
                        "id": "mem-two",
                        "title": "Second",
                        "relative_score": 0.7,
                        "absolute_support": 0.6,
                    },
                ],
            }

    service = Service()
    candidates = adapter.recall_thinkgraph_attention_candidates(
        "project-one", "What did we decide?", service=service,
    )

    assert service.recall_arguments == {
        "query": "What did we decide?",
        "workspace": "project-one",
        "mtypes": ["episodic"],
        "k": 8,
        "token_budget": 0,
        "retrieval_profile": "fast",
        "candidate_depth": "fixed",
        "response_mode": "compact",
        "include_untrusted": False,
        "planning": "off",
        "reinforce": False,
        "record_receipt": False,
    }
    assert candidates == [{
        "choiceId": adapter._attention_choice_id(
            "ThinkGraph", "entity-canonical"
        ),
        "authority": "ThinkGraph",
        "nativeId": "entity-canonical",
        "title": "Canonical decision",
        "nodeType": "person_or_concept",
        "recallEvidence": [
            {
                "memoryId": "mem-one",
                "recallRank": 1,
                "relativeScore": 0.9,
                "absoluteSupport": 0.8,
                "memoryTitle": "First",
                "thinkKind": "DECISION",
                "thinkSummary": "First summary",
            },
            {
                "memoryId": "mem-two",
                "recallRank": 2,
                "relativeScore": 0.7,
                "absoluteSupport": 0.6,
                "memoryTitle": "Second",
                "thinkKind": "DECISION",
                "thinkSummary": "Second summary",
            },
        ],
    }]


def test_attention_jev_makes_one_choice_call_and_preserves_rounded_distribution(
    monkeypatch: pytest.MonkeyPatch,
):
    candidates = [
        {
            "choiceId": adapter._attention_choice_id(
                "ThinkGraph" if index < 8 else "KnowGraph", f"entity-{index}"
            ),
            "authority": "ThinkGraph" if index < 8 else "KnowGraph",
            "nativeId": f"entity-{index}",
            "title": f"Entity {index}",
            "nodeType": "Concept",
        }
        for index in range(16)
    ]
    choice_ids = [candidate["choiceId"] for candidate in candidates]
    calls = []

    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "id": "decision-one",
                "provider": "OpenRouter",
                "model": adapter.JEV_MODEL,
                "usage": {"prompt_tokens": 17},
                "answers": {
                    "attention": {
                        "type": "choice",
                        "choice": choice_ids[0],
                        "confidence": 0.73,
                        "probabilities": {
                            choice_id: 0.4 if index == 0 else 0.04
                            for index, choice_id in enumerate(choice_ids)
                        },
                    },
                },
            }

    class Client:
        def __init__(self, **options):
            assert options == {
                "timeout": adapter.MAIN_GRAPH_ATTENTION_TIMEOUT_SECONDS,
                "follow_redirects": False,
            }

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def post(self, endpoint, **kwargs):
            calls.append((endpoint, kwargs))
            return Response()

    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(adapter.httpx, "Client", Client)

    decision = adapter.decide_main_graph_attention("Current message", candidates)

    assert len(calls) == 1
    assert calls[0][0] == adapter.JEV_ENDPOINT
    body = calls[0][1]["json"]
    assert body["model"] == "typesafe/jev-1.13"
    assert list(body["questions"]) == ["attention"]
    assert set(body["questions"]["attention"]["criteria"]) == set(choice_ids)
    assert len(body["state"]["canonical_entity_options"]) == 16
    assert {option["choice_id"] for option in body["state"]["canonical_entity_options"]} == set(choice_ids)
    assert decision["decisionId"] == "decision-one"
    assert decision["confidence"] == pytest.approx(0.73)
    assert set(decision["distribution"]) == set(choice_ids)
    assert sum(decision["distribution"].values()) == pytest.approx(1.0)
    assert adapter.MAIN_GRAPH_ATTENTION_TIMEOUT_SECONDS == pytest.approx(15.0)
    assert adapter.MAIN_GRAPH_ATTENTION_TIMEOUT_SECONDS < 45.0
    assert (
        adapter.MAIN_GRAPH_ATTENTION_TIMEOUT_SECONDS
        < adapter.PYTHON_RAILS_DEFAULT_REQUEST_BUDGET_SECONDS
    )

    with pytest.raises(
        adapter.JevAttentionError, match="jev_attention_response_invalid"
    ) as invalid:
        adapter._validate_jev_attention_response(
            {
                "answers": {
                    "attention": {
                        "type": "choice",
                        "choice": choice_ids[0],
                        "confidence": 0.5,
                        "probabilities": {choice_ids[0]: 1.0},
                    },
                },
            },
            tuple(choice_ids),
        )
    assert invalid.value.status == "invalid"


def test_attention_jev_reports_httpx_timeout_separately(
    monkeypatch: pytest.MonkeyPatch,
):
    candidate = {
        "choiceId": adapter._attention_choice_id("ThinkGraph", "entity-one"),
        "authority": "ThinkGraph",
        "nativeId": "entity-one",
        "title": "Entity one",
    }

    class Client:
        def __init__(self, **_options):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def post(self, *_args, **_kwargs):
            raise adapter.httpx.ReadTimeout("slow decision")

    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(adapter.httpx, "Client", Client)

    with pytest.raises(adapter.JevAttentionError) as failure:
        adapter.decide_main_graph_attention("Current message", [candidate])
    assert failure.value.status == "timeout"
    assert failure.value.error_code == "jev_attention_timeout"


def _focus_request(candidate_count: int = 10) -> dict:
    center_members = [
        {
            "authority": "ThinkGraph",
            "nativeId": "center-think",
            "title": "Shared center",
            "description": "The stored Think description.",
        },
        {
            "authority": "KnowGraph",
            "nativeId": "center-know",
            "title": "Shared center",
            "description": None,
        },
    ]
    candidates = []
    for index in range(candidate_count):
        authority = "ThinkGraph" if index % 2 == 0 else "KnowGraph"
        center_native_id = "center-think" if authority == "ThinkGraph" else "center-know"
        visual_id = "visual-paired" if index < 2 else f"visual-{index}"
        native_id = f"subject-{index}"
        candidates.append({
            "visualId": visual_id,
            "authority": authority,
            "nativeId": native_id,
            "title": f"Subject {index}",
            "description": None if index == 1 else f"Stored native description {index}.",
            "incidentRelationships": [{
                "edgeId": f"visual-edge-{index}",
                "nativeEdgeId": f"native-edge-{index}",
                "sourceVisualId": "visual-center",
                "sourceId": center_native_id,
                "sourceTitle": "Shared center",
                "targetVisualId": visual_id,
                "targetId": native_id,
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
            "nativeMembers": center_members,
        },
        "candidates": candidates,
    }


def test_focus_jev_makes_one_subject_choice_and_selects_eight_visual_bundles(
    monkeypatch: pytest.MonkeyPatch,
):
    payload = _focus_request()
    choice_ids = [
        adapter._focus_choice_id(candidate["authority"], candidate["nativeId"])
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
        with pytest.raises(adapter.JevAttentionError) as failure:
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

    with pytest.raises(adapter.JevAttentionError) as missing_id:
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

    with pytest.raises(adapter.JevAttentionError) as null_id:
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
    with pytest.raises(adapter.JevAttentionError) as unavailable:
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
    with pytest.raises(adapter.JevAttentionError) as timeout:
        adapter.decide_graph_focus(payload)
    assert timeout.value.status == "timeout"
    assert timeout.value.error_code == "jev_focus_timeout"


def test_focus_request_rejects_center_candidates_and_nonincident_records():
    payload = _focus_request(1)
    payload["candidates"][0]["nativeId"] = "center-think"
    with pytest.raises(adapter.JevAttentionError, match="jev_focus_request_invalid"):
        adapter._validated_focus_request(payload)

    payload = _focus_request(1)
    payload["candidates"][0]["incidentRelationships"][0]["sourceVisualId"] = "other"
    with pytest.raises(adapter.JevAttentionError, match="jev_focus_request_invalid"):
        adapter._validated_focus_request(payload)


def test_native_id_projection_uses_only_bounded_direct_neighborhood(
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
            "native_id": canonical_id,
            "memory_id": f"memory-{canonical_id}",
            "kind": "CONCEPT",
            "content": f"Stored Think for {canonical_id}",
            "concepts": [canonical_id],
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
