from __future__ import annotations

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


def test_direct_card_targets_keep_only_enabled_top_level_flow_targets() -> None:
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
    assert card_domain._direct_card_targets("parent", cards, edges) == [
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
    assert preview["cardIdentity"] == {"cardId": "parent", "title": "parent"}
    assert preview["idf"]["enabledTools"] == []
    assert preview["delegationTargets"] == [{
        **_expected_delegate(),
        "nativeTools": ["terminal"],
        "skills": ["repository-coder"],
        "toolsets": ["terminal"],
    }]
    assert "delegationTargets" not in preview["idf"]


def test_hermes_flow_target_projects_saved_profile_outside_model_input(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    preview = _delegation_preview(
        monkeypatch,
        edges=[{"source": "parent", "target": "child", "edgeType": "flow"}],
        parent_runtime={"kind": "hermes", "mode": "main", "profile": "main"},
    )
    assert preview["runtimeOwner"] == "hermes"
    assert preview["cardIdentity"] == {"cardId": "parent", "title": "parent"}
    assert "card.run_assistant_agent" not in preview["idf"]["enabledTools"]
    assert preview["delegationTargets"] == [{
        **_expected_delegate(),
        "nativeTools": ["terminal"],
        "skills": ["repository-coder"],
        "toolsets": ["terminal"],
    }]
    assert "delegationTargets" not in preview["idf"]


def test_no_flow_edge_materializes_no_delegation_transport(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    preview = _delegation_preview(monkeypatch, edges=[])
    assert preview["cardIdentity"] == {"cardId": "parent", "title": "parent"}
    assert preview["idf"]["enabledTools"] == []
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


def test_mag_one_identity_resolves_without_materializing_or_running(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mag_one = _agent("mag-one", runtime={"kind": "autogen", "mode": "magentic_one"})
    mag_one["title"] = "Magentic-One"
    mag_one["_cardRevisionId"] = "revision-mag-one"
    mag_one["_cardRevision"] = 1
    mag_one["_cardRevisionSha256"] = "sha-mag-one"
    loaded = {
        "projectId": "00000000-0000-0000-0000-000000000001",
        "deck": {"nodes": [mag_one], "edges": []},
    }
    monkeypatch.setattr(card_domain, "_load_deck_internal", lambda *_args: loaded)
    monkeypatch.setattr(
        card_domain,
        "materialize_invocation",
        lambda *_args, **_kwargs: pytest.fail("proposal identity must not materialize"),
    )

    assert card_domain.resolve_magentic_card_identity("project-one", "deck-one") == {
        "projectId": loaded["projectId"],
        "deckId": "deck-one",
        "targetCardId": "mag-one",
        "targetCardTitle": "Magentic-One",
    }


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
    assert "card.run_assistant_agent" not in preview["idf"]["enabledTools"]
    assert "card.run_assistant_agent" not in preview["idf"]["enabledTools"]
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
    assert "card.run_assistant_agent" not in missing["idf"]["enabledTools"]


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
        "assignment": "Use every supplied declaration.",
        "keyContext": "Continue only from the bounded current handoff.",
        "visibleMessages": [
            {"role": "user", "content": "Please verify the current source."},
            {"role": "assistant", "content": "I found one source-backed starting point."},
        ],
        "priorResults": [{
            "authority": "KnowGraph",
            "nativeId": "episode:one",
            "reason": "selected evidence",
            "asOf": "2026-08-17T00:00:00Z",
            "required": True,
        }],
        "outputRequirements": "Return the declared result.",
    }


def test_receiving_card_materializes_its_own_exact_call_data(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    loaded = _destination_fixture(monkeypatch)
    hermes = card_domain.materialize_invocation(_destination_payload("hermes"))
    autogen = card_domain.materialize_invocation(_destination_payload("autogen"))

    assert hermes["idf"]["systemPrompt"] == "Hermes saved prompt"
    assert hermes["idf"]["runtime"] == {
        "kind": "hermes", "mode": "delegate", "profile": "research",
    }
    assert hermes["idf"]["enabledTools"] == []
    assert autogen["idf"]["systemPrompt"] == "AutoGen saved prompt"
    assert autogen["idf"]["runtime"] == {"kind": "autogen", "mode": "assistant"}
    assert autogen["idf"]["enabledTools"] == []
    assert hermes["idf"]["message"] == autogen["idf"]["message"]
    assert "Continue only from the bounded current handoff." in hermes["idf"]["message"]
    assert "Inspect the supplied current graph data" in hermes["idf"]["message"]
    assert hermes["idf"]["nativeReferences"][0]["nativeId"] == "episode:one"
    assert "cardId" not in hermes["idf"]
    assert "runId" not in hermes["idf"]
    assert "flow-hermes" not in str(hermes["idf"])

    loaded["deck"]["edges"] = [
        edge for edge in loaded["deck"]["edges"] if edge["target"] != "autogen"
    ]
    with pytest.raises(
        card_domain.CardDomainError,
        match="card_invocation_edge_authority_required",
    ):
        card_domain.materialize_invocation(_destination_payload("autogen"))


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
    preview = card_domain.materialize_invocation(payload)

    assert [anchor["nativeId"] for anchor in resolved] == ["hook:one", "handoff:one"]
    assert preview["idf"]["graphSeed"] == "actual current graph data"
    assert [reference["nativeId"] for reference in preview["idf"]["nativeReferences"]] == [
        "episode:one", "hook:one", "handoff:one",
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
    preview = card_domain.materialize_invocation(_destination_payload("hermes"))

    assert len(calls) == 1
    anchors, kwargs = calls[0]
    assert len(anchors) == 1
    assert anchors[0]["searchDynamicInput"] is True
    assert anchors[0]["entityTypes"] == ["Company"]
    assert anchors[0]["edgeTypes"] == ["SUPPORTS"]
    assert kwargs["search_text"] == "Use every supplied declaration."
    assert preview["idf"]["graphSeed"] == "current KnowGraph result"
    assert preview["resolvedNativeReads"][0]["nativeId"] == "entity-1"


def test_card_graph_handoff_rereads_native_data_and_attributes_source_run(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = _agent("helper", runtime={"kind": "hermes", "mode": "kanban", "profile": "helper"})
    source["runtimeOptions"]["tools"] = ["card.load_graph_references"]
    target = _agent("mag-one", runtime={"kind": "autogen", "mode": "magentic_one"})
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


def test_explicit_subagent_context_is_bounded_transient_and_retaskable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    loaded = _destination_fixture(monkeypatch)
    target = next(card for card in loaded["deck"]["nodes"] if card["id"] == "hermes")
    target["runtime"] = {"kind": "hermes", "mode": "kanban", "profile": "knowledge"}
    target["runtimeOptions"]["tools"] = ["graphiti.add_memory"]

    first = card_domain.materialize_invocation({
        **_destination_payload("hermes"),
        "assignment": "Research the first bounded question.",
        "keyContext": "Use current graph evidence for the first question.",
    })
    second = card_domain.materialize_invocation({
        **_destination_payload("hermes"),
        "assignment": "Retask the same saved Kanban Card with a second question.",
        "keyContext": "The first result was weak; verify the missing point only.",
    })

    assert first["cardIdentity"]["cardId"] == second["cardIdentity"]["cardId"] == "hermes"
    assert second["idf"]["runtime"]["profile"] == "knowledge"
    assert "Retask the same saved Kanban Card" in second["idf"]["message"]
    assert "Research the first bounded question" not in second["idf"]["message"]
    assert second["delegationTargets"] == []
    assert "card.run_assistant_agent" not in second["idf"]["enabledTools"]

    too_many = _destination_payload("hermes")
    too_many["visibleMessages"] = [
        {"role": "user", "content": f"message {index}"} for index in range(7)
    ]
    with pytest.raises(card_domain.CardDomainError, match="card_handoff_visible_message_limit_exceeded"):
        card_domain.materialize_invocation(too_many)

    too_large = _destination_payload("hermes")
    too_large["visibleMessages"] = [{"role": "user", "content": "x" * 3_001}]
    with pytest.raises(card_domain.CardDomainError, match="card_handoff_visible_message_token_limit_exceeded"):
        card_domain.materialize_invocation(too_large)


def test_explicit_subagent_context_rejects_unbounded_parent_context(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _destination_fixture(monkeypatch)
    payload = _destination_payload("hermes")
    payload["contextMarkdown"] = "complete parent transcript"
    with pytest.raises(card_domain.CardDomainError, match="unbounded_card_handoff_context_rejected"):
        card_domain.materialize_invocation(payload)


def test_main_and_coder_can_explicitly_retask_one_non_delegating_kanban_card(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    main = _agent("main", runtime={"kind": "hermes", "mode": "main", "profile": "main"})
    coder = _agent("coder", runtime={"kind": "hermes", "mode": "delegate", "profile": "coder"})
    kanban = _agent("kanban", runtime={"kind": "hermes", "mode": "kanban", "profile": "knowledge"})
    main["runtimeOptions"]["tools"] = ["card.run_assistant_agent"]
    coder["runtimeOptions"]["tools"] = ["card.run_assistant_agent"]
    kanban["runtimeOptions"]["tools"] = ["graphiti.add_memory"]
    for index, card in enumerate((main, coder, kanban), start=1):
        card["_cardRevisionId"] = f"revision-{index}"
        card["_cardRevision"] = 1
        card["_cardRevisionSha256"] = f"sha-{index}"
    loaded = {
        "projectId": "project-one",
        "deck": {
            "nodes": [main, coder, kanban],
            "edges": [
                {"source": "main", "target": "kanban", "edgeType": "flow"},
                {"source": "coder", "target": "kanban", "edgeType": "flow"},
            ],
        },
    }
    monkeypatch.setattr(card_domain, "_load_deck_internal", lambda *_args: loaded)

    def invoke(sender: str, task: str) -> dict:
        return card_domain.materialize_invocation({
            "projectId": "project-one", "deckId": "deck_builder",
            "cardId": "kanban", "senderCardId": sender,
            "assignment": task, "keyContext": "Inspect supplied evidence first.",
            "visibleMessages": [], "priorResults": [],
            "outputRequirements": "Return evidence, gaps, and native references.",
        })

    assert invoke("main", "Research the current question.")["cardIdentity"]["cardId"] == "kanban"
    assert invoke("coder", "Retask the missing evidence.")["delegationTargets"] == []
    loaded["deck"]["edges"] = loaded["deck"]["edges"][:1]
    with pytest.raises(card_domain.CardDomainError, match="card_invocation_edge_authority_required"):
        invoke("coder", "This wire no longer authorizes the retask.")

def test_main_chat_materializes_once_without_serialized_card_or_run_data(
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
    materializations: list[str] = []
    real_materialize = card_domain.materialize_idf

    def count_materialization(**kwargs):
        materializations.append(str(kwargs["dynamic_input"]))
        return real_materialize(**kwargs)

    monkeypatch.setattr(card_domain, "materialize_idf", count_materialization)
    prepared = card_domain.prepare_main_chat({
        "projectId": "project-one",
        "deckId": "deck-one",
        "message": "Help me prepare work for another agent.",
    })
    assert "assignment" not in prepared
    assert "message" not in prepared
    assert prepared["idf"]["systemPrompt"] == main["prompt"]
    assert prepared["idf"]["message"] == "Help me prepare work for another agent."
    assert prepared["idf"]["enabledTools"] == []
    assert prepared["idf"]["runtime"] == {
        "kind": "hermes", "mode": "main", "profile": "default",
    }
    assert "cardId" not in prepared["idf"]
    assert "runId" not in prepared["idf"]
    assert "serialized-card" not in str(prepared["idf"])
    assert prepared["cardIdentity"] == {"cardId": "main", "title": "main"}
    assert materializations == ["Help me prepare work for another agent."]
    inserted: dict[str, object] = {}
    monkeypatch.setattr(
        card_domain,
        "_insert_run",
        lambda value, **kwargs: inserted.update({"prepared": value, **kwargs}),
    )
    monkeypatch.setattr(card_domain, "_observe_run_start", lambda *args, **kwargs: True)
    begun = card_domain.begin_main_chat_run({
        "projectId": "project-one",
        "deckId": "deck-one",
        "message": "Help me prepare work for another agent.",
        "cardRevisionId": "main-revision",
        "runId": "run-main-one",
        "correlationId": "run-main-one",
        "conversationId": "conversation-one",
    })
    assert begun["hermesTransport"]["idf"] == begun["idf"]
    assert begun["hermesTransport"]["idf"]["message"] == (
        "Help me prepare work for another agent."
    )
    assert inserted["prepared"]["idf"] == begun["idf"]
    assert materializations == [
        "Help me prepare work for another agent.",
        "Help me prepare work for another agent.",
    ]


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
        "idf": {"runtime": {"kind": "hermes", "mode": "main", "profile": "main"}, "nativeReferences": [{
            "authority": "KnowGraph",
            "nativeId": "episode:selected",
            "reason": "selected for the call",
            "asOf": "2026-08-17T00:00:00Z",
            "required": True,
        }]},
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
    assert len(insert) == 11
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
