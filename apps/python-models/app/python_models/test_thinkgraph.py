import asyncio
import json

import pytest

from app.python_models import engraphis
from app.python_models.thinkgraph import validate_cognition


def question():
    return dict(nodeType="Question", memoryCategory="question", projectScope="project-one",
                authoredBy="assistant", questionStatus="open", normalizedText="Which evidence distinguishes these alternatives?",
                originRefs=[dict(authority="thinkgraph", nativeId="hypothesis", projectId="project-one")],
                provenance=["conversation:original-user-claim"])


def test_runtime_supplies_scope_without_asking_model_to_reconstruct_identity():
    value = question()
    del value["projectScope"]
    del value["originRefs"][0]["projectId"]
    stored = validate_cognition(value, "project-one")
    assert stored["projectScope"] == stored["originRefs"][0]["projectId"] == "project-one"


def test_legacy_cognition_metadata_remains_readable(tmp_path, monkeypatch):
    from engraphis.service import MemoryService
    from engraphis.mcp_server import set_service
    owner = MemoryService.create(str(tmp_path / "memory.sqlite"), embed_model="hash",
                                 extractor="none", graph_extractor="none")
    monkeypatch.setattr(engraphis, "_service", owner)
    set_service(owner)
    call = lambda name, args: asyncio.run(engraphis.invoke_tool("project-one", name, args))

    try:
        saved = call("engraphis_remember", {
            "title": "Evidence for alternatives",
            "content": "Compare supporting and conflicting evidence before selecting an alternative.",
        })
        native_id = saved["id"]
        # Existing cognition metadata remains readable even though the retired
        # cross-database Question/evidence writer is no longer live.
        legacy_cognition = validate_cognition({
            **question(),
            "questionStatus": "contested",
            "answerRefs": [{
                "authority": "knowgraph",
                "nativeId": "existing-knowgraph-evidence",
                "projectId": "project-one",
            }],
        }, "project-one")
        expected_bytes = json.dumps(
            legacy_cognition,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
        legacy = owner.store.get_memory(native_id)
        legacy.metadata = {"cognition": legacy_cognition}
        owner.store.add_memory(legacy)
        native = engraphis.inspect("project-one", native_id)
        stored = native["memory"]["metadata"]["cognition"]
        assert json.dumps(
            stored, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode() == expected_bytes
        assert stored["questionStatus"] == "contested"
        assert stored["answerRefs"] == [{
            "authority": "knowgraph",
            "nativeId": "existing-knowgraph-evidence",
            "projectId": "project-one",
        }]
        assert stored["authoredBy"] == "assistant"
        assert stored["originRefs"] == question()["originRefs"]
        with pytest.raises(ValueError, match="thinkgraph_operation_unavailable"):
            engraphis.private_operation("project-one", "attach_answer", {
                "nativeId": native_id,
                "evidence": {
                    "authority": "knowgraph",
                    "nativeId": "retired-cross-graph-pointer",
                    "projectId": "project-one",
                },
                "status": "answered",
            })
        after_rejected_write = engraphis.inspect(
            "project-one", native_id
        )["memory"]["metadata"]["cognition"]
        assert json.dumps(
            after_rejected_write,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode() == expected_bytes
        # Ordinary metadata updates cannot discard cognition.
        call("engraphis_update_memory", {"memory_id": native_id, "title": "Evidence for alternatives"})
        after_update = engraphis.inspect(
            "project-one", native_id
        )["memory"]["metadata"]["cognition"]
        assert json.dumps(
            after_update,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode() == expected_bytes
    finally:
        owner.close()


@pytest.mark.parametrize("change,error", [
    ({"questionStatus": "answered"}, "question_evidence_required"),
    ({"projectScope": "other"}, "cross_project_reference_not_authorized"),
    ({"userScope": "user"}, "user_scope_authorization_required"),
    ({"authoredBy": "unknown"}, "literal_error"),
])
def test_structural_contract_does_not_guess_missing_authority(change, error):
    with pytest.raises(ValueError, match=error):
        validate_cognition({**question(), **change}, "project-one")


def test_native_relationship_projection_does_not_invent_strength_or_authorship(tmp_path, monkeypatch):
    from engraphis.service import MemoryService
    from engraphis.mcp_server import set_service
    owner = MemoryService.create(str(tmp_path / "links.sqlite"), embed_model="hash",
                                 extractor="none", graph_extractor="none")
    monkeypatch.setattr(engraphis, "_service", owner)
    set_service(owner)
    call = lambda name, args: asyncio.run(engraphis.invoke_tool("project-one", name, args))
    try:
        a = call("engraphis_remember", {"content": "An interest in spacecraft components"})["id"]
        b = call("engraphis_remember", {"content": "A question about supplier profitability"})["id"]
        call("engraphis_link", {"a": a, "b": b, "relation": "related", "layer": "semantic",
                               "reason": "Supplier research concerns these components."})
        scene = owner.graph_scene(workspace="project-one")
        projected = engraphis.projection("project-one")
        assert [n["id"] for n in projected["nodes"]] == [n["id"] for n in scene["nodes"]]
        assert [e["id"] for e in projected["edges"]] == [e["id"] for e in scene["edges"]]
        for original, visible in zip(scene["nodes"], projected["nodes"]):
            assert all(visible[key] == value for key, value in original.items())
        for original, visible in zip(scene["edges"], projected["edges"]):
            assert all(visible[key] == value for key, value in original.items())
            assert visible["predicate"] == original["relation"]
    finally:
        owner.close()
