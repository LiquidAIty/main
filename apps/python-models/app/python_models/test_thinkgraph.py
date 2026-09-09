import asyncio
import json
from types import SimpleNamespace

import pytest

from app.python_models import engraphis, question_evidence
from app.python_models.thinkgraph import validate_cognition
from app.python_models.thinkgraph_analysis import analyze_graph


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


def test_question_identity_content_evidence_and_legacy_preservation(tmp_path, monkeypatch):
    from engraphis.service import MemoryService
    from engraphis.mcp_server import set_service
    owner = MemoryService.create(str(tmp_path / "memory.sqlite"), embed_model="hash",
                                 extractor="none", graph_extractor="none")
    monkeypatch.setattr(engraphis, "_service", owner)
    set_service(owner)
    request = lambda operation, project, arguments: engraphis.private_operation(project, operation, arguments)
    call = lambda name, args: asyncio.run(engraphis.invoke_tool("project-one", name, args))
    calls = []

    class Driver:
        async def execute_query(self, cypher, **params):
            calls.append(params)
            return SimpleNamespace(records=[{"uuid": params["episode_id"]}])

    try:
        saved = call("engraphis_remember", {
            "title": "Evidence for alternatives",
            "content": "Compare supporting and conflicting evidence before selecting an alternative.",
        })
        native_id = saved["id"]
        # Existing metadata remains readable by the retained evidence-linking
        # contract; it is no longer an added field on Engraphis MCP tools.
        legacy = owner.store.get_memory(native_id)
        legacy.metadata = {"cognition": validate_cognition(question(), "project-one")}
        owner.store.add_memory(legacy)
        link = question_evidence.validate_question_evidence(dict(
            questionRef=dict(authority="thinkgraph", nativeId=native_id, projectId="project-one"),
            outcome="contested", relation="contradicts"), "project-one", request)
        asyncio.run(question_evidence.link_question_evidence(Driver(), link, "episode-actual", "liquidaity-project-one", request))
        asyncio.run(question_evidence.link_question_evidence(Driver(), link, "episode-actual", "liquidaity-project-one", request))
        native = engraphis.inspect("project-one", native_id)
        stored = native["memory"]["metadata"]["cognition"]
        assert stored["questionStatus"] == "contested"
        assert len(stored["answerRefs"]) == 1
        assert stored["authoredBy"] == "assistant"
        assert stored["originRefs"] == question()["originRefs"]
        assert json.loads(calls[0]["link"])["questionRef"]["nativeId"] == native_id
        # Ordinary metadata updates cannot discard cognition.
        call("engraphis_update_memory", {"memory_id": native_id, "title": "Evidence for alternatives"})
        assert engraphis.inspect("project-one", native_id)["memory"]["metadata"]["cognition"] == stored
    finally:
        owner.close()


def test_weighted_communities_gateways_and_gaps_are_analysis_only():
    nodes = list("abcdef") + ["isolated"]
    edges = [[a, b, 1] for a, b in [("a", "b"), ("a", "c"), ("b", "c"), ("d", "e"), ("d", "f"), ("e", "f"), ("c", "d")]]
    encoded = json.dumps({"nodes": nodes, "edges": edges})
    analysis = analyze_graph("revision", encoded)
    assert analysis["nodes"]["c"]["gatewayScore"] > analysis["nodes"]["a"]["gatewayScore"]
    assert analysis["nodes"]["a"]["communityId"] != analysis["nodes"]["f"]["communityId"]
    assert ["isolated"] in analysis["components"]
    assert analysis["gaps"]
    for gap in analysis["gaps"]:
        assert gap["edgeClass"] == "derived"
        assert not any({a, b} == {gap["source"], gap["target"]} for a, b, _ in edges)
    assert json.loads(encoded) == {"nodes": nodes, "edges": edges}
    assert analyze_graph("revision", encoded) is analysis
    assert analyze_graph("empty", '{"nodes":[],"edges":[]}')["communities"] == []


@pytest.mark.parametrize("change,error", [
    ({"questionStatus": "answered"}, "question_evidence_required"),
    ({"projectScope": "other"}, "cross_project_reference_not_authorized"),
    ({"userScope": "user"}, "user_scope_authorization_required"),
    ({"authoredBy": "unknown"}, "literal_error"),
])
def test_structural_contract_does_not_guess_missing_authority(change, error):
    with pytest.raises(ValueError, match=error):
        validate_cognition({**question(), **change}, "project-one")


def test_evidence_scope_is_checked_before_question_write(monkeypatch):
    async def query(*args, **kwargs):
        return SimpleNamespace(records=[])
    with pytest.raises(ValueError, match="not_found_in_project"):
        asyncio.run(question_evidence.link_question_evidence(SimpleNamespace(execute_query=query), {
            "questionRef": dict(authority="thinkgraph", nativeId="q", projectId="p"), "outcome": "answered"}, "foreign-episode", "p", lambda *args: pytest.fail("must not write ThinkGraph")))


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
