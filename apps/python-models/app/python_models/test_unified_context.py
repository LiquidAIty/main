from concurrent.futures import ThreadPoolExecutor
import threading
import time

import pytest

from app.python_models.unified_context import (
    MAX_GRAPH_CONTEXT_CHARACTERS,
    MAX_GRAPH_EVIDENCE_RECORDS,
    UnifiedContextRequest,
    build_graph_object_context,
    build_model_context,
    build_unified_context,
    render_graph_views,
    render_model_context,
    select_persisted_graph_views,
    transition_persisted_graph_views,
)


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
    if path == "/api/knowgraph/graph":
        return {
            "nodes": [
                {"id": "know:one", "label": "Know one", "type": "Concept", "properties": {}},
                {"id": "know:two", "label": "Know two", "type": "Document", "properties": {}},
            ],
            "relationships": [{"id": "know-edge", "source": "know:one", "target": "know:two", "type": "SUPPORTED_BY"}],
        }
    if path == "/api/layout":
        assert params["project"] == "C-Projects-main"
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


def request(**overrides):
    values = {"project_id": "project-1", "conversation_id": "main"}
    values.update(overrides)
    return UnifiedContextRequest(**values)


def test_full_authority_data_passes_through_without_classifier_membership():
    result = build_unified_context(request(), graph=FakeThinkGraph(), read_json=fake_read, read_codegraph_json=fake_read)
    assert result["counts"]["selected"] == {"thinkgraph": 2, "knowgraph": 2, "codegraph": 3}
    assert result["counts"]["nodes"] == 7
    assert result["counts"]["edges"] == 3
    assert {node["source_id"] for node in result["nodes"]} == {"think:one", "think:two", "know:one", "know:two", "pkg.one", "pkg.two", "pkg.file"}
    assert {(edge["type"], edge["cross_authority"]) for edge in result["edges"]} == {("RELATES_TO", False), ("SUPPORTED_BY", False), ("CALLS", False)}
    forbidden = {"activeAnchor", "context_role", "reason_for_inclusion", "story_state", "connected_to_anchor", "distance_to_anchor", "path_to_anchor"}
    assert forbidden.isdisjoint(result)
    assert all(forbidden.isdisjoint(node) for node in result["nodes"])


def test_codegraph_coordinates_and_full_membership_are_preserved():
    result = build_unified_context(request(), graph=FakeThinkGraph(), read_json=fake_read, read_codegraph_json=fake_read)
    code = next(node for node in result["nodes"] if node["source_id"] == "pkg.one")
    assert (code["x"], code["y"], code["z"], code["size"]) == (1.0, 2.0, 3.0, 4.0)
    assert result["identity"]["codeGraphProjectId"] == "C-Projects-main"


def test_projection_identity_is_stable_and_changes_with_source_identity():
    first = build_unified_context(request(), graph=FakeThinkGraph(), read_json=fake_read, read_codegraph_json=fake_read)
    second = build_unified_context(request(), graph=FakeThinkGraph(), read_json=fake_read, read_codegraph_json=fake_read)
    assert first["projectionId"] == second["projectionId"]
    other = build_unified_context(request(conversation_id="other"), graph=FakeThinkGraph(), read_json=fake_read, read_codegraph_json=fake_read)
    assert other["projectionId"] != first["projectionId"]


def test_partial_authority_failure_is_honest_and_does_not_backfill():
    def partial_read(path, params):
        if path == "/api/knowgraph/graph":
            raise RuntimeError("neo4j_down")
        return fake_read(path, params)
    result = build_unified_context(request(), graph=FakeThinkGraph(), read_json=partial_read, read_codegraph_json=fake_read)
    assert result["counts"]["selected"] == {"thinkgraph": 2, "knowgraph": 0, "codegraph": 3}
    assert {warning["code"] for warning in result["warnings"]} >= {"authority_unavailable", "empty_authority_view"}


def test_model_context_uses_the_same_projection_identity():
    built = build_unified_context(request(), graph=FakeThinkGraph(), read_json=fake_read, read_codegraph_json=fake_read)
    delivered = build_model_context(built["projectionId"], request(), graph=FakeThinkGraph(), read_json=fake_read, read_codegraph_json=fake_read)
    assert delivered["projectionId"] == built["projectionId"]
    with pytest.raises(ValueError, match="projection_superseded"):
        build_model_context("unified:wrong", request(), graph=FakeThinkGraph(), read_json=fake_read, read_codegraph_json=fake_read)


def test_selected_objects_resolve_by_authority_with_bounded_relationships():
    context = build_graph_object_context(
        "project-1",
        "main",
        [
            {"authority": "thinkgraph", "canonicalId": "think:one", "selectedThrough": "thinkgraph"},
            {"authority": "knowgraph", "canonicalId": "know:one", "selectedThrough": "knowgraph"},
            {"authority": "codegraph", "canonicalId": "pkg.one", "selectedThrough": "codegraph"},
        ],
        graph=FakeThinkGraph(), read_json=fake_read, read_codegraph_json=fake_read,
    )
    assert [record["authority"] for record in context["resolved"]] == ["thinkgraph", "knowgraph", "codegraph"]
    assert "ThinkGraph Finding — think:one" in context["modelContext"]
    assert "RELATES_TO -> Think two" in context["modelContext"]
    assert context["measurements"]["objects"] == 3
    assert context["measurements"]["relationships"] <= 24


def test_unified_object_selection_preserves_source_authority_and_rejects_stale_or_missing_identity():
    built = build_unified_context(request(), graph=FakeThinkGraph(), read_json=fake_read, read_codegraph_json=fake_read)
    resolved = build_graph_object_context(
        "project-1", "main",
        [{"authority": "thinkgraph", "canonicalId": "think:two", "selectedThrough": "unified", "sourceAuthority": "thinkgraph", "projectionId": built["projectionId"]}],
        graph=FakeThinkGraph(), read_json=fake_read, read_codegraph_json=fake_read,
    )
    assert resolved["resolved"][0]["authority"] == "thinkgraph"
    with pytest.raises(ValueError, match="projection_superseded"):
        build_graph_object_context(
            "project-1", "main",
            [{"authority": "thinkgraph", "canonicalId": "think:two", "selectedThrough": "unified", "sourceAuthority": "thinkgraph", "projectionId": "unified:stale"}],
            graph=FakeThinkGraph(), read_json=fake_read, read_codegraph_json=fake_read,
        )
    class ProjectIsolatedThinkGraph(FakeThinkGraph):
        def projection(self, project_id: str, limit: int = 5000):
            if project_id != "project-1":
                return {"revision": "other", "nodes": [], "edges": []}
            return super().projection(project_id, limit)

    with pytest.raises(ValueError, match="not_visible"):
        build_graph_object_context(
            "another-project", "main",
            [{"authority": "thinkgraph", "canonicalId": "think:two", "selectedThrough": "thinkgraph"}],
            graph=ProjectIsolatedThinkGraph(), read_json=fake_read, read_codegraph_json=fake_read,
        )


def test_model_context_is_bounded_to_the_explicit_selected_view_never_the_projection_dump():
    selected_request = request(active_view_id="thinkgraph:role-view")
    built = build_unified_context(selected_request, graph=FakeThinkGraph(), read_json=fake_read, read_codegraph_json=fake_read)
    delivered = build_model_context(built["projectionId"], selected_request, graph=FakeThinkGraph(), read_json=fake_read, read_codegraph_json=fake_read)
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


def test_unselected_role_views_are_not_automatically_attached():
    built = build_unified_context(request(), graph=FakeThinkGraph(), read_json=fake_read, read_codegraph_json=fake_read)
    delivered = build_model_context(
        built["projectionId"],
        request(),
        graph=FakeThinkGraph(),
        read_json=fake_read,
        read_codegraph_json=fake_read,
    )
    assert delivered["graphViews"] == []
    assert "thinkgraph:role-view" not in delivered["modelContext"]


def test_unified_exposes_selected_identity_and_lifecycle_without_view_content():
    result = build_unified_context(
        request(active_view_id="thinkgraph:role-view"),
        graph=FakeThinkGraph(),
        read_json=fake_read,
        read_codegraph_json=fake_read,
    )
    assert result["lifecycle"]["selected"] == ["thinkgraph:role-view"]
    assert result["lifecycle"]["consumed"] == ["thinkgraph:spent"]
    assert result["graphViews"][0]["recordCount"] == 1
    assert "records" not in result["graphViews"][0]
    assert {view["viewId"] for view in result["availableGraphViews"]} == {
        "thinkgraph:role-view",
        "codegraph:coder-only",
        "thinkgraph:spent",
    }


def test_explicit_multiple_selection_preserves_order_and_bounded_rendering():
    views = FakeThinkGraph().graph_views("project-1", "main")["views"]
    selected = select_persisted_graph_views(
        views,
        ["codegraph:coder-only", "thinkgraph:role-view"],
        project_id="project-1",
        conversation_id="main",
        receiving_roles={"coder", "main_chat"},
    )
    assert [view["viewId"] for view in selected] == [
        "codegraph:coder-only",
        "thinkgraph:role-view",
    ]
    rendered = render_graph_views(selected)
    assert rendered["measurements"]["records"] == 2
    assert rendered["measurements"]["estimatedTokens"] < 200


def test_graph_view_render_deduplicates_normalized_repository_file_ranges():
    base = {
        "projectId": "project-1",
        "conversationId": "main",
        "authority": "codegraph",
        "status": "attached",
        "records": [],
        "includedRelationships": [],
    }
    rendered = render_graph_views([
        {
            **base,
            "viewId": "codegraph:first",
            "records": [{
                "canonicalId": "first",
                "summary": "First view of the function",
                "filePath": r"C:\Projects\main\apps\backend\src\main.ts",
                "sourceRange": {"startLine": 10, "endLine": 20},
            }],
        },
        {
            **base,
            "viewId": "codegraph:second",
            "records": [{
                "canonicalId": "duplicate",
                "summary": "Same function repeated with different prose",
                "file_path": "c:/projects/main/apps/backend/src/main.ts",
                "source_range": {"endLine": 20, "startLine": 10},
            }],
        },
    ])

    assert rendered["measurements"]["records"] == 1
    assert rendered["measurements"]["uniqueFiles"] == 1
    assert rendered["measurements"]["uniqueSourceRanges"] == 1
    assert rendered["measurements"]["duplicateFileRangeCount"] == 1
    assert "First view of the function" in rendered["text"]
    assert "Same function repeated" not in rendered["text"]


def test_graph_context_limits_are_enforced_before_provider_delivery():
    base = {
        "viewId": "codegraph:oversized",
        "projectId": "project-1",
        "conversationId": "main",
        "authority": "codegraph",
        "status": "attached",
        "includedRelationships": [],
    }
    with pytest.raises(ValueError, match="graph_context_record_limit_exceeded"):
        render_graph_views([{
            **base,
            "records": [
                {"canonicalId": f"record:{index}", "summary": f"record {index}"}
                for index in range(MAX_GRAPH_EVIDENCE_RECORDS + 1)
            ],
        }])

    normal = render_graph_views([{
        **base,
        "records": [{"canonicalId": "record:one", "summary": "bounded"}],
    }])
    assert normal["measurements"]["characters"] <= MAX_GRAPH_CONTEXT_CHARACTERS


@pytest.mark.parametrize(
    ("view_id", "message"),
    [
        ("codegraph:coder-only", "graph_view_role_mismatch"),
        ("thinkgraph:spent", "graph_view_lifecycle_invalid"),
        ("missing", "graph_view_unknown"),
    ],
)
def test_invalid_explicit_view_selection_fails_closed(view_id, message):
    with pytest.raises(ValueError, match=message):
        build_unified_context(
            request(active_view_id=view_id),
            graph=FakeThinkGraph(),
            read_json=fake_read,
            read_codegraph_json=fake_read,
        )


def test_view_scope_and_duplicate_selection_fail_closed():
    views = FakeThinkGraph().graph_views("project-1", "main")["views"]
    with pytest.raises(ValueError, match="graph_view_ids_duplicate"):
        select_persisted_graph_views(
            views,
            ["thinkgraph:role-view", "thinkgraph:role-view"],
            project_id="project-1",
            conversation_id="main",
            receiving_roles={"main_chat"},
        )
    wrong_scope = [{**views[0], "projectId": "other-project"}]
    with pytest.raises(ValueError, match="graph_view_scope_mismatch"):
        select_persisted_graph_views(
            wrong_scope,
            ["thinkgraph:role-view"],
            project_id="project-1",
            conversation_id="main",
            receiving_roles={"main_chat"},
        )


def test_lifecycle_transition_updates_the_persisted_full_view_without_transporting_membership():
    class PersistingThinkGraph(FakeThinkGraph):
        def __init__(self):
            self.saved = []

        def persist_graph_view(self, view):
            self.saved.append(view)
            return {"ok": True, "view": view}

    graph = PersistingThinkGraph()
    identities = transition_persisted_graph_views(
        graph,
        project_id="project-1",
        conversation_id="main",
        view_ids=["thinkgraph:role-view"],
        status="active",
        invocation_id="run-1",
        runtime={"provider": "openai"},
    )
    assert identities == [{
        **identities[0],
        "viewId": "thinkgraph:role-view",
        "status": "active",
        "recordCount": 1,
    }]
    assert graph.saved[0]["records"][0]["summary"] == "Decision Think two"
    assert "records" not in identities[0]
    with pytest.raises(ValueError, match="graph_view_transition_invalid"):
        transition_persisted_graph_views(
            graph,
            project_id="project-1",
            conversation_id="main",
            view_ids=["thinkgraph:role-view"],
            status="consumed",
        )


def test_render_model_context_with_no_role_views_is_honest_not_a_fallback_dump():
    built = build_unified_context(request(), graph=FakeThinkGraph(), read_json=fake_read, read_codegraph_json=fake_read)
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
        return build_unified_context(request(project_id="concurrent"), graph=FakeThinkGraph(), read_json=slow_read, read_codegraph_json=slow_read)

    with ThreadPoolExecutor(max_workers=2) as pool:
        first, second = [future.result(timeout=3) for future in [pool.submit(resolve), pool.submit(resolve)]]
    assert calls == 1
    assert first["projectionId"] == second["projectionId"]
