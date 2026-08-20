from __future__ import annotations

import json

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
        "runtime": {"kind": "hermes", "mode": "delegate", "profile": "coder"},
        "prompt": "common prompt",
        "provider": "openrouter",
        "modelKey": "deepseek/deepseek-v4-flash-0731",
        "providerModelId": "deepseek/deepseek-v4-flash-0731",
        "accessMode": "openrouter-api",
        "tools": [],
        "nativeTools": [],
        "skills": [],
        "toolsets": [],
        "mcpConnectionIds": [],
    }


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


def test_direct_subagents_keep_only_enabled_top_level_flow_targets() -> None:
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
        "nested": _agent("nested", parentGraphId="nested-graph"),
        "orchestrator": _agent(
            "orchestrator", runtime={"kind": "autogen", "mode": "magentic_one"}
        ),
        "kanban": _agent(
            "kanban",
            runtime={"kind": "hermes", "mode": "kanban", "profile": "steward"},
        ),
    }
    edges = [
        {"source": "parent", "target": "enabled", "edgeType": "flow"},
        {"source": "parent", "target": "disabled-option", "edgeType": "flow"},
        {"source": "parent", "target": "nested", "edgeType": "flow"},
        {"source": "parent", "target": "orchestrator", "edgeType": "flow"},
        {"source": "parent", "target": "kanban", "edgeType": "flow"},
        {"source": "enabled", "target": "parent", "edgeType": "flow"},
    ]
    assert card_domain._direct_subagents("parent", cards, edges) == [
        _expected_delegate("enabled"),
        {
            **_expected_delegate("kanban"),
            "runtime": {"kind": "hermes", "mode": "kanban", "profile": "steward"},
        },
    ]


def _delegation_preview(
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
        "cardId": "parent",
        "assignment": "delegate only across the saved FLOW relationship",
    })


def test_enabled_flow_edge_materializes_bounded_target_without_inventing_tool_grant(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    preview = _delegation_preview(
        monkeypatch,
        edges=[{"source": "parent", "target": "child", "edgeType": "flow"}],
    )
    assert preview["cardContext"]["tools"] == ["calculator"]
    assert preview["providerProjection"]["enabledTools"] == ["calculator"]
    assert preview["delegationTargets"] == [{
        **_expected_delegate(),
        "nativeTools": ["terminal"],
        "skills": ["repository-coder"],
        "toolsets": ["terminal"],
    }]
    assert "delegationTargets" not in preview["exactIdf"]


def test_hermes_flow_target_projects_saved_profile_outside_exact_idf(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    preview = _delegation_preview(
        monkeypatch,
        edges=[{"source": "parent", "target": "child", "edgeType": "flow"}],
        parent_runtime={"kind": "hermes", "mode": "main", "profile": "main"},
    )
    assert preview["runtimeOwner"] == "hermes"
    assert preview["cardContext"]["tools"] == ["calculator"]
    assert "card.run_assistant_agent" not in preview["providerProjection"]["enabledTools"]
    assert preview["delegationTargets"] == [{
        **_expected_delegate(),
        "nativeTools": ["terminal"],
        "skills": ["repository-coder"],
        "toolsets": ["terminal"],
    }]
    assert "delegationTargets" not in preview["exactIdf"]


def test_no_flow_edge_materializes_no_delegation_transport(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    preview = _delegation_preview(monkeypatch, edges=[])
    assert preview["cardContext"]["tools"] == ["calculator"]
    assert preview["providerProjection"]["enabledTools"] == ["calculator"]
    assert preview["delegationTargets"] == []


def test_magentic_card_may_invoke_only_a_saved_magentic_option_worker(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mag_one = _agent("mag-one", runtime={"kind": "autogen", "mode": "magentic_one"})
    worker = _agent("worker", runtime={"kind": "autogen", "mode": "assistant"})
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
        "cardId": "worker",
        "senderCardId": "mag-one",
        "assignment": "bounded worker task",
    }
    assert card_domain.materialize_invocation(payload)["runtimeOwner"] == "autogen"
    loaded["deck"]["edges"] = []
    with pytest.raises(card_domain.CardDomainError, match="card_invocation_edge_authority_required"):
        card_domain.materialize_invocation(payload)


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
    payload = {
        "projectId": "project-one",
        "deckId": "deck-one",
        "senderCardId": "main",
        "assignment": "bounded team task",
    }
    assert card_domain.materialize_magentic_invocation(payload)["runtimeOwner"] == "mag_one"
    loaded["deck"]["edges"] = []
    with pytest.raises(card_domain.CardDomainError, match="magentic_control_target_ambiguous"):
        card_domain.materialize_magentic_invocation(payload)


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
    assert preview["delegationTargets"] == []


def test_disabled_missing_or_invalid_flow_target_is_not_eligible(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    edge = [{"source": "parent", "target": "child", "edgeType": "flow"}]
    disabled = _agent(
        "child", runtime={"kind": "hermes", "mode": "delegate", "profile": "coder"}
    )
    disabled["runtimeOptions"] = {**disabled["runtimeOptions"], "enabled": False}
    assert _delegation_preview(
        monkeypatch,
        edges=edge,
        target=disabled,
    )["delegationTargets"] == []

    invalid = _agent("child", runtime={"kind": "autogen", "mode": "magentic_one"})
    assert _delegation_preview(
        monkeypatch,
        edges=edge,
        target=invalid,
    )["delegationTargets"] == []

    missing = _delegation_preview(
        monkeypatch,
        edges=[{"source": "parent", "target": "missing", "edgeType": "flow"}],
    )
    assert missing["delegationTargets"] == []
    assert "card.run_assistant_agent" not in missing["cardContext"]["tools"]


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


def test_only_autogen_assistant_cards_are_magentic_workers() -> None:
    for mode in ("main", "delegate", "kanban"):
        assert card_domain._is_magentic_worker_card(_agent(
            mode, runtime={"kind": "hermes", "mode": mode, "profile": mode}
        )) is False
    assert card_domain._is_magentic_worker_card(_agent(
        "mag-one", runtime={"kind": "autogen", "mode": "magentic_one"}
    )) is False
    assert card_domain._is_magentic_worker_card(_agent(
        "worker", runtime={"kind": "autogen", "mode": "assistant"}
    )) is True


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
    assert '"tools": [\n      "calculator"' in exact
    assert '"toolDefinitions"' not in exact
    assert hermes_preview["providerProjection"]["toolDefinitions"]
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


def test_main_chat_preparation_never_materializes_or_consumes_an_idf(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import engraphis.backends.embedder_st as embedder_st
    import engraphis.core.engine as engraphis_engine
    import engraphis.mcp_server as engraphis_mcp

    monkeypatch.setattr(
        embedder_st,
        "_construct_local_sentence_transformer",
        lambda *args, **kwargs: pytest.fail("Main preparation initialized Engraphis"),
    )
    monkeypatch.setattr(
        engraphis_engine,
        "get_embedder",
        lambda *args, **kwargs: pytest.fail("Main preparation constructed embedder"),
    )
    monkeypatch.setattr(
        engraphis_mcp.MemoryService,
        "create",
        lambda *args, **kwargs: pytest.fail("Main preparation opened Engraphis"),
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
    prepared = card_domain.prepare_main_chat({
        "projectId": "project-one",
        "deckId": "deck-one",
        "message": "Help me author an IDF for another agent.",
    })
    assert "exactIdf" not in prepared
    assert "assignment" not in prepared
    assert prepared["message"] == "Help me author an IDF for another agent."
    assert "serialized-card" not in json.dumps(prepared)
    assert "# LiquidAIty IDF" not in json.dumps(prepared)
    assert prepared["providerProjection"] == {
        "systemPrompt": main["prompt"],
        "enabledTools": ["canvas.inspect"],
        "message": "Help me author an IDF for another agent.",
    }
    assert "toolDefinitions" not in prepared["cardContext"]
    inserted: dict[str, object] = {}
    monkeypatch.setattr(
        card_domain,
        "_insert_prompt_free_run",
        lambda value, **kwargs: inserted.update({"prepared": value, **kwargs}),
    )
    monkeypatch.setattr(card_domain, "_observe_run_start", lambda *args, **kwargs: True)
    begun = card_domain.begin_main_chat_run({
        "projectId": "project-one",
        "deckId": "deck-one",
        "message": "Help me author an IDF for another agent.",
        "cardRevisionId": "main-revision",
        "runId": "run-main-one",
        "correlationId": "run-main-one",
        "conversationId": "conversation-one",
    })
    assert "exactIdf" not in begun
    assert begun["savedIdf"] is None
    assert begun["hermesTransport"]["message"] == "Help me author an IDF for another agent."
    assert begun["hermesTransport"]["systemPrompt"] == main["prompt"]
    assert inserted["saved_idf_id"] is None
    assert inserted["saved_idf_revision"] is None


def test_saved_idf_inspection_reads_exact_non_directional_body_without_routing() -> None:
    card_context = {
        "cardId": "portable",
        "title": "Portable",
        "prompt": "Portable instructions.",
        "runtime": {"kind": "autogen", "mode": "assistant"},
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
        "saved_idf_id": "idf-one",
        "saved_idf_revision": 3,
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
    assert insert[11:13] == ("idf-one", 3)
    assert result["cardId"] == "card_main_chat"
    assert result["parentRunId"] == "main-run"
    assert result["nativeChildId"] == "sa-ephemeral"
    assert observed[0][0]["cardContext"]["cardId"] == "card_main_chat"
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

    assert sql == ["SET TRANSACTION READ ONLY"]
    assert result["authority"] == "postgresql-age-agentgraph"
    assert result["projectId"] == "project-one"
    assert result["scope"] == {
        "readScope": "project-deck",
        "projectWideRequested": False,
        "conversationId": "conversation-one",
        "conversationFilterAvailable": False,
    }
    assert result["cards"][0]["cardId"] == "card-one"
    assert result["relationships"][0]["edgeType"] == "flow"
    assert result["runs"] == [{
        "runId": "run-one",
        "correlationId": "correlation-one",
        "state": "completed",
        "cardId": "card-one",
        "assignedFromCardIds": ["card-main"],
        "parentRunIds": [],
        "childRunIds": [],
        "usedTools": ["cbm.search_graph"],
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
            "resultHash": "a" * 64,
            "truncated": False,
        }],
        "nativeReferences": [{"authority": "KnowGraph", "nativeId": "episode:one"}],
        "viewedNativeReferences": [],
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
        "runId": "run-one",
        "cardId": "card-one",
        "authority": "codegraph",
        "operation": "read",
        "toolName": "cbm.search_graph",
        "nativeNodeIds": ["pkg._runtime_owner"],
        "nativeEdgeIds": ["edge-one"],
        "resultHash": "a" * 64,
        "truncated": False,
    }

    assert card_domain.observe_native_attention(event) is True
    assert len(statements) == 2
    assert "USED_TOOL" in statements[0][0]
    assert "EXECUTED_BY" in statements[0][0]
    assert "UNWIND $references" in statements[1][0]
    assert "USED" in statements[1][0]
    assert statements[0][1]["nativeNodeIds"] == ["pkg._runtime_owner"]
    assert statements[0][1]["nativeEdgeIds"] == ["edge-one"]
    assert statements[1][1]["references"] == [
        {"nativeId": "pkg._runtime_owner", "nativeKind": "node"},
        {"nativeId": "edge-one", "nativeKind": "edge"},
    ]
    assert not any(
        key in params
        for _query, params in statements
        for key in ("prompt", "result", "content", "exactIdf")
    )

    before = len(statements)
    assert card_domain.observe_native_attention({**event, "cardId": None}) is False
    assert len(statements) == before


def test_mag_one_instruction_idf_uses_only_canonical_persistence_and_never_runs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[str, dict]] = []
    exact_idf = "exact inspector-visible IDF bytes"

    def materialize(payload):
        calls.append(("materialize", dict(payload)))
        return {
            "projectId": "project-one",
            "deckId": "deck-one",
            "cardRevisionId": "22222222-2222-4222-8222-222222222222",
            "cardContext": {"cardId": "card-mag-one"},
            "exactIdf": exact_idf,
        }

    def save(payload):
        calls.append(("save", dict(payload)))
        return {
            "savedIdf": {
                "idfId": "11111111-1111-4111-8111-111111111111",
                "revision": 1,
                "contentMarkdown": exact_idf,
            },
            "inspection": {"assignment": "proposed mission", "runtimeOwner": "mag_one"},
        }

    monkeypatch.setattr(card_domain, "materialize_magentic_invocation", materialize)
    monkeypatch.setattr(card_domain, "save_idf_revision", save)

    result = card_domain.save_magentic_instructions({
        "projectId": "project-one",
        "deckId": "deck-one",
        "senderCardId": "card-main",
        "instructions": "proposed mission",
    })

    assert result["idfId"] == "11111111-1111-4111-8111-111111111111"
    assert result["started"] is False
    assert calls[0] == (
        "materialize",
        {
            "projectId": "project-one",
            "deckId": "deck-one",
            "senderCardId": "card-main",
            "assignment": "proposed mission",
        },
    )
    assert calls[1][0] == "save"
    assert calls[1][1]["exactIdf"] == exact_idf
    assert calls[1][1]["provenanceKind"] == "agent"
    assert "runId" not in calls[1][1]


def test_run_mag_one_saved_idf_is_revalidated_without_changing_exact_bytes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    exact_idf = "exact inspector-visible IDF bytes"
    captured: list[dict] = []
    monkeypatch.setattr(
        card_domain,
        "load_saved_idf_revision",
        lambda *_args: {
            "savedIdf": {
                "idfId": "11111111-1111-4111-8111-111111111111",
                "revision": 1,
                "projectId": "project-one",
                "deckId": "deck-one",
                "targetCardId": "card-mag-one",
                "targetCardRevisionId": "22222222-2222-4222-8222-222222222222",
                "contentMarkdown": exact_idf,
            },
            "inspection": {"assignment": "proposed mission", "runtimeOwner": "mag_one"},
        },
    )

    def validate(payload):
        captured.append(dict(payload))
        return {
            "projectId": "project-one",
            "deckId": "deck-one",
            "assignment": "proposed mission",
            "exactIdf": payload["exactIdf"],
            "cardRevisionId": payload["cardRevisionId"],
            "cardContext": {"cardId": "card-mag-one"},
        }

    monkeypatch.setattr(card_domain, "validate_exact_invocation", validate)
    prepared = card_domain.load_magentic_saved_invocation({
        "projectId": "project-one",
        "deckId": "deck-one",
        "senderCardId": "card-main",
        "idfId": "11111111-1111-4111-8111-111111111111",
    })

    assert captured[0]["senderCardId"] == "card-main"
    assert captured[0]["exactIdf"] == exact_idf
    assert prepared["exactIdf"] == exact_idf
    assert prepared["savedIdf"]["idfId"] == "11111111-1111-4111-8111-111111111111"
