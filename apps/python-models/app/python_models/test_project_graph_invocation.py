"""Isolated admission and native pre-persistence boundary checks; no product writes."""
# Graph + less = more: less code that does the same work as more code is more useful.
# Entity names the feature; Relationship explains why this file belongs and what it contributes.
# Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
# Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
# Entity: Project Knowledge Graph
# Relationship: Verifies immutable research scope through the existing source-event and native admission boundaries.
# Entity: KnowGraph
# Relationship: Exercises native Graphiti bulk persistence rejection before an automatic request can introduce a new name.
# Entity: Authentication
# Relationship: Verifies Project-context reads reject callers without the supervised process credential and admitted native scope.
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import json
from types import SimpleNamespace

import pytest
from engraphis.service import MemoryService

from app.python_models import project_graph_invocation as invocation
from app.python_models import knowgraph_research as research


@pytest.fixture
def ledger(tmp_path, monkeypatch):
    service = MemoryService.create(str(tmp_path / "events.sqlite"))
    service.store.get_or_create_workspace("project-a")
    monkeypatch.setattr(invocation, "get_service", lambda _: service)
    monkeypatch.setattr(invocation, "project_principal", lambda _: {"id": "owner"})
    yield service
    service.close()


def test_native_main_scope_comes_from_admitted_message_not_later_profile_project(ledger, monkeypatch):
    ledger.record_event("conversation_message", json.dumps({
        "projectId": "project-a", "role": "user", "content": "Research PL", "providerContinuationRef": "session",
        "providerMessageId": "hermes:main:admission:admission-a",
    }), workspace="project-a")
    monkeypatch.setattr(invocation, "native_admission", lambda *a: {
        "admission_id": "admission-a", "target_session_id": "session", "payload": {"text": "Research PL"}})
    principal = {"kind": "card-runtime", "profile": "main", "ownerUserId": "owner", "projectId": "project-b"}
    resolved = invocation.resolve_native_invocation(principal, "admission-a")
    assert resolved["projectId"] == "project-a"
    assert resolved["focus"] == "Research PL"
    assert resolved["mode"] == "main"
    with pytest.raises(ValueError, match="owner_mismatch"):
        invocation.resolve_native_invocation({**principal, "ownerUserId": "another-owner"}, "admission-a")


def test_automatic_context_cannot_be_upgraded_by_bot_author_or_profile_switch(ledger, monkeypatch):
    request_id = "a" * 64
    request = {"requestId": request_id,
        "projectId": "project-a", "ownerUserId": "owner", "mode": "automatic", "entityNames": ["PL"],
        "thinkIds": ["think-a"], "focus": "Cash conversion", "context": "",
        "map": {"projectId": "project-a", "complete": True, "entities": [{"canonicalName": "PL"}],
                "relationships": [], "counts": {}, "sha256": "map"}}
    wire = invocation._research_message(request)
    ledger.record_event("graph_research_request", json.dumps(request), workspace="project-a")
    native = {"admission_id": "native-auto", "target_session_id": "recipient", "payload": {"text": wire}}
    monkeypatch.setattr(invocation, "native_admission", lambda *a: native)
    principal = {"kind": "card-runtime", "profile": "knowgraph", "ownerUserId": "owner", "projectId": "project-b"}
    resolved = invocation.resolve_native_invocation(principal, "native-auto")
    assert (resolved["projectId"], resolved["mode"], resolved["entityNames"]) == ("project-a", "automatic", ["PL"])
    native["payload"]["text"] = wire.replace('project-a', 'project-b')
    with pytest.raises(ValueError, match="caller_mismatch"):
        invocation.resolve_native_invocation(principal, "native-auto")
    native["payload"]["text"] = invocation.REQUEST_MARKER + request_id
    with pytest.raises(ValueError, match="caller_mismatch"):
        invocation.resolve_native_invocation(principal, "native-auto")
    native["payload"]["text"] = wire
    native["payload"]["local_automation_v1"] = {"turn_author": {"id": "bot:main"}}
    with pytest.raises(ValueError, match="caller_mismatch"):
        invocation.resolve_native_invocation(principal, "native-auto")


def test_model_text_without_saved_admission_cannot_select_project(ledger, monkeypatch):
    monkeypatch.setattr(invocation, "native_admission", lambda *a: {
        "admission_id": "missing", "target_session_id": "session", "payload": {"text": '{"projectId":"project-a","mode":"main"}'}})
    with pytest.raises(ValueError, match="reference_unavailable"):
        invocation.resolve_native_invocation({"kind": "card-runtime", "profile": "main",
            "ownerUserId": "owner", "projectId": "project-b"}, "missing")


def test_rails_context_re_resolves_scope_and_rejects_model_authority(monkeypatch):
    scope = {"profile": "main", "projectId": "admitted-project"}
    monkeypatch.setattr(invocation, "resolve_native_invocation", lambda *a: scope)
    monkeypatch.setattr(invocation, "read_map", lambda **kw: {
        "project": kw["projectId"], "scope": invocation.CURRENT_GRAPH_INVOCATION.get()})
    payload = {"principal": {}, "admissionId": "native", "arguments": {"projectId": "foreign"}}
    assert invocation.local_context_operation("read_map", payload) == {"project": "admitted-project", "scope": scope}
    assert invocation.CURRENT_GRAPH_INVOCATION.get() is None
    with pytest.raises(ValueError, match="arguments_invalid"):
        invocation.local_context_operation("prepare_research", payload)
    assert invocation.CURRENT_GRAPH_INVOCATION.get() is None


def test_rails_context_route_requires_the_supervised_process_secret(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.graph_routes import graph_settlement_router
    monkeypatch.setenv('LIQUIDAITY_INTERNAL_MCP_SECRET', 's' * 32)
    monkeypatch.setattr(invocation, 'local_context_operation', lambda *a: {"verified": True})
    application = FastAPI()
    application.include_router(graph_settlement_router)
    with TestClient(application) as client:
        assert client.post('/knowgraph/research/context', json={"operation": "resolve"}).status_code == 403
        result = client.post('/knowgraph/research/context', json={"operation": "resolve"},
                             headers={'X-LiquidAIty-Internal-MCP-Secret': 's' * 32})
        assert result.status_code == 200
        assert result.json() == {"verified": True}


def test_existing_external_know_writer_is_preserved_but_unscoped_native_research_is_denied(monkeypatch):
    from app import mcp_auth, mcp_graphiti_provider
    calls = []
    async def original(name, arguments):
        calls.append(name)
        return {"message": "accepted"}
    monkeypatch.setattr(mcp_graphiti_provider, '_GRAPHITI_MODULE', SimpleNamespace(mcp=SimpleNamespace(call_tool=original)))
    monkeypatch.setattr(mcp_auth, 'internal_mcp_principal', lambda: None)
    assert asyncio.run(mcp_graphiti_provider.call_graphiti_tool('add_know', {})) == {"message": "accepted"}
    monkeypatch.setattr(mcp_auth, 'internal_mcp_principal', lambda: {"kind": "card-runtime", "profile": "knowgraph"})
    with pytest.raises(PermissionError, match='invocation_required'):
        asyncio.run(mcp_graphiti_provider.call_graphiti_tool('add_know', {}))
    assert calls == ['add_know']


def test_research_retry_reuses_original_map_and_request_identity(ledger, monkeypatch):
    from app.python_models import project_entity_map
    graph = {"projectId": "project-a", "complete": True, "entities": [{"canonicalName": "PL"}],
             "relationships": [], "counts": {}, "sha256": "original-map"}
    monkeypatch.setattr(project_entity_map, "build_project_entity_map", lambda _: graph)
    token = invocation.CURRENT_GRAPH_INVOCATION.set({"profile": "main", "projectId": "project-a", "nativeAdmissionId": "parent"})
    try:
        arguments = dict(projectId="project-a", entityNames=["PL"], thinkIds=[], focus="Cash conversion")
        first = invocation.prepare_research(**arguments)
        envelope = json.loads(first["message"].partition("\n")[2])
        assert json.loads(envelope["input"])["research"]["focus"] == "Cash conversion"
        assert envelope["projectMapContext"]["pairReference"] == first["requestId"]
        graph["entities"] = [{"canonicalName": "Different current map"}]
        assert invocation.prepare_research(**arguments) == first
        rows = ledger.store.conn.execute("SELECT content FROM events WHERE kind='graph_research_request'").fetchall()
        assert len(rows) == 1
        assert json.loads(rows[0]["content"])["map"]["entities"] == [{"canonicalName": "PL"}]
    finally:
        invocation.CURRENT_GRAPH_INVOCATION.reset(token)


def test_message_projection_omits_only_zero_weights_without_mutating_provider_map():
    graph = {"projectId": "a", "complete": True, "entities": [], "counts": {}, "sha256": "source-map",
             "relationships": [{"state": {"distribution": {"SUPPORTS": .8, "AFFECTS": .2, "IS_A": 0}}}]}
    request = {"requestId": "a" * 64, "projectId": "a", "ownerUserId": "owner", "mode": "main",
               "entityNames": ["PL"], "thinkIds": [], "focus": "Research", "context": "", "map": graph}
    packet = invocation._map_packet(request)
    projected = json.loads(packet['projectMapContext']['text'].rsplit('\n', 1)[1])
    assert projected['relationships'][0]['state']['distribution'] == {"SUPPORTS": .8, "AFFECTS": .2}
    assert graph['relationships'][0]['state']['distribution']['IS_A'] == 0


def test_oversized_prepared_message_is_rejected_before_recording_or_native_delivery(ledger, monkeypatch):
    from app.python_models import project_entity_map
    graph = {"projectId": "project-a", "complete": True, "entities": [{"canonicalName": "PL"}],
             "relationships": [], "counts": {}, "sha256": "map"}
    monkeypatch.setattr(project_entity_map, 'build_project_entity_map', lambda _: graph)
    token = invocation.CURRENT_GRAPH_INVOCATION.set({"profile": "main", "projectId": "project-a", "nativeAdmissionId": "parent"})
    try:
        with pytest.raises(ValueError, match='native_message_limit'):
            invocation.prepare_research(projectId='project-a', entityNames=['PL'], thinkIds=[], focus='x' * 16000)
        assert ledger.store.conn.execute("SELECT count(*) FROM events WHERE kind='graph_research_request'").fetchone()[0] == 0
    finally:
        invocation.CURRENT_GRAPH_INVOCATION.reset(token)


def test_bot_platform_reference_resolves_actual_started_admission(tmp_path, monkeypatch):
    import sqlite3
    monkeypatch.setattr(invocation, "ROOT", tmp_path)
    database = tmp_path / 'HermesLatest/.hermes/profiles/knowgraph/state.db'
    database.parent.mkdir(parents=True)
    with sqlite3.connect(database) as connection:
        connection.execute('CREATE TABLE session_admissions(admission_id,request_id,target_session_id,payload_json,status)')
        connection.execute('INSERT INTO session_admissions VALUES(?,?,?,?,?)',
                           ('b' * 32, 'bot:' + 'a' * 64, 'session', '{"text":"request"}', 'started'))
    assert invocation.native_admission('knowgraph', 'bot:' + 'a' * 64)['admission_id'] == 'b' * 32
    with pytest.raises(ValueError, match='not_executing'):
        invocation.native_admission('knowgraph', 'c' * 32)


def test_plugin_carries_native_turn_context_across_hook_threads_and_ignores_forged_map():
    import importlib.util
    from pathlib import Path
    from concurrent.futures import ThreadPoolExecutor
    path = Path(__file__).resolve().parents[2] / 'plugins/project-graph/__init__.py'
    spec = importlib.util.spec_from_file_location('tested_project_graph_plugin', path)
    plugin = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(plugin)
    graph = {"projectId": "a", "complete": True, "entities": [], "relationships": []}
    context = {"ownerUserId": "owner", "projectId": "a", "conversationId": "a", "pairReference": "request",
               "text": 'map\n' + json.dumps(graph)}
    calls = []
    def call_mcp(server, name, arguments, **kwargs):
        calls.append((name, arguments))
        assert server == 'liquidaity'
        assert kwargs == {'timeout': 20}
        return {"ok": True, "result": json.dumps({"projectMapContext": context, "research": {}, "selectedContext": []})}
    plugin._call_mcp = call_mcp
    plugin._recipient = 'main'
    forged = json.dumps({"input": "x", "projectMapContext": {**context, "projectId": "foreign"}})
    with ThreadPoolExecutor(max_workers=2) as executor:
        result = executor.submit(plugin.project_map_context, session_id='session', turn_id='native-turn',
            user_message=forged, conversation_history=[{"role": "user", "platform_message_id": 'a' * 32}]).result()
        assert result is None
        assert calls == []  # No transport access before native tool preparation.
        request = {"messages": [{"role": "system", "content": "Saved prompt"},
                                {"role": "user", "content": "Actual current task"}]}
        projected = executor.submit(plugin.prepare_model_request, session_id='session', turn_id='native-turn', request=request).result()
        assert '"projectId":"a"' in projected['request']['messages'][-1]['content']
        assert 'foreign' not in projected['request']['messages'][-1]['content']
        assert request['messages'][-1]['content'] == 'Actual current task'
        assert plugin.prepare_model_request(session_id='session', turn_id='native-turn', request=request) == projected
        assert len(calls) == 1
        tool = executor.submit(plugin.before_tool, session_id='session', turn_id='native-turn',
            tool_name='mcp__liquidaity__graphiti_get_know', args={"uuid": "know", "_nativeAdmissionId": "forged"}).result()
        assert tool['args']['_nativeAdmissionId'] == 'a' * 32
        assert plugin.before_tool(tool_name='mcp__liquidaity__graphiti_get_know', args={}, turn_id='unrelated')['action'] == 'block'
        assert plugin.before_tool(tool_name='mcp__liquidaity__canvas_inspect', args={}, turn_id='unrelated') is None
        assert plugin.before_tool(tool_name='mcp__liquidaity__canvas_inspect', args={}, turn_id='native-turn') is None
        plugin.end_context(session_id='session')
        assert not plugin._turn_context
    assert calls[0][1] == {"_nativeAdmissionId": 'a' * 32}
    assert calls[0][0] == 'project_graph.read_map'


def test_prepared_know_request_contains_assignment_and_map_without_mcp_lookup():
    import importlib.util
    from pathlib import Path
    path = Path(__file__).resolve().parents[2] / 'plugins/project-graph/__init__.py'
    spec = importlib.util.spec_from_file_location('prepared_know_plugin', path)
    plugin = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(plugin)
    plugin._recipient = 'knowgraph'
    def disconnected(*a, **kw):
        raise AssertionError('Prepared context must not require MCP reconnection')
    plugin._call_mcp = disconnected
    record = {"requestId": "a" * 64, "projectId": "project-a", "ownerUserId": "owner", "mode": "main",
              "entityNames": ["PL"], "thinkIds": ["think-a"], "focus": "Verify cash conversion", "context": "",
              "selectedContext": [{"thinkId": "think-a", "sources": ["Exact source excerpt"]}],
              "map": {"projectId": "project-a", "complete": True, "entities": [{"canonicalName": "PL"}],
                      "relationships": [], "counts": {}, "sha256": "map"}}
    wire = 'Message from Main: ' + invocation._research_message(record)
    hook = plugin.project_map_context(session_id='know', turn_id='turn', user_message=wire,
        conversation_history=[{"role": "user", "platform_message_id": "bot:" + "b" * 64}])
    request = {"messages": [{"role": "system", "content": "Saved Card prompt"},
                            {"role": "user", "content": "Unrelated old conversation"},
                            {"role": "user", "content": wire + '\n\n' + hook['context']}]}
    result = plugin.prepare_model_request(request=request, session_id='know', turn_id='turn')['request']['messages']
    assert len(result) == 2
    content = result[-1]['content']
    assert 'Verify cash conversion' in content and 'Exact source excerpt' in content
    assert content.count('### Current Project Entity Map') == 1
    assert 'PROJECT_RESEARCH_REQUEST:' not in content and 'projectMapContext' not in content
    assert 'Unrelated old conversation' not in content
    tool = plugin.before_tool(tool_name='mcp__liquidaity__graphiti_add_know', args={}, turn_id='turn')
    assert tool['args']['_nativeAdmissionId'] == 'bot:' + 'b' * 64
    plugin.end_context(session_id='know', turn_id='turn')
    assert not plugin._turn_context


def test_names_use_native_normalization_and_never_cross_project():
    scope = {"projectId": "a", "mode": "automatic", "map": {"entities": [{"canonicalName": "PL"}]}}
    research.validate_names(scope, [{"name": "  pl ", "group_id": "liquidaity-a"}])
    with pytest.raises(PermissionError, match="new_entity_name"):
        research.validate_names(scope, [{"name": "Unrelated company", "group_id": "liquidaity-a"}])
    with pytest.raises(PermissionError, match="scope_mismatch"):
        research.validate_names(scope, [{"name": "PL", "group_id": "liquidaity-b"}])
    research.validate_names({**scope, "mode": "main"}, [{"name": "New focused subject", "group_id": "liquidaity-a"}])


def test_native_extraction_bulk_cannot_persist_a_new_automatic_name():
    from graphiti_core.driver.driver import GraphProvider
    from graphiti_core.nodes import EntityNode
    from graphiti_core.utils.bulk_utils import add_nodes_and_edges_bulk_tx
    calls = []
    class Transaction:
        async def run(self, query, **kwargs):
            calls.append(kwargs)
    async def check():
        scope = {"projectId": "a", "mode": "automatic", "map": {"entities": [{"canonicalName": "PL"}]}}
        token = research._WRITE_SCOPE.set(scope)
        try:
            with pytest.raises(PermissionError, match="new_entity_name"):
                await add_nodes_and_edges_bulk_tx(Transaction(), [], [], [
                    EntityNode(name="PL", group_id="liquidaity-a", name_embedding=[1.0]),
                    EntityNode(name="New extracted subject", group_id="liquidaity-a", name_embedding=[1.0]),
                ], [], None, SimpleNamespace(provider=GraphProvider.NEO4J, graph_operations_interface=research.ResearchGraphOperations()))
            assert not any("nodes" in call for call in calls)
        finally:
            research._WRITE_SCOPE.reset(token)
    asyncio.run(check())


@pytest.mark.parametrize('missing_entity', [False, True])
@pytest.mark.parametrize('jev_failure', [False, True])
def test_queued_write_retains_admitted_scope_after_context_switch(monkeypatch, missing_entity, jev_failure):
    from app.python_models import canonical_entity_directory, engraphis
    captured = []
    monkeypatch.setattr(engraphis, "project_principal", lambda _: {"id": "owner"})
    monkeypatch.setattr(canonical_entity_directory, "build_canonical_entity_directory", lambda _: {"entities": [{"canonicalName": "PL"}]})
    monkeypatch.setattr(research, "rails_context", lambda *a, **kw: {"entities": [{"canonicalName": "PL"}]})
    async def jev(*a, **kw):
        if jev_failure:
            raise RuntimeError('assessment_unavailable')
        return {"status": "current"}
    monkeypatch.setattr(research, "settle_relationships", jev)
    notifications = []
    monkeypatch.setattr(research, "notify_graph", lambda scope: notifications.append(scope['projectId']))
    from graphiti_core.nodes import EntityNode
    from graphiti_core.errors import NodeNotFoundError
    from app.application_tool_error import ApplicationToolError
    async def missing(*a, **kw): raise NodeNotFoundError('engraphis-id')
    monkeypatch.setattr(EntityNode, 'get_by_uuid', missing)
    async def check():
        admitted = asyncio.Event()
        class Queue:
            async def add_episode_task(self, group, process):
                self.process = process
                admitted.set()
        class Driver:
            async def execute_query(self, *a, **kw): return ([{"uuid": "know", "origins": [kw["origin"]]}], None, None)
        know = SimpleNamespace(uuid="know", entity_edges=[], content="Source evidence")
        class Client:
            driver = Driver()
            async def add_know(self, **kw):
                captured.append((kw["group_id"], research._WRITE_SCOPE.get()["mode"]))
                return SimpleNamespace(know=know, episode_results=SimpleNamespace(edges=[], nodes=[]), created=True, entity_created=True)
            async def get_know(self, *a, **kw): return know
        module = SimpleNamespace(queue_service=Queue(), graphiti_client=Client(),
            graphiti_service=SimpleNamespace(entity_types=None, edge_types=None, edge_type_map=None),
            parse_reference_time=lambda _: datetime.now(timezone.utc), _know_result=lambda _: {"uuid": "know"})
        scope = {"projectId": "a", "ownerUserId": "owner", "profile": "knowgraph", "mode": "automatic",
                 "map": {"entities": [{"canonicalName": "PL"}]}, "requestId": "request-a", "entityNames": ["PL"],
                 "thinkIds": ["think-a"], "focus": "Cash conversion"}
        token = invocation.CURRENT_GRAPH_INVOCATION.set(scope)
        try:
            task = asyncio.create_task(research.add_research_know(module, {"name": "Finding", "entity_name": "PL",
                "observation": "Observation", "interpretation": "Interpretation", "group_id": "liquidaity-a",
                **({'entity_uuid': 'engraphis-id'} if missing_entity else {}),
                "citation": {"url": "https://example.test/source", "title": "Source", "publisher": "Publisher", "evidence": "An exact passage of source evidence."}}))
            ready = asyncio.create_task(admitted.wait())
            await asyncio.wait({task, ready}, timeout=3, return_when=asyncio.FIRST_COMPLETED)
            if task.done():
                task.result()  # Surface preparation failure instead of hanging on the queue signal.
            assert ready.done(), "native queue admission was not reached"
            invocation.CURRENT_GRAPH_INVOCATION.set({**scope, "projectId": "b", "mode": "main"})
            await module.queue_service.process()
            if missing_entity:
                with pytest.raises(ApplicationToolError, match='omit entity_uuid'):
                    await task
                assert captured == []
                assert notifications == []
                return
            result = await task
            assert captured == [("liquidaity-a", "automatic")]
            assert result["know"]["researchOrigins"][0]["requestId"] == "request-a"
            assert result['status'] == ('partial' if jev_failure else 'completed')
            assert notifications == ['a']
        finally:
            invocation.CURRENT_GRAPH_INVOCATION.reset(token)
    asyncio.run(check())
