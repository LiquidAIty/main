from __future__ import annotations

import pytest

from app.python_models import card_domain
from app.python_models.idd import validate_idf_islands
from app.python_models.idf import render_content_markdown


def _agent(card_id: str, **overrides):
    card = {
        "id": card_id,
        "kind": "agent",
        "templateId": "template_assist",
        "title": card_id,
        "prompt": "common prompt",
        "runtimeType": "assistant_agent",
        "runtimeBinding": "research_agent",
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


def test_direct_subagents_keep_only_enabled_top_level_assistant_flow_targets() -> None:
    cards = {
        "parent": _agent("parent"),
        "enabled": _agent("enabled", runtimeBinding="local_coder"),
        "disabled-option": _agent(
            "disabled-option",
            runtimeOptions={**_agent("x")["runtimeOptions"], "enabled": False},
        ),
        "nested": _agent("nested", parentGraphId="nested-graph"),
        "orchestrator": _agent("orchestrator", runtimeType="magentic_one"),
    }
    edges = [
        {"source": "parent", "target": "enabled", "edgeType": "flow"},
        {"source": "parent", "target": "disabled-option", "edgeType": "flow"},
        {"source": "parent", "target": "nested", "edgeType": "flow"},
        {"source": "parent", "target": "orchestrator", "edgeType": "flow"},
        {"source": "enabled", "target": "parent", "edgeType": "flow"},
    ]
    assert card_domain._direct_subagents("parent", cards, edges) == [{
        "cardId": "enabled",
        "title": "enabled",
        "runtimeBinding": "local_coder",
    }]


def _delegation_preview(
    monkeypatch: pytest.MonkeyPatch,
    *,
    edges: list[dict[str, object]],
    target: dict | None = None,
) -> dict:
    parent = _agent("parent")
    parent["runtimeOptions"] = {
        **parent["runtimeOptions"],
        "tools": ["calculator"],
    }
    child = target or _agent("child", runtimeBinding="local_coder")
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
        "cardId": "parent",
        "assignment": "delegate only across the saved FLOW relationship",
    })


def test_enabled_flow_edge_materializes_bounded_delegation_tool_and_target(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    preview = _delegation_preview(
        monkeypatch,
        edges=[{"source": "parent", "target": "child", "edgeType": "flow"}],
    )
    assert preview["cardContext"]["tools"] == ["calculator", "card.run_assistant_agent"]
    assert preview["providerProjection"]["enabledTools"] == [
        "calculator",
        "card.run_assistant_agent",
    ]
    assert preview["cardContext"]["directSubagents"] == [{
        "cardId": "child",
        "title": "child",
        "runtimeBinding": "local_coder",
    }]


def test_no_flow_edge_materializes_no_delegation_transport(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    preview = _delegation_preview(monkeypatch, edges=[])
    assert preview["cardContext"]["tools"] == ["calculator"]
    assert preview["providerProjection"]["enabledTools"] == ["calculator"]
    assert preview["cardContext"]["directSubagents"] == []


def test_disabled_flow_edge_materializes_no_delegation_transport(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    preview = _delegation_preview(
        monkeypatch,
        edges=[{
            "source": "parent",
            "target": "child",
            "edgeType": "flow",
            "enabled": False,
        }],
    )
    assert "card.run_assistant_agent" not in preview["cardContext"]["tools"]
    assert "card.run_assistant_agent" not in preview["providerProjection"]["enabledTools"]
    assert preview["cardContext"]["directSubagents"] == []


def test_disabled_missing_or_invalid_flow_target_is_not_eligible(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    edge = [{"source": "parent", "target": "child", "edgeType": "flow"}]
    disabled = _agent("child", runtimeBinding="local_coder")
    disabled["runtimeOptions"] = {**disabled["runtimeOptions"], "enabled": False}
    assert _delegation_preview(
        monkeypatch,
        edges=edge,
        target=disabled,
    )["cardContext"]["directSubagents"] == []

    invalid = _agent("child", runtimeType="magentic_one")
    assert _delegation_preview(
        monkeypatch,
        edges=edge,
        target=invalid,
    )["cardContext"]["directSubagents"] == []

    missing = _delegation_preview(
        monkeypatch,
        edges=[{"source": "parent", "target": "missing", "edgeType": "flow"}],
    )
    assert missing["cardContext"]["directSubagents"] == []
    assert "card.run_assistant_agent" not in missing["cardContext"]["tools"]


def test_stable_card_keeps_common_hermes_and_autogen_prompts_separate() -> None:
    card = _agent("dual")
    card["runtimeOptions"] = {
        **card["runtimeOptions"],
        "profile": "dual-profile",
        "hermesFacet": {"instructions": "Hermes instructions"},
        "autogenFacet": {
            "assistantName": "DualAgent",
            "systemMessage": "AutoGen instructions",
        },
    }
    stable = card_domain._stable_card(card)
    assert stable["basePrompt"] == "common prompt"
    assert stable["hermesFacet"]["instructions"] == "Hermes instructions"
    assert stable["autogenFacet"]["systemMessage"] == "AutoGen instructions"


def test_coder_transport_preserves_exact_idf_and_python_owned_permission() -> None:
    prepared = {
        "projectId": "project-one",
        "exactIdf": "# LiquidAIty IDF\n\nExact Coder job.",
        "cardContext": {
            "cardId": "card_coder",
            "title": "Coder",
            "prompt": "Return a CoderReport.",
            "provider": "openai",
            "modelKey": "gpt-5.6-luna",
            "providerModelId": "gpt-5.6-luna",
            "accessMode": "coder-oauth",
            "tools": ["cbm.search_graph", "run_local_coder"],
            "nativeTools": [],
            "skills": [],
            "toolsets": [],
            "mcpConnectionIds": [],
            "runtimeOptions": {"writeMode": "edit", "reasoningEffort": "high"},
        },
    }
    transport = card_domain._coder_transport(
        prepared,
        {"assignment": "Exact Coder job."},
    )
    packet = transport["coderPacket"]
    assert transport["exactIdf"] == prepared["exactIdf"]
    assert packet["exactIdf"] == prepared["exactIdf"]
    assert packet["writeMode"] == "edit"
    assert packet["mcpTools"] == ["cbm.search_graph"]
    assert "repoPath" not in packet
    assert "id" not in packet


def _destination_fixture(monkeypatch: pytest.MonkeyPatch) -> dict:
    sender = _agent("sender")
    hermes = _agent("hermes", prompt="Hermes saved prompt", runtimeBinding="research_agent")
    hermes["runtimeOptions"] = {
        **hermes["runtimeOptions"],
        "profile": "research",
        "profileSnapshot": {
            "name": "research",
            "model": "deepseek/deepseek-v4-flash-0731",
            "gateway": "openrouter",
        },
        "profileConflictResolution": "card",
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
        "cardId": card_id,
        "senderCardId": "sender",
        "assignment": "Use every declaration in this IDF.",
        "contextMarkdown": (
            "[MCP]\nname=calculator\n[/MCP]\n\n"
            "[JSON]\n"
            '{"type":"task-data","value":{"recipientCardId":"not-authority","runtime":"not-authority"}}'
            "\n[/JSON]"
        ),
        "nativeReferences": [{
            "authority": "KnowGraph",
            "nativeId": "episode:one",
            "reason": "selected evidence",
            "asOf": "2026-08-17T00:00:00Z",
            "required": True,
        }],
        "outputRequirements": "Return the declared result.",
    }


def test_same_exact_idf_is_destination_independent_for_different_authorized_cards(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _destination_fixture(monkeypatch)
    hermes_preview = card_domain.materialize_invocation(_destination_payload("hermes"))
    assert hermes_preview["cardContext"]["cardId"] == "hermes"
    assert hermes_preview["providerProjection"]["systemPrompt"] == "Hermes saved prompt"
    assert hermes_preview["providerProjection"]["enabledTools"] == ["calculator"]
    exact = "\n" + hermes_preview["exactIdf"] + "\n "
    assert "[MCP]\nname=calculator\n[/MCP]" in exact
    assert '"recipientCardId":"not-authority"' in exact
    assert '"type": "serialized-card"' in exact
    assert '"cardId": "hermes"' in exact
    assert "flow-hermes" not in exact
    assert "flow-autogen" not in exact

    hermes_validated = card_domain.validate_exact_invocation({
        **_destination_payload("hermes"),
        "cardRevisionId": "revision-2",
        "exactIdf": exact,
    })
    autogen_validated = card_domain.validate_exact_invocation({
        **_destination_payload("autogen"),
        "cardRevisionId": "revision-3",
        "exactIdf": exact,
    })
    assert hermes_validated["exactIdf"] == exact
    assert autogen_validated["exactIdf"] == exact
    assert autogen_validated["providerProjection"]["message"] == exact
    assert autogen_validated["cardContext"]["cardId"] == "autogen"
    assert autogen_validated["runtimeOwner"] == "autogen"


def test_idf_text_cannot_choose_recipient_runtime_or_create_a_flow_edge(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    loaded = _destination_fixture(monkeypatch)
    exact = card_domain.materialize_invocation(_destination_payload("hermes"))["exactIdf"]
    loaded["deck"]["edges"] = [
        edge for edge in loaded["deck"]["edges"] if edge["target"] != "autogen"
    ]
    with pytest.raises(card_domain.CardDomainError, match="card_invocation_edge_authority_required"):
        card_domain.validate_exact_invocation({
            **_destination_payload("autogen"),
            "cardRevisionId": "revision-3",
            "exactIdf": exact,
        })
    assert all(edge["target"] != "autogen" for edge in loaded["deck"]["edges"])

    validated = card_domain.validate_exact_invocation({
        **_destination_payload("hermes"),
        "cardRevisionId": "revision-2",
        "exactIdf": exact,
    })
    assert validated["cardContext"]["cardId"] == "hermes"
    assert validated["runtimeOwner"] == "hermes"


def test_idf_tool_text_does_not_expand_external_runtime_grants(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _destination_fixture(monkeypatch)
    exact = card_domain.materialize_invocation(_destination_payload("hermes"))["exactIdf"]
    validated = card_domain.validate_exact_invocation({
        **_destination_payload("hermes"),
        "cardRevisionId": "revision-2",
        "exactIdf": exact.replace("name=calculator", "name=current_datetime"),
    })
    assert "name=current_datetime" in validated["exactIdf"]
    assert validated["providerProjection"]["enabledTools"] == ["calculator"]


def test_native_reference_uses_the_idd_shape_provenance_and_hard_bounds() -> None:
    reference = {
        "authority": "KnowGraph",
        "nativeId": "episode:one",
        "reason": "selected evidence for this invocation",
        "asOf": "2026-08-16T12:00:00Z",
        "required": True,
    }
    assert card_domain._normalized_native_references([reference]) == [reference]
    with pytest.raises(card_domain.CardDomainError, match="idd_record_field_required:native-reference.reason"):
        card_domain._normalized_native_references([{
            "authority": "KnowGraph",
            "nativeId": "episode:one",
            "asOf": "2026-08-16T12:00:00Z",
            "required": True,
        }])
    with pytest.raises(card_domain.CardDomainError, match="native_reference_limit_exceeded"):
        card_domain._normalized_native_references(
            [{**reference, "nativeId": f"episode:{index}"} for index in range(33)]
        )
    with pytest.raises(card_domain.CardDomainError, match="native_reference_text_limit_exceeded"):
        card_domain._normalized_native_references([{**reference, "reason": "x" * 66_000}])


def test_main_materialization_contains_the_saved_card_without_routing_data(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    main = _agent("main", runtimeBinding="main_chat")
    main["runtimeOptions"] = {
        **main["runtimeOptions"],
        "profile": "default",
        "profileSnapshot": {
            "name": "default",
            "model": "deepseek/deepseek-v4-flash-0731",
            "gateway": "openrouter",
        },
        "profileConflictResolution": "card",
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
    preview = card_domain.materialize_main_invocation({
        "projectId": "project-one",
        "deckId": "deck-one",
        "assignment": "Reason over the supplied IDF.",
    })
    assert "main-revision" not in preview["exactIdf"]
    assert '"cardId": "main"' in preview["exactIdf"]
    assert "canvas.inspect" in preview["exactIdf"]
    assert "directSubagents" not in preview["exactIdf"]
    assert preview["providerProjection"]["enabledTools"] == ["canvas.inspect"]


def test_saved_idf_inspection_reads_exact_non_directional_body_without_routing() -> None:
    card_context = {
        "cardId": "portable",
        "title": "Portable",
        "prompt": "Portable instructions.",
        "runtimeType": "assistant_agent",
        "runtimeBinding": "research_agent",
        "accessMode": "openrouter-api",
        "provider": "openrouter",
        "providerModelId": "model-one",
        "tools": ["calculator"],
    }
    exact = render_content_markdown(
        system_text="Portable instructions.",
        user_text="repeatable assignment",
        card_context=card_context,
        dynamic_context_markdown="[KNOWN_CONTEXT]\nselected fact\n[/KNOWN_CONTEXT]",
        native_references=[],
    )
    inspection = card_domain._inspect_saved_idf(exact)
    assert inspection["assignment"] == "repeatable assignment"
    assert inspection["instructionText"] == "Portable instructions."
    assert inspection["cardContext"] == card_context
    assert inspection["runtimeOwner"] == "autogen"
    assert inspection["providerProjection"]["message"] == exact


def test_age_runtime_telemetry_preserves_run_card_and_artifact_lineage(
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
        "cardContext": {"cardId": "card-one", "tools": ["calculator"]},
        "idfInspection": {
            "nativeReferences": [{
                "authority": "KnowGraph",
                "nativeId": "episode:exact",
                "reason": "present in the edited exact IDF",
                "asOf": "2026-08-17T00:00:00Z",
                "required": True,
            }],
        },
    }
    assert card_domain._observe_run_start(
        prepared,
        {
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
    assert any("USED_TOOL" in query for query, _params in statements)
    native_use = [
        (query, params) for query, params in statements
        if "[edge:USED]" in query
    ]
    assert len(native_use) == 1
    assert native_use[0][1]["nativeId"] == "episode:exact"
    assert all(params.get("nativeId") != "episode:stale-request" for _query, params in statements)

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
