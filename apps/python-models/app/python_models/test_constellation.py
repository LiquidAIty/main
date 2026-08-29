from pathlib import Path
import os
import time

import pytest

from app.python_models import constellation
from app.python_models.constellation import ConstellationError, ConstellationProcess


def test_operation_dispatch_stays_inside_one_allowlisted_owner(monkeypatch) -> None:
    calls: list[tuple[str, dict]] = []

    class Owner:
        def request(self, operation, arguments, **_kwargs):
            calls.append((operation, arguments))
            return {"ok": True, "operation": operation}

    monkeypatch.setattr(constellation, "get_constellation", lambda project_id: Owner())
    assert constellation.invoke_constellation_operation(
        "project-one", "stats", {}
    ) == {"ok": True, "operation": "stats"}
    assert calls == [("stats", {})]
    with pytest.raises(
        ConstellationError,
        match="constellation_operation_unsupported:launch_second_runtime",
    ):
        constellation.invoke_constellation_operation(
            "project-one", "launch_second_runtime", {}
        )


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
        assert first["semanticState"] == "available"
        assert first["semanticReason"] == "explicit_start_required"

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

        capabilities = engine.request("capabilities", {})
        assert capabilities["engineVersion"] == "1.0.5"
        assert capabilities["modes"]["semanticEmbedding"]["enabled"] is True
        assert capabilities["modes"]["boundedNativeAutonomy"]["maxConcurrency"] == 1
        assert "maintain" in capabilities["exposedOperations"]
        assert "reembed_start" in capabilities["exposedOperations"]

        semantic_status = engine.request("semantic_status", {})
        assert semantic_status["state"] == "stopped"
        assert semantic_status["model"] == "Xenova/bge-m3"

        duplicate = engine.request(
            "check_duplicate",
            {"l0": "Question one", "l2": "What evidence would change this decision?"},
        )
        assert duplicate["isDuplicate"] is True
        assert duplicate["existingId"] == "question-one"
        edge_types = engine.request("edge_types", {})["edgeTypes"]
        assert "associative" in edge_types

        updated = engine.request(
            "update_memory",
            {
                "nativeId": "question-one",
                "l2": "What bounded evidence would change this decision?",
                "tags": ["question", "updated"],
            },
        )
        assert updated["ok"] is True
        assert updated["updatedFields"] == ["l2", "tags"]

        engine.request(
            "remember",
            {
                "id": "evidence-one",
                "l0": "Evidence one",
                "l1": "A bounded evidence node",
                "l2": "One reversible experiment produced evidence.",
                "source": "liquidaity-test",
            },
        )
        linked = engine.request(
            "link",
            {
                "sourceId": "evidence-one",
                "edges": [{"target": "question-one", "type": "associative", "strength": 0.6}],
            },
        )
        assert linked["created"] >= 1

        after_link = engine.request(
            "inspect", {"nativeId": "evidence-one", "maxDepth": 1}
        )
        edge = next(
            item for item in after_link["inspectedEdges"]
            if item["source"] == "evidence-one"
            and item["target"] == "question-one"
            and item["edge_type"] == "associative"
        )
        exact_edge = engine.request("inspect_edge", {"edgeId": edge["id"]})
        assert exact_edge["edge"]["source"] == "evidence-one"

        adjusted = engine.request(
            "adjust_edge", {"edgeId": edge["id"], "delta": 0.05}
        )
        assert adjusted["ok"] is True
        fine_type = edge_types["associative"][0]
        classified = engine.request(
            "classify_edge",
            {"edgeId": edge["id"], "fineType": fine_type, "fineConfidence": 0.8},
        )
        assert classified["ok"] is True
        verified_edge = engine.request(
            "edge_review", {"action": "verify", "edgeId": edge["id"]}
        )
        assert verified_edge["ok"] is True

        collision = engine.request(
            "collide", {"numFoci": 2, "budget": 400, "maxDepth": 1}
        )
        assert len(collision["foci"]) == 2

        preview = engine.request(
            "identity_preview",
            {
                "segments": {"direction": "I prefer bounded reversible experiments."},
                "reason": "Lifecycle-test the native preview contract only.",
            },
        )["preview"]
        assert preview["proposedIds"] == ["soul-core-refined-direction"]
        assert len(preview["digest"]) == 64

        autonomy = engine.request(
            "autonomy_start",
            {
                "mode": "collide",
                "confirmAutonomy": True,
                "maxCycles": 1,
                "maxDurationSeconds": 10,
                "intervalSeconds": 1,
                "maxDepth": 1,
                "maxTokens": 400,
                "perCycleTokens": 400,
                "numFoci": 2,
            },
        )["run"]
        assert autonomy["maxConcurrency"] == 1
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            autonomy = engine.request("autonomy_status", {})["run"]
            if autonomy["state"] != "running":
                break
            time.sleep(0.05)
        assert autonomy["state"] == "completed"
        assert autonomy["completedCycles"] == 1

        forgotten = engine.request(
            "forget", {"nativeId": "evidence-one", "confirmDormant": True}
        )
        assert forgotten["state"] == "dormant"
        maintenance = engine.request(
            "maintain",
            {
                "confirmProjectMaintenance": True,
                "decayFactor": 1,
                "pruneThreshold": 0,
                "dormantThreshold": 0,
            },
        )
        assert maintenance["ok"] is True
        assert isinstance(maintenance["report"]["edges_orphan_swept"], int)
    finally:
        engine.close()

    assert database.is_file()


@pytest.mark.skipif(
    os.environ.get("CONSTELLATION_LIVE_EMBEDDING_TEST") != "1",
    reason="explicit live local BGE-M3 lifecycle proof",
)
def test_native_constellation_semantic_lifecycle(tmp_path: Path) -> None:
    database = tmp_path / "constellation-semantic.sqlite"
    engine = ConstellationProcess("semantic-project", database_path=database)
    try:
        started = engine.request(
            "semantic_start",
            {
                "confirmStart": True,
                "waitForReady": True,
                "maxWaitSeconds": 180,
            },
            timeout_seconds=190,
        )
        assert started["status"]["state"] == "ready"
        assert started["status"]["model"] == "Xenova/bge-m3"
        assert started["status"]["dimension"] == 1024
        written = engine.request(
            "remember_semantic",
            {
                "id": "semantic-proof",
                "l0": "Semantic lifecycle proof",
                "l1": "The pinned local BGE-M3 embedder is ready.",
                "l2": "This isolated memory proves native semantic write and retrieval.",
                "source": "liquidaity-live-test",
                "maxWaitSeconds": 180,
            },
            timeout_seconds=190,
        )
        assert written["embedded"] is True
        assert written["semanticState"] == "ready"
        rendered = engine.request(
            "semantic_context",
            {
                "focus": "local semantic retrieval proof",
                "budget": 500,
                "maxDepth": 1,
                "maxL2": 2,
                "maxWaitSeconds": 180,
            },
            timeout_seconds=190,
        )
        assert rendered["semanticSearch"] is True
        assert any(node["id"] == "semantic-proof" for node in rendered["nodes"])

        reembed = engine.request(
            "reembed_start",
            {
                "confirmReembed": True,
                "maxNodes": 1,
                "maxDurationSeconds": 30,
                "maxWaitSeconds": 30,
            },
            timeout_seconds=40,
        )["job"]
        reembed_deadline = time.monotonic() + 30
        while time.monotonic() < reembed_deadline:
            reembed = engine.request("reembed_status", {})["job"]
            if reembed["state"] != "running":
                break
            time.sleep(0.05)
        assert reembed["state"] == "completed"
        assert reembed["processed"] == 1

        preview = engine.request(
            "identity_preview",
            {
                "segments": {"values": "I value exact lifecycle receipts."},
                "reason": "Isolated native identity lifecycle proof.",
            },
        )["preview"]
        applied = engine.request(
            "identity_apply",
            {
                "previewId": preview["previewId"],
                "digest": preview["digest"],
                "confirmIdentityMutation": True,
                "maxWaitSeconds": 30,
            },
            timeout_seconds=40,
        )
        assert applied["ok"] is True
        assert applied["verified"] is True
        assert any(
            row["id"] == "soul-core-refined-values"
            for row in applied["readback"]
        )

        notification = engine.request("notification_status", {})
        assert notification["owner"] == "constellation-launcher-outbox"
        not_queued = engine.request(
            "notify",
            {
                "kind": "lifecycle-test",
                "title": "Isolated test",
                "body": "No launcher delivery is expected while disabled.",
                "confirmNotification": True,
            },
        )
        assert not_queued["queued"] is False
        assert not_queued["reason"] == "launcher_notifications_disabled"

        stopped = engine.request("semantic_stop", {"confirmStop": True})
        assert stopped["stopped"] is True
        stop_deadline = time.monotonic() + 5
        while time.monotonic() < stop_deadline:
            stopped_status = engine.request("semantic_status", {})
            if stopped_status["state"] == "stopped":
                break
            time.sleep(0.05)
        assert stopped_status["state"] == "stopped"
        assert stopped_status["failure"] is None
    finally:
        engine.close()

    assert database.is_file()
