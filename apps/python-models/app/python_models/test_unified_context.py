from concurrent.futures import ThreadPoolExecutor
import threading
import time

import pytest

from app.python_models import agentgraph
from app.python_models.unified_context import (
    MAX_GRAPH_CONTEXT_CHARACTERS,
    MAX_GRAPH_VIEW_REFERENCES,
    UnifiedContextRequest,
    build_model_context,
    build_unified_context,
    render_graph_views,
    render_model_context,
    select_persisted_graph_views,
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
        base = {"schemaVersion": "graph-view.v1", "projectId": project_id, "conversationId": conversation_id or "main", "authority": "agentgraph", "producingRole": "main_chat", "displayLabel": "Bounded references"}
        return {"ok": True, "views": [
            {**base, "viewId": "thinkgraph:role-view", "status": "attached", "receivingRole": "main_chat",
             "references": [
                 {"referenceId": "think:two", "referenceType": "thinkgraph", "recordKind": "node", "required": True},
                 {"referenceId": "think-edge", "referenceType": "thinkgraph", "recordKind": "edge", "required": True},
                 {"referenceId": "know:one", "referenceType": "knowgraph", "recordKind": "node", "required": False},
                 {"referenceId": "pkg.one", "referenceType": "codegraph", "recordKind": "node", "required": True},
             ]},
            {**base, "viewId": "codegraph:coder-only", "status": "attached", "receivingRole": "coder",
             "references": [{"referenceId": "pkg.one", "referenceType": "codegraph", "required": True}]},
            {**base, "viewId": "thinkgraph:spent", "status": "consumed", "receivingRole": "main_chat",
             "references": [{"referenceId": "think:one", "referenceType": "thinkgraph", "required": False}]},
        ]}


@pytest.fixture(autouse=True)
def _agentgraph_view_store(monkeypatch):
    monkeypatch.setattr(
        agentgraph,
        "list_graph_views",
        lambda *, project_id, conversation_id=None, limit=20, **_kwargs: {
            **FakeThinkGraph().graph_views(project_id, conversation_id),
            "views": FakeThinkGraph().graph_views(project_id, conversation_id)["views"][:limit],
        },
    )


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


def test_no_active_manifest_is_honestly_empty_not_full_authority_data():
    result = build_unified_context(request(), graph=FakeThinkGraph(), read_json=fake_read, read_codegraph_json=fake_read)
    assert result["counts"]["selected"] == {"thinkgraph": 0, "knowgraph": 0, "codegraph": 0}
    assert result["nodes"] == []
    assert result["edges"] == []
    assert result["manifest"]["records"] == []
    assert {warning["code"] for warning in result["warnings"]} == {
        "no_active_context_manifest",
        "missing_authority_mapping",
    }


def test_selected_native_membership_is_materialized_from_one_manifest():
    result = build_unified_context(request(active_view_id="thinkgraph:role-view"), graph=FakeThinkGraph(), read_json=fake_read, read_codegraph_json=fake_read)
    code = next(node for node in result["nodes"] if node["source_id"] == "pkg.one")
    assert all(isinstance(code[axis], float) for axis in ("x", "y", "z"))
    assert result["identity"]["codeGraphProjectId"] == "C-Projects-main"
    assert {node["source_id"] for node in result["nodes"]} == {
        "think:one",
        "think:two",
        "know:one",
        "pkg.one",
    }
    assert [(edge["type"], edge["cross_authority"]) for edge in result["edges"]] == [
        ("RELATES_TO", False)
    ]
    records = result["manifest"]["records"]
    assert [record["deliveryOrder"] for record in records] == list(range(5))
    assert all(record["representationHash"] and record["characters"] > 0 for record in records)
    assert result["manifest"]["nodeCount"] == 4
    assert result["manifest"]["edgeCount"] == 1


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
    result = build_unified_context(request(active_view_id="thinkgraph:role-view"), graph=FakeThinkGraph(), read_json=partial_read, read_codegraph_json=fake_read)
    assert result["counts"]["selected"] == {"thinkgraph": 3, "knowgraph": 0, "codegraph": 1}
    assert {warning["code"] for warning in result["warnings"]} >= {
        "authority_unavailable",
        "optional_reference_unavailable",
    }
    assert "know:one" not in {node["source_id"] for node in result["nodes"]}


def test_model_context_uses_the_same_projection_identity():
    built = build_unified_context(request(), graph=FakeThinkGraph(), read_json=fake_read, read_codegraph_json=fake_read)
    delivered = build_model_context(built["projectionId"], request(), graph=FakeThinkGraph(), read_json=fake_read, read_codegraph_json=fake_read)
    assert delivered["projectionId"] == built["projectionId"]
    with pytest.raises(ValueError, match="projection_superseded"):
        build_model_context("unified:wrong", request(), graph=FakeThinkGraph(), read_json=fake_read, read_codegraph_json=fake_read)


def test_model_and_unified_use_identical_selected_manifest_membership():
    selected_request = request(active_view_id="thinkgraph:role-view")
    built = build_unified_context(selected_request, graph=FakeThinkGraph(), read_json=fake_read, read_codegraph_json=fake_read)
    delivered = build_model_context(built["projectionId"], selected_request, graph=FakeThinkGraph(), read_json=fake_read, read_codegraph_json=fake_read)
    text = delivered["modelContext"]
    assert "[DELIVERED_GRAPH_CONTEXT]" in text
    assert '"nativeId":"think:two"' in text
    assert '"nativeId":"think-edge"' in text
    assert '"nativeId":"know:one"' in text
    assert '"nativeId":"pkg.one"' in text
    # Other-role and spent-lifecycle views never leak in.
    assert "codegraph:coder-only" not in text
    assert "thinkgraph:spent" not in text
    assert "pkg.two" not in text and "know:two" not in text
    assert {
        (record["authority"], record["kind"], record["nativeId"])
        for record in delivered["manifest"]["records"]
    } == {
        (node["authority"], "node", node["source_id"])
        for node in built["nodes"]
    } | {
        (
            "thinkgraph",
            "edge",
            edge["id"].removeprefix("thinkgraph:"),
        )
        for edge in built["edges"]
    }
    # Lifecycle views returned for runtime stamping are exactly the role views.
    assert [view["viewId"] for view in delivered["graphViews"]] == ["thinkgraph:role-view"]
    measurements = delivered["measurements"]
    assert set(measurements["sections"]) == {"header", "records", "unresolved", "retrieval"}
    assert measurements["views"]["thinkgraph:role-view"]["references"] == 4
    assert measurements["manifestHash"] == built["manifest"]["manifestHash"]


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
    assert result["graphViews"][0]["referenceCount"] == 4
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
    assert rendered["measurements"]["references"] == 5
    assert rendered["measurements"]["estimatedTokens"] < 200


def test_graph_view_render_carries_reference_identities_without_payloads():
    base = {
        "projectId": "project-1",
        "conversationId": "main",
        "authority": "agentgraph",
        "status": "attached",
        "displayLabel": "Code references",
        "producingRole": "main_chat",
        "receivingRole": "coder",
    }
    rendered = render_graph_views([
        {
            **base,
            "viewId": "codegraph:first",
            "references": [{"referenceId": "symbol:first", "referenceType": "codegraph", "required": True}],
        },
        {
            **base,
            "viewId": "codegraph:second",
            "references": [{"referenceId": "symbol:second", "referenceType": "codegraph", "required": False}],
        },
    ])

    assert rendered["measurements"]["references"] == 2
    assert "codegraph -> symbol:first [required]" in rendered["text"]
    assert "codegraph -> symbol:second" in rendered["text"]


def test_graph_context_limits_are_enforced_before_provider_delivery():
    base = {
        "viewId": "codegraph:oversized",
        "projectId": "project-1",
        "conversationId": "main",
        "authority": "agentgraph",
        "status": "attached",
        "displayLabel": "Oversized",
        "producingRole": "main_chat",
        "receivingRole": "coder",
    }
    with pytest.raises(ValueError, match="graph_view_reference_limit_exceeded"):
        render_graph_views([{
            **base,
            "references": [
                {"referenceId": f"record:{index}", "referenceType": "codegraph"}
                for index in range(MAX_GRAPH_VIEW_REFERENCES + 1)
            ],
        }])

    normal = render_graph_views([{
        **base,
        "references": [{"referenceId": "record:one", "referenceType": "codegraph"}],
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


def test_render_model_context_with_no_role_views_is_honest_not_a_fallback_dump():
    built = build_unified_context(request(), graph=FakeThinkGraph(), read_json=fake_read, read_codegraph_json=fake_read)
    rendered = render_model_context(built, [])
    assert "records: 0" in rendered["text"]
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
        return build_unified_context(request(project_id="concurrent", active_view_id="thinkgraph:role-view"), graph=FakeThinkGraph(), read_json=slow_read, read_codegraph_json=slow_read)

    with ThreadPoolExecutor(max_workers=2) as pool:
        first, second = [future.result(timeout=3) for future in [pool.submit(resolve), pool.submit(resolve)]]
    assert calls == 1
    assert first["projectionId"] == second["projectionId"]
