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


def test_attention_jev_makes_one_choice_call_and_normalizes_full_distribution(
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
                        "probabilities": {
                            choice_id: (0.2 if index == 0 else 0.05)
                            for index, choice_id in enumerate(choice_ids)
                        },
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

    decision = adapter.decide_main_graph_attention("Current message", candidates)

    assert len(calls) == 1
    assert calls[0][0] == adapter.JEV_ENDPOINT
    body = calls[0][1]["json"]
    assert body["model"] == "typesafe/jev-1.13"
    assert list(body["questions"]) == ["attention"]
    assert set(body["questions"]["attention"]["criteria"]) == set(choice_ids)
    assert len(body["state"]["canonical_entity_options"]) == 16
    assert decision["decisionId"] == "decision-one"
    assert set(decision["distribution"]) == set(choice_ids)
    assert sum(decision["distribution"].values()) == pytest.approx(1.0)

    with pytest.raises(
        adapter.JevAttentionError, match="jev_attention_response_invalid"
    ) as invalid:
        adapter._validate_jev_attention_response(
            {
                "answers": {
                    "attention": {
                        "type": "choice",
                        "choice": choice_ids[0],
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
