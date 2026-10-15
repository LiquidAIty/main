from __future__ import annotations

from app.python_models import project_graph_relevance as relevance


def _think(identifier: str) -> dict:
    return {
        "engraphisMemoryId": identifier,
        "engraphisEntityId": f"entity-{identifier}",
        "body": f"Think body {identifier}",
        "ingestedAt": identifier,
    }


def _know(identifier: str) -> dict:
    return {
        "graphitiEpisodeId": identifier,
        "graphitiEntityId": f"entity-{identifier}",
        "idea": {
            "body": f"For body {identifier}",
            "citations": [{"url": f"https://example.test/for/{identifier}"}],
        },
        "counterIdea": {
            "body": f"Against body {identifier}",
            "citations": [{"url": f"https://example.test/against/{identifier}"}],
        },
        "ingestedAt": identifier,
    }


def test_grounding_keeps_one_most_relevant_and_one_distinct_recent_per_authority() -> None:
    def think_retriever(_project: str, _query: str, _limit: int):
        return [_think("recent-think")], [
            _think("recent-think"), _think("think-a"), _think("think-b"), _think("think-c"),
        ], {"retrieval": "engraphis_provider"}

    def know_retriever(_project: str, _query: str, _limit: int):
        return [_know("recent-know")], [
            _know("recent-know"), _know("know-a"), _know("know-b"), _know("know-c"),
        ], {"retrieval": "graphiti_provider_entity_search"}

    def rate(_query: str, _context: str, candidates: dict, limit: int):
        assert limit == 1
        assert [item["engraphisMemoryId"] for item in candidates["thinkgraph"]] == [
            "think-a", "think-b", "think-c",
        ]
        assert [item["graphitiEpisodeId"] for item in candidates["knowgraph"]] == [
            "know-a", "know-b", "know-c",
        ]
        return {
            "thinkgraph": {
                "status": "success", "decisionId": "decision-one", "confidence": 0.9,
                "records": [
                    {**_think("think-b"), "relevance": 0.6, "relevanceRank": 1},
                ],
            },
            "knowgraph": {
                "status": "success", "decisionId": "decision-one", "confidence": 0.9,
                "records": [
                    {**_know("know-c"), "relevance": 0.7, "relevanceRank": 1},
                ],
            },
        }

    packet = relevance.build_project_graph_grounding(
        "project-one",
        "current user request",
        context="bounded conversation",
        think_retriever=think_retriever,
        know_retriever=know_retriever,
        relevance_rater=rate,
    )

    assert packet["schemaVersion"] == "project-graph.grounding.v1"
    assert packet["authorities"]["thinkgraph"]["recent"][0]["engraphisMemoryId"] == (
        "recent-think"
    )
    assert [
        item["engraphisMemoryId"]
        for item in packet["authorities"]["thinkgraph"]["relevant"]
    ] == ["think-b"]
    assert [
        item["graphitiEpisodeId"]
        for item in packet["authorities"]["knowgraph"]["relevant"]
    ] == ["know-c"]
    assert packet["authorities"]["thinkgraph"]["provider"] == {
        "retrieval": "engraphis_provider",
    }
    assert packet["authorities"]["knowgraph"]["provider"] == {
        "retrieval": "graphiti_provider_entity_search",
    }
    assert packet["revision"]

    context = relevance.append_project_graph_grounding("base", packet)
    assert context.count("PROJECT GRAPH GROUNDING (CURRENT REQUEST):") == 1
    assert relevance.append_project_graph_grounding(context, packet) == context


def test_jev_rates_provider_candidates_by_current_context_without_recency_reward(
    monkeypatch,
) -> None:
    captured: dict = {}

    def decide(body: dict, **_kwargs):
        captured.update(body)
        answers = {}
        for question_id, question in body["questions"].items():
            choices = list(question["criteria"])
            probabilities = {
                choice: value for choice, value in zip(
                    choices, [0.1, 0.65, 0.25], strict=True,
                )
            }
            answers[question_id] = {
                "type": "choice",
                "choice": choices[1],
                "probabilities": probabilities,
                "confidence": 0.88,
            }
        return {"id": "jev-relevance-one", "answers": answers}

    monkeypatch.setattr(relevance.card_run_jev, "request_jev_decision", decide)
    result = relevance._jev_relevance(
        "current request",
        "bounded context",
        {
            "thinkgraph": [_think("a"), _think("b"), _think("c")],
            "knowgraph": [_know("a"), _know("b"), _know("c")],
        },
    )

    assert captured["state"]["current_user_request"] == "current request"
    assert captured["state"]["bounded_context"] == "bounded context"
    assert "mere recency" in captured["questions"]["thinkgraph_relevance"][
        "instructions"
    ]
    assert "two-sided Know" in captured["questions"]["knowgraph_relevance"][
        "instructions"
    ]
    assert [item["relevanceRank"] for item in result["thinkgraph"]["records"]] == [1]
    assert result["thinkgraph"]["records"][0]["engraphisMemoryId"] == "b"
    assert result["knowgraph"]["records"][0]["graphitiEpisodeId"] == "b"


def test_graphiti_provider_entity_search_hydrates_only_exact_about_knows(monkeypatch) -> None:
    async def search(name: str, arguments: dict):
        assert name == "search_nodes"
        assert arguments["max_nodes"] == 8
        return {"nodes": [{"uuid": "entity-a"}, {"uuid": "entity-b"}]}

    monkeypatch.setattr(relevance.mcp_provider_operations, "call_graphiti_operation", search)
    monkeypatch.setattr(
        relevance,
        "read_recent_knowgraph_knows",
        lambda _project, limit: [_know("recent")],
    )
    monkeypatch.setattr(
        relevance,
        "read_knowgraph_entity_know_candidates",
        lambda _project, entity_id, limit: [
            {**_know(f"{entity_id}-one"), "graphitiEntityId": entity_id},
        ],
    )

    recent, candidates, metadata = relevance._provider_know_records(
        "project-one", "current request",
    )

    assert recent[0]["graphitiEpisodeId"] == "recent"
    assert [item["graphitiEntityId"] for item in candidates] == ["entity-a", "entity-b"]
    assert metadata == {
        "retrieval": "graphiti_provider_entity_search",
        "matchedEntityCount": 2,
    }


def test_provider_failure_is_honest_and_does_not_substitute_recent_as_relevant() -> None:
    def failed(_project: str, _query: str, _limit: int):
        raise RuntimeError("provider down")

    def healthy(_project: str, _query: str, _limit: int):
        return [_know("recent")], [_know("candidate")], {"retrieval": "provider"}

    def rate(_query: str, _context: str, _candidates: dict, _limit: int):
        return {
            "thinkgraph": {"status": "empty", "records": [], "decisionId": None},
            "knowgraph": {"status": "empty", "records": [], "decisionId": None},
        }

    packet = relevance.build_project_graph_grounding(
        "project-one", "request",
        think_retriever=failed,
        know_retriever=healthy,
        relevance_rater=rate,
    )

    think = packet["authorities"]["thinkgraph"]
    assert think["recent"] == []
    assert think["relevant"] == []
    assert think["relevanceStatus"] == "unavailable"
    assert think["errorCode"] == "thinkgraph_provider_retrieval_unavailable"
