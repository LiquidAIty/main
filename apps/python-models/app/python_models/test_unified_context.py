from concurrent.futures import ThreadPoolExecutor
import threading
import time

from app.python_models.unified_context import UnifiedContextRequest, build_unified_context


class FakeThinkGraph:
    def projection(self, project_id: str, limit: int = 500):
        return {
            "nodes": [
                {"id": "t:goal", "canonicalId": "t:goal", "title": "Goal", "type": "Goal", "degree": 2,
                 "projectId": project_id, "properties": {"cluster": "decision", "knowgraph_ref": "k:book"}},
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
