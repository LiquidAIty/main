from __future__ import annotations

import json

import pytest

from app.python_models import (
    agentgraph_topology,
    card_invocation_preparation,
    card_invocation_tools,
    card_run_preparation,
    saved_card_contract,
    saved_cards,
)


@pytest.fixture(autouse=True)
def project_worldview_defaults_to_existing_availability(monkeypatch):
    """Keep unrelated Card tests focused; dedicated tests override the mask."""

    def resolve(project_id, candidate_capability_ids, **_kwargs):
        candidates = list(dict.fromkeys(candidate_capability_ids))
        return {
            "schemaVersion": "project-worldview.v1",
            "projectId": project_id,
            "defaultEnabled": True,
            "candidateCapabilities": candidates,
            "enabledCapabilities": candidates,
            "excludedCapabilities": [],
            "overrides": [],
        }

    monkeypatch.setattr(card_invocation_tools, "resolve_project_worldview", resolve)
    monkeypatch.setattr(agentgraph_topology, "resolve_project_worldview", resolve)

def _agent(card_id: str, **overrides):
    card = {
        "id": card_id,
        "kind": "agent",
        "templateId": "template_assist",
        "title": card_id,
        "prompt": "common prompt",
        "runtime": {"kind": "hermes", "mode": "delegate", "profile": card_id},
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

def _main_bot(card_id: str, **overrides):
    return _agent(card_id, **overrides)

_REMOVED_PROFILE_TARGET_PROJECTION = "delegation" + "Targets"

def _external_tool(name: str, *, read_only: bool) -> dict:
    namespace, provider_name = name.split(".", 1)
    input_schema = {"type": "object", "properties": {}}
    return {
        "name": name,
        "providerToolName": provider_name,
        "kind": "tool",
        "sourceId": namespace,
        "namespace": namespace,
        "connectionKind": "external-mcp",
        "publication": "external-mcp",
        "access": "read" if read_only else "write",
        "title": name,
        "description": f"Provider contract for {name}.",
        "inputSchema": input_schema,
        "canonicalInputSchema": input_schema,
        "serverInjectedArguments": [],
        "dispatcherContextArguments": [],
        "dispatcherOwner": (
            "app.mcp_provider_operations.call_graphiti_operation"
            if namespace == "graphiti"
            else "app.mcp_provider_operations.call_cbm_operation"
        ),
        "authenticatedProjection": True,
        "annotations": {
            "readOnlyHint": read_only,
            "destructiveHint": False,
            "idempotentHint": read_only,
            "openWorldHint": True,
        },
        "grantEligible": True,
        "available": True,
    }

def _delegation_invocation(
    monkeypatch: pytest.MonkeyPatch,
    *,
    edges: list[dict[str, object]],
    target: dict | None = None,
    parent_runtime: dict | None = None,
) -> dict:
    parent = _agent("parent", runtime=parent_runtime or {"kind": "hermes", "mode": "main", "profile": "main"})
    parent["runtimeOptions"] = {
        **parent["runtimeOptions"],
        "tools": ["calculator"],
    }
    child = target or _agent(
        "child",
        runtime={"kind": "hermes", "mode": "delegate", "profile": "helper"},
        runtimeOptions={
            **_agent("child")["runtimeOptions"],
            "tools": ["calculator"],
            "skills": ["repository-helper"],
            "toolsets": ["terminal"],
        },
    )
    for number, card in enumerate((parent, child), start=1):
        card["_cardRevisionId"] = f"revision-{number}"
        card["_cardRevision"] = 1
        card["_cardRevisionSha256"] = f"sha-{number}"
    monkeypatch.setattr(saved_cards, "load_deck",
        lambda _project, _deck: {
            "projectId": "00000000-0000-0000-0000-000000000001",
            "deck": {"nodes": [parent, child], "edges": edges},
        },
    )
    return card_invocation_preparation.materialize_invocation({
        "projectId": "project-one",
        "deckId": "deck-one",
        "runId": "run-delegation",
        "cardId": "parent",
        "assignment": "delegate only across the saved FLOW relationship",
    })

def _prepared_grounded_runtime(runtime: dict[str, str]) -> dict:
    reads = [{
        "cbmQualifiedName": "symbol-one",
    }]
    materialized = card_invocation_preparation.materialize_idf(
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
        graph_records=reads,
        graph_projection={"graphSystems": ["cbm"], "nodes": [{
            "id": "symbol-one", "graphSystem": "cbm", "type": "Function",
        }], "edges": []},
    )
    return {
        "projectId": "project-one",
        "deckId": "deck-one",
        "runtimeOwner": "mag_one" if runtime.get("mode") == "magentic_one" else "hermes",
        "cardIdentity": {"cardId": "card-one", "title": "Card"},
        "cardRevisionId": "revision-one",
        "idf": materialized.idf.model_dump(),
        "resolvedGraphReads": reads,
        "resolvedGraphProjection": {
            "nodes": [{"id": "symbol-one"}], "edges": [],
        },
    }

def _destination_fixture(monkeypatch: pytest.MonkeyPatch) -> dict:
    sender = _main_bot("sender", runtime={"kind": "hermes", "mode": "main", "profile": "sender"})
    hermes = _agent(
        "hermes",
        prompt="Hermes saved prompt",
        runtime={"kind": "hermes", "mode": "delegate", "profile": "research"},
    )
    hermes["runtimeOptions"] = {
        **hermes["runtimeOptions"],
        "tools": ["calculator"],
    }
    for number, card in enumerate((sender, hermes), start=1):
        card["_cardRevisionId"] = f"revision-{number}"
        card["_cardRevision"] = number
        card["_cardRevisionSha256"] = f"sha-{number}"
    loaded = {
        "projectId": "00000000-0000-0000-0000-000000000001",
        "deck": {
            "nodes": [sender, hermes],
            "edges": [
                {"id": "flow-hermes", "source": "sender", "target": "hermes", "edgeType": "flow"},
            ],
        },
    }
    monkeypatch.setattr(saved_cards, "load_deck", lambda _project, _deck: loaded)
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

def test_no_script_preserves_saved_presentation_without_narrowing_effective_grants(
    monkeypatch,
):
    loaded = _destination_fixture(monkeypatch)
    card = loaded["deck"]["nodes"][1]
    card["runtimeOptions"].update(
        tools=["canvas.inspect", "graphiti.search_nodes"],
        mcpConnectionIds=["graphiti"],
    )
    before = json.dumps(card, sort_keys=True)
    payload = _destination_payload("hermes")
    payload["discoveredTools"] = [
        _external_tool("graphiti.search_nodes", read_only=True),
    ]
    prepared = card_invocation_preparation._prepare_invocation(payload)
    config = prepared["_callConfig"]
    assert config["presentedTools"] == card["runtimeOptions"]["tools"]
    assert set(config["presentedTools"]) <= set(config["enabledTools"])
    assert "web_search" not in config["enabledTools"]
    assert json.dumps(card, sort_keys=True) == before

def test_auto_tools_narrows_only_the_ordinary_model_surface(monkeypatch):
    loaded = _destination_fixture(monkeypatch)
    card = loaded["deck"]["nodes"][1]
    card["runtimeOptions"].update(
        autoTools=True,
        tools=["canvas.inspect", "graphiti.search_nodes"],
    )
    captured = {}

    def select(**kwargs):
        captured.update(kwargs)
        return ["graphiti.search_nodes"], {
            "schemaVersion": "auto-tools-decision.v1",
            "status": "selected",
            "candidateCount": 2,
            "selectedToolIds": ["graphiti.search_nodes"],
            "selectedConfidencePercentages": {"graphiti.search_nodes": 82.0},
            "decisionId": "decision-tools",
            "errorCode": None,
        }

    monkeypatch.setattr(card_invocation_preparation, "select_auto_tools", select)
    payload = _destination_payload("hermes")
    payload["discoveredTools"] = [
        _external_tool("graphiti.search_nodes", read_only=True),
    ]

    invocation = card_invocation_preparation.materialize_invocation(payload)
    grants = invocation["idf"]["selectedToolsAndGrants"]

    assert captured["baseline_tool_ids"] == [
        "canvas.inspect", "graphiti.search_nodes",
    ]
    assert captured["context"]["current_request"] == payload["assignment"]
    assert grants["enabledTools"] == [
        "canvas.inspect", "graphiti.search_nodes",
    ]
    assert grants["presentedTools"] == ["graphiti.search_nodes"]
    assert [item["canonicalId"] for item in grants["toolDefinitions"]] == [
        "graphiti.search_nodes",
    ]

def test_auto_model_replaces_only_the_run_provider_tuple(monkeypatch):
    loaded = _destination_fixture(monkeypatch)
    card = loaded["deck"]["nodes"][1]
    card["runtimeOptions"].update(
        provider="openai",
        accessMode="chatgpt-account",
        modelKey="gpt-5.6-sol",
        providerModelId="gpt-5.6-sol",
        autoModel=True,
    )
    before = json.dumps(card, sort_keys=True)
    candidate = {
        "id": "openai:chatgpt-account:gpt-5.6-luna",
        "provider": "openai",
        "accessMode": "chatgpt-account",
        "modelKey": "gpt-5.6-luna",
        "providerModelId": "gpt-5.6-luna",
        "label": "GPT-5.6 Luna",
        "eligible": True,
        "contextWindow": 200_000,
        "supportsTools": True,
        "inputModalities": ["text"],
        "reasoningEfforts": ["low", "medium", "high"],
        "taskFit": "Authored fast-model task-fit facts.",
    }
    payload = {
        **_destination_payload("hermes"),
        "autoModelCandidates": [candidate],
    }

    invocation = card_invocation_preparation.materialize_invocation(payload)

    assert invocation["idf"]["stableSavedCardContext"]["provider"] == {
        "provider": "openai",
        "accessMode": "chatgpt-account",
        "modelKey": "gpt-5.6-luna",
        "providerModelId": "gpt-5.6-luna",
    }
    assert invocation["autoModelDecision"]["savedModelId"] == (
        "openai:chatgpt-account:gpt-5.6-sol"
    )
    assert invocation["autoModelDecision"]["selectedModelId"] == candidate["id"]
    assert json.dumps(card, sort_keys=True) == before

def test_published_catalog_failure_keeps_the_model_turn_and_surfaces_the_error(monkeypatch):
    loaded = _destination_fixture(monkeypatch)
    card = loaded["deck"]["nodes"][1]
    card["runtimeOptions"]["tools"] = ["canvas.inspect"]
    payload = _destination_payload("hermes")
    payload["discoveredToolFailures"] = {
        "canvas.inspect": "tool_catalog_definition_invalid:canvas.inspect",
    }

    prepared = card_invocation_preparation._prepare_invocation(payload)

    config = prepared["_callConfig"]
    assert config["enabledTools"] == []
    assert config["presentedTools"] == []
    assert config["unavailableTools"] == ["canvas.inspect"]
    assert config["unavailableToolReasons"] == {
        "canvas.inspect": "tool_catalog_definition_invalid:canvas.inspect",
    }
    assert config["toolCatalogFailure"] == "tool_catalog_definition_invalid:canvas.inspect"

def test_saved_card_exposes_only_currently_available_enabled_tools(monkeypatch):
    loaded = _destination_fixture(monkeypatch)
    card = loaded["deck"]["nodes"][1]
    card["runtimeOptions"].update(
        tools=["canvas.inspect", "graphiti.search_nodes"],
    )
    before = json.dumps(card, sort_keys=True)
    payload = _destination_payload("hermes")
    unavailable = _external_tool("graphiti.search_nodes", read_only=True)
    unavailable.update({
        "title": "Search Graphiti nodes",
        "description": "Search the connected Graphiti knowledge graph.",
        "available": False,
    })
    payload["discoveredTools"] = [unavailable]
    payload["unavailableToolCatalogFamilies"] = ["graphiti"]

    prepared = card_invocation_preparation._prepare_invocation(payload)
    config = prepared["_callConfig"]
    assert config["enabledTools"] == ["canvas.inspect"]
    assert config["presentedTools"] == ["canvas.inspect"]
    assert config["unavailableTools"] == ["graphiti.search_nodes"]
    assert json.dumps(card, sort_keys=True) == before

def test_valid_script_compacts_only_its_literal_handle_and_ignores_legacy_enabled(
    monkeypatch,
):
    loaded = _destination_fixture(monkeypatch)
    card = loaded["deck"]["nodes"][1]
    card["runtimeOptions"]["autoTools"] = True
    card["runtimeOptions"]["script"] = {
        "enabled": False,
        "source": '''CARD_SCRIPT = {
    "mode": "tool_recipe",
    "input": {"type": "object", "properties": {}},
    "output": {"type": "object", "properties": {"result": {}}, "required": ["result"]},
}
from hermes_tools import SCRIPT, output, tools
tools.calculator = SCRIPT
tools.call("calculator")
output.emit({"result": {}})
''',
    }
    monkeypatch.setattr(
        card_invocation_preparation,
        "select_auto_tools",
        lambda **kwargs: (
            [],
            {
                "schemaVersion": "auto-tools-decision.v1",
                "status": "selected",
                "candidateCount": len(kwargs["baseline_tool_ids"]),
                "selectedToolIds": [],
                "selectedConfidencePercentages": {},
                "decisionId": "decision-one",
                "errorCode": None,
            },
        ),
    )

    invocation = card_invocation_preparation.materialize_invocation(_destination_payload("hermes"))
    grants = invocation["idf"]["selectedToolsAndGrants"]
    saved = invocation["idf"]["stableSavedCardContext"]["runtimeOptions"]["script"]

    assert grants["enabledTools"] == ["calculator"]
    assert grants["presentedTools"] == []
    assert grants["scriptPresentation"] == {"mode": "script"}
    assert "enabled" not in saved
    assert saved["lastValidation"]["status"] == "valid"
    assert "hermesSupport" not in saved
    assert saved["compiled"]["scriptToolIds"] == ["calculator"]
    assert saved["compiled"]["agentToolIds"] == []
    assert invocation["autoToolsDecision"]["selectedToolIds"] == []

def test_invalid_script_is_inert_and_keeps_exact_saved_tool_schema(monkeypatch):
    loaded = _destination_fixture(monkeypatch)
    card = loaded["deck"]["nodes"][1]
    card["runtimeOptions"]["script"] = {
        "enabled": True,
        "source": "return InvocationPreparation()",
    }

    invocation = card_invocation_preparation.materialize_invocation(_destination_payload("hermes"))
    grants = invocation["idf"]["selectedToolsAndGrants"]
    saved = invocation["idf"]["stableSavedCardContext"]["runtimeOptions"]["script"]

    assert grants["presentedTools"] == ["calculator"]
    assert grants["scriptPresentation"] == {"mode": "selected-mcp"}
    assert saved["lastValidation"]["status"] == "invalid"

def test_main_without_selected_graph_data_keeps_the_idf_graph_context_empty(monkeypatch):
    result = _delegation_invocation(monkeypatch, edges=[])
    assert result["idf"]["actualGraphData"]["modelText"] == ""
    assert result["idf"]["actualGraphData"]["selectedGraphRecords"] == []
    assert result["resolvedGraphReads"] == []
    assert "preparedContextReads" not in result

def test_main_preview_exposes_saved_authority_without_starting_a_run(monkeypatch):
    main = _agent("main", runtime={"kind": "hermes", "mode": "main", "profile": "main"})
    main.update({"_cardRevisionId": "main-revision", "_cardRevision": 1, "_cardRevisionSha256": "main-sha"})
    main["runtimeOptions"]["tools"] = ["canvas.inspect"]
    monkeypatch.setattr(saved_cards, "load_deck", lambda *_: {
        "projectId": "00000000-0000-0000-0000-000000000001", "deck": {"nodes": [main], "edges": []},
    })
    monkeypatch.setattr(
        card_invocation_preparation,
        "materialize_idf",
        lambda **_: pytest.fail("preview created an IDF"),
    )
    monkeypatch.setattr(card_run_preparation, "_insert_run", lambda *_, **__: pytest.fail("preview started a Run"))
    payload = {"projectId": "project-one", "deckId": "deck-one", "conversationId": "conversation-one"}
    assert "preparedContext" not in card_invocation_preparation.prepare_main_chat(payload)
    result = card_invocation_preparation.prepare_main_chat({**payload, "message": "source validity"})
    assert result["message"] == "source validity"
    assert "preparedContext" not in result
    assert result["sessionProfile"]["unavailableTools"] == []
    assert "idf" not in result and "runId" not in result

def test_enabled_flow_edge_does_not_project_a_conversational_target_into_the_run(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    invocation = _delegation_invocation(
        monkeypatch,
        edges=[{"source": "parent", "target": "child", "edgeType": "flow"}],
    )
    assert invocation["cardIdentity"] == {"cardId": "parent", "title": "parent"}
    assert invocation["idf"]["selectedToolsAndGrants"]["enabledTools"] == ["calculator"]
    assert _REMOVED_PROFILE_TARGET_PROJECTION not in invocation
    assert _REMOVED_PROFILE_TARGET_PROJECTION not in invocation["idf"]

def test_hermes_flow_keeps_formal_run_and_conversation_surfaces_separate(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    invocation = _delegation_invocation(
        monkeypatch,
        edges=[{"source": "parent", "target": "child", "edgeType": "flow"}],
        parent_runtime={"kind": "hermes", "mode": "main", "profile": "main"},
    )
    assert invocation["runtimeOwner"] == "hermes"
    assert invocation["cardIdentity"] == {"cardId": "parent", "title": "parent"}
    assert invocation["idf"]["selectedToolsAndGrants"]["enabledTools"] == ["calculator"]
    assert _REMOVED_PROFILE_TARGET_PROJECTION not in invocation
    assert _REMOVED_PROFILE_TARGET_PROJECTION not in invocation["idf"]

def test_no_flow_edge_also_has_no_conversational_transport_projection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    invocation = _delegation_invocation(monkeypatch, edges=[])
    assert invocation["cardIdentity"] == {"cardId": "parent", "title": "parent"}
    assert invocation["idf"]["selectedToolsAndGrants"]["enabledTools"] == ["calculator"]
    assert _REMOVED_PROFILE_TARGET_PROJECTION not in invocation

def test_catalog_does_not_broaden_saved_card_grants(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    card = _agent("catalog-card")
    card["_cardRevisionId"] = "revision-catalog"
    card["_cardRevision"] = 1
    card["_cardRevisionSha256"] = "sha-catalog"
    card["runtimeOptions"] = {
        **card["runtimeOptions"],
        "tools": ["engraphis_remember"],
    }
    monkeypatch.setattr(saved_cards, "load_deck",
        lambda _project, _deck: {
            "projectId": "00000000-0000-0000-0000-000000000001",
            "deck": {"nodes": [card], "edges": []},
        },
    )

    def discovered(name: str, namespace: str, *, read_only: bool) -> dict:
        input_schema = {"type": "object", "properties": {}}
        return {
            "name": name,
            "providerToolName": name.split(".")[-1],
            "kind": "tool",
            "sourceId": f"{namespace}_mcp",
            "namespace": namespace,
            "connectionKind": "external-mcp",
            "publication": "external-mcp",
            "access": "read" if read_only else "write",
            "title": name,
            "description": name,
            "inputSchema": input_schema,
            "canonicalInputSchema": input_schema,
            "serverInjectedArguments": [],
            "dispatcherContextArguments": [],
            "dispatcherOwner": (
                "app.mcp_provider_operations.call_graphiti_operation"
                if namespace == "graphiti"
                else "app.mcp_provider_operations.call_cbm_operation"
            ),
            "authenticatedProjection": True,
            "annotations": {
                "readOnlyHint": read_only,
                "destructiveHint": not read_only,
                "idempotentHint": read_only,
                "openWorldHint": True,
            },
            "grantEligible": True,
        }

    invocation = card_invocation_preparation.materialize_invocation({
        "projectId": "project-one",
        "deckId": "deck-one",
        "runId": "run-catalog",
        "cardId": "catalog-card",
        "assignment": "compose supported graph reads",
        "discoveredTools": [
            discovered("cbm.search_graph", "cbm", read_only=True),
            discovered("graphiti.search_nodes", "graphiti", read_only=True),
            discovered("cbm.index_repository", "cbm", read_only=False),
        ],
    })

    grants = invocation["idf"]["selectedToolsAndGrants"]
    assert grants["enabledTools"] == ["engraphis_remember"]
    assert grants["presentedTools"] == ["engraphis_remember"]
    assert [tool["canonicalId"] for tool in grants["toolDefinitions"]] == [
        "engraphis_remember",
    ]
    assert "cbm.index_repository" not in grants["enabledTools"]

@pytest.mark.parametrize(
    "runtime",
    [
        {"kind": "hermes", "mode": "delegate", "profile": "helper"},
        {"kind": "hermes", "mode": "magentic_one", "profile": "card-one"},
    ],
)
def test_helper_and_mag_one_accept_empty_graph_and_reject_stale_selected_reference(
    monkeypatch: pytest.MonkeyPatch,
    runtime: dict[str, str],
) -> None:
    prepared = _prepared_grounded_runtime(runtime)
    prepared["resolvedGraphReads"] = []
    prepared["resolvedGraphProjection"] = {"nodes": [], "edges": []}
    monkeypatch.setattr(
        card_invocation_preparation,
        "materialize_invocation",
        lambda _payload, **_kwargs: prepared,
    )
    assert card_invocation_preparation.prepare_run_invocation({}) is prepared

    stale = [{
        "cbmQualifiedName": "missing-symbol",
        "reason": "Required production owner", "priority": 0,
        "boundedExpansion": 0, "resultLimit": 4, "required": True,
    }]
    with pytest.raises(
        saved_card_contract.CardDomainError,
        match="selected_graph_data_reference_stale:cbmQualifiedName:missing-symbol",
    ):
        card_invocation_preparation.prepare_run_invocation({"dataAnchors": stale})

@pytest.mark.parametrize(
    "runtime",
    [
        {"kind": "hermes", "mode": "delegate", "profile": "helper"},
        {"kind": "hermes", "mode": "magentic_one", "profile": "card-one"},
    ],
)
def test_selected_helper_and_mag_one_graph_data_is_validated_without_creating_a_run(
    monkeypatch: pytest.MonkeyPatch,
    runtime: dict[str, str],
) -> None:
    prepared = _prepared_grounded_runtime(runtime)
    monkeypatch.setattr(
        card_invocation_preparation,
        "materialize_invocation",
        lambda _payload, **_kwargs: prepared,
    )
    monkeypatch.setattr(card_run_preparation, "_insert_run",
        lambda *_args, **_kwargs: pytest.fail("graph-data validation created a Run"),
    )
    payload = {"dataAnchors": [{
        "cbmQualifiedName": "symbol-one",
        "reason": "Required production owner", "priority": 0,
        "boundedExpansion": 0, "resultLimit": 4, "required": True,
    }]}

    assert card_invocation_preparation.prepare_run_invocation(payload) is prepared

def test_ordinary_hermes_cards_keep_the_existing_unrestricted_preparation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    prepared = _prepared_grounded_runtime({
        "kind": "hermes", "mode": "delegate", "profile": "card-one",
    })
    prepared["resolvedGraphReads"] = []
    prepared["resolvedGraphProjection"] = {"nodes": [], "edges": []}
    monkeypatch.setattr(
        card_invocation_preparation,
        "materialize_invocation",
        lambda _payload, **_kwargs: prepared,
    )

    assert card_invocation_preparation.prepare_run_invocation({}) is prepared

def test_magnetic_taskgraph_card_may_invoke_only_a_saved_blue_worker(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mag_one = _agent(
        "mag-one",
        runtime={"kind": "hermes", "mode": "magentic_one", "profile": "mag-one"},
    )
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
    monkeypatch.setattr(saved_cards, "load_deck", lambda *_args: loaded)
    payload = {
        "projectId": "project-one",
        "deckId": "deck-one",
        "runId": "run-worker",
        "cardId": "worker",
        "senderCardId": "mag-one",
        "assignment": "bounded worker task",
    }
    assert card_invocation_preparation.materialize_invocation(payload)["runtimeOwner"] == "hermes"
    loaded["deck"]["edges"] = []
    with pytest.raises(saved_card_contract.CardDomainError, match="card_invocation_edge_authority_required"):
        card_invocation_preparation.materialize_invocation(payload)

def test_same_hermes_card_direct_and_mag_one_materialize_the_same_saved_identity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    main = _main_bot(
        "main",
        title="Main",
        runtime={"kind": "hermes", "mode": "main", "profile": "main"},
    )
    mag_one = _agent(
        "mag-one",
        runtime={"kind": "hermes", "mode": "magentic_one", "profile": "mag-one"},
    )
    helper = _agent(
        "helper",
        title="Helper",
        prompt="Saved Helper prompt",
        runtime={"kind": "hermes", "mode": "delegate", "profile": "helper"},
    )
    helper["runtimeOptions"] = {
        **helper["runtimeOptions"],
        "provider": "openai",
        "modelKey": "gpt-5.6-luna",
        "providerModelId": "gpt-5.6-luna",
        "accessMode": "chatgpt-account",
        "tools": ["card.create"],
        "skills": ["codex"],
        "toolsets": ["computer_use"],
        "mcpConnectionIds": ["main-runtime"],
    }
    for number, card in enumerate((main, mag_one, helper), start=1):
        card["_cardRevisionId"] = f"revision-{number}"
        card["_cardRevision"] = 1
        card["_cardRevisionSha256"] = f"sha-{number}"
    monkeypatch.setattr(saved_cards, "load_deck", lambda *_args: {
        "projectId": "00000000-0000-0000-0000-000000000001",
        "deck": {
            "nodes": [main, mag_one, helper],
            "edges": [
                {
                    "source": "main",
                    "target": "helper",
                    "edgeType": "flow",
                },
                {
                    "source": "mag-one",
                    "target": "helper",
                    "edgeType": "magentic_option",
                },
            ],
        },
    })

    direct = card_invocation_preparation.materialize_invocation({
        "projectId": "project-one",
        "deckId": "deck-one",
        "runId": "run-direct",
        "cardId": "helper",
        "senderCardId": "main",
        "assignment": "direct mission",
    })
    bus_worker = card_invocation_preparation.materialize_invocation({
        "projectId": "project-one",
        "deckId": "deck-one",
        "runId": "run-team-child",
        "cardId": "helper",
        "senderCardId": "mag-one",
        "assignment": "bus mission",
    })

    assert direct["cardIdentity"] == bus_worker["cardIdentity"]
    assert direct["cardRevisionId"] == bus_worker["cardRevisionId"] == "revision-3"
    assert direct["runtimeOwner"] == bus_worker["runtimeOwner"] == "hermes"
    assert direct["idf"]["stableSavedCardContext"] == bus_worker["idf"]["stableSavedCardContext"]
    assert direct["idf"]["selectedToolsAndGrants"] == bus_worker["idf"]["selectedToolsAndGrants"]
    assert direct["idf"]["dynamicContext"]["task"] == "direct mission"
    assert bus_worker["idf"]["dynamicContext"]["task"] == "bus mission"

def test_one_enabled_saved_magnetic_card_resolves_without_a_control_wire(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    main = _agent(
        "main",
        runtime={"kind": "hermes", "mode": "main", "profile": "main"},
    )
    mag_one = _agent(
        "mag-one",
        runtime={"kind": "hermes", "mode": "magentic_one", "profile": "mag-one"},
    )
    for number, card in enumerate((main, mag_one), start=1):
        card["_cardRevisionId"] = f"revision-{number}"
        card["_cardRevision"] = 1
        card["_cardRevisionSha256"] = f"sha-{number}"
    loaded = {
        "projectId": "00000000-0000-0000-0000-000000000001",
        "deck": {
            "nodes": [main, mag_one],
            "edges": [],
        },
    }
    monkeypatch.setattr(saved_cards, "load_deck", lambda *_args: loaded)
    assert card_invocation_preparation.resolve_magnetic_taskgraph_card(
        "project-one", "deck-one"
    ) == {
        "projectId": "00000000-0000-0000-0000-000000000001",
        "deckId": "deck-one",
        "cardId": "mag-one",
    }
    mag_one["runtimeOptions"]["enabled"] = False
    with pytest.raises(
        saved_card_contract.CardDomainError,
        match="magnetic_taskgraph_card_identity_ambiguous",
    ):
        card_invocation_preparation.resolve_magnetic_taskgraph_card("project-one", "deck-one")
    mag_one["runtimeOptions"].pop("enabled")
    loaded["deck"]["nodes"].append(_agent(
        "other-mag",
        runtime={"kind": "hermes", "mode": "magentic_one", "profile": "other-mag"},
    ))
    with pytest.raises(
        saved_card_contract.CardDomainError,
        match="magnetic_taskgraph_card_identity_ambiguous",
    ):
        card_invocation_preparation.resolve_magnetic_taskgraph_card("project-one", "deck-one")

def test_main_mode_invokes_magnetic_across_orange_bot_authority(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    main = _main_bot(
        "main",
        runtime={"kind": "hermes", "mode": "main", "profile": "main"},
    )
    main["runtimeOptions"]["orchestrator"] = False
    magnetic = _agent(
        "magnetic",
        runtime={"kind": "hermes", "mode": "magentic_one", "profile": "magnetic"},
    )
    for number, card in enumerate((main, magnetic), start=1):
        card["_cardRevisionId"] = f"revision-{number}"
        card["_cardRevision"] = 1
        card["_cardRevisionSha256"] = f"sha-{number}"
    loaded = {
        "projectId": "00000000-0000-0000-0000-000000000001",
        "deck": {"nodes": [main, magnetic], "edges": [{
            "id": "main-magnetic",
            "source": "main",
            "target": "magnetic",
            "edgeType": "flow",
        }]},
    }
    monkeypatch.setattr(saved_cards, "load_deck", lambda *_args: loaded)
    payload = {
        "projectId": "project-one",
        "deckId": "deck-one",
        "runId": "run-magnetic",
        "cardId": "magnetic",
        "senderCardId": "main",
        "assignment": "approved Magnetic mission",
    }
    assert card_invocation_preparation.materialize_invocation(payload)["runtimeOwner"] == "mag_one"
    loaded["deck"]["edges"] = []
    with pytest.raises(saved_card_contract.CardDomainError, match="card_invocation_edge_authority_required"):
        card_invocation_preparation.materialize_invocation(payload)
    loaded["deck"]["edges"] = [{
        "id": "main-magnetic",
        "source": "main",
        "target": "magnetic",
        "edgeType": "flow",
    }]
    main["runtime"] = {"kind": "hermes", "mode": "delegate", "profile": "main"}
    main["runtimeOptions"]["orchestrator"] = True
    assert card_invocation_preparation.materialize_invocation(payload)["runtimeOwner"] == "mag_one"
    main["runtimeOptions"]["orchestrator"] = False
    with pytest.raises(saved_card_contract.CardDomainError, match="card_invocation_edge_authority_required"):
        card_invocation_preparation.materialize_invocation(payload)

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
    assert invocation["idf"]["selectedToolsAndGrants"]["enabledTools"] == ["calculator"]
    assert _REMOVED_PROFILE_TARGET_PROJECTION not in invocation

@pytest.mark.parametrize("model_key", ["gpt-5.6-sol", "catalog-choice"])
def test_saved_parent_selection_reaches_execution_without_changing_card_authority(monkeypatch, model_key):
    loaded = _destination_fixture(monkeypatch)
    card = loaded["deck"]["nodes"][1]
    card["runtimeOptions"].update(
        provider="openai", accessMode="chatgpt-account", modelKey=model_key,
        providerModelId="gpt-5.6-sol",
        subagentModel={"provider": "openai", "accessMode": "chatgpt-account",
                       "modelKey": "gpt-5.6-luna", "providerModelId": "gpt-5.6-luna"},
    )
    before = json.dumps(loaded, sort_keys=True)
    prepared = card_invocation_preparation._prepare_invocation(_destination_payload("hermes"))
    invocation = card_invocation_preparation.materialize_invocation(_destination_payload("hermes"))
    expected = {"provider": "openai", "accessMode": "chatgpt-account",
                "modelKey": model_key, "providerModelId": "gpt-5.6-sol"}
    assert prepared["_callConfig"]["provider"] == expected
    assert invocation["idf"]["stableSavedCardContext"]["provider"] == expected
    assert prepared["_callConfig"]["runtimeOptions"]["subagentModel"] == card["runtimeOptions"]["subagentModel"]
    assert json.dumps(loaded, sort_keys=True) == before

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

    invocation = card_invocation_preparation.materialize_invocation(_destination_payload("hermes"))

    assert invocation["idf"]["stableSavedCardContext"]["runtimeOptions"]["subagentModel"] == selection
    assert invocation["idf"]["stableSavedCardContext"]["provider"]["providerModelId"] != "gpt-5.6-luna"
    assert saved_card_contract.stable_card_record(card)["runtimeExtensions"]["subagentModel"] == selection

@pytest.mark.parametrize("selection", ["none", "leaf", "recursive"])
def test_saved_hermes_subagent_type_survives_canonical_idf_materialization(
    monkeypatch, selection,
):
    loaded = _destination_fixture(monkeypatch)
    card = next(item for item in loaded["deck"]["nodes"] if item["id"] == "hermes")
    card["runtimeOptions"]["subagentType"] = selection

    prepared = card_invocation_preparation._prepare_invocation(_destination_payload("hermes"))
    invocation = card_invocation_preparation.materialize_invocation(_destination_payload("hermes"))

    assert prepared["_callConfig"]["runtimeOptions"]["subagentType"] == selection
    assert invocation["idf"]["stableSavedCardContext"]["runtimeOptions"]["subagentType"] == selection
    assert saved_card_contract.stable_card_record(card)["runtimeExtensions"]["subagentType"] == selection

def test_missing_hermes_subagent_type_stays_absent(monkeypatch):
    _destination_fixture(monkeypatch)

    prepared = card_invocation_preparation._prepare_invocation(_destination_payload("hermes"))

    assert "subagentType" not in prepared["_callConfig"]["runtimeOptions"]

def test_invalid_saved_hermes_subagent_type_is_rejected(monkeypatch):
    loaded = _destination_fixture(monkeypatch)
    card = next(item for item in loaded["deck"]["nodes"] if item["id"] == "hermes")
    card["runtimeOptions"]["subagentType"] = "team"

    with pytest.raises(saved_card_contract.CardDomainError, match="card_subagent_type_invalid"):
        card_invocation_preparation._prepare_invocation(_destination_payload("hermes"))

@pytest.mark.parametrize("runtime", [
    {"kind": "hermes", "mode": mode, "profile": "research"}
    for mode in ("main", "delegate", "magentic_one")
])
def test_ordinary_materialization_never_loads_builder_dictionary(monkeypatch, runtime):
    from app.python_models import idd
    loaded = _destination_fixture(monkeypatch)
    next(card for card in loaded["deck"]["nodes"] if card["id"] == "hermes")["runtime"] = runtime
    monkeypatch.setattr(idd, "load_input_data_dictionary", lambda: (_ for _ in ()).throw(
        AssertionError("ordinary Run must not load builder data")))
    payload = _destination_payload("hermes")
    payload.pop("senderCardId")
    invocation = card_invocation_preparation.materialize_invocation(payload)
    assert invocation["idf"]["selectedToolsAndGrants"]["enabledTools"] == ["calculator"]

def test_project_worldview_filters_saved_tools_before_idf_materialization(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    loaded = _destination_fixture(monkeypatch)
    card = next(item for item in loaded["deck"]["nodes"] if item["id"] == "hermes")
    card["runtimeOptions"]["tools"] = ["calculator", "current_datetime"]

    def project_mask(project_id, candidates, **_kwargs):
        assert project_id == loaded["projectId"]
        assert candidates == ["calculator", "current_datetime"]
        return {
            "schemaVersion": "project-worldview.v1",
            "projectId": project_id,
            "defaultEnabled": True,
            "candidateCapabilities": candidates,
            "enabledCapabilities": ["calculator"],
            "excludedCapabilities": ["current_datetime"],
            "overrides": [{
                "capabilityId": "current_datetime",
                "enabled": False,
                "controlledBy": "user",
                "mainReason": None,
                "updatedAt": "2026-09-27T00:00:00+00:00",
            }],
        }

    monkeypatch.setattr(card_invocation_tools, "resolve_project_worldview", project_mask)

    invocation = card_invocation_preparation.materialize_invocation(_destination_payload("hermes"))

    assert invocation["projectWorldview"]["excludedCapabilities"] == ["current_datetime"]
    assert invocation["idf"]["selectedToolsAndGrants"]["enabledTools"] == ["calculator"]

def test_receiving_card_materializes_its_own_exact_call_data(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    loaded = _destination_fixture(monkeypatch)
    hermes = card_invocation_preparation.materialize_invocation(_destination_payload("hermes"))

    assert hermes["idf"]["stableSavedCardContext"]["instructions"] == "Hermes saved prompt"
    assert hermes["idf"]["stableSavedCardContext"]["runtime"] == {
        "kind": "hermes", "mode": "delegate", "profile": "research",
    }
    assert hermes["idf"]["selectedToolsAndGrants"]["enabledTools"] == ["calculator"]
    assert hermes["idf"]["dynamicContext"]["task"] == "Use every supplied declaration."
    assert hermes["idf"]["actualGraphData"]["recordCounts"]["total"] == 0
    assert hermes["idf"]["actualGraphData"]["selectedGraphRecords"] == []
    assert "runId" not in hermes["idf"]["stableSavedCardContext"]
    assert "flow-hermes" not in str(hermes["idf"])

    loaded["deck"]["edges"] = [
        edge for edge in loaded["deck"]["edges"] if edge["target"] != "hermes"
    ]
    with pytest.raises(
        saved_card_contract.CardDomainError,
        match="card_invocation_edge_authority_required",
    ):
        card_invocation_preparation.materialize_invocation(_destination_payload("hermes"))

def test_idf_materialization_requires_an_actual_run_identity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _destination_fixture(monkeypatch)
    payload = _destination_payload("hermes")
    payload.pop("runId")

    with pytest.raises(saved_card_contract.CardDomainError, match="run_id_required"):
        card_invocation_preparation.materialize_invocation(payload)

@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("contextMarkdown", "copied parent context"),
        ("keyContext", "arbitrary caller summary"),
        ("visibleMessages", [{"role": "user", "content": "old chat"}]),
        ("priorResults", [{"recordId": "copied-result"}]),
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
        saved_card_contract.CardDomainError,
        match=f"invocation_context_field_forbidden:{field}",
    ):
        card_invocation_preparation.materialize_invocation(payload)

def test_saved_knowgraph_idf_receives_complete_cross_graph_subject_directory(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.python_models.canonical_subject_directory import (
        assemble_canonical_subject_directory,
    )

    loaded = _destination_fixture(monkeypatch)
    target = loaded["deck"]["nodes"][1]
    target["id"] = "card_knowgraph"
    target["runtime"]["profile"] = "knowgraph"
    loaded["deck"]["edges"][0]["target"] = "card_knowgraph"
    subjects = assemble_canonical_subject_directory(
        loaded["projectId"],
        {"complete": True, "count": 1, "revision": "think-r1", "subjects": [{
            "engraphisEntityId": "think-rocket",
            "canonicalName": "Rocket Lab", "entityKind": "person_or_concept",
        }]},
        {"complete": True, "count": 1, "revision": "know-r1", "subjects": [{
            "graphitiEntityId": "know-rocket",
            "canonicalName": "Rocket Lab", "entityKind": "Entity",
        }]},
    )
    monkeypatch.setattr(card_invocation_preparation, "build_canonical_subject_directory", lambda _project: subjects,
    )
    invocation = card_invocation_preparation.materialize_invocation(
        _destination_payload("card_knowgraph")
    )

    assert invocation["canonicalSubjectDirectory"] == subjects
    graph_text = invocation["idf"]["actualGraphData"]["modelText"]
    assert "Complete Cross-Graph Subject Directory" in graph_text
    assert graph_text.count("Rocket Lab") == 2
    assert invocation["inputSummary"]["estimatedGraphContextTokens"] > 0

def test_context_cascade_rejects_duplicate_and_recursive_handoffs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _destination_fixture(monkeypatch)
    payload = {
        **_destination_payload("hermes"),
        "dataAnchors": [
            {
                "engraphisEntityId": "same:one",
                "reason": "sender selected the object",
                "priority": 1,
                "boundedExpansion": 0,
                "required": True,
            },
            {
                "engraphisEntityId": "same:one",
                "reason": "sender selected the same object twice",
                "priority": 0,
                "boundedExpansion": 0,
                "required": True,
            },
        ],
    }
    with pytest.raises(saved_card_contract.CardDomainError, match="data_anchor_duplicate"):
        card_invocation_preparation.materialize_invocation(payload)

    payload["dataAnchors"] = []
    payload["senderCardId"] = "hermes"
    with pytest.raises(
        saved_card_contract.CardDomainError,
        match="card_invocation_self_handoff_forbidden",
    ):
        card_invocation_preparation.materialize_invocation(payload)

def test_explicit_card_mission_is_transient_and_retaskable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    loaded = _destination_fixture(monkeypatch)
    target = next(card for card in loaded["deck"]["nodes"] if card["id"] == "hermes")
    target["runtime"] = {"kind": "hermes", "mode": "delegate", "profile": "knowledge"}
    target["runtimeOptions"]["tools"] = ["graphiti.add_memory"]

    first = card_invocation_preparation.materialize_invocation({
        **_destination_payload("hermes"),
        "runId": "run-first",
        "assignment": "Research the first bounded question.",
        "discoveredTools": [_external_tool("graphiti.add_memory", read_only=False)],
    })
    second = card_invocation_preparation.materialize_invocation({
        **_destination_payload("hermes"),
        "runId": "run-second",
        "assignment": "Retask the same saved Graph Agent Card with a second question.",
        "discoveredTools": [_external_tool("graphiti.add_memory", read_only=False)],
    })

    assert first["cardIdentity"]["cardId"] == second["cardIdentity"]["cardId"] == "hermes"
    assert second["idf"]["stableSavedCardContext"]["runtime"]["profile"] == "knowledge"
    assert "Retask the same saved Graph Agent Card" in second["idf"]["dynamicContext"]["task"]
    assert "Research the first bounded question" not in second["idf"]["dynamicContext"]["task"]
    assert _REMOVED_PROFILE_TARGET_PROJECTION not in second

def test_only_main_mode_can_retask_one_connected_graph_card(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    main = _main_bot("main", runtime={"kind": "hermes", "mode": "main", "profile": "main"})
    helper = _agent("helper", runtime={"kind": "hermes", "mode": "delegate", "profile": "helper"})
    graph_agent = _agent("graph-agent", runtime={"kind": "hermes", "mode": "delegate", "profile": "knowledge"})
    graph_agent["runtimeOptions"]["tools"] = ["graphiti.add_memory"]
    for index, card in enumerate((main, helper, graph_agent), start=1):
        card["_cardRevisionId"] = f"revision-{index}"
        card["_cardRevision"] = 1
        card["_cardRevisionSha256"] = f"sha-{index}"
    loaded = {
        "projectId": "project-one",
        "deck": {
            "nodes": [main, helper, graph_agent],
            "edges": [
                {"source": "main", "target": "graph-agent", "edgeType": "flow"},
            ],
        },
    }
    monkeypatch.setattr(saved_cards, "load_deck", lambda *_args: loaded)

    def invoke(sender: str, task: str) -> dict:
        return card_invocation_preparation.materialize_invocation({
            "projectId": "project-one", "deckId": "deck_builder",
            "runId": f"run-{sender}-{len(task)}",
            "cardId": "graph-agent", "senderCardId": sender,
            "assignment": task,
            "discoveredTools": [_external_tool("graphiti.add_memory", read_only=False)],
        })

    assert invoke("main", "Research the current question.")["cardIdentity"]["cardId"] == "graph-agent"
    with pytest.raises(saved_card_contract.CardDomainError, match="card_invocation_edge_authority_required"):
        invoke("helper", "An ordinary Card cannot orchestrate another Card.")

def test_builder_input_is_independent_of_changed_or_missing_plan(monkeypatch):
    from pathlib import Path

    builder = _agent(
        "builder", prompt="Use saved construction instructions.",
        runtime={"kind": "hermes", "mode": "delegate", "profile": "builder"},
        runtimeOptions={**_agent("x")["runtimeOptions"], "tools": ["canvas.inspect"],
                        "skills": ["agent-builder-inspection"]},
    )
    builder.update(_cardRevisionId="revision-one", _cardRevision=1, _cardRevisionSha256="a" * 64)
    monkeypatch.setattr(saved_cards, "load_deck", lambda *_args: {
        "projectId": "project-one", "meta": {"deckRevision": "deck-revision-one"},
        "deck": {"nodes": [builder], "edges": [], "projectCodeFolder": "worker-agent-ui"},
    })
    original_read = Path.read_bytes
    plan_reads = []
    plan_content = b"## Agent Builder product vision\nBuilder migration and graph test plan."

    def read_bytes(path):
        if path.name == "PLAN.md":
            plan_reads.append(str(path))
            if plan_content is None:
                raise FileNotFoundError(path)
            return plan_content
        return original_read(path)

    monkeypatch.setattr(Path, "read_bytes", read_bytes)
    payload = {
        "projectId": "project-one", "deckId": "deck_builder", "cardId": "builder",
        "assignment": "Inspect the current Card configuration.",
    }

    def materialized():
        prepared = card_invocation_preparation._prepare_invocation(payload)
        config = prepared["_callConfig"]
        return card_invocation_preparation.materialize_idf(
            stable={"instructions": config["systemPrompt"], "runtime": config["runtime"],
                    "provider": config["provider"]},
            variable={"task": prepared["assignment"]},
            capabilities=config, graph_context="", graph_records=[], graph_projection={},
            materialized_at="2026-09-10T00:00:00Z",
        )

    first = materialized()
    plan_content = b"stale rewritten PLAN containing obsolete runtime and roadmap instructions"
    assert materialized().idf_bytes == first.idf_bytes
    plan_content = None
    assert materialized().idf_bytes == first.idf_bytes
    assert plan_reads == []
    assert first.idf.stableSavedCardContext.instructions == builder["prompt"]
    assert first.idf.selectedToolsAndGrants.skills == ["agent-builder-inspection"]
    assert first.idf.selectedToolsAndGrants.enabledTools == ["canvas.inspect"]
    assert first.idf.selectedToolsAndGrants.unavailableTools == []
    assert first.idf.dynamicContext.task == payload["assignment"]
    assert b"PLAN.md" not in first.idf_bytes

@pytest.mark.parametrize("field", ["builderOperation", "agentBuilderOperation", "agentBuilderGuidance", "buildTarget", "selectedCardTarget"])
def test_invocation_rejects_retired_operation_fields(field):
    with pytest.raises(saved_card_contract.CardDomainError, match="invocation_context_field_forbidden"):
        card_invocation_preparation._reject_non_graph_invocation_context({field: {"mode": "create"}})
