"""Native mechanics in a disposable store; never product acceptance data."""
import asyncio
import json
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


def test_metadata_update_correction_and_reopen(native):
    cognition = dict(nodeType="Question", memoryCategory="question", authoredBy="user",
                     questionStatus="open", provenance=["conversation:fixture"])
    saved = call(native, "engraphis_remember", content="Can a strong business be overpriced?",
                 title="Business quality and price", summary="An unresolved question.", cognition=cognition)
    mid = saved["id"]
    call(native, "engraphis_update_memory", memory_id=mid, summary="A useful investing distinction.")
    before = native.inspect("project-one", mid)["memory"]
    assert before["summary"] == "A useful investing distinction."
    assert before["metadata"]["cognition"]["authoredBy"] == "user"
    corrected = call(native, "engraphis_correct", memory_id=mid,
                     new_content="I want to separate business quality from the price I pay.", reason="Clarified question")
    successor = native.inspect("project-one", corrected["id"])["memory"]
    assert successor["metadata"]["cognition"] == before["metadata"]["cognition"]
    assert corrected["superseded"] == [mid]
    native.close_engine()
    reopened = native.inspect("project-one", corrected["id"])["memory"]
    assert reopened["metadata"]["cognition"] == before["metadata"]["cognition"]
    assert native.inspect("project-one", mid)["memory"]["content"] == before["content"]


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


def test_declared_recall_arguments_match_readonly_service():
    schemas = {tool["name"]: tool["inputSchema"] for tool in asyncio.run(adapter.native_tools())}
    # The public service does not accept the MCP-only response postprocessor argument.
    assert "max_response_tokens" not in schemas["engraphis_recall_context"]["properties"]
    for schema in schemas.values():
        assert not ({"workspace", "repo", "session_id", "scope"} & schema["properties"].keys())
