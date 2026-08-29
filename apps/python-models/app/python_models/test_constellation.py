from pathlib import Path

import pytest

from app.python_models.constellation import ConstellationProcess


def test_native_constellation_write_context_and_inspect(tmp_path: Path) -> None:
    database = tmp_path / "constellation.sqlite"
    try:
        engine = ConstellationProcess("project-one", database_path=database)
    except Exception as error:
        pytest.fail(f"native Constellation adapter failed to start: {error}")
    try:
        first = engine.request(
            "remember",
            {
                "id": "question-one",
                "l0": "Question one",
                "l1": "A bounded question",
                "l2": "What evidence would change this decision?",
                "tags": ["question"],
                "projectTag": "liquidaity-project:project-one",
                "nodeType": "knowledge",
                "source": "liquidaity-test",
            },
        )
        assert first["id"] == "question-one"
        assert first["deterministicTopologyReady"] is True
        assert first["semanticState"] == "degraded"

        second = engine.request(
            "remember",
            {
                "id": "answer-one",
                "l0": "Answer one",
                "l1": "A bounded answer",
                "l2": "The current evidence favors a reversible experiment.",
                "tags": ["answer"],
                "projectTag": "liquidaity-project:project-one",
                "nodeType": "knowledge",
                "source": "liquidaity-test",
                "edges": [
                    {
                        "target": "question-one",
                        "type": "builds_on",
                        "strength": 0.9,
                    }
                ],
            },
        )
        assert second["counts"]["active"] == 2

        inspected = engine.request(
            "inspect", {"nativeId": "question-one", "maxDepth": 1}
        )
        assert {node["id"] for node in inspected["nodes"]} == {
            "question-one",
            "answer-one",
        }
        assert any(
            edge["from"] == "answer-one" and edge["to"] == "question-one"
            for edge in inspected["edges"]
        )

        context = engine.request(
            "context", {"focus": "question", "maxDepth": 1}
        )
        assert context["deterministicTopologyReady"] is True
        assert context["stats"]["rendered"] >= 1
    finally:
        engine.close()

    assert database.is_file()
