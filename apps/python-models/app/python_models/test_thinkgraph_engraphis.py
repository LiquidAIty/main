from __future__ import annotations

import hashlib

import numpy as np

from app.python_models.thinkgraph_engraphis import ThinkGraphEngraphis


class LocalTestEmbedder:
    dim = 384

    def embed(self, texts, *, kind="text"):
        rows = []
        for text in texts:
            raw = hashlib.sha384(text.encode("utf-8")).digest()
            vector = np.frombuffer(raw, dtype=np.uint8).astype(np.float32)
            vector = np.resize(vector, self.dim)
            vector /= np.linalg.norm(vector)
            rows.append(vector)
        return np.vstack(rows)


def adapter(tmp_path):
    return ThinkGraphEngraphis(tmp_path / "thinkgraph.sqlite", embedder=LocalTestEmbedder())


def authority(project="ADMIN", correlation="turn-1"):
    return {
        "projectId": project,
        "cardId": "card_main",
        "conversationId": "kg-self-01",
        "correlationId": correlation,
    }


def patch():
    return {
        "resources": [
            {
                "id": "goal:kg01",
                "label": "Choose a graph organizing principle.",
                "kind": "Goal",
                "properties": {"episode": "kg-self-01"},
            },
            {
                "id": "dec:kg01",
                "label": "Use purpose-specific graphs joined by a small shared contract.",
                "kind": "Decision",
                "properties": {"episode": "kg-self-01", "goal": "goal:kg01"},
            },
        ],
        "statements": [
            {
                "id": "st:goal-dec",
                "subject": "goal:kg01",
                "predicateTerm": "RESULTED_IN",
                "object": "dec:kg01",
            }
        ],
    }


def test_patch_preserves_ids_and_is_idempotent(tmp_path):
    graph = adapter(tmp_path)
    first = graph.apply_patch(authority(), patch())
    second = graph.apply_patch(authority(), patch())
    assert first["status"] == "applied"
    assert second["status"] == "duplicate"
    projection = graph.projection("ADMIN")
    assert {node["id"] for node in projection["nodes"]} == {"goal:kg01", "dec:kg01"}
    assert [edge["id"] for edge in projection["edges"]] == ["st:goal-dec"]
    canonical_ids = {node["canonicalId"] for node in projection["nodes"]}
    assert all(edge["source"] in canonical_ids and edge["target"] in canonical_ids for edge in projection["edges"])
    assert projection["authority"] == "engraphis-v2"


def test_exact_lookup_neighborhood_and_project_isolation(tmp_path):
    graph = adapter(tmp_path)
    graph.apply_patch(authority(), patch())
    assert graph.get_record("ADMIN", "dec:kg01")["canonicalId"] == "dec:kg01"
    neighborhood = graph.neighborhood("ADMIN", "dec:kg01")
    assert {node["id"] for node in neighborhood["nodes"]} == {"goal:kg01", "dec:kg01"}
    assert graph.projection("OTHER")["counts"] == {"nodes": 0, "edges": 0}
    assert graph.get_record("OTHER", "dec:kg01") is None


def test_hybrid_recall_is_bounded_and_scoped(tmp_path):
    graph = adapter(tmp_path)
    graph.apply_patch(authority(), patch())
    result = graph.recall("ADMIN", "shared graph contract", k=1)
    assert result["engine"] == "engraphis-v2"
    assert result["count"] == 1
    assert result["chunks"][0]["projectId"] == "ADMIN"
    assert result["chunks"][0]["canonicalId"] in {"goal:kg01", "dec:kg01"}
    assert graph.recall("OTHER", "shared graph contract", k=5)["count"] == 0


def test_current_and_historical_projection(tmp_path):
    graph = adapter(tmp_path)
    graph.apply_patch(authority(), patch())
    graph.store.close_validity("dec:kg01", reason="superseded")
    current = graph.projection("ADMIN")
    historical = graph.projection("ADMIN", include_historical=True)
    assert "dec:kg01" not in {node["id"] for node in current["nodes"]}
    historical_decision = next(node for node in historical["nodes"] if node["id"] == "dec:kg01")
    assert historical_decision["currentState"] == "historical"
    assert historical_decision["validTo"]


def test_changed_record_creates_immutable_version_and_supersedes_lineage(tmp_path):
    graph = adapter(tmp_path)
    graph.apply_patch(authority(correlation="turn-1"), patch())
    revised = patch()
    revised["resources"][1]["label"] = "Use authority-specific graphs joined by explicit references."
    graph.apply_patch(authority(correlation="turn-2"), revised)

    current = graph.projection("ADMIN")
    historical = graph.projection("ADMIN", include_historical=True)
    current_decision = next(node for node in current["nodes"] if node["canonicalId"] == "dec:kg01")
    versions = [node for node in historical["nodes"] if node["canonicalId"] == "dec:kg01"]

    assert current_decision["label"] == revised["resources"][1]["label"]
    assert current_decision["versionOrdinal"] == 2
    assert len(versions) == 2
    assert len({node["versionId"] for node in versions}) == 2
    assert sum(node["validTo"] is None for node in versions) == 1
    assert any(
        edge["predicate"] == "RESULTED_IN"
        and edge["source"] == "goal:kg01"
        and edge["target"] == "dec:kg01"
        for edge in current["edges"]
    )
    assert any(
        edge["predicate"] == "SUPERSEDES"
        and edge["source"] == current_decision["versionId"]
        and edge["target"] == current_decision["supersedesVersionId"]
        for edge in historical["edges"]
    )


def test_same_canonical_id_is_isolated_across_projects_and_conversations(tmp_path):
    graph = adapter(tmp_path)
    graph.apply_patch(authority(project="ADMIN", correlation="admin-1"), patch())
    other_authority = authority(project="OTHER", correlation="other-1")
    other_authority["conversationId"] = "other-conversation"
    graph.apply_patch(other_authority, patch())

    admin = graph.get_record("ADMIN", "goal:kg01")
    other = graph.get_record("OTHER", "goal:kg01")
    assert admin and other
    assert admin["id"] != other["id"]
    assert admin["conversationId"] == "kg-self-01"
    assert other["conversationId"] == "other-conversation"


def test_graph_views_are_durable_versioned_and_keep_lineage(tmp_path):
    graph = adapter(tmp_path)
    candidate = {
        "schemaVersion": "graph-view.v1",
        "viewId": "think:view-1",
        "authority": "thinkgraph",
        "status": "candidate",
        "projectId": "ADMIN",
        "conversationId": "kg-self-01",
        "producingRole": "user",
        "receivingRole": "coder",
        "rootCanonicalNodeIds": ["goal:kg01"],
        "includedCanonicalNodeIds": ["goal:kg01", "dec:kg01"],
        "includedRelationships": [{"id": "st:goal-dec", "source": "goal:kg01", "target": "dec:kg01", "type": "RESULTED_IN"}],
        "records": [],
        "query": "selected goal neighborhood",
        "filter": {"nodeTypes": ["Goal", "Decision"], "trustStates": []},
        "hopDepth": 1,
        "provenanceRefs": [],
        "note": "Inspect the implementation seam.",
        "omittedNeighborCount": 0,
        "createdAt": "2026-07-15T00:00:00Z",
        "updatedAt": "2026-07-15T00:00:00Z",
    }
    graph.persist_graph_view(candidate)
    active = {**candidate, "status": "active", "invocationId": "req-1", "updatedAt": "2026-07-15T00:00:30Z"}
    graph.persist_graph_view(active)
    consumed = {**active, "status": "consumed", "updatedAt": "2026-07-15T00:01:00Z"}
    graph.persist_graph_view(consumed)
    returned = {**candidate, "viewId": "code:return-1", "authority": "codegraph", "status": "returned", "producingRole": "coder", "receivingRole": "main_chat", "parentViewId": "think:view-1", "invocationId": "req-1", "updatedAt": "2026-07-15T00:01:05Z"}
    graph.persist_graph_view(returned)

    views = graph.graph_views("ADMIN", "kg-self-01")["views"]
    assert {view["viewId"] for view in views} == {"think:view-1", "code:return-1"}
    current_input = next(view for view in views if view["viewId"] == "think:view-1")
    assert current_input["status"] == "consumed"
    assert current_input["includedCanonicalNodeIds"] == ["goal:kg01", "dec:kg01"]
    assert next(view for view in views if view["viewId"] == "code:return-1")["parentViewId"] == "think:view-1"
    projection = graph.projection("ADMIN", include_historical=True)
    assert any(edge["predicate"] == "DERIVED_FROM" for edge in projection["edges"])
    assert any(edge["predicate"] == "SUPERSEDES" for edge in projection["edges"])
