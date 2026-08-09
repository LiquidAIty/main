from pathlib import Path

import pytest

from app.python_models.thinkgraph_live_projection import project_live_thinkgraph


def _payload(**overrides):
    payload = {
        "projectId": "project-1",
        "conversationId": "main",
        "runId": "turn-1",
        "observedAt": "2026-08-09T12:00:00.000Z",
        "state": "active",
        "streams": [
            {
                "source": "user",
                "sourceId": "message-1",
                "text": "Do not add another timeout loop, fix the build.",
            },
        ],
    }
    payload.update(overrides)
    return payload


def test_projects_bounded_observations_without_semantic_predicates():
    projection = project_live_thinkgraph(_payload())

    labels = {node["label"].casefold() for node in projection["nodes"]}
    assert "timeout loop" in labels
    assert "build" in labels
    assert all(node["properties"]["persisted"] is False for node in projection["nodes"])
    assert all(node["properties"]["state"] == "active" for node in projection["nodes"])
    assert {edge["predicate"] for edge in projection["edges"]} <= {
        "observed-near",
        "co-occurs-with",
        "mentioned-with",
        "reasoning-near",
        "answer-near",
        "user-near",
    }
    assert all(edge["properties"]["observational"] is True for edge in projection["edges"])


def test_ids_survive_incremental_text_and_cross_stream_repetition_is_observational():
    first = project_live_thinkgraph(_payload())
    second = project_live_thinkgraph(
        _payload(
            streams=[
                {
                    "source": "user",
                    "sourceId": "message-1",
                    "text": "Do not add another timeout loop, fix the build.",
                },
                {
                    "source": "reasoning",
                    "sourceId": "reasoning-1",
                    "text": "Inspect the timeout loop before changing the build pipeline.",
                },
            ],
        ),
    )

    first_by_source_label = {
        (node["properties"]["source"], node["label"].casefold()): node["id"]
        for node in first["nodes"]
    }
    second_by_source_label = {
        (node["properties"]["source"], node["label"].casefold()): node["id"]
        for node in second["nodes"]
    }
    assert second_by_source_label[("user", "timeout loop")] == first_by_source_label[("user", "timeout loop")]
    assert any(node["properties"]["source"] == "reasoning" for node in second["nodes"])
    assert any(edge["predicate"] == "mentioned-with" for edge in second["edges"])
    serialized = str(second)
    assert "Inspect the timeout loop before changing the build pipeline." not in serialized


def test_is_empty_safe_and_enforces_hard_bounds():
    empty = project_live_thinkgraph(_payload(streams=[{"source": "assistant", "sourceId": "a", "text": "..."}]))
    assert empty["counts"] == {"nodes": 0, "edges": 0}

    text = " ".join(f"concept{index} linked{index}" for index in range(100))
    bounded = project_live_thinkgraph(
        _payload(streams=[{"source": "assistant", "sourceId": "a", "text": text}], maxNodes=999, maxEdges=999),
    )
    assert len(bounded["nodes"]) <= 32
    assert len(bounded["edges"]) <= 64


def test_rejects_missing_turn_identity():
    with pytest.raises(ValueError, match="runId required"):
        project_live_thinkgraph(_payload(runId=""))


def test_module_has_no_disallowed_runtime_dependencies():
    source = Path(__file__).with_name("thinkgraph_live_projection.py").read_text(encoding="utf-8").casefold()
    forbidden_imports = (
        "import sqlite",
        "import sentence_transformers",
        "import graphiti",
        "import neo4j",
        "import openai",
        "import openrouter",
    )
    assert not any(name in source for name in forbidden_imports)

