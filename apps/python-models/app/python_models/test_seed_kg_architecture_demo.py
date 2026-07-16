from __future__ import annotations

from collections import Counter

import numpy as np

from app.python_models.seed_kg_architecture_demo import (
    DEMO_PROJECT_ID,
    demo_graph_views,
    demo_links,
    demo_resources,
    demo_view_statements,
    remove_demo,
    seed_demo,
)
from app.python_models.thinkgraph_engraphis import ThinkGraphEngraphis


class LocalTestEmbedder:
    dim = 384

    def embed(self, texts, *, kind="text"):
        vectors = []
        for text in texts:
            vector = np.zeros(self.dim, dtype=np.float32)
            for index, byte in enumerate(text.encode("utf-8")):
                vector[(index + byte) % self.dim] += 1.0
            norm = np.linalg.norm(vector)
            vectors.append(vector / norm if norm else vector)
        return np.asarray(vectors, dtype=np.float32)


def adapter(tmp_path):
    return ThinkGraphEngraphis(tmp_path / "thinkgraph-demo.sqlite", embedder=LocalTestEmbedder())


def test_seed_shape_is_dense_connected_and_uses_supported_families():
    resources = demo_resources()
    links = demo_links()
    ids = {item["id"] for item in resources}
    assert len(resources) == 60
    assert len(ids) == 60
    assert 75 <= len(links) <= 130
    assert all(source in ids and target in ids and source != target for source, _, target in links)
    degree = Counter(endpoint for source, _, target in links for endpoint in (source, target))
    assert set(degree) == ids
    assert sum(1 for value in degree.values() if value >= 6) >= 3
    assert {view["status"] for view in demo_graph_views()} == {"candidate", "attached"}
    role_views = {view["receivingRole"]: view for view in demo_graph_views() if view["receivingRole"] in {"main_chat", "hermes", "coder"}}
    assert set(role_views) == {"main_chat", "hermes", "coder"}
    assert all(view["status"] == "candidate" and "no prior invocation" in view["note"] for view in role_views.values())


def test_seed_is_idempotent_and_retrievable(tmp_path):
    graph = adapter(tmp_path)
    first = seed_demo(graph)
    first_projection = graph.projection(DEMO_PROJECT_ID, limit=500)
    second = seed_demo(graph)
    second_projection = graph.projection(DEMO_PROJECT_ID, limit=500)
    assert first["counts"] == {"nodes": 67, "edges": len(demo_links()) + len(demo_view_statements()) + 1}
    assert second["counts"] == first["counts"]
    assert second["revision"] == first["revision"]
    assert {item["status"] for item in second["batches"]} == {"duplicate"}
    assert first_projection == second_projection
    degree = Counter(endpoint for edge in first_projection["edges"] for endpoint in (edge["source"], edge["target"]))
    assert all(degree[node["id"]] > 0 for node in first_projection["nodes"])
    recall = graph.recall(DEMO_PROJECT_ID, "Why is network analysis derived rather than canonical?", k=8)
    assert recall["count"] > 0
    assert any(chunk["recordKind"] in {"Decision", "Finding", "Evidence"} for chunk in recall["chunks"])
    assert len(graph.graph_views(DEMO_PROJECT_ID, "demo:kg-architecture:v1")["views"]) == 7


def test_removal_is_exact_and_allows_clean_reseed(tmp_path):
    graph = adapter(tmp_path)
    seed_demo(graph)
    try:
        remove_demo(graph, confirm="wrong-workspace")
        raise AssertionError("wrong confirmation must fail")
    except ValueError:
        pass
    removed = remove_demo(graph, confirm=DEMO_PROJECT_ID)
    assert removed["status"] == "removed"
    assert DEMO_PROJECT_ID not in {item["name"] for item in __import__("engraphis.service", fromlist=["MemoryService"]).MemoryService(graph.engine).list_workspaces()["workspaces"]}
    reseeded = seed_demo(graph)
    assert reseeded["counts"]["nodes"] == 67
