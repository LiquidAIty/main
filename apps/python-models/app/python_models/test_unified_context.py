from concurrent.futures import ThreadPoolExecutor
import threading
import time

import pytest

from app.python_models.unified_context import (
    UnifiedContextRequest,
    build_model_context,
    build_unified_context,
    render_graph_views,
    render_model_context,
)


class FakeThinkGraph:
    def projection(self, project_id: str, limit: int = 500):
        return {
            "nodes": [
                {"id": "t:goal", "canonicalId": "t:goal", "title": "Goal", "type": "Goal", "degree": 2,
                 "projectId": project_id, "knowGraphRef": "k:book",
                 "properties": {"cluster": "decision", "knowgraph_ref": "k:book"}},
                {"id": "t:decision", "canonicalId": "t:decision", "title": "Decision", "type": "Decision", "degree": 1,
                 "projectId": project_id, "properties": {"cluster": "decision"}},
                {"id": "graph-view:view-1", "canonicalId": "graph-view:view-1", "type": "GraphView", "projectId": project_id,
                 "conversationId": "main", "properties": {
                    "view_id": "view-1", "view_authority": "thinkgraph", "status": "attached",
                    "included_node_ids_json": '["t:goal"]', "root_node_ids_json": '["t:goal"]',
                    "records_json": "[]", "relationships_json": "[]", "filter_json": "{}",
                    "provenance_refs_json": "[]", "producing_role": "user", "receiving_role": "main_chat",
                 }},
            ],
            "edges": [{"id": "te:1", "source": "t:goal", "target": "t:decision", "predicate": "RESULTED_IN"}],
        }


def fake_read(path, _params):
    if "knowgraph" in path:
        return {"resolved_project_id": "book-scope", "nodes": [{"id": "k:book", "label": "Book", "type": "Document", "properties": {}}], "relationships": [], "view": _view("knowgraph", ["k:book"])}
    return {"ok": True, "nodes": [{"id": "c:fn", "label": "fn", "type": "Function"}], "edges": []}


def fake_post(_path, _payload):
    return {"ok": True, "cbmProject": "repo", "result": {"results": [{"qualified_name": "c:fn", "name": "fn", "label": "Function", "file_path": "fn.py"}]}, "graphView": _view("codegraph", ["c:fn"])}


def _view(authority, ids):
    return {"schemaVersion": "graph-view.v1", "viewId": f"{authority}:view", "authority": authority, "status": "candidate", "projectId": "project-1", "conversationId": "main", "producingRole": authority, "receivingRole": "main_chat", "rootCanonicalNodeIds": ids[:1], "includedCanonicalNodeIds": ids, "records": [{"canonicalId": item, "summary": item, "selectionReason": "test", "provenanceRefs": [], "estimatedCharacters": len(item), "estimatedTokens": 1} for item in ids], "includedRelationships": [], "query": "test", "filter": {"nodeTypes": [], "trustStates": []}, "hopDepth": 0, "provenanceRefs": [], "omittedNeighborCount": 0, "createdAt": "2026-01-01", "updatedAt": "2026-01-01"}


def test_projection_is_bounded_stable_and_carries_exact_selected_view():
    request = UnifiedContextRequest("project-1", "main", role="coder", active_view_id="view-1", think_limit=2)
    first = build_unified_context(request, graph=FakeThinkGraph(), read_json=fake_read, post_json=fake_post)
    second = build_unified_context(request, graph=FakeThinkGraph(), read_json=fake_read, post_json=fake_post)
    assert {key: value for key, value in first.items() if key not in {"timingsMs", "cache"}} == {key: value for key, value in second.items() if key not in {"timingsMs", "cache"}}
    assert first["schemaVersion"] == "unified.context.v1"
    assert len(first["graphViews"]) == 3
    assert {view["authority"] for view in first["graphViews"]} == {"thinkgraph", "knowgraph", "codegraph"}
    assert first["graphViews"][0]["parentViewId"] == "view-1"
    assert all(view["status"] == "candidate" for view in first["graphViews"])
    assert all(view["receivingRole"] == "coder" for view in first["graphViews"])
    assert first["lifecycle"]["selected"] == [view["viewId"] for view in first["graphViews"]]
    assert first["counts"]["nodes"] == 3
    assert first["counts"]["crossAuthorityEdges"] == 1
    assert len([edge for edge in first["edges"] if edge["cross_authority"]]) == 1
    assert {node["authority"] for node in first["nodes"]} == {"thinkgraph", "knowgraph", "codegraph"}
    assert first["identity"] == {
        "applicationProjectId": "project-1",
        "thinkGraphWorkspaceId": "project-1",
        "knowGraphScopeId": "book-scope",
        "codeGraphProjectId": "repo",
        "conversationId": "main",
        "activeGraphViewId": "view-1",
        "receivingRole": "coder",
        "projectionId": first["projectionId"],
    }


def test_roles_produce_distinct_server_side_projection_hashes():
    projections = [build_unified_context(
        UnifiedContextRequest("project-1", "main", role=role, think_limit=80, know_limit=80, code_limit=80),
        graph=FakeThinkGraph(), read_json=fake_read, post_json=fake_post,
    ) for role in ("main_chat", "hermes", "coder")]
    assert len({item["configurationHash"] for item in projections}) == 3
    assert len({item["projectionId"] for item in projections}) == 3
    assert projections[1]["limits"]["codegraph"] == 20
    assert projections[2]["limits"]["knowgraph"] == 20


def test_expansion_is_a_new_server_view_not_a_browser_only_hide_show():
    base = build_unified_context(UnifiedContextRequest("project-1", "main", active_view_id="view-1"), graph=FakeThinkGraph(), read_json=fake_read, post_json=fake_post)
    expanded = build_unified_context(UnifiedContextRequest("project-1", "main", active_view_id="view-1", expansion_depth=1), graph=FakeThinkGraph(), read_json=fake_read, post_json=fake_post)
    assert base["projectionId"] != expanded["projectionId"]
    assert next(view for view in base["graphViews"] if view["authority"] == "thinkgraph")["viewId"] != next(view for view in expanded["graphViews"] if view["authority"] == "thinkgraph")["viewId"]
    assert expanded["counts"]["selected"]["thinkgraph"] > base["counts"]["selected"]["thinkgraph"]


def test_missing_authority_is_explicit_warning_not_fake_data():
    def failed_read(path, params):
        if "knowgraph" in path:
            raise RuntimeError("neo4j_down")
        return fake_read(path, params)
    result = build_unified_context(UnifiedContextRequest("project-1", "main"), graph=FakeThinkGraph(), read_json=failed_read, post_json=fake_post)
    assert result["counts"]["selected"]["knowgraph"] == 0
    assert {warning["code"] for warning in result["warnings"]} == {"authority_unavailable", "empty_authority_view", "referenced_record_not_in_projection", "missing_authority_mapping"}


def test_model_context_resolves_by_persistent_identity_and_is_faithful():
    request = UnifiedContextRequest("compact-project", "main")
    built = build_unified_context(request, graph=FakeThinkGraph(), read_json=fake_read, post_json=fake_post)
    first = build_model_context(built["projectionId"], request, graph=FakeThinkGraph(), read_json=fake_read, post_json=fake_post)
    second = build_model_context(built["projectionId"], request, graph=FakeThinkGraph(), read_json=fake_read, post_json=fake_post)
    assert first["modelContext"] == second["modelContext"]
    text = first["modelContext"]
    assert built["projectionId"] in text
    assert "REASONING STATE" in text and "- Goal: Goal" in text
    assert "RETRIEVAL:" in text and "read_thinkgraph_scope" in text
    # FAITHFUL: every selected record of every authority view appears in the text.
    for view in built["graphViews"]:
        for record in view["records"]:
            assert str(record["canonicalId"]) in text
    # Every projection relationship (including cross-authority) is rendered.
    rendered = render_model_context(built)
    assert rendered["measurements"]["relationships"] == len({
        (edge["source"], edge["target"], edge["type"]) for edge in built["edges"]
    })
    # None of the display/telemetry fields leak into the model text.
    for excluded in ('"x":', "estimatedTokens", "selectionReason", "includedCanonicalNodeIds", "#4AE2DF"):
        assert excluded not in text
    measurements = first["measurements"]
    assert measurements["characters"] == len(text)
    assert set(measurements["sections"]) == {"header", "reasoning_state", "records", "relationships", "provenance", "warnings", "retrieval"}
    assert set(measurements["authorities"]) == {"thinkgraph", "knowgraph", "codegraph"}
    # The compact delivery is materially smaller than the full projection JSON.
    import json as _json
    assert len(text) < len(_json.dumps(built)) / 5


def test_model_context_rejects_superseded_or_mismatched_projection_id():
    request = UnifiedContextRequest("scope-project", "main")
    built = build_unified_context(request, graph=FakeThinkGraph(), read_json=fake_read, post_json=fake_post)
    # Unknown/stale id for this configuration — honest failure, no silent regeneration.
    with pytest.raises(ValueError, match="projection_superseded"):
        build_model_context("unified:not-the-current-hash", request, graph=FakeThinkGraph(), read_json=fake_read, post_json=fake_post)
    # A different configuration (wrong scope, role, or expansion) produces a
    # different content hash, so a swapped id also fails honestly.
    other = UnifiedContextRequest("scope-project", "main", expansion_depth=1)
    with pytest.raises(ValueError, match="projection_superseded"):
        build_model_context(built["projectionId"], other, graph=FakeThinkGraph(), read_json=fake_read, post_json=fake_post)
    current = build_model_context(built["projectionId"], request, graph=FakeThinkGraph(), read_json=fake_read, post_json=fake_post)
    assert current["ok"] is True
    assert current["graphViews"] == built["graphViews"]


def test_render_model_context_reports_projection_side_omissions():
    built = build_unified_context(
        UnifiedContextRequest("omission-project", "main", think_limit=1, expansion_depth=1),
        graph=FakeThinkGraph(), read_json=fake_read, post_json=fake_post,
    )
    rendered = render_model_context(built)
    think = rendered["measurements"]["authorities"]["thinkgraph"]
    assert think["availableBeyondView"] >= 1
    assert "more available beyond this view" in rendered["text"]


def test_render_graph_views_is_faithful_and_compact():
    views = [_view("thinkgraph", ["t:goal", "t:decision"]), _view("codegraph", ["c:fn"])]
    views[0]["includedRelationships"] = [{"id": "e1", "source": "t:goal", "target": "t:decision", "type": "RESULTED_IN"}]
    rendered = render_graph_views(views)
    text = rendered["text"]
    for canonical in ("t:goal", "t:decision", "c:fn"):
        assert canonical in text
    assert "t:goal -RESULTED_IN-> t:decision" in text
    assert rendered["measurements"]["records"] == 3
    assert rendered["measurements"]["relationships"] == 1
    assert "selectionReason" not in text and "estimatedTokens" not in text
    import json as _json
    assert len(text) < len(_json.dumps(views))


def test_identical_concurrent_requests_resolve_authorities_once():
    barrier = threading.Barrier(2)
    calls = {"codegraph": 0}
    calls_lock = threading.Lock()

    def slow_post(path, payload):
        with calls_lock:
            calls["codegraph"] += 1
        time.sleep(0.08)
        return fake_post(path, payload)

    request = UnifiedContextRequest("singleflight-project", "singleflight-conversation", active_view_id="view-1")

    def resolve():
        barrier.wait(timeout=2)
        return build_unified_context(request, graph=FakeThinkGraph(), read_json=fake_read, post_json=slow_post)

    with ThreadPoolExecutor(max_workers=2) as pool:
        first, second = [future.result(timeout=3) for future in [pool.submit(resolve), pool.submit(resolve)]]

    assert calls["codegraph"] == 1
    assert first["projectionId"] == second["projectionId"]
    assert {first["cache"]["freshness"], second["cache"]["freshness"]} == {
        "resolved_from_authorities",
        "joined_inflight",
    }
