from concurrent.futures import ThreadPoolExecutor
import threading
import time

import pytest

from app.python_models.unified_context import UnifiedContextRequest, build_model_context, build_unified_context, render_model_context


class FakeThinkGraph:
    def projection(self, project_id: str, limit: int = 5000):
        return {
            "revision": "think-revision-1",
            "nodes": [
                {"id": "think:one", "canonicalId": "think:one", "title": "Think one", "type": "Finding", "projectId": project_id, "properties": {}},
                {"id": "think:two", "canonicalId": "think:two", "title": "Think two", "type": "Decision", "projectId": project_id, "properties": {}},
            ][:limit],
            "edges": [{"id": "think-edge", "source": "think:one", "target": "think:two", "predicate": "RELATES_TO"}],
        }

    def graph_views(self, project_id: str, conversation_id: str | None = None):
        base = {"schemaVersion": "graph-view.v1", "projectId": project_id, "conversationId": conversation_id or "main", "producingRole": "thinkgraph", "provenanceRefs": [], "omittedNeighborCount": 0, "query": ""}
        return {"ok": True, "views": [
            {**base, "viewId": "thinkgraph:role-view", "authority": "thinkgraph", "status": "attached", "receivingRole": "main_chat",
             "records": [{"canonicalId": "think:two", "summary": "Decision Think two"}],
             "includedRelationships": [{"id": "vr", "source": "think:one", "target": "think:two", "type": "RELATES_TO"}]},
            {**base, "viewId": "codegraph:coder-only", "authority": "codegraph", "status": "attached", "receivingRole": "coder",
             "records": [{"canonicalId": "pkg.one", "summary": "coder-only record"}], "includedRelationships": []},
            {**base, "viewId": "thinkgraph:spent", "authority": "thinkgraph", "status": "consumed", "receivingRole": "main_chat",
             "records": [{"canonicalId": "think:one", "summary": "already consumed"}], "includedRelationships": []},
        ]}


def fake_read(path, params):
    if path == "/api/knowgraph/analysis/latest":
        return {"analysis": {
            "nodes": [
                {"id": "know:one", "label": "Know one", "type": "Concept", "properties": {}},
                {"id": "know:two", "label": "Know two", "type": "Document", "properties": {}},
            ],
            "edges": [{"id": "know-edge", "source": "know:one", "target": "know:two", "type": "SUPPORTED_BY"}],
        }}
    if path == "/api/layout":
        assert params["project"] == "repo"
        return {
            "nodes": [
                {"id": 10, "x": 1, "y": 2, "z": 3, "label": "Function", "name": "pkg.one", "size": 4, "color": "#fff"},
                {"id": 11, "x": 4, "y": 5, "z": 6, "label": "Class", "name": "pkg.two", "size": 5, "color": "#fff"},
                {"id": 12, "x": 7, "y": 8, "z": 9, "label": "File", "name": "pkg.file", "size": 3, "color": "#fff"},
            ],
            "edges": [{"id": "code-edge", "source": 10, "target": 11, "type": "CALLS"}],
            "total_nodes": 3,
        }
    raise AssertionError(path)


def fake_post(path, payload):
    assert path == "/api/coder/mcp-bridge/codegraph_status"
    assert payload == {}
    return {"ok": True, "cbmProject": "repo"}


def request(**overrides):
    values = {"project_id": "project-1", "conversation_id": "main"}
    values.update(overrides)
    return UnifiedContextRequest(**values)


def test_full_authority_data_passes_through_without_classifier_membership():
    result = build_unified_context(request(), graph=FakeThinkGraph(), read_json=fake_read, read_codegraph_json=fake_read, post_json=fake_post)
    assert result["counts"]["selected"] == {"thinkgraph": 2, "knowgraph": 2, "codegraph": 3}
    assert result["counts"]["nodes"] == 7
    assert result["counts"]["edges"] == 3
    assert {node["source_id"] for node in result["nodes"]} == {"think:one", "think:two", "know:one", "know:two", "pkg.one", "pkg.two", "pkg.file"}
    assert {(edge["type"], edge["cross_authority"]) for edge in result["edges"]} == {("RELATES_TO", False), ("SUPPORTED_BY", False), ("CALLS", False)}
    forbidden = {"activeAnchor", "context_role", "reason_for_inclusion", "story_state", "connected_to_anchor", "distance_to_anchor", "path_to_anchor"}
    assert forbidden.isdisjoint(result)
    assert all(forbidden.isdisjoint(node) for node in result["nodes"])


def test_codegraph_coordinates_and_full_membership_are_preserved():
    result = build_unified_context(request(), graph=FakeThinkGraph(), read_json=fake_read, read_codegraph_json=fake_read, post_json=fake_post)
    code = next(node for node in result["nodes"] if node["source_id"] == "pkg.one")
    assert (code["x"], code["y"], code["z"], code["size"]) == (1.0, 2.0, 3.0, 4.0)
    assert result["identity"]["codeGraphProjectId"] == "repo"


def test_projection_identity_is_stable_and_changes_with_source_identity():
    first = build_unified_context(request(), graph=FakeThinkGraph(), read_json=fake_read, read_codegraph_json=fake_read, post_json=fake_post)
    second = build_unified_context(request(), graph=FakeThinkGraph(), read_json=fake_read, read_codegraph_json=fake_read, post_json=fake_post)
    assert first["projectionId"] == second["projectionId"]
    other = build_unified_context(request(conversation_id="other"), graph=FakeThinkGraph(), read_json=fake_read, read_codegraph_json=fake_read, post_json=fake_post)
    assert other["projectionId"] != first["projectionId"]


def test_partial_authority_failure_is_honest_and_does_not_backfill():
    def partial_read(path, params):
        if path == "/api/knowgraph/analysis/latest":
            raise RuntimeError("neo4j_down")
        return fake_read(path, params)
    result = build_unified_context(request(), graph=FakeThinkGraph(), read_json=partial_read, read_codegraph_json=fake_read, post_json=fake_post)
    assert result["counts"]["selected"] == {"thinkgraph": 2, "knowgraph": 0, "codegraph": 3}
    assert {warning["code"] for warning in result["warnings"]} >= {"authority_unavailable", "empty_authority_view"}


def test_model_context_uses_the_same_projection_identity():
    built = build_unified_context(request(), graph=FakeThinkGraph(), read_json=fake_read, read_codegraph_json=fake_read, post_json=fake_post)
    delivered = build_model_context(built["projectionId"], request(), graph=FakeThinkGraph(), read_json=fake_read, read_codegraph_json=fake_read, post_json=fake_post)
    assert delivered["projectionId"] == built["projectionId"]
    with pytest.raises(ValueError, match="projection_superseded"):
        build_model_context("unified:wrong", request(), graph=FakeThinkGraph(), read_json=fake_read, read_codegraph_json=fake_read, post_json=fake_post)


def test_model_context_is_bounded_to_role_views_never_the_projection_dump():
    built = build_unified_context(request(), graph=FakeThinkGraph(), read_json=fake_read, read_codegraph_json=fake_read, post_json=fake_post)
    delivered = build_model_context(built["projectionId"], request(), graph=FakeThinkGraph(), read_json=fake_read, read_codegraph_json=fake_read, post_json=fake_post)
    text = delivered["modelContext"]
    # Reasoning state (structural ThinkGraph types) + this role's persisted views.
    assert "REASONING STATE" in text and "- Decision: Think two" in text
    assert "thinkgraph:role-view" in text and "Decision Think two (think:two)" in text
    assert "think:one -RELATES_TO-> think:two" in text
    # Other-role and spent-lifecycle views never leak in.
    assert "codegraph:coder-only" not in text and "coder-only record" not in text
    assert "thinkgraph:spent" not in text
    # The display projection's node/edge dump NEVER enters the prompt — it is
    # referenced by identity and counts only.
    assert "pkg.one" not in text and "pkg.two" not in text and "-CALLS->" not in text
    assert "know:one" not in text
    assert "thinkgraph=2, knowgraph=2, codegraph=3" in text
    # Lifecycle views returned for runtime stamping are exactly the role views.
    assert [view["viewId"] for view in delivered["graphViews"]] == ["thinkgraph:role-view"]
    measurements = delivered["measurements"]
    assert set(measurements["sections"]) == {"header", "reasoning_state", "graph_views", "warnings", "retrieval"}
    assert measurements["views"]["thinkgraph:role-view"]["relationships"] == 1
    # Bounded means bounded: the whole context stays tiny even though the
    # projection carries every authority record.
    assert measurements["estimatedTokens"] < 400


def test_render_model_context_with_no_role_views_is_honest_not_a_fallback_dump():
    built = build_unified_context(request(), graph=FakeThinkGraph(), read_json=fake_read, read_codegraph_json=fake_read, post_json=fake_post)
    rendered = render_model_context(built, [])
    assert "ROLE GRAPH VIEWS: none persisted for this role" in rendered["text"]
    assert "-CALLS->" not in rendered["text"] and "pkg.one" not in rendered["text"]


def test_identical_concurrent_requests_join_one_full_authority_read():
    barrier = threading.Barrier(2)
    calls = 0
    lock = threading.Lock()

    def slow_read(path, params):
        nonlocal calls
        if path == "/api/layout":
            with lock:
                calls += 1
            time.sleep(0.08)
        return fake_read(path, params)

    def resolve():
        barrier.wait(timeout=2)
        return build_unified_context(request(project_id="concurrent"), graph=FakeThinkGraph(), read_json=slow_read, read_codegraph_json=slow_read, post_json=fake_post)

    with ThreadPoolExecutor(max_workers=2) as pool:
        first, second = [future.result(timeout=3) for future in [pool.submit(resolve), pool.submit(resolve)]]
    assert calls == 1
    assert first["projectionId"] == second["projectionId"]
