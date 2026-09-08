import asyncio
import json
from types import SimpleNamespace

import pytest

from app.python_models import constellation, question_evidence
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
    owner = constellation.ConstellationProcess("project-one", database_path=tmp_path / "memory.sqlite")
    monkeypatch.setattr(constellation, "get_constellation", lambda _: owner)
    request = lambda operation, project, arguments: constellation.invoke_constellation_operation(project, operation, arguments)
    calls = []

    class Driver:
        async def execute_query(self, cypher, **params):
            calls.append(params)
            return SimpleNamespace(records=[{"uuid": params["episode_id"]}])

    try:
        constellation.invoke_constellation_operation("project-one", "remember", {
            "id": "question", "l0": "Evidence for alternatives", "l1": "A question, not a verified claim.",
            "l2": "Compare supporting and conflicting evidence before selecting an alternative.", "cognition": question(),
        })
        link = question_evidence.validate_question_evidence(dict(
            questionRef=dict(authority="thinkgraph", nativeId="question", projectId="project-one"),
            outcome="contested", relation="contradicts"), "project-one", request)
        asyncio.run(question_evidence.link_question_evidence(Driver(), link, "episode-actual", "liquidaity-project-one", request))
        asyncio.run(question_evidence.link_question_evidence(Driver(), link, "episode-actual", "liquidaity-project-one", request))
        native = owner.request("inspect", {"nativeId": "question", "maxDepth": 0})
        stored = native["inspectedNode"]["cognition"]
        assert stored["questionStatus"] == "contested"
        assert len(stored["answerRefs"]) == 1
        assert stored["authoredBy"] == "assistant"
        assert stored["originRefs"] == question()["originRefs"]
        assert json.loads(calls[0]["link"])["questionRef"]["nativeId"] == "question"
        projected = constellation._projection("project-one", native)["nodes"][0]
        assert projected["properties"]["summary"] == "A question, not a verified claim."
        assert projected["properties"]["fullContent"].startswith("Compare supporting")
        assert projected["properties"]["researchSeed"]["questionRef"]["nativeId"] == "question"
        # The old write contract remains valid and cannot discard cognition.
        owner.request("remember", {"id": "question", "l0": "Evidence for alternatives", "l1": "A question, not a verified claim.", "l2": "Updated discussion."})
        assert owner.request("inspect", {"nativeId": "question"})["inspectedNode"]["cognition"] == stored
        updated = {**stored, "questionStatus": "superseded"}
        constellation.invoke_constellation_operation("project-one", "update_memory", {"nativeId": "question", "cognition": updated})
        assert owner.request("inspect", {"nativeId": "question"})["inspectedNode"]["cognition"]["questionStatus"] == "superseded"
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


def test_evidence_scope_is_checked_before_question_write(monkeypatch):
    async def query(*args, **kwargs):
        return SimpleNamespace(records=[])
    with pytest.raises(ValueError, match="not_found_in_project"):
        asyncio.run(question_evidence.link_question_evidence(SimpleNamespace(execute_query=query), {
            "questionRef": dict(authority="thinkgraph", nativeId="q", projectId="p"), "outcome": "answered"}, "foreign-episode", "p", lambda *args: pytest.fail("must not write ThinkGraph")))


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
