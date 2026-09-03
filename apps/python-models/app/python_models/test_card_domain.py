from __future__ import annotations

import json

import pytest

from app.python_models import card_domain


def _agent(card_id: str, **overrides):
    card = {
        "id": card_id,
        "kind": "agent",
        "templateId": "template_assist",
        "title": card_id,
        "prompt": "common prompt",
        "runtime": {"kind": "autogen", "mode": "assistant"},
        "runtimeOptions": {
            "provider": "openrouter",
            "modelKey": "deepseek/deepseek-v4-flash-0731",
            "providerModelId": "deepseek/deepseek-v4-flash-0731",
            "accessMode": "openrouter-api",
            "tools": [],
        },
        "position": {"x": 0, "y": 0},
    }
    card.update(overrides)
    return card


def _expected_delegate(card_id: str = "child") -> dict:
    return {
        "cardId": card_id,
        "title": card_id,
        "profile": "coder",
        "description": "",
        "cardRevisionId": "revision-2" if card_id == "child" else "revision-2",
    }


def test_agent_builder_run_resolves_one_exact_non_system_card_target(monkeypatch) -> None:
    builder = _agent(
        "builder",
        runtime={
            "kind": "hermes", "mode": "delegate",
            "profile": "liquidaity-agent-builder",
        },
        runtimeOptions={
            **_agent("x")["runtimeOptions"],
            "tools": ["card.update_configuration"],
            "skills": ["agent-builder-inspection"],
        },
    )
    target = _agent(
        "selected",
        title="Selected Assistant",
        role="Selected specialist",
        prompt="Old prompt",
        runtimeOptions={**_agent("x")["runtimeOptions"], "tools": ["web_search"]},
    )
    for number, card in enumerate((builder, target), start=1):
        card["_cardRevisionId"] = f"revision-{number}"
        card["_cardRevision"] = number
        card["_cardRevisionSha256"] = f"sha-{number}"
    monkeypatch.setattr(card_domain, "_load_deck_internal", lambda *_args: {
        "projectId": "project-one",
        "meta": {"deckRevision": "deck-revision-one"},
        "deck": {
            "nodes": [builder, target],
            "edges": [],
            "workspaceRoot": "C:/Projects/agents",
        },
    })

    prepared = card_domain._prepare_invocation({
        "projectId": "project-one",
        "deckId": "deck_builder",
        "cardId": "builder",
        "assignment": "Update the selected Card prompt and tools.",
        "builderOperation": {
            "mode": "edit",
            "expectedDeckRevision": "deck-revision-one",
            "targetCardId": "selected",
            "targetCardRevisionId": "revision-2",
            "prompt": "New prompt",
            "tools": ["web_search"],
        },
    })

    assert prepared["buildTarget"] == {
        "cardId": "selected",
        "cardRevisionId": "revision-2",
        "deckRevision": "deck-revision-one",
        "title": "Selected Assistant",
        "templateId": "template_assist",
        "role": "Selected specialist",
        "prompt": "Old prompt",
        "outputContract": None,
        "runtime": {"kind": "autogen", "mode": "assistant"},
        "runtimeOptions": target["runtimeOptions"],
    }
    assert prepared["builderOperation"] == {
        "mode": "edit",
        "deckRevision": "deck-revision-one",
        "workspaceRoot": "C:/Projects/agents",
        "cbmProject": None,
        "allowedFields": ["prompt", "tools"],
        "templateId": "template_assist",
        "title": "Selected Assistant",
        "role": "Selected specialist",
        "prompt": "New prompt",
        "tools": ["web_search"],
        "targetCardId": "selected",
        "targetCardRevisionId": "revision-2",
    }
    assert prepared["builderGuidance"]["vision"]["sourcePath"] == "PLAN.md"
    assert prepared["builderGuidance"]["idd"]["content"]["template"]["id"] == (
        "template_assist"
    )
    assert prepared["builderGuidance"]["skill"]["content"].startswith("---")

    with pytest.raises(
        card_domain.CardDomainError, match="agent_builder_deck_revision_stale"
    ):
        card_domain._prepare_invocation({
            "projectId": "project-one",
            "deckId": "deck_builder",
            "cardId": "builder",
            "assignment": "Use no stale deck.",
            "builderOperation": {
                "mode": "edit",
                "expectedDeckRevision": "stale-deck-revision",
                "targetCardId": "selected",
                "targetCardRevisionId": "revision-2",
                "prompt": "New prompt",
                "tools": ["web_search"],
            },
        })

    with pytest.raises(
        card_domain.CardDomainError, match="agent_builder_target_revision_stale"
    ):
        card_domain._prepare_invocation({
            "projectId": "project-one",
            "deckId": "deck_builder",
            "cardId": "builder",
            "assignment": "Use no stale Card.",
            "builderOperation": {
                "mode": "edit",
                "expectedDeckRevision": "deck-revision-one",
                "targetCardId": "selected",
                "targetCardRevisionId": "stale-card-revision",
                "prompt": "New prompt",
                "tools": ["web_search"],
            },
        })


def test_agent_builder_run_materializes_one_idd_backed_create_operation(monkeypatch) -> None:
    builder = _agent(
        "builder",
        runtime={
            "kind": "hermes", "mode": "delegate",
            "profile": "liquidaity-agent-builder",
        },
        runtimeOptions={
            **_agent("x")["runtimeOptions"],
            "tools": ["card.create", "cbm.search_graph", "cbm.detect_changes"],
            "skills": ["agent-builder-inspection"],
        },
    )
    builder["_cardRevisionId"] = "revision-builder"
    builder["_cardRevision"] = 1
    builder["_cardRevisionSha256"] = "sha-builder"
    monkeypatch.setattr(card_domain, "_load_deck_internal", lambda *_args: {
        "projectId": "project-one",
        "meta": {"deckRevision": "deck-revision-one"},
        "deck": {
            "nodes": [builder],
            "edges": [],
            "workspaceRoot": "C:/Projects/agents",
        },
    })
    model = {
        "provider": "openai",
        "modelKey": "gpt-5.6-luna",
        "providerModelId": "gpt-5.6-luna",
        "accessMode": "chatgpt-account",
    }

    payload = {
        "projectId": "project-one",
        "deckId": "deck_builder",
        "cardId": "builder",
        "assignment": "Create the configured ordinary Card.",
        "builderOperation": {
            "mode": "create",
            "expectedDeckRevision": "deck-revision-one",
            "templateId": "template_assist",
            "title": "Portfolio Planner",
            "role": "Plans and journals assigned paper trades.",
            "prompt": "Return a bounded trade plan with citations.",
            "tools": ["web_search"],
            "model": model,
        },
        "configuredModels": [{
            "provider": "openai",
            "key": "gpt-5.6-luna",
            "providerModelId": "gpt-5.6-luna",
            "label": "Luna",
        }],
    }
    prepared = card_domain._prepare_invocation(payload)

    assert prepared["buildTarget"] is None
    assert prepared["builderOperation"] == {
        "mode": "create",
        "deckRevision": "deck-revision-one",
        "workspaceRoot": "C:/Projects/agents",
        "cbmProject": None,
        "allowedFields": [
            "templateId", "title", "role", "prompt", "runtime", "model", "tools",
        ],
        "templateId": "template_assist",
        "title": "Portfolio Planner",
        "role": "Plans and journals assigned paper trades.",
        "prompt": "Return a bounded trade plan with citations.",
        "tools": ["web_search"],
        "runtime": {"kind": "autogen", "mode": "assistant"},
        "model": model,
    }
    assert "cbm.search_graph" not in prepared["_callConfig"]["enabledTools"]
    assert "cbm.search_graph" not in prepared["_callConfig"]["presentedTools"]
    assert "cbm.detect_changes" not in prepared["_callConfig"]["enabledTools"]
    assert "cbm.detect_changes" not in prepared["_callConfig"]["presentedTools"]
    code_payload = {
        **payload,
        "builderOperation": {
            **payload["builderOperation"],
            "cbmProject": "C-Projects-agents",
        },
    }
    code_prepared = card_domain._prepare_invocation(code_payload)
    assert "cbm.search_graph" in code_prepared["_callConfig"]["enabledTools"]
    assert "cbm.search_graph" in code_prepared["_callConfig"]["presentedTools"]
    assert "cbm.detect_changes" in code_prepared["_callConfig"]["enabledTools"]
    assert "cbm.detect_changes" in code_prepared["_callConfig"]["presentedTools"]
    assert prepared["builderGuidance"]["idd"]["content"]["operations"] == [
        {
            "id": "canvas.inspect", "access": "read", "publication": "external-mcp",
            "sourceIds": ["main_mcp"], "namespace": "main", "kind": "tool",
        },
        {
            "id": "card.create", "access": "write", "publication": "external-mcp",
            "sourceIds": ["main_mcp"], "namespace": "main", "kind": "tool",
        },
        {
            "id": "web_search", "access": "read", "publication": "external-mcp",
            "sourceIds": ["main_mcp", "autogen"], "namespace": "main", "kind": "tool",
        },
    ]


def test_agent_builder_guidance_fails_visibly_for_missing_sources(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    operation = {
        "mode": "edit", "templateId": "template_assist", "tools": [],
    }
    monkeypatch.setattr(card_domain, "AGENT_BUILDER_VISION_PATH", tmp_path / "missing-plan")
    with pytest.raises(card_domain.CardDomainError, match="agent_builder_vision_missing"):
        card_domain._agent_builder_guidance(
            operation, selected_skills=["agent-builder-inspection"]
        )

    monkeypatch.setattr(card_domain, "AGENT_BUILDER_VISION_PATH", card_domain._REPOSITORY_ROOT / "PLAN.md")
    monkeypatch.setattr(
        card_domain, "load_input_data_dictionary",
        lambda: (_ for _ in ()).throw(card_domain.IddValidationError("idd_load_failed")),
    )
    with pytest.raises(card_domain.CardDomainError, match="agent_builder_idd_unavailable"):
        card_domain._agent_builder_guidance(
            operation, selected_skills=["agent-builder-inspection"]
        )


def test_agent_builder_guidance_requires_selected_existing_native_skill(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    operation = {
        "mode": "edit", "templateId": "template_assist", "tools": [],
    }
    with pytest.raises(card_domain.CardDomainError, match="agent_builder_skill_not_selected"):
        card_domain._agent_builder_guidance(operation, selected_skills=[])
    monkeypatch.setattr(card_domain, "AGENT_BUILDER_SKILL_PATH", tmp_path / "missing-skill")
    with pytest.raises(card_domain.CardDomainError, match="agent_builder_skill_missing"):
        card_domain._agent_builder_guidance(
            operation, selected_skills=["agent-builder-inspection"]
        )


@pytest.mark.parametrize("system_target", [
    _agent(
        "main",
        runtime={"kind": "hermes", "mode": "main", "profile": "liquidaity-main"},
    ),
    _agent(
        "graph",
        runtime={
            "kind": "hermes", "mode": "delegate",
            "profile": "liquidaity-hermes-steward",
        },
    ),
    _agent(
        "mag-one",
        runtime={"kind": "autogen", "mode": "magentic_one"},
    ),
])
def test_agent_builder_target_rejects_system_cards(system_target) -> None:
    builder = _agent(
        "builder",
        runtime={
            "kind": "hermes", "mode": "delegate",
            "profile": "liquidaity-agent-builder",
        },
    )
    with pytest.raises(card_domain.CardDomainError, match="agent_builder_system_target_forbidden"):
        card_domain._selected_agent_builder_target(
            system_target["id"],
            receiving_card=builder,
            cards={builder["id"]: builder, system_target["id"]: system_target},
            deck_revision="deck-revision-one",
        )


def test_saved_hermes_card_preserves_exact_team_defaults_and_rejects_non_hermes() -> None:
    team = {
        "mode": "auto", "maxWorkers": 3, "retryLimit": 2,
        "workerModel": {
            "provider": "openai", "accessMode": "chatgpt-account",
            "modelKey": "gpt-5.6-luna", "providerModelId": "gpt-5.6-luna",
        },
        "leadModel": {
            "provider": "openai", "accessMode": "chatgpt-account",
            "modelKey": "gpt-5.6-terra", "providerModelId": "gpt-5.6-terra",
        },
    }
    hermes = _agent(
        "hermes-team",
        runtime={"kind": "hermes", "mode": "delegate", "profile": "research"},
        runtimeOptions={**_agent("x")["runtimeOptions"], "team": team},
    )
    assert card_domain._stable_card(hermes)["runtimeExtensions"]["team"] == team
    with pytest.raises(card_domain.CardDomainError, match="card_team_requires_hermes"):
        card_domain._stable_card(_agent(
            "autogen-team",
            runtimeOptions={**_agent("x")["runtimeOptions"], "team": team},
        ))


def test_deck_validation_rejects_duplicate_identities_and_missing_endpoints() -> None:
    duplicate = {
        "id": "deck-two",
        "name": "Two",
        "version": 1,
        "nodes": [_agent("same"), _agent("same")],
        "edges": [],
        "promptTemplates": [],
    }
    with pytest.raises(card_domain.CardDomainError, match="card_id_duplicate:same"):
        card_domain._validated_deck_collections(duplicate, "deck-two")

    missing = {
        **duplicate,
        "nodes": [_agent("source")],
        "edges": [{
            "id": "edge-one",
            "source": "source",
            "target": "missing",
            "edgeType": "flow",
        }],
    }
    with pytest.raises(card_domain.CardDomainError, match="edge_endpoint_missing:edge-one"):
        card_domain._validated_deck_collections(missing, "deck-two")


def test_explicit_card_deletion_requires_intent_and_rejects_protected_cards() -> None:
    with pytest.raises(card_domain.CardDomainError, match="card_deletion_intent_invalid"):
        card_domain.delete_card(
            "project-one", "deck-one", "accidental",
            expected_deck_revision="deck-revision",
            expected_card_revision_id="card-revision",
            deletion_intent="",
        )
    with pytest.raises(card_domain.CardDomainError, match="card_deletion_protected:card_main_chat"):
        card_domain.delete_card(
            "project-one", "deck-one", "card_main_chat",
            expected_deck_revision="deck-revision",
            expected_card_revision_id="card-revision",
            deletion_intent="delete-card",
        )


def test_explicit_card_deletion_removes_only_exact_card_and_endpoint_edges(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    statements: list[tuple[str, object]] = []
    deleted_edges: list[str] = []
    deleted_cards: list[str] = []

    class Cursor:
        last_query = ""

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def execute(self, query, params=None):
            self.last_query = str(query)
            statements.append((self.last_query, params))

        def fetchone(self):
            if "SELECT revision" in self.last_query:
                return {"revision": "deck-revision"}
            if "SELECT current_revision_id" in self.last_query:
                return {"current_revision_id": "card-revision"}
            if "SELECT ordinal" in self.last_query:
                return {"ordinal": 6}
            return None

    class Connection:
        committed = False

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def cursor(self, **_kwargs):
            return Cursor()

        def commit(self):
            self.committed = True

    connection = Connection()
    monkeypatch.setattr(card_domain, "connect_postgres", lambda **_kwargs: connection)
    monkeypatch.setattr(card_domain, "_resolve_project", lambda *_args: {"id": "project-one"})
    monkeypatch.setattr(card_domain, "_load_deck_with_cursor", lambda *_args, **_kwargs: {
        "deck": {
            "nodes": [
                {"id": "keep-one", "_cardRevisionId": "keep-revision"},
                {"id": "accidental", "_cardRevisionId": "card-revision"},
                {"id": "keep-two", "_cardRevisionId": "keep-revision-two"},
            ],
            "edges": [
                {"id": "edge-in", "source": "keep-one", "target": "accidental"},
                {"id": "edge-out", "source": "accidental", "target": "keep-two"},
                {"id": "edge-keep", "source": "keep-one", "target": "keep-two"},
            ],
        },
    })
    monkeypatch.setattr(card_domain, "_card_has_telemetry_edges", lambda *_args: False)
    monkeypatch.setattr(
        card_domain,
        "_delete_age_edge",
        lambda _cursor, _project, _deck, edge: deleted_edges.append(edge["id"]),
    )
    monkeypatch.setattr(
        card_domain,
        "_delete_age_card",
        lambda _cursor, _project, _deck, card: deleted_cards.append(card),
    )
    monkeypatch.setattr(card_domain, "load_deck", lambda *_args: {
        "deck": {"nodes": [{"id": "keep-one"}, {"id": "keep-two"}], "edges": [{"id": "edge-keep"}]},
        "meta": {"deckRevision": "new-revision"},
    })

    result = card_domain.delete_card(
        "project-one", "deck-one", "accidental",
        expected_deck_revision="deck-revision",
        expected_card_revision_id="card-revision",
        deletion_intent="delete-card",
    )

    assert deleted_edges == ["edge-in", "edge-out"]
    assert deleted_cards == ["accidental"]
    assert connection.committed is True
    assert result["meta"]["deckRevision"] == "new-revision"
    assert any("FROM ag_catalog.trading_jobs" in query for query, _ in statements)
    assert any("FROM ag_catalog.trading_lifecycle_runs" in query for query, _ in statements)
    mutation_params = [params for query, params in statements if "DELETE FROM" in query]
    assert mutation_params == [
        ("project-one", "deck-one", "accidental"),
        ("project-one", "deck-one", "accidental"),
        ("project-one", "deck-one", "accidental"),
    ]


def test_card_deletion_telemetry_check_uses_typed_agentgraph_endpoints(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    statements: list[str] = []

    def no_rows(_cursor, query, _params, _column):
        statements.append(query)
        return []

    monkeypatch.setattr(card_domain, "_age_rows", no_rows)

    assert card_domain._card_has_telemetry_edges(
        object(), "project-one", "deck-one", "card-one"
    ) is False
    assert len(statements) == len(card_domain.CARD_TELEMETRY_CARD_EDGE_PATTERNS)
    assert all("->()" not in statement and "MATCH ()-" not in statement for statement in statements)
    assert all(":Run" in statement or ":Card" in statement for statement in statements)


def test_direct_card_targets_allow_presentation_attached_hermes_workers() -> None:
    cards = {
        "parent": _agent("parent"),
        "enabled": _agent(
            "enabled",
            runtime={"kind": "hermes", "mode": "delegate", "profile": "coder"},
        ),
        "disabled-option": _agent(
            "disabled-option",
            runtimeOptions={**_agent("x")["runtimeOptions"], "enabled": False},
        ),
        "presentation-attached": _agent(
            "presentation-attached",
            parentGraphId="workbench-trading",
            runtime={"kind": "hermes", "mode": "delegate", "profile": "trading"},
        ),
        "orchestrator": _agent(
            "orchestrator", runtime={"kind": "autogen", "mode": "magentic_one"}
        ),
    }
    edges = [
        {"source": "parent", "target": "enabled", "edgeType": "flow"},
        {"source": "parent", "target": "disabled-option", "edgeType": "flow"},
        {"source": "parent", "target": "presentation-attached", "edgeType": "flow"},
        {"source": "parent", "target": "orchestrator", "edgeType": "flow"},
        {"source": "enabled", "target": "parent", "edgeType": "flow"},
        {"source": "parent", "target": "enabled", "edgeType": "magentic_option"},
        {"source": "parent", "target": "enabled", "edgeType": "flow", "enabled": False},
    ]
    assert card_domain._direct_card_targets("parent", cards, edges) == [
        {**_expected_delegate("enabled"), "cardRevisionId": ""},
        {
            "cardId": "presentation-attached",
            "title": "presentation-attached",
            "profile": "trading",
            "description": "",
            "cardRevisionId": "",
        },
    ]


def _delegation_invocation(
    monkeypatch: pytest.MonkeyPatch,
    *,
    edges: list[dict[str, object]],
    target: dict | None = None,
    parent_runtime: dict | None = None,
) -> dict:
    parent = _agent("parent", runtime=parent_runtime or {"kind": "autogen", "mode": "assistant"})
    parent["runtimeOptions"] = {
        **parent["runtimeOptions"],
        "tools": ["calculator"],
    }
    if parent["runtime"].get("kind") == "hermes":
        parent["runtimeOptions"]["tools"].append("card.run_assistant_agent")
    child = target or _agent(
        "child",
        runtime={"kind": "hermes", "mode": "delegate", "profile": "coder"},
        runtimeOptions={
            **_agent("child")["runtimeOptions"],
            "nativeTools": ["terminal"],
            "skills": ["repository-coder"],
            "toolsets": ["terminal"],
        },
    )
    for number, card in enumerate((parent, child), start=1):
        card["_cardRevisionId"] = f"revision-{number}"
        card["_cardRevision"] = 1
        card["_cardRevisionSha256"] = f"sha-{number}"
    monkeypatch.setattr(
        card_domain,
        "_load_deck_internal",
        lambda _project, _deck: {
            "projectId": "00000000-0000-0000-0000-000000000001",
            "deck": {"nodes": [parent, child], "edges": edges},
        },
    )
    return card_domain.materialize_invocation({
        "projectId": "project-one",
        "deckId": "deck-one",
        "runId": "run-delegation",
        "cardId": "parent",
        "assignment": "delegate only across the saved FLOW relationship",
    })


def test_enabled_flow_edge_materializes_bounded_target_without_inventing_tool_grant(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    invocation = _delegation_invocation(
        monkeypatch,
        edges=[{"source": "parent", "target": "child", "edgeType": "flow"}],
    )
    assert invocation["cardIdentity"] == {"cardId": "parent", "title": "parent"}
    assert invocation["idf"]["selectedToolsAndGrants"]["enabledTools"] == ["calculator"]
    assert invocation["delegationTargets"] == [_expected_delegate()]
    assert "delegationTargets" not in invocation["idf"]


def test_hermes_flow_target_projects_saved_profile_outside_model_input(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    invocation = _delegation_invocation(
        monkeypatch,
        edges=[{"source": "parent", "target": "child", "edgeType": "flow"}],
        parent_runtime={"kind": "hermes", "mode": "main", "profile": "main"},
    )
    assert invocation["runtimeOwner"] == "hermes"
    assert invocation["cardIdentity"] == {"cardId": "parent", "title": "parent"}
    assert "card.run_assistant_agent" not in invocation["idf"]["selectedToolsAndGrants"]["enabledTools"]
    assert invocation["delegationTargets"] == [_expected_delegate()]
    assert "delegationTargets" not in invocation["idf"]


def test_no_flow_edge_materializes_no_delegation_transport(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    invocation = _delegation_invocation(monkeypatch, edges=[])
    assert invocation["cardIdentity"] == {"cardId": "parent", "title": "parent"}
    assert invocation["idf"]["selectedToolsAndGrants"]["enabledTools"] == ["calculator"]
    assert invocation["delegationTargets"] == []


def test_all_healthy_catalog_grants_reads_but_only_explicit_available_writes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    card = _agent("catalog-card")
    card["_cardRevisionId"] = "revision-catalog"
    card["_cardRevision"] = 1
    card["_cardRevisionSha256"] = "sha-catalog"
    card["runtimeOptions"] = {
        **card["runtimeOptions"],
        "toolCatalogPolicy": "all_healthy",
        "disabledTools": ["graphiti.search_nodes"],
        "tools": ["constellation.remember"],
        "script": {
            "enabled": True,
            "source": '''CARD_SCRIPT = {
    "mode": "tool_recipe",
    "input": {"type": "object", "properties": {"mission": {"type": "string"}}, "required": ["mission"]},
    "output": {"type": "object", "properties": {"agent": {"type": "object", "properties": {"run": {"type": "boolean"}}, "required": ["run"]}}, "required": ["agent"]},
}
from hermes_tools import SCRIPT, output, tools
tools.cbm.search_graph = SCRIPT
tools.call("cbm.search_graph")
output.emit({"agent": {"run": False}})
''',
        },
    }
    monkeypatch.setattr(
        card_domain,
        "_load_deck_internal",
        lambda _project, _deck: {
            "projectId": "00000000-0000-0000-0000-000000000001",
            "deck": {"nodes": [card], "edges": []},
        },
    )

    def discovered(name: str, namespace: str, *, read_only: bool) -> dict:
        return {
            "name": name,
            "nativeName": name.split(".")[-1],
            "kind": "tool",
            "sourceId": "main_mcp",
            "namespace": namespace,
            "connectionKind": "external-mcp",
            "description": name,
            "inputSchema": {"type": "object", "properties": {}},
            "annotations": {"readOnlyHint": read_only},
        }

    invocation = card_domain.materialize_invocation({
        "projectId": "project-one",
        "deckId": "deck-one",
        "runId": "run-catalog",
        "cardId": "catalog-card",
        "assignment": "compose supported graph reads",
        "discoveredTools": [
            discovered("cbm.search_graph", "cbm", read_only=True),
            discovered("graphiti.search_nodes", "graphiti", read_only=True),
            discovered("constellation.remember", "constellation", read_only=False),
            discovered("cbm.index_repository", "cbm", read_only=False),
        ],
    })

    grants = invocation["idf"]["selectedToolsAndGrants"]
    assert grants["toolCatalogPolicy"] == "all_healthy"
    assert grants["disabledTools"] == ["graphiti.search_nodes"]
    assert grants["enabledTools"] == [
        "cbm.search_graph", "constellation.remember", "web_search",
    ]
    assert grants["presentedTools"] == ["constellation.remember"]
    assert [tool["canonicalId"] for tool in grants["toolDefinitions"]] == [
        "constellation.remember",
    ]
    assert "cbm.index_repository" not in grants["enabledTools"]
    script = invocation["idf"]["stableSavedCardContext"]["runtimeOptions"]["script"]
    assert grants["scriptPresentation"]["mode"] == "script"
    assert script["nativeSupport"]["active"] is True
    assert script["compiled"]["toolStates"] == {
        "cbm.search_graph": 1,
        "constellation.remember": 2,
        "web_search": 0,
    }


def _prepared_grounded_runtime(runtime: dict[str, str]) -> dict:
    reads = [{
        "authority": "CodeGraph", "nativeId": "symbol-one",
    }]
    materialized = card_domain.materialize_idf(
        stable={
            "projectId": "project-one", "deckId": "deck-one", "cardId": "card-one",
            "instructions": "test instructions",
            "outputContract": "",
            "runtime": runtime,
            "runtimeOptions": {},
            "provider": {
                "provider": "openai", "modelKey": "gpt-5.6-luna",
                "providerModelId": "gpt-5.6-luna", "accessMode": "chatgpt-account",
            },
        },
        variable={"task": "test task"},
        capabilities={"enabledTools": []},
        graph_context="symbol-one",
        native_references=reads,
        graph_projection={"authority": "CodeGraph", "nodes": [{
            "id": "symbol-one", "authority": "CodeGraph", "type": "Function",
        }], "edges": []},
    )
    return {
        "projectId": "project-one",
        "deckId": "deck-one",
        "runtimeOwner": (
            "hermes" if runtime["kind"] == "hermes"
            else "mag_one" if runtime.get("mode") == "magentic_one"
            else "autogen"
        ),
        "cardIdentity": {"cardId": "card-one", "title": "Card"},
        "cardRevisionId": "revision-one",
        "idf": materialized.idf.model_dump(),
        "resolvedNativeReads": reads,
        "resolvedGraphProjection": {
            "nodes": [{"id": "symbol-one"}], "edges": [],
        },
    }


def _prepared_kanban_runtime() -> dict:
    prepared = _prepared_grounded_runtime({
        "kind": "hermes", "mode": "kanban", "profile": "steward",
    })
    prepared.update({
        "projectId": "project-one",
        "deckId": "deck-one",
        "runtimeOwner": "hermes",
        "cardIdentity": {"cardId": "kanban-one", "title": "Kanban"},
        "resolvedNativeReads": [],
        "resolvedGraphProjection": {"nodes": [], "edges": []},
    })
    return prepared


def _fake_retain_idf(prepared: dict, **_kwargs) -> tuple[dict, dict, dict]:
    idf = prepared["idf"]
    stable = idf["stableSavedCardContext"]
    grants = idf["selectedToolsAndGrants"]
    dynamic = idf["dynamicContext"]
    return (
        {
            "idf": idf,
            "inputSummary": {"idfBytes": 1},
        },
        {
            "idfPath": "in.idf", "idfSha256": "idf", "idfBytes": 1,
        },
        {
            "systemPrompt": str(stable.get("instructions") or ""),
            "outputRequirements": str(stable.get("outputRequirements") or ""),
            "task": str(dynamic.get("task") or ""),
            "message": str(dynamic.get("task") or ""),
            "graphContext": str(idf["actualGraphData"].get("modelText") or ""),
            "runtime": stable["runtime"],
            "provider": stable["provider"],
            "enabledTools": list(grants.get("enabledTools") or []),
        },
    )


@pytest.mark.parametrize(
    "runtime",
    [
        {"kind": "hermes", "mode": "delegate", "profile": "coder"},
        {"kind": "autogen", "mode": "magentic_one"},
    ],
)
def test_coder_and_mag_one_accept_empty_graph_and_reject_stale_selected_reference(
    monkeypatch: pytest.MonkeyPatch,
    runtime: dict[str, str],
) -> None:
    prepared = _prepared_grounded_runtime(runtime)
    prepared["resolvedNativeReads"] = []
    prepared["resolvedGraphProjection"] = {"nodes": [], "edges": []}
    monkeypatch.setattr(card_domain, "materialize_invocation", lambda _payload: prepared)
    assert card_domain.prepare_run_invocation({}) is prepared

    stale = [{
        "authority": "CodeGraph", "nativeId": "missing-symbol",
        "reason": "Required production owner", "priority": 0,
        "boundedExpansion": 0, "resultLimit": 4, "required": True,
    }]
    with pytest.raises(
        card_domain.CardDomainError,
        match="selected_graph_data_reference_stale:CodeGraph:missing-symbol",
    ):
        card_domain.prepare_run_invocation({"dataAnchors": stale})


@pytest.mark.parametrize(
    "runtime",
    [
        {"kind": "hermes", "mode": "delegate", "profile": "coder"},
        {"kind": "autogen", "mode": "magentic_one"},
    ],
)
def test_selected_coder_and_mag_one_graph_data_is_validated_without_creating_a_run(
    monkeypatch: pytest.MonkeyPatch,
    runtime: dict[str, str],
) -> None:
    prepared = _prepared_grounded_runtime(runtime)
    monkeypatch.setattr(card_domain, "materialize_invocation", lambda _payload: prepared)
    monkeypatch.setattr(
        card_domain,
        "_insert_run",
        lambda *_args, **_kwargs: pytest.fail("graph-data validation created a Run"),
    )
    payload = {"dataAnchors": [{
        "authority": "CodeGraph", "nativeId": "symbol-one",
        "reason": "Required production owner", "priority": 0,
        "boundedExpansion": 0, "resultLimit": 4, "required": True,
    }]}

    assert card_domain.prepare_run_invocation(payload) is prepared


def test_other_card_runtimes_keep_the_existing_unrestricted_preparation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    prepared = _prepared_grounded_runtime({"kind": "autogen", "mode": "assistant"})
    prepared["resolvedNativeReads"] = []
    prepared["resolvedGraphProjection"] = {"nodes": [], "edges": []}
    monkeypatch.setattr(card_domain, "materialize_invocation", lambda _payload: prepared)

    assert card_domain.prepare_run_invocation({}) is prepared


def test_optional_editor_review_never_materializes_an_idf(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    components = {
        "prepared": {
            "projectId": "project-one",
            "deckId": "deck_builder",
            "cardRevisionId": "revision-one",
            "cardRevision": 1,
            "cardRevisionSha256": "sha-one",
            "runtimeOwner": "hermes",
            "cardIdentity": {"cardId": "card-one", "title": "One"},
        },
        "resolvedNativeReads": [],
        "resolvedGraphProjection": {
            "schemaVersion": "native-card-context.v1",
            "authority": "",
            "projectId": "project-one",
            "nodes": [],
            "edges": [],
            "counts": {"nodes": 0, "edges": 0},
        },
    }
    monkeypatch.setattr(
        card_domain,
        "_resolve_invocation_components",
        lambda _payload: components,
    )
    monkeypatch.setattr(
        card_domain,
        "materialize_idf",
        lambda **_kwargs: pytest.fail("editor review materialized an IDF"),
    )

    review = card_domain.prepare_card_review_context({"dataAnchors": []})

    assert review["resolvedGraphProjection"]["nodes"] == []
    assert "idf" not in review


def test_new_run_fails_closed_when_root_input_files_cannot_persist(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    prepared = _prepared_grounded_runtime({"kind": "autogen", "mode": "assistant"})
    terminal: list[dict] = []
    monkeypatch.setattr(card_domain, "prepare_run_invocation", lambda _payload: prepared)
    monkeypatch.setattr(
        card_domain,
        "_insert_run",
        lambda *_args, **_kwargs: ("run-one", "correlation-one", True),
    )
    monkeypatch.setattr(
        card_domain,
        "_retain_run_idf",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            card_domain.CardDomainError("input_files_write_failed")
        ),
    )
    monkeypatch.setattr(card_domain, "finish_run", lambda payload: terminal.append(payload) or {})

    with pytest.raises(card_domain.CardDomainError, match="input_files_write_failed"):
        card_domain.begin_run({"runId": "run-one", "correlationId": "correlation-one"})
    assert terminal == [{
        "runId": "run-one",
        "state": "failed",
        "nativePhase": "failed",
        "errorCode": "input_files_materialization_failed",
        "errorSummary": "input_files_write_failed",
    }]


def test_read_run_input_files_resolves_card_through_saved_revision(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    statements: list[str] = []
    loaded_identity: dict[str, str] = {}

    class Cursor:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def execute(self, query, _params=None):
            statements.append(str(query))

        def fetchone(self):
            return {"card_id": "card_local_coder"}

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def cursor(self, **_kwargs):
            return Cursor()

    class Materialized:
        idf_bytes = b'{"schema":"liquidaity.idf.v1"}\n'

    def load_materialized(_descriptor, **identity):
        loaded_identity.update(identity)
        return Materialized()

    monkeypatch.setattr(card_domain, "connect_postgres", lambda **_kwargs: Connection())
    monkeypatch.setattr(card_domain, "_resolve_project", lambda *_args: {"id": "project-one"})
    monkeypatch.setattr(card_domain, "_input_file_descriptor_for_run", lambda _run_id: {"idfPath": "in.idf"})
    monkeypatch.setattr(card_domain, "load_idf", load_materialized)
    monkeypatch.setattr(card_domain, "idf_public", lambda _materialized: {"inputSummary": {}})

    result = card_domain.read_run_input_files({
        "projectId": "project-one",
        "deckId": "deck-one",
        "runId": "run-one",
    })

    query = "\n".join(statements)
    assert "JOIN ag_catalog.agent_card_revisions AS revision" in query
    assert "SELECT revision.card_id" in query
    assert "SELECT card_id FROM ag_catalog.agent_runs" not in query
    assert loaded_identity == {
        "project_id": "project-one",
        "deck_id": "deck-one",
        "run_id": "run-one",
        "card_id": "card_local_coder",
    }
    assert result["idfText"].startswith('{"schema"')


def test_mag_one_participant_validation_still_fails_before_run_creation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    prepared = _prepared_grounded_runtime({"kind": "autogen", "mode": "magentic_one"})
    monkeypatch.setattr(card_domain, "prepare_run_invocation", lambda _payload: prepared)
    monkeypatch.setattr(card_domain, "_load_deck_internal", lambda *_args: {
        "projectId": "project-one",
        "deck": {
            "nodes": [{
                "id": "card-one",
                "runtime": {"kind": "autogen", "mode": "magentic_one"},
            }],
            "edges": [],
        },
    })
    monkeypatch.setattr(
        card_domain,
        "_insert_run",
        lambda *_args, **_kwargs: pytest.fail("participant validation created a Run"),
    )

    with pytest.raises(
        card_domain.CardDomainError,
        match="magentic_runtime_no_connected_participants",
    ):
        card_domain.begin_run({"runId": "run-one", "correlationId": "correlation-one"})


def test_retired_kanban_card_mode_cannot_create_a_new_run(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    prepared = _prepared_kanban_runtime()
    monkeypatch.setattr(card_domain, "prepare_run_invocation", lambda _payload: prepared)
    monkeypatch.setattr(
        card_domain,
        "_insert_run",
        lambda *_args, **_kwargs: pytest.fail("retired Card mode created a Run"),
    )

    with pytest.raises(
        card_domain.CardDomainError,
        match="hermes_kanban_card_mode_retired",
    ):
        card_domain.begin_run({
            "projectId": "project-one",
            "deckId": "deck-one",
            "cardId": "kanban-one",
            "runId": "run-retired",
            "correlationId": "correlation-retired",
            "assignment": "Do not start",
        })


def test_active_kanban_recovery_projects_only_persisted_run_and_root_identity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    statements: list[str] = []

    class Cursor:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def execute(self, query, _params=None):
            statements.append(str(query))

        def fetchall(self):
            base = {
                "run_id": "run-one",
                "correlation_id": "correlation-one",
                "project_id": "project-one",
                "deck_id": "deck-one",
                "card_id": "card_hermes_steward",
                "target_card_revision_id": "revision-one",
                "runtime_kind": "hermes",
                "runtime_mode": "kanban",
                "runtime_profile": "liquidaity-hermes-steward",
                "state": "running",
                "provider_thread_ref": "t_existing_root",
            }
            return [
                base,
                {
                    **base,
                    "run_id": "run-team-child",
                    "runtime_mode": "main",
                    "runtime_profile": "liquidaity-main",
                    "provider_thread_ref": "t_team_root",
                },
                {
                    **base,
                    "run_id": "run-card-session",
                    "runtime_mode": "main",
                    "provider_thread_ref": "acp-session-uuid",
                },
            ]

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def cursor(self, **_kwargs):
            return Cursor()

    monkeypatch.setattr(card_domain, "connect_postgres", lambda **_kwargs: Connection())

    result = card_domain.list_active_kanban_runs()

    assert result["ok"] is True
    assert len(result["runs"]) == 2
    assert result["runs"][0]["runId"] == "run-one"
    assert result["runs"][0]["nativeRootId"] == "t_existing_root"
    assert result["runs"][0]["runtimeProfile"] == "liquidaity-hermes-steward"
    assert result["runs"][1]["runId"] == "run-team-child"
    assert result["runs"][1]["runtimeMode"] == "main"
    assert result["runs"][1]["nativeRootId"] == "t_team_root"
    query = "\n".join(statements)
    assert "run.state IN ('pending','running')" in query
    assert "run.runtime_mode='kanban'" not in query
    assert "provider_thread_ref IS NOT NULL" in query
    assert "native_child" not in query.lower()


def test_run_projection_carries_saved_runtime_profile_for_exact_rejoin() -> None:
    projected = card_domain._run_projection({
        "run_id": "run-one",
        "runtime_kind": "hermes",
        "runtime_mode": "kanban",
        "runtime_profile": "liquidaity-hermes-steward",
        "provider_thread_ref": "t_retained_root",
        "provider": "openai-codex",
        "provider_model_id": "gpt-5.6-luna",
        "access_mode": "chatgpt-account",
        "state": "failed",
    })

    assert projected["runId"] == "run-one"
    assert projected["runtimeProfile"] == "liquidaity-hermes-steward"
    assert projected["nativeRootId"] == "t_retained_root"
    assert projected["provider"] == "openai-codex"
    assert projected["model"] == "gpt-5.6-luna"
    assert projected["accessMode"] == "chatgpt-account"


@pytest.mark.parametrize("run_tools, expected_tools", [
    (["card.load_graph_references", "graphiti.add_memory"], ["card.load_graph_references", "graphiti.add_memory"]),
    ([], []),
    (["calculator", "cbm.search_graph"], ["calculator"]),
])
def test_native_hermes_task_context_uses_exact_root_run_revision_grants(
    monkeypatch: pytest.MonkeyPatch, run_tools, expected_tools,
) -> None:
    statements: list[tuple[str, object]] = []

    class Cursor:
        last_query = ""

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def execute(self, query, params=None):
            self.last_query = str(query)
            statements.append((self.last_query, params))

        def fetchall(self):
            if "FROM ag_catalog.agent_runs" in self.last_query:
                return [{
                    "run_id": "run-one",
                    "provider_thread_ref": "t_root",
                    "project_id": "project-one",
                    "deck_id": "deck_builder",
                    "target_card_revision_id": "revision-one",
                    "card_id": "card_hermes_steward",
                    "runtime_kind": "hermes",
                    "runtime_mode": "delegate",
                    "runtime_profile": "liquidaity-hermes-steward",
                    "enabled": True,
                }]
            if "card_capability_grants" in self.last_query:
                return [
                    {"grant_id": "graphiti.add_memory"},
                    {"grant_id": "card.load_graph_references"},
                    {"grant_id": "retired.project_memory_admin"},
                    {"grant_id": "calculator"},
                ]
            if "ag_catalog.cypher" in self.last_query:
                return [{"value": json.dumps({"conversationId": "conversation-one"})}]
            return []

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def cursor(self, **_kwargs):
            return Cursor()

    monkeypatch.setattr(card_domain, "connect_postgres", lambda **_kwargs: Connection())
    monkeypatch.setattr(card_domain, "_resolve_project", lambda _cursor, _ref: {"id": "project-one"})
    monkeypatch.setattr(
        card_domain,
        "readable_tool_ids",
        lambda: frozenset({"cbm.search_graph", "constellation.context", "calculator"}),
    )
    from types import SimpleNamespace
    monkeypatch.setattr(card_domain, "_input_file_descriptor_for_run", lambda run_id: {"runId": run_id})
    monkeypatch.setattr(card_domain, "load_idf", lambda descriptor, **identity: SimpleNamespace(
        idf=SimpleNamespace(selectedToolsAndGrants=SimpleNamespace(
            enabledTools=run_tools,
        )),
    ))

    result = card_domain.resolve_native_hermes_task_context({
        "nativeTaskIds": ["t_worker", "t_root"],
    })

    assert result["context"] == {
        "projectId": "project-one",
        "deckId": "deck_builder",
        "conversationId": "conversation-one",
        "runId": "run-one",
        "rootRunId": "run-one",
        "cardId": "card_hermes_steward",
        "cardRevisionId": "revision-one",
        "runtimeMode": "delegate",
        "runtimeProfile": "liquidaity-hermes-steward",
        "nativeRootId": "t_root",
        "grantedTools": expected_tools,
    }
    query = "\n".join(statement for statement, _params in statements)
    assert "provider_thread_ref = ANY" in query
    assert "target_card_revision_id" in query
    assert "grant_kind='tool'" in query
    run_query, run_params = next(
        (statement, params)
        for statement, params in statements
        if "FROM ag_catalog.agent_runs" in statement
    )
    assert "run.project_id=%s" not in run_query
    assert run_params == (["t_root", "t_worker"],)


def test_run_progress_casts_numeric_native_run_id_to_persisted_text(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    statements: list[tuple[str, object]] = []

    class Cursor:
        rowcount = 1

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def execute(self, query, params=None):
            statements.append((str(query), params))

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def cursor(self, **_kwargs):
            return Cursor()

    monkeypatch.setattr(card_domain, "connect_postgres", lambda **_kwargs: Connection())
    monkeypatch.setattr(card_domain, "_observe_run_progress", lambda *_args, **_kwargs: True)

    result = card_domain.update_run_progress({
        "runId": "run-one",
        "nativeRootId": "t_retained_root",
        "nativeRunId": 18,
        "nativePhase": "working",
        "tasksCompleted": 2,
        "tasksTotal": 5,
        "activeWorkers": 1,
    })

    query, params = statements[0]
    assert "provider_turn_ref=COALESCE(%s::text, provider_turn_ref)" in query
    assert params[1] == 18
    assert result["updated"] is True


def test_finish_run_reconciles_only_a_matching_terminal_native_kanban_root(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    statements: list[tuple[str, object]] = []
    receipt = {
        "run_id": "run-one",
        "state": "failed",
        "runtime_kind": "hermes",
        "runtime_mode": "kanban",
        "provider_thread_ref": "t_retained_root",
    }

    class Cursor:
        rowcount = 0

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def execute(self, query, params=None):
            statements.append((str(query), params))
            if "UPDATE ag_catalog.agent_runs" in str(query):
                self.rowcount = 1
                receipt["state"] = "completed"

        def fetchone(self):
            return receipt

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def cursor(self, **_kwargs):
            return Cursor()

    monkeypatch.setattr(card_domain, "connect_postgres", lambda **_kwargs: Connection())
    monkeypatch.setattr(card_domain, "_observe_run_finish", lambda *_args, **_kwargs: True)

    result = card_domain.finish_run({
        "runId": "run-one",
        "state": "completed",
        "providerThreadRef": "t_retained_root",
        "providerTurnRef": 18,
        "nativePhase": "complete",
        "tasksCompleted": 5,
        "tasksTotal": 5,
        "activeWorkers": 0,
        "finalResult": "Exact stored native result.",
        "reconcileNativeTerminal": True,
    })

    update_query, update_params = statements[0]
    assert "state IN ('failed','cancelled')" in update_query
    assert "runtime_kind='hermes'" in update_query
    assert "runtime_mode='kanban'" in update_query
    assert "provider_thread_ref=%s" in update_query
    assert "provider_turn_ref=%s::text" in update_query
    assert update_params[-1] == "t_retained_root"
    assert result["updated"] is True
    assert result["state"] == "completed"


def test_finish_run_reconciliation_requires_a_stored_native_result() -> None:
    with pytest.raises(
        card_domain.CardDomainError,
        match="run_terminal_reconciliation_result_missing",
    ):
        card_domain.finish_run({
            "runId": "run-one",
            "state": "completed",
            "providerThreadRef": "t_retained_root",
            "reconcileNativeTerminal": True,
        })


def test_finish_run_reconciles_one_hash_verified_result_without_rewriting_receipt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    statements: list[tuple[str, object]] = []
    final_result = "Exact native assistant result."
    receipt = {
        "run_id": "run-one",
        "state": "completed",
        "finished_at": "original-finished-at",
        "provider_input_tokens": 123,
        "final_result": final_result,
    }

    class Cursor:
        rowcount = 0

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def execute(self, query, params=None):
            statements.append((str(query), params))
            if "UPDATE ag_catalog.agent_runs SET final_result" in str(query):
                self.rowcount = 1

        def fetchone(self):
            return receipt

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def cursor(self, **_kwargs):
            return Cursor()

    monkeypatch.setattr(card_domain, "connect_postgres", lambda **_kwargs: Connection())
    monkeypatch.setattr(card_domain, "_observe_run_result_ready", lambda *_args: True)
    monkeypatch.setattr(
        card_domain,
        "_observe_run_finish",
        lambda *_args, **_kwargs: pytest.fail("result recovery rewrote terminal Run telemetry"),
    )

    result = card_domain.finish_run({
        "runId": "run-one",
        "state": "completed",
        "finalResult": final_result,
        "expectedResultSha256": card_domain._sha(final_result),
        "reconcilePersistedResult": True,
    })

    update_query, update_params = statements[0]
    assert "SET final_result=%s" in update_query
    assert "state='completed' AND final_result IS NULL" in update_query
    assert "finished_at" not in update_query
    assert "provider_input_tokens" not in update_query
    assert update_params == (final_result, "run-one")
    assert result["updated"] is True
    assert result["telemetryWritten"] is True


def test_finish_run_result_reconciliation_rejects_wrong_hash() -> None:
    with pytest.raises(
        card_domain.CardDomainError,
        match="run_result_reconciliation_hash_mismatch",
    ):
        card_domain.finish_run({
            "runId": "run-one",
            "state": "completed",
            "finalResult": "Exact native result.",
            "expectedResultSha256": "0" * 64,
            "reconcilePersistedResult": True,
        })


def test_magentic_card_may_invoke_only_a_saved_magentic_option_worker(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mag_one = _agent("mag-one", runtime={"kind": "autogen", "mode": "magentic_one"})
    worker = _agent(
        "worker",
        runtime={"kind": "hermes", "mode": "delegate", "profile": "worker"},
    )
    for number, card in enumerate((mag_one, worker), start=1):
        card["_cardRevisionId"] = f"revision-{number}"
        card["_cardRevision"] = 1
        card["_cardRevisionSha256"] = f"sha-{number}"
    loaded = {
        "projectId": "00000000-0000-0000-0000-000000000001",
        "deck": {
            "nodes": [mag_one, worker],
            "edges": [{
                "source": "worker",
                "target": "mag-one",
                "edgeType": "magentic_option",
            }],
        },
    }
    monkeypatch.setattr(card_domain, "_load_deck_internal", lambda *_args: loaded)
    payload = {
        "projectId": "project-one",
        "deckId": "deck-one",
        "runId": "run-worker",
        "cardId": "worker",
        "senderCardId": "mag-one",
        "assignment": "bounded worker task",
    }
    assert card_domain.materialize_invocation(payload)["runtimeOwner"] == "hermes"
    loaded["deck"]["edges"] = []
    with pytest.raises(card_domain.CardDomainError, match="card_invocation_edge_authority_required"):
        card_domain.materialize_invocation(payload)


def test_same_hermes_card_direct_and_team_materialize_the_same_saved_identity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mag_one = _agent("mag-one", runtime={"kind": "autogen", "mode": "magentic_one"})
    coder = _agent(
        "coder",
        title="Coder",
        prompt="Saved Coder prompt",
        runtime={"kind": "hermes", "mode": "delegate", "profile": "coder"},
    )
    coder["runtimeOptions"] = {
        **coder["runtimeOptions"],
        "provider": "openai",
        "modelKey": "gpt-5.6-luna",
        "providerModelId": "gpt-5.6-luna",
        "accessMode": "chatgpt-account",
        "tools": ["card.create"],
        "nativeTools": ["memory"],
        "skills": ["codex"],
        "toolsets": ["hermes-acp"],
        "mcpConnectionIds": ["main-runtime"],
    }
    for number, card in enumerate((mag_one, coder), start=1):
        card["_cardRevisionId"] = f"revision-{number}"
        card["_cardRevision"] = 1
        card["_cardRevisionSha256"] = f"sha-{number}"
    monkeypatch.setattr(card_domain, "_load_deck_internal", lambda *_args: {
        "projectId": "00000000-0000-0000-0000-000000000001",
        "deck": {
            "nodes": [mag_one, coder],
            "edges": [{
                "source": "mag-one",
                "target": "coder",
                "edgeType": "magentic_option",
            }],
        },
    })

    direct = card_domain.materialize_invocation({
        "projectId": "project-one",
        "deckId": "deck-one",
        "runId": "run-direct",
        "cardId": "coder",
        "assignment": "direct mission",
    })
    team = card_domain.materialize_invocation({
        "projectId": "project-one",
        "deckId": "deck-one",
        "runId": "run-team-child",
        "cardId": "coder",
        "senderCardId": "mag-one",
        "assignment": "team mission",
    })

    assert direct["cardIdentity"] == team["cardIdentity"]
    assert direct["cardRevisionId"] == team["cardRevisionId"] == "revision-2"
    assert direct["runtimeOwner"] == team["runtimeOwner"] == "hermes"
    assert direct["idf"]["stableSavedCardContext"] == team["idf"]["stableSavedCardContext"]
    assert direct["idf"]["selectedToolsAndGrants"] == team["idf"]["selectedToolsAndGrants"]
    assert direct["idf"]["dynamicContext"]["task"] == "direct mission"
    assert team["idf"]["dynamicContext"]["task"] == "team mission"


def test_saved_magentic_control_edge_is_required_to_resolve_mag_one(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    main = _agent(
        "main",
        runtime={"kind": "hermes", "mode": "main", "profile": "main"},
    )
    mag_one = _agent("mag-one", runtime={"kind": "autogen", "mode": "magentic_one"})
    for number, card in enumerate((main, mag_one), start=1):
        card["_cardRevisionId"] = f"revision-{number}"
        card["_cardRevision"] = 1
        card["_cardRevisionSha256"] = f"sha-{number}"
    loaded = {
        "projectId": "00000000-0000-0000-0000-000000000001",
        "deck": {
            "nodes": [main, mag_one],
            "edges": [{
                "source": "main",
                "target": "mag-one",
                "edgeType": "magentic_control",
            }],
        },
    }
    monkeypatch.setattr(card_domain, "_load_deck_internal", lambda *_args: loaded)
    assert card_domain.resolve_magentic_target_card(
        "project-one", "deck-one", "main"
    ) == {
        "projectId": "00000000-0000-0000-0000-000000000001",
        "deckId": "deck-one",
        "cardId": "mag-one",
    }
    loaded["deck"]["edges"] = []
    with pytest.raises(card_domain.CardDomainError, match="magentic_control_target_ambiguous"):
        card_domain.resolve_magentic_target_card("project-one", "deck-one", "main")


def test_disabled_flow_edge_materializes_no_delegation_transport(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    invocation = _delegation_invocation(
        monkeypatch,
        edges=[{
            "source": "parent",
            "target": "child",
            "edgeType": "flow",
            "enabled": False,
        }],
    )
    assert "card.run_assistant_agent" not in invocation["idf"]["selectedToolsAndGrants"]["enabledTools"]
    assert "card.run_assistant_agent" not in invocation["idf"]["selectedToolsAndGrants"]["enabledTools"]
    assert invocation["delegationTargets"] == []


def test_disabled_missing_or_invalid_flow_target_is_not_eligible(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    edge = [{"source": "parent", "target": "child", "edgeType": "flow"}]
    disabled = _agent(
        "child", runtime={"kind": "hermes", "mode": "delegate", "profile": "coder"}
    )
    disabled["runtimeOptions"] = {**disabled["runtimeOptions"], "enabled": False}
    assert _delegation_invocation(
        monkeypatch,
        edges=edge,
        target=disabled,
    )["delegationTargets"] == []

    invalid = _agent("child", runtime={"kind": "autogen", "mode": "magentic_one"})
    assert _delegation_invocation(
        monkeypatch,
        edges=edge,
        target=invalid,
    )["delegationTargets"] == []

    missing = _delegation_invocation(
        monkeypatch,
        edges=[{"source": "parent", "target": "missing", "edgeType": "flow"}],
    )
    assert missing["delegationTargets"] == []
    assert "card.run_assistant_agent" not in missing["idf"]["selectedToolsAndGrants"]["enabledTools"]


def test_stable_card_has_one_prompt_and_one_explicit_runtime() -> None:
    card = _agent(
        "coder",
        runtime={"kind": "hermes", "mode": "delegate", "profile": "coder"},
    )
    stable = card_domain._stable_card(card)
    assert stable["basePrompt"] == "common prompt"
    assert stable["runtime"] == {
        "kind": "hermes", "mode": "delegate", "profile": "coder"
    }


def test_runtime_owner_is_exhaustive_over_the_explicit_runtime_union() -> None:
    for mode in ("main", "delegate", "kanban"):
        assert card_domain._runtime_owner(_agent(
            mode, runtime={"kind": "hermes", "mode": mode, "profile": mode}
        )) == "hermes"
    assert card_domain._runtime_owner(_agent(
        "assistant", runtime={"kind": "autogen", "mode": "assistant"}
    )) == "autogen"
    assert card_domain._runtime_owner(_agent(
        "mag-one", runtime={"kind": "autogen", "mode": "magentic_one"}
    )) == "mag_one"
    for invalid, error in (
        (None, "runtime_kind_required"),
        ({"kind": "hermes", "mode": "delegate"}, "runtime_profile_required"),
        ({"kind": "autogen", "mode": "delegate"}, "autogen_runtime_mode_unsupported"),
        ({"kind": "other", "mode": "assistant"}, "runtime_kind_unsupported"),
    ):
        with pytest.raises(card_domain.CardDomainError, match=error):
            card_domain._runtime_owner(_agent("invalid", runtime=invalid))


def test_enabled_callable_saved_cards_are_magentic_workers() -> None:
    for mode in ("main", "delegate", "kanban"):
        assert card_domain._is_callable_magentic_worker_card(_agent(
            mode, runtime={"kind": "hermes", "mode": mode, "profile": mode}
        )) is True
    assert card_domain._is_callable_magentic_worker_card(_agent(
        "worker", runtime={"kind": "autogen", "mode": "assistant"}
    )) is True
    assert card_domain._is_callable_magentic_worker_card(_agent(
        "mag-one", runtime={"kind": "autogen", "mode": "magentic_one"}
    )) is False
    assert card_domain._is_callable_magentic_worker_card(_agent(
        "disabled", enabled=False,
        runtime={"kind": "hermes", "mode": "delegate", "profile": "disabled"},
    )) is False
    assert card_domain._is_callable_magentic_worker_card(_agent(
        "disabled-option", runtimeOptions={"enabled": False},
        runtime={"kind": "hermes", "mode": "delegate", "profile": "disabled-option"},
    )) is False
    assert card_domain._is_callable_magentic_worker_card(_agent(
        "unsupported", runtime={"kind": "hermes", "mode": "single", "profile": "unsupported"},
    )) is False


def test_saved_card_participant_projects_identity_and_runtime_only() -> None:
    card = _agent(
        "coder",
        title="Coder",
        prompt="saved worker prompt",
        runtime={"kind": "hermes", "mode": "delegate", "profile": "coder"},
    )
    card["runtimeOptions"]["tools"] = ["card.create"]

    assert card_domain._saved_card_participant(card) == {
        "cardId": "coder",
        "title": "Coder",
        "runtime": {"kind": "hermes", "mode": "delegate", "profile": "coder"},
    }
    with pytest.raises(card_domain.CardDomainError, match="magentic_worker_runtime_invalid"):
        card_domain._saved_card_participant(_agent(
            "mag-one", runtime={"kind": "autogen", "mode": "magentic_one"}
        ))


def test_magentic_roster_describes_an_enabled_hermes_saved_card(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mag_one = _agent("mag-one", runtime={"kind": "autogen", "mode": "magentic_one"})
    coder = _agent(
        "coder",
        title="Coder",
        runtime={"kind": "hermes", "mode": "delegate", "profile": "coder"},
    )
    monkeypatch.setattr(card_domain, "_load_deck_internal", lambda *_args: {
        "projectId": "project-one",
        "deck": {
            "nodes": [mag_one, coder],
            "edges": [{
                "source": "mag-one",
                "target": "coder",
                "edgeType": "magentic_option",
            }],
        },
    })

    roster = card_domain.describe_magentic_agents("project-one", "deck-one")

    assert roster["orchestratorCardId"] == "mag-one"
    assert roster["connectedAgents"] == [{
        "cardId": "coder",
        "title": "Coder",
        "model": {
            "modelKey": "deepseek/deepseek-v4-flash-0731",
            "provider": "openrouter",
        },
        "tools": [],
        "connected": True,
        "executionReady": True,
        "readinessState": "ready",
        "readinessReason": None,
    }]


def _destination_fixture(monkeypatch: pytest.MonkeyPatch) -> dict:
    sender = _agent("sender")
    hermes = _agent(
        "hermes",
        prompt="Hermes saved prompt",
        runtime={"kind": "hermes", "mode": "delegate", "profile": "research"},
    )
    hermes["runtimeOptions"] = {
        **hermes["runtimeOptions"],
        "tools": ["calculator"],
    }
    autogen = _agent("autogen", prompt="AutoGen saved prompt")
    autogen["runtimeOptions"] = {
        **autogen["runtimeOptions"],
        "tools": ["current_datetime"],
    }
    for number, card in enumerate((sender, hermes, autogen), start=1):
        card["_cardRevisionId"] = f"revision-{number}"
        card["_cardRevision"] = number
        card["_cardRevisionSha256"] = f"sha-{number}"
    loaded = {
        "projectId": "00000000-0000-0000-0000-000000000001",
        "deck": {
            "nodes": [sender, hermes, autogen],
            "edges": [
                {"id": "flow-hermes", "source": "sender", "target": "hermes", "edgeType": "flow"},
                {"id": "flow-autogen", "source": "sender", "target": "autogen", "edgeType": "flow"},
            ],
        },
    }
    monkeypatch.setattr(card_domain, "_load_deck_internal", lambda _project, _deck: loaded)
    return loaded


def _destination_payload(card_id: str) -> dict:
    return {
        "projectId": "project-one",
        "deckId": "deck-one",
        "runId": f"run-{card_id}",
        "cardId": card_id,
        "senderCardId": "sender",
        "assignment": "Use every supplied declaration.",
    }


def test_invalid_enabled_script_falls_back_to_exact_saved_tool_schema(monkeypatch):
    loaded = _destination_fixture(monkeypatch)
    card = next(item for item in loaded["deck"]["nodes"] if item["id"] == "hermes")
    card["runtimeOptions"]["script"] = {"enabled": True, "source": "return InvocationPreparation()"}
    invocation = card_domain.materialize_invocation(_destination_payload("hermes"))
    grants = invocation["idf"]["selectedToolsAndGrants"]
    script = invocation["idf"]["stableSavedCardContext"]["runtimeOptions"]["script"]
    assert grants["presentedTools"] == ["calculator"]
    assert grants["scriptPresentation"] == {
        "mode": "selected-mcp", "fallbackReason": "card_script_validation_failed",
    }
    assert script["lastValidation"]["status"] == "invalid"


def test_disabled_script_preserves_model_input_and_remains_visible_saved_configuration(monkeypatch):
    loaded = _destination_fixture(monkeypatch)
    card = next(item for item in loaded["deck"]["nodes"] if item["id"] == "hermes")
    before = card_domain.materialize_invocation(_destination_payload("hermes"))["idf"]
    card["runtimeOptions"]["script"] = {"enabled": False, "source": "not executable"}
    after = card_domain.materialize_invocation(_destination_payload("hermes"))["idf"]
    assert before["actualGraphData"] == after["actualGraphData"]
    assert before["dynamicContext"] == after["dynamicContext"]
    assert before["selectedToolsAndGrants"] == after["selectedToolsAndGrants"]
    before_stable = dict(before["stableSavedCardContext"])
    after_stable = dict(after["stableSavedCardContext"])
    before_options = dict(before_stable.pop("runtimeOptions"))
    after_options = dict(after_stable.pop("runtimeOptions"))
    assert before_stable == after_stable
    assert before_options == {
        key: value for key, value in after_options.items() if key != "script"
    }
    stable = card_domain._stable_card(card)
    assert stable["runtimeExtensions"]["script"]["enabled"] is False
    assert stable["runtimeExtensions"]["script"]["source"] == "not executable"
    assert stable["runtimeExtensions"]["script"]["nativeSupport"]["available"] is True
    assert stable["grants"]["tools"] == ["calculator"]


def test_saved_hermes_subagent_model_survives_canonical_idf_materialization(monkeypatch):
    loaded = _destination_fixture(monkeypatch)
    card = next(item for item in loaded["deck"]["nodes"] if item["id"] == "hermes")
    selection = {
        "provider": "openai",
        "accessMode": "chatgpt-account",
        "modelKey": "gpt-5.6-luna",
        "providerModelId": "gpt-5.6-luna",
    }
    card["runtimeOptions"]["subagentModel"] = selection

    invocation = card_domain.materialize_invocation(_destination_payload("hermes"))

    assert invocation["idf"]["stableSavedCardContext"]["runtimeOptions"]["subagentModel"] == selection
    assert invocation["idf"]["stableSavedCardContext"]["provider"]["providerModelId"] != "gpt-5.6-luna"
    assert card_domain._stable_card(card)["runtimeExtensions"]["subagentModel"] == selection


@pytest.mark.parametrize("runtime", [
    {"kind": "hermes", "mode": mode, "profile": "research"} for mode in ("main", "delegate", "kanban")
] + [{"kind": "autogen", "mode": mode} for mode in ("assistant", "magentic_one")])
def test_ordinary_materialization_never_loads_builder_dictionary(monkeypatch, runtime):
    from app.python_models import idd
    loaded = _destination_fixture(monkeypatch)
    next(card for card in loaded["deck"]["nodes"] if card["id"] == "hermes")["runtime"] = runtime
    monkeypatch.setattr(idd, "load_input_data_dictionary", lambda: (_ for _ in ()).throw(
        AssertionError("ordinary Run must not load builder data")))
    payload = _destination_payload("hermes")
    payload.pop("senderCardId")
    invocation = card_domain.materialize_invocation(payload)
    assert invocation["idf"]["selectedToolsAndGrants"]["enabledTools"] == ["calculator"]


def test_receiving_card_materializes_its_own_exact_call_data(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    loaded = _destination_fixture(monkeypatch)
    hermes = card_domain.materialize_invocation(_destination_payload("hermes"))
    autogen = card_domain.materialize_invocation(_destination_payload("autogen"))

    assert hermes["idf"]["stableSavedCardContext"]["instructions"] == "Hermes saved prompt"
    assert hermes["idf"]["stableSavedCardContext"]["runtime"] == {
        "kind": "hermes", "mode": "delegate", "profile": "research",
    }
    assert hermes["idf"]["selectedToolsAndGrants"]["enabledTools"] == ["calculator"]
    assert autogen["idf"]["stableSavedCardContext"]["instructions"] == "AutoGen saved prompt"
    assert autogen["idf"]["stableSavedCardContext"]["runtime"] == {"kind": "autogen", "mode": "assistant"}
    assert autogen["idf"]["selectedToolsAndGrants"]["enabledTools"] == ["current_datetime"]
    assert hermes["idf"]["dynamicContext"]["task"] == autogen["idf"]["dynamicContext"]["task"]
    assert hermes["idf"]["dynamicContext"]["task"] == "Use every supplied declaration."
    assert hermes["idf"]["actualGraphData"]["recordCounts"]["total"] == 0
    assert hermes["idf"]["actualGraphData"]["selectedNativeReferences"] == []
    assert "runId" not in hermes["idf"]["stableSavedCardContext"]
    assert "flow-hermes" not in str(hermes["idf"])

    loaded["deck"]["edges"] = [
        edge for edge in loaded["deck"]["edges"] if edge["target"] != "autogen"
    ]
    with pytest.raises(
        card_domain.CardDomainError,
        match="card_invocation_edge_authority_required",
    ):
        card_domain.materialize_invocation(_destination_payload("autogen"))


def test_idf_materialization_requires_an_actual_run_identity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _destination_fixture(monkeypatch)
    payload = _destination_payload("hermes")
    payload.pop("runId")

    with pytest.raises(card_domain.CardDomainError, match="run_id_required"):
        card_domain.materialize_invocation(payload)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("contextMarkdown", "copied parent context"),
        ("nativeReferences", [{"nativeId": "unresolved"}]),
        ("keyContext", "arbitrary caller summary"),
        ("visibleMessages", [{"role": "user", "content": "old chat"}]),
        ("priorResults", [{"nativeId": "copied-result"}]),
        ("outputRequirements", "caller-authored extra prompt"),
        ("tools", ["calculator"]),
    ],
)
def test_invocation_rejects_every_non_graph_context_field(
    monkeypatch: pytest.MonkeyPatch,
    field: str,
    value: object,
) -> None:
    _destination_fixture(monkeypatch)
    payload = {**_destination_payload("hermes"), field: value}
    with pytest.raises(
        card_domain.CardDomainError,
        match=f"invocation_context_field_forbidden:{field}",
    ):
        card_domain.materialize_invocation(payload)


def test_saved_hook_and_handoff_anchor_resolve_before_one_materialization(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    loaded = _destination_fixture(monkeypatch)
    target = next(card for card in loaded["deck"]["nodes"] if card["id"] == "hermes")
    target["runtimeOptions"]["graphHooks"] = [{
        "authority": "ThinkGraph",
        "nativeId": "hook:one",
        "reason": "saved start point",
        "order": 1,
        "boundedExpansion": 0,
        "required": True,
    }]
    resolved: list[dict] = []

    def resolve(project_id, anchors, **kwargs):
        assert project_id == loaded["projectId"]
        assert kwargs["search_text"] == "Use every supplied declaration."
        resolved.extend(anchors)
        return "actual current graph data", [{
            "authority": "ThinkGraph", "nativeId": anchor["nativeId"],
            "reason": anchor["reason"], "asOf": "current", "required": anchor["required"],
        } for anchor in anchors]

    monkeypatch.setattr(card_domain, "resolve_data_anchors", resolve)
    payload = {
        **_destination_payload("hermes"),
        "dataAnchors": [{
            "authority": "ThinkGraph",
            "nativeId": "handoff:one",
            "reason": "selected by sender",
            "priority": 10,
            "boundedExpansion": 0,
            "required": True,
        }],
    }
    invocation = card_domain.materialize_invocation(payload)

    assert [anchor["nativeId"] for anchor in resolved] == ["hook:one", "handoff:one"]
    assert invocation["idf"]["actualGraphData"]["modelText"] == "actual current graph data"
    assert [reference["nativeId"] for reference in invocation["idf"]["actualGraphData"]["selectedNativeReferences"]] == [
        "hook:one", "handoff:one",
    ]

    loaded["deck"]["edges"] = []
    resolved.clear()
    with pytest.raises(card_domain.CardDomainError, match="card_invocation_edge_authority_required"):
        card_domain.materialize_invocation(payload)
    assert resolved == []


def test_saved_dynamic_knowgraph_hook_searches_the_assignment_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    loaded = _destination_fixture(monkeypatch)
    target = next(card for card in loaded["deck"]["nodes"] if card["id"] == "hermes")
    target["runtimeOptions"]["graphHooks"] = [{
        "authority": "KnowGraph",
        "reason": "start from current sourced knowledge",
        "order": 1,
        "boundedExpansion": 1,
        "required": False,
        "searchDynamicInput": True,
        "entityTypes": ["Company"],
        "edgeTypes": ["SUPPORTS"],
        "maxNodes": 4,
        "maxFacts": 5,
    }]
    calls: list[tuple[list[dict], dict]] = []

    def resolve(_project_id, anchors, **kwargs):
        calls.append((anchors, kwargs))
        return "current KnowGraph result", [{
            "authority": "KnowGraph", "nativeId": "entity-1",
            "reason": anchors[0]["reason"], "asOf": "current",
            "required": False, "readOperation": "graphiti.search_nodes",
        }]

    monkeypatch.setattr(card_domain, "resolve_data_anchors", resolve)
    invocation = card_domain.materialize_invocation(_destination_payload("hermes"))

    assert len(calls) == 1
    anchors, kwargs = calls[0]
    assert len(anchors) == 1
    assert anchors[0]["searchDynamicInput"] is True
    assert anchors[0]["entityTypes"] == ["Company"]
    assert anchors[0]["edgeTypes"] == ["SUPPORTS"]
    assert kwargs["search_text"] == "Use every supplied declaration."
    assert invocation["idf"]["actualGraphData"]["modelText"] == "current KnowGraph result"
    assert invocation["resolvedNativeReads"][0]["nativeId"] == "entity-1"


def test_card_graph_handoff_rereads_native_data_and_attributes_source_run(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = _agent("helper", runtime={"kind": "hermes", "mode": "kanban", "profile": "helper"})
    source["runtimeOptions"]["tools"] = ["card.load_graph_references"]
    target = _agent(
        "mag-one",
        runtime={"kind": "autogen", "mode": "magentic_one"},
        _cardRevisionId="revision-mag-one",
        _cardRevision=3,
        _cardRevisionSha256="sha-mag-one",
    )
    monkeypatch.setattr(card_domain, "_load_deck_internal", lambda *_args: {
        "projectId": "project-one",
        "deck": {"nodes": [source, target], "edges": []},
    })
    resolved_calls = []
    monkeypatch.setattr(
        card_domain,
        "resolve_data_anchors",
        lambda project_id, anchors, **kwargs: (
            resolved_calls.append((project_id, anchors, kwargs))
            or (
                "# KnowGraph\nActual current sourced finding",
                [{
                    "authority": "KnowGraph", "nativeId": "episode:one",
                    "nativeKind": "node", "reason": anchors[0]["reason"],
                    "provenance": {"source": "Graphiti"}, "truncated": False,
                }],
            )
        ),
    )
    observed = []
    monkeypatch.setattr(card_domain, "observe_native_attention", lambda event: observed.append(event) or True)

    result = card_domain.load_card_graph_reference({
        "projectId": "project-one", "deckId": "deck_builder",
        "conversationId": "conversation-one", "_sourceCardId": "helper",
        "_sourceRunId": "run-helper", "targetCardId": "mag-one",
        "authority": "KnowGraph", "nativeId": "episode:one",
        "reason": "Use the sourced evidence", "order": 2, "depth": 1,
        "resultLimit": 8, "required": True,
    })

    assert result["ready"] is True
    assert result["persisted"] is False
    assert result["started"] is False
    assert result["cardRevisionId"] == "revision-mag-one"
    assert result["cardRevision"] == 3
    assert result["cardRevisionSha256"] == "sha-mag-one"
    assert result["reference"] == {
        "authority": "KnowGraph", "nativeId": "episode:one",
        "reason": "Use the sourced evidence", "boundedExpansion": 1,
        "resultLimit": 8, "required": True, "order": 2,
    }
    assert resolved_calls[0][2]["deck_id"] == "deck_builder"
    assert resolved_calls[0][2]["card_id"] == "helper"
    assert resolved_calls[0][2]["graph_projection"]["schemaVersion"] == "native-card-context.v1"
    assert observed[0]["runId"] == "run-helper"
    assert observed[0]["cardId"] == "helper"
    assert observed[0]["targetCardId"] == "mag-one"
    assert observed[0]["nativeNodeIds"] == ["episode:one"]


def test_main_can_load_its_own_bounded_knowledge_selection_without_handoff_grant(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    main = _agent(
        "main",
        runtime={"kind": "hermes", "mode": "main", "profile": "liquidaity-main"},
    )
    monkeypatch.setattr(card_domain, "_load_deck_internal", lambda *_args: {
        "projectId": "project-one",
        "deck": {"nodes": [main], "edges": []},
    })
    resolved_calls = []
    monkeypatch.setattr(
        card_domain,
        "resolve_data_anchors",
        lambda project_id, anchors, **kwargs: (
            resolved_calls.append((project_id, anchors, kwargs))
            or (
                "# ThinkGraph\nCurrent bounded decision",
                [{
                    "authority": "ThinkGraph",
                    "nativeId": "mem-one",
                    "nativeKind": "node",
                    "reason": anchors[0]["reason"],
                }],
            )
        ),
    )

    result = card_domain.load_card_graph_reference({
        "projectId": "project-one",
        "deckId": "deck_builder",
        "conversationId": "conversation-one",
        "_sourceCardId": "main",
        "_sourceRunId": "run-main",
        "targetCardId": "main",
        "authority": "ThinkGraph",
        "nativeId": "mem-one",
        "reason": "Attach the approved decision",
        "order": 0,
        "depth": 0,
        "resultLimit": 1,
        "required": True,
    })

    assert result["ready"] is True
    assert result["sourceCardId"] == result["targetCardId"] == "main"
    assert result["reference"] == {
        "authority": "ThinkGraph",
        "nativeId": "mem-one",
        "reason": "Attach the approved decision",
        "boundedExpansion": 0,
        "resultLimit": 1,
        "required": True,
        "order": 0,
    }
    assert len(resolved_calls) == 1
    assert resolved_calls[0][2]["card_id"] == "main"


def test_non_main_same_card_graph_load_remains_forbidden(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    helper = _agent(
        "helper",
        runtime={"kind": "hermes", "mode": "kanban", "profile": "helper"},
    )
    helper["runtimeOptions"]["tools"] = ["card.load_graph_references"]
    monkeypatch.setattr(card_domain, "_load_deck_internal", lambda *_args: {
        "projectId": "project-one",
        "deck": {"nodes": [helper], "edges": []},
    })

    with pytest.raises(
        card_domain.CardDomainError,
        match="graph_reference_self_handoff_forbidden",
    ):
        card_domain.load_card_graph_reference({
            "projectId": "project-one",
            "deckId": "deck_builder",
            "_sourceCardId": "helper",
            "_sourceRunId": "run-helper",
            "targetCardId": "helper",
            "authority": "ThinkGraph",
            "nativeId": "mem-one",
            "reason": "Invalid recursive handoff",
            "order": 0,
            "depth": 0,
            "resultLimit": 1,
            "required": True,
        })


def test_card_graph_handoff_fails_closed_for_ungranted_or_unresolved_required_reference(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = _agent("helper", runtime={"kind": "hermes", "mode": "kanban", "profile": "helper"})
    target = _agent("mag-one", runtime={"kind": "autogen", "mode": "magentic_one"})
    monkeypatch.setattr(card_domain, "_load_deck_internal", lambda *_args: {
        "projectId": "project-one", "deck": {"nodes": [source, target], "edges": []},
    })
    payload = {
        "projectId": "project-one", "deckId": "deck_builder",
        "_sourceCardId": "helper", "_sourceRunId": "run-helper",
        "targetCardId": "mag-one", "authority": "KnowGraph",
        "nativeId": "missing", "reason": "Required source", "order": 0,
        "depth": 0, "resultLimit": 4, "required": True,
    }
    with pytest.raises(card_domain.CardDomainError, match="graph_reference_handoff_not_granted"):
        card_domain.load_card_graph_reference(payload)

    source["runtimeOptions"]["tools"] = ["card.load_graph_references"]
    monkeypatch.setattr(card_domain, "resolve_data_anchors", lambda *_args, **_kwargs: ("", []))
    result = card_domain.load_card_graph_reference(payload)
    assert result["ok"] is False
    assert result["ready"] is False
    assert result["error"] == "data_anchor_required_not_resolved"


def test_context_cascade_rejects_duplicate_and_recursive_handoffs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    loaded = _destination_fixture(monkeypatch)
    target = next(card for card in loaded["deck"]["nodes"] if card["id"] == "hermes")
    target["runtimeOptions"]["graphHooks"] = [{
        "authority": "ThinkGraph",
        "nativeId": "same:one",
        "reason": "saved start point",
        "order": 1,
        "boundedExpansion": 0,
        "required": True,
    }]
    payload = {
        **_destination_payload("hermes"),
        "dataAnchors": [{
            "authority": "ThinkGraph",
            "nativeId": "same:one",
            "reason": "sender selected the same object",
            "priority": 1,
            "boundedExpansion": 0,
            "required": True,
        }],
    }
    with pytest.raises(card_domain.CardDomainError, match="data_anchor_duplicate"):
        card_domain.materialize_invocation(payload)

    payload["dataAnchors"] = []
    payload["senderCardId"] = "hermes"
    with pytest.raises(
        card_domain.CardDomainError,
        match="card_invocation_self_handoff_forbidden",
    ):
        card_domain.materialize_invocation(payload)


def test_explicit_card_mission_is_transient_and_retaskable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    loaded = _destination_fixture(monkeypatch)
    target = next(card for card in loaded["deck"]["nodes"] if card["id"] == "hermes")
    target["runtime"] = {"kind": "hermes", "mode": "delegate", "profile": "knowledge"}
    target["runtimeOptions"]["tools"] = ["graphiti.add_memory"]

    first = card_domain.materialize_invocation({
        **_destination_payload("hermes"),
        "runId": "run-first",
        "assignment": "Research the first bounded question.",
    })
    second = card_domain.materialize_invocation({
        **_destination_payload("hermes"),
        "runId": "run-second",
        "assignment": "Retask the same saved Graph Agent Card with a second question.",
    })

    assert first["cardIdentity"]["cardId"] == second["cardIdentity"]["cardId"] == "hermes"
    assert second["idf"]["stableSavedCardContext"]["runtime"]["profile"] == "knowledge"
    assert "Retask the same saved Graph Agent Card" in second["idf"]["dynamicContext"]["task"]
    assert "Research the first bounded question" not in second["idf"]["dynamicContext"]["task"]
    assert second["delegationTargets"] == []
    assert "card.run_assistant_agent" not in second["idf"]["selectedToolsAndGrants"]["enabledTools"]


def test_main_and_coder_can_explicitly_retask_one_non_delegating_graph_agent_card(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    main = _agent("main", runtime={"kind": "hermes", "mode": "main", "profile": "main"})
    coder = _agent("coder", runtime={"kind": "hermes", "mode": "delegate", "profile": "coder"})
    graph_agent = _agent("graph-agent", runtime={"kind": "hermes", "mode": "delegate", "profile": "knowledge"})
    main["runtimeOptions"]["tools"] = ["card.run_assistant_agent"]
    coder["runtimeOptions"]["tools"] = ["card.run_assistant_agent"]
    graph_agent["runtimeOptions"]["tools"] = ["graphiti.add_memory"]
    for index, card in enumerate((main, coder, graph_agent), start=1):
        card["_cardRevisionId"] = f"revision-{index}"
        card["_cardRevision"] = 1
        card["_cardRevisionSha256"] = f"sha-{index}"
    loaded = {
        "projectId": "project-one",
        "deck": {
            "nodes": [main, coder, graph_agent],
            "edges": [
                {"source": "main", "target": "graph-agent", "edgeType": "flow"},
                {"source": "coder", "target": "graph-agent", "edgeType": "flow"},
            ],
        },
    }
    monkeypatch.setattr(card_domain, "_load_deck_internal", lambda *_args: loaded)

    def invoke(sender: str, task: str) -> dict:
        return card_domain.materialize_invocation({
            "projectId": "project-one", "deckId": "deck_builder",
            "runId": f"run-{sender}-{len(task)}",
            "cardId": "graph-agent", "senderCardId": sender,
            "assignment": task,
        })

    assert invoke("main", "Research the current question.")["cardIdentity"]["cardId"] == "graph-agent"
    assert invoke("coder", "Retask the missing evidence.")["delegationTargets"] == []
    loaded["deck"]["edges"] = loaded["deck"]["edges"][:1]
    with pytest.raises(card_domain.CardDomainError, match="card_invocation_edge_authority_required"):
        invoke("coder", "This wire no longer authorizes the retask.")

def test_main_chat_uses_one_canonical_materializer_without_serialized_card_data(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    from app.python_models import constellation

    monkeypatch.setattr(
        constellation,
        "get_constellation",
        lambda *_args, **_kwargs: pytest.fail("Main preparation opened Constellation"),
    )
    main = _agent(
        "main", runtime={"kind": "hermes", "mode": "main", "profile": "default"}
    )
    main["runtimeOptions"] = {
        **main["runtimeOptions"],
        "tools": ["canvas.inspect"],
    }
    main["_cardRevisionId"] = "main-revision"
    main["_cardRevision"] = 1
    main["_cardRevisionSha256"] = "main-sha"
    monkeypatch.setattr(
        card_domain,
        "_load_deck_internal",
        lambda _project, _deck: {
            "projectId": "00000000-0000-0000-0000-000000000001",
            "deck": {"nodes": [main], "edges": []},
        },
    )
    materializations: list[str] = []
    real_materialize = card_domain.materialize_idf

    def count_materialization(**kwargs):
        materializations.append(str(kwargs["variable"]["task"]))
        return real_materialize(**kwargs)

    monkeypatch.setattr(card_domain, "materialize_idf", count_materialization)
    prepared = card_domain.prepare_main_chat({
        "projectId": "project-one",
        "deckId": "deck-one",
        "message": "Help me prepare work for another agent.",
    })
    assert "assignment" not in prepared
    assert prepared["message"] == "Help me prepare work for another agent."
    assert "idf" not in prepared
    assert prepared["sessionProfile"]["systemPrompt"] == main["prompt"]
    assert prepared["sessionProfile"]["enabledTools"] == ["canvas.inspect"]
    assert prepared["sessionProfile"]["runtime"] == {
        "kind": "hermes", "mode": "main", "profile": "default",
    }
    assert prepared["cardIdentity"] == {"cardId": "main", "title": "main"}
    assert materializations == []
    inserted: dict[str, object] = {}
    monkeypatch.setattr(
        card_domain,
        "_insert_run",
        lambda value, **kwargs: (
            inserted.update({"prepared": value, **kwargs})
            or (kwargs["run_id"], kwargs["correlation_id"], True)
        ),
    )
    monkeypatch.setattr(card_domain, "_observe_run_start", lambda *args, **kwargs: True)
    monkeypatch.setattr(card_domain, "_record_run_input_artifact", lambda *_args, **_kwargs: None)
    monkeypatch.setenv("LIQUIDAITY_RUN_INPUT_ROOT", str(tmp_path / "run-inputs"))
    begun = card_domain.begin_main_chat_run({
        "projectId": "project-one",
        "deckId": "deck-one",
        "message": "Help me prepare work for another agent.",
        "cardRevisionId": "main-revision",
        "runId": "run-main-one",
        "correlationId": "run-main-one",
        "conversationId": "conversation-one",
    })
    assert begun["hermesTransport"]["request"]["task"] == (
        "Help me prepare work for another agent."
    )
    assert inserted["prepared"]["idf"]["dynamicContext"]["task"] == begun["idf"]["dynamicContext"]["task"]
    assert begun["inputFile"]["idfPath"].endswith("in.idf")
    assert materializations == ["Help me prepare work for another agent."]


def test_age_run_start_records_identity_but_never_invents_tool_or_reference_use(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    statements: list[tuple[str, dict]] = []

    class Cursor:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def cursor(self, **_kwargs):
            return Cursor()

    monkeypatch.setattr(card_domain, "connect_postgres", lambda **_kwargs: Connection())
    monkeypatch.setattr(
        card_domain,
        "_age_rows",
        lambda _cursor, query, params, _columns: statements.append((query, params)) or [],
    )
    prepared = {
        "projectId": "project-one",
        "deckId": "deck-one",
        "cardIdentity": {"cardId": "card-one"},
        "idf": {"stableSavedCardContext": {"runtime": {
            "kind": "hermes", "mode": "main", "profile": "main",
        }}},
    }
    assert card_domain._observe_run_start(
        prepared,
        {
            "driverSource": "internal_chat",
            "nativeReferences": [{
                "authority": "KnowGraph",
                "nativeId": "episode:stale-request",
                "reason": "must not drive telemetry",
                "asOf": "2026-08-17T00:00:00Z",
                "required": True,
            }],
        },
        run_id="run-one",
        correlation_id="correlation-one",
    ) is True
    assert any("EXECUTED_BY" in query for query, _params in statements)
    assert statements[0][1]["driverSource"] == "internal_chat"
    assert statements[0][1]["contextAuthorityMode"] == "main_native_honcho"
    assert "run.driverSource=$driverSource" in statements[0][0]
    assert "run.contextAuthorityMode=$contextAuthorityMode" in statements[0][0]
    assert all("USED_TOOL" not in query for query, _params in statements)
    assert all("[edge:USED]" not in query for query, _params in statements)
    assert all("[edge:VIEWED]" not in query for query, _params in statements)

    statements.clear()
    assert card_domain._observe_run_finish("run-one", "completed") is True
    assert len(statements) == 1
    assert "SET run.state=$state" in statements[0][0]

    statements.clear()
    assert card_domain._observe_artifact(
        "run-one",
        "artifact-one",
        "report",
        "artifact://report-one",
    ) is True
    assert len(statements) == 1
    assert "PRODUCED_ARTIFACT" in statements[0][0]


def test_native_hermes_ephemeral_child_keeps_originating_card_revision(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    statements = []
    parent = {
        "run_id": "main-run",
        "project_id": "project-one",
        "deck_id": "deck-one",
        "target_card_revision_id": "main-revision",
        "runtime_kind": "hermes",
        "runtime_mode": "main",
        "provider": "openai",
        "model_key": "main-model",
        "provider_model_id": "main-model",
        "access_mode": "chatgpt-account",
        "state": "running",
        "card_id": "card_main_chat",
    }

    class Cursor:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def execute(self, statement, params):
            statements.append((statement, params))

        def fetchall(self):
            return [parent]

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def cursor(self, **_kwargs):
            return Cursor()

    monkeypatch.setattr(card_domain, "connect_postgres", lambda **_kwargs: Connection())
    observed = []
    monkeypatch.setattr(
        card_domain,
        "_observe_run_start",
        lambda prepared, payload, **kwargs: observed.append((prepared, payload, kwargs)) or True,
    )

    result = card_domain.begin_native_hermes_child_run({
        "runId": "ephemeral-run",
        "correlationId": "ephemeral-correlation",
        "rootRunId": "main-run",
        "parentRunId": "main-run",
        "projectId": "project-one",
        "deckId": "deck-one",
        "conversationId": "conversation-one",
        "cardId": "card_main_chat",
        "nativeChildId": "sa-ephemeral",
    })

    insert = next(params for query, params in statements if "INSERT INTO ag_catalog.agent_runs" in query)
    assert insert[3] == "main-revision"
    assert insert[4:6] == ("hermes", "main")
    assert len(insert) == 12
    # Only durable native Team task ids are valid rejoin selectors. Native
    # one-shot leaf ids retain the pre-existing unbound child-Run behavior.
    assert insert[11] is None
    assert result["cardId"] == "card_main_chat"
    assert result["parentRunId"] == "main-run"
    assert result["nativeChildId"] == "sa-ephemeral"
    assert observed[0][0]["cardIdentity"]["cardId"] == "card_main_chat"
    assert observed[0][1] == {
        "originatingRunId": "main-run",
        "rootRunId": "main-run",
        "conversationId": "conversation-one",
        "nativeChildId": "sa-ephemeral",
    }

    with pytest.raises(card_domain.CardDomainError, match="hermes_child_parent_card_mismatch"):
        card_domain.begin_native_hermes_child_run({
            "runId": "forged-child-run",
            "correlationId": "forged-child-correlation",
            "rootRunId": "main-run",
            "parentRunId": "main-run",
            "projectId": "project-one",
            "deckId": "deck-one",
            "conversationId": "conversation-one",
            "cardId": "card_coder",
            "nativeChildId": "sa-forged",
        })


def test_native_hermes_team_root_gets_one_idempotent_child_run(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    statements: list[tuple[str, object]] = []
    native_run_exists = False
    parent = {
        "run_id": "main-run", "project_id": "project-one", "deck_id": "deck-one",
        "target_card_revision_id": "main-revision", "runtime_kind": "hermes",
        "runtime_mode": "main", "provider": "openai-codex", "model_key": "gpt-5.6-sol",
        "provider_model_id": "gpt-5.6-sol", "access_mode": "chatgpt-account",
        "state": "running", "card_id": "card_main_chat",
    }

    class Cursor:
        last_query = ""

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def execute(self, statement, params):
            nonlocal native_run_exists
            self.last_query = str(statement)
            statements.append((self.last_query, params))
            if "INSERT INTO ag_catalog.agent_runs" in self.last_query:
                native_run_exists = True

        def fetchall(self):
            if "WHERE run.run_id IN" in self.last_query:
                return [parent]
            if "run.provider_thread_ref=%s" in self.last_query:
                return [{"run_id": "team-child-run"}] if native_run_exists else []
            return []

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def cursor(self, **_kwargs):
            return Cursor()

    monkeypatch.setattr(card_domain, "connect_postgres", lambda **_kwargs: Connection())
    observed: list[str] = []
    monkeypatch.setattr(
        card_domain,
        "_observe_run_start",
        lambda _prepared, _payload, **kwargs: observed.append(kwargs["run_id"]) or True,
    )
    payload = {
        "runId": "team-child-run", "correlationId": "team-child-correlation",
        "rootRunId": "main-run", "parentRunId": "main-run",
        "projectId": "project-one", "deckId": "deck-one",
        "conversationId": "conversation-one", "cardId": "card_main_chat",
        "nativeChildId": "t_team_root", "provider": "openai-codex",
        "model": "gpt-5.6-terra",
    }

    created = card_domain.begin_native_hermes_child_run(payload)
    rejoined = card_domain.begin_native_hermes_child_run({
        **payload,
        "runId": "duplicate-run-must-not-persist",
        "correlationId": "duplicate-correlation",
    })

    inserts = [params for query, params in statements if "INSERT INTO ag_catalog.agent_runs" in query]
    assert len(inserts) == 1
    assert inserts[0][11] == "t_team_root"
    assert created["runId"] == "team-child-run"
    assert created["rejoined"] is False
    assert rejoined["runId"] == "team-child-run"
    assert rejoined["rejoined"] is True
    assert observed == ["team-child-run"]


def test_agentgraph_inspection_is_bounded_read_only_and_project_scoped(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sql: list[str] = []
    age_calls: list[tuple[str, dict]] = []

    class Cursor:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def execute(self, statement, *_args):
            sql.append(statement)

        def fetchone(self):
            return {"available": True}

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def cursor(self, **_kwargs):
            return Cursor()

    deck = {
        "projectId": "project-one",
        "deck": {
            "nodes": [{
                "id": "card-one",
                "title": "Main",
                "runtime": {"kind": "hermes", "mode": "main", "profile": "main"},
                "runtimeOptions": {"enabled": True},
            }],
            "edges": [{
                "id": "flow-one",
                "source": "card-one",
                "target": "card-two",
                "edgeType": "flow",
            }],
        },
    }

    def age_rows(_cursor, query, params, _columns):
        age_calls.append((query, params))
        if "EXECUTED_BY" in query:
            return [{
                "run": {
                    "runId": "run-one",
                    "correlationId": "correlation-one",
                    "state": "completed",
                },
                "card_id": "card-one",
            }]
        if "ASSIGNED_TO" in query:
            return [{
                "run_id": "run-one",
                "sender_card_id": "card-main",
                "target_card_id": "card-one",
            }]
        if "count(edge)" in query:
            return [{
                "run_id": "run-one",
                "operation": "read",
                "event_count": 1,
            }]
        if "USED_TOOL" in query:
            return [{
                "run_id": "run-one",
                "tool_id": "cbm.search_graph",
                "event": {
                    "eventId": "native-attention:event-one",
                    "timestamp": "2026-08-18T12:00:00Z",
                    "projectId": "project-one",
                    "deckId": "deck-one",
                    "conversationId": "conversation-one",
                    "cardId": "card-one",
                    "authority": "codegraph",
                    "operation": "read",
                    "toolName": "cbm.search_graph",
                    "nativeNodeIds": ["pkg._runtime_owner"],
                    "nativeEdgeIds": [],
                    "resultHash": "a" * 64,
                    "truncated": False,
                },
            }]
        if "-[:USED]->" in query:
            return [{
                "run_id": "run-one",
                "authority": "KnowGraph",
                "native_id": "episode:one",
            }]
        if "-[:VIEWED]->" in query:
            return []
        if "-[:READ]->" in query:
            return [{"run_id": "run-one", "authority": "CodeGraph", "native_id": "pkg.materialized"}]
        if "PRODUCED_ARTIFACT" in query:
            return [{
                "run_id": "run-one",
                "artifact": {
                    "artifactId": "artifact-one",
                    "artifactKind": "report",
                    "locator": "artifact://one",
                },
            }]
        return []

    monkeypatch.setattr(card_domain, "connect_postgres", lambda **_kwargs: Connection())
    monkeypatch.setattr(card_domain, "_load_deck_with_cursor", lambda *_args, **_kwargs: deck)
    monkeypatch.setattr(card_domain, "_age_rows", age_rows)

    result = card_domain.inspect_agentgraph({
        "projectId": "project-one",
        "deckId": "deck-one",
        "conversationId": "conversation-one",
        "assignmentId": "retired-assignment",
        "limit": 5,
    })

    assert sql[0] == "SET TRANSACTION READ ONLY"
    assert sql == ["SET TRANSACTION READ ONLY"]
    assert result["telemetry"]["materializedNativeReferencesAvailable"] is True
    assert result["authority"] == "postgresql-age-agentgraph"
    assert result["projectId"] == "project-one"
    assert result["scope"] == {
        "readScope": "project-deck",
        "projectWideRequested": False,
        "conversationId": "conversation-one",
        "cardId": None,
        "runId": None,
        "conversationFilterAvailable": True,
    }
    assert result["cards"][0]["cardId"] == "card-one"
    assert result["relationships"][0]["edgeType"] == "flow"
    assert result["runs"] == [{
        "runId": "run-one",
        "correlationId": "correlation-one",
        "state": "completed",
        "projectId": "project-one",
        "deckId": "deck-one",
        "conversationId": "",
        "rootRunId": "run-one",
        "nativeChildId": None,
        "startedAt": None,
        "lastAttentionAt": None,
        "cardId": "card-one",
        "assignedFromCardIds": ["card-main"],
        "parentRunIds": [],
            "childRunIds": [],
            "usedTools": ["cbm.search_graph"],
            "graphReads": 1,
            "graphWrites": 0,
            "attentionEvents": [{
            "eventId": "native-attention:event-one",
            "timestamp": "2026-08-18T12:00:00Z",
            "projectId": "project-one",
            "deckId": "deck-one",
            "conversationId": "conversation-one",
            "runId": "run-one",
            "cardId": "card-one",
            "authority": "codegraph",
            "operation": "read",
            "toolName": "cbm.search_graph",
            "nativeNodeIds": ["pkg._runtime_owner"],
            "nativeEdgeIds": [],
            "nativeEdges": [],
            "resultHash": "a" * 64,
            "truncated": False,
        }],
        "nativeReferences": [{"authority": "KnowGraph", "nativeId": "episode:one"}],
        "viewedNativeReferences": [],
        "materializedNativeReferences": [{"authority": "CodeGraph", "nativeId": "pkg.materialized"}],
        "artifacts": [{
            "artifactId": "artifact-one",
            "artifactKind": "report",
            "locator": "artifact://one",
        }],
    }]
    assert result["legacyAssignment"] == {
        "assignmentId": "retired-assignment",
        "available": False,
        "reason": "assignmentId is not a current AgentGraph identity; use runId",
    }
    assert all(params["projectId"] == "project-one" for _query, params in age_calls)
    assert all(params["deckId"] == "deck-one" for _query, params in age_calls)
    assert all(
        keyword not in query.upper()
        for query, _params in age_calls
        for keyword in ("MERGE ", "CREATE ", "DELETE ", " SET ")
    )


def test_native_attention_observation_requires_existing_run_card_identity(monkeypatch):
    statements: list[tuple[str, dict]] = []

    class Cursor:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def cursor(self, **_kwargs):
            return Cursor()

    def age_rows(_cursor, query, params, _columns):
        statements.append((query, params))
        if "EXECUTED_BY" in query:
            return [{"run_id": "run-one"}]
        return [{"observed": 3}]

    monkeypatch.setattr(card_domain, "connect_postgres", lambda **_kwargs: Connection())
    monkeypatch.setattr(card_domain, "_age_rows", age_rows)
    event = {
        "eventId": "native-attention:event-one",
        "timestamp": "2026-08-18T12:00:00Z",
        "projectId": "project-one",
        "deckId": "deck-one",
        "conversationId": "conversation-one",
        "runId": "coder-run-one",
        "cardId": "card_local_coder",
        "authority": "codegraph",
        "operation": "read",
        "toolName": "cbm.search_graph",
        "nativeNodeIds": [
            "C-Projects-LiquidAIty-main.apps.python-models.app.python_models.idf.materialize_idf",
            "apps/python-models/app/python_models/idf.py",
        ],
        "nativeEdgeIds": ["edge-one"],
        "nativeEdges": [{
            "id": "edge-one",
            "source": "node-a",
            "target": "node-b",
            "predicate": "USES",
            "provenance": {"group_id": "group-one"},
        }],
        "resultHash": "a" * 64,
        "truncated": False,
    }

    assert card_domain.observe_native_attention(event) is True
    assert len(statements) == 2
    assert "USED_TOOL" in statements[0][0]
    assert "EXECUTED_BY" in statements[0][0]
    assert "UNWIND $references" in statements[1][0]
    assert "USED" in statements[1][0]
    assert statements[0][1]["runId"] == "coder-run-one"
    assert statements[0][1]["cardId"] == "card_local_coder"
    assert statements[0][1]["nativeNodeIds"] == [
        "C-Projects-LiquidAIty-main.apps.python-models.app.python_models.idf.materialize_idf",
        "apps/python-models/app/python_models/idf.py",
    ]
    assert statements[0][1]["nativeEdgeIds"] == ["edge-one"]
    assert statements[0][1]["nativeEdges"] == [{
        "id": "edge-one",
        "source": "node-a",
        "target": "node-b",
        "predicate": "USES",
        "provenance": {"group_id": "group-one"},
    }]
    assert statements[1][1]["references"] == [
        {
            "nativeId": "C-Projects-LiquidAIty-main.apps.python-models.app.python_models.idf.materialize_idf",
            "nativeKind": "node",
        },
        {
            "nativeId": "apps/python-models/app/python_models/idf.py",
            "nativeKind": "node",
        },
        {"nativeId": "edge-one", "nativeKind": "edge"},
    ]
    assert not any(
        key in params
        for _query, params in statements
        for key in ("prompt", "result", "content", "modelInput")
    )

    before = len(statements)
    assert card_domain.observe_native_attention({**event, "cardId": None}) is False
    assert len(statements) == before
