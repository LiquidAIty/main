from __future__ import annotations

import copy
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


def test_exact_idf_allows_dynamic_edits_but_protects_card_authority() -> None:
    context = {
        "cardId": "card-one",
        "title": "One",
        "prompt": "stable",
        "runtimeType": "assistant_agent",
        "runtimeBinding": "research_agent",
        "provider": "openrouter",
        "modelKey": "model",
        "providerModelId": "model",
        "accessMode": "openrouter-api",
        "executionMode": "single",
        "tools": [],
    }
    preview = {
        "cardContext": context,
        "providerProjection": {"systemPrompt": "stable system"},
    }
    edited = render_content_markdown(
        system_text="stable system",
        user_text="edited temporary assignment",
        card_context=context,
        dynamic_context_markdown="temporary context",
        native_references=[],
    )
    card_domain._validate_exact_idf(preview, edited)

    with pytest.raises(card_domain.CardDomainError, match="exact_idf_stable_prompt_changed"):
        card_domain._validate_exact_idf(
            preview,
            edited.replace("stable system", "changed system", 1),
        )

    changed_context = copy.deepcopy(context)
    changed_context["tools"] = ["ungranted.tool"]
    changed = render_content_markdown(
        system_text="stable system",
        user_text="edited temporary assignment",
        card_context=changed_context,
        dynamic_context_markdown="temporary context",
        native_references=[],
    )
    with pytest.raises(card_domain.CardDomainError, match="exact_idf_card_authority_changed"):
        card_domain._validate_exact_idf(preview, changed)


def test_native_reference_uses_the_idd_shape_and_preserves_provenance() -> None:
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


def test_main_idf_contains_bounded_native_project_context_without_copying_graphs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    main = _agent("main", runtimeBinding="main_chat")
    main["runtimeOptions"] = {
        "provider": "openai",
        "modelKey": "gpt-5.6-luna",
        "providerModelId": "gpt-5.6-luna",
        "accessMode": "chatgpt-account",
        "executionMode": "single",
        "profile": "default",
        "profileSnapshot": {
            "name": "default",
            "model": "gpt-5.6-luna",
            "gateway": "openai-codex",
        },
        "profileConflictResolution": "card",
        "hermesFacet": {"profileHomeRef": "hermes-profile:default"},
        "tools": ["engraphis.recall", "canvas.inspect", "run_mag_one"],
    }
    coder = _agent("coder", runtimeBinding="local_coder")
    coder["runtimeOptions"] = {
        **coder["runtimeOptions"],
        "tools": ["cbm.search_graph", "run_local_coder"],
    }
    helper = _agent("helper", runtimeBinding="hermes_steward")
    helper["runtimeOptions"] = {
        **helper["runtimeOptions"],
        "tools": ["graphiti.search_nodes"],
    }
    magentic = _agent("mag", runtimeType="magentic_one", runtimeBinding=None)
    for number, card in enumerate((main, coder, helper, magentic), start=1):
        card["_cardRevisionId"] = f"revision-{number}"
        card["_cardRevision"] = number
        card["_cardRevisionSha256"] = f"sha-{number}"
    edges = [
        {"id": "flow-helper", "source": "main", "target": "helper", "edgeType": "flow"},
        {"id": "flow-coder", "source": "main", "target": "coder", "edgeType": "flow"},
        {"id": "control-mag", "source": "main", "target": "mag", "edgeType": "magentic_control"},
        {
            "id": "option-coder",
            "source": "coder",
            "target": "mag",
            "edgeType": "magentic_option",
            "targetHandle": "bus-in-1",
        },
    ]
    monkeypatch.setattr(
        card_domain,
        "_load_deck_internal",
        lambda _project, _deck: {
            "projectId": "00000000-0000-0000-0000-000000000001",
            "project": {
                "id": "00000000-0000-0000-0000-000000000001",
                "name": "Documentation Project",
                "code": "docs",
                "type": "agent",
                "status": "active",
            },
            "deck": {
                "id": "deck-one",
                "name": "Documentation Deck",
                "workspaceRoot": "C:/Projects/LiquidAIty/main",
                "nodes": [main, coder, helper, magentic],
                "edges": edges,
            },
            "meta": {"deckRevision": "deck-revision-one", "deckSavedAt": "2026-08-17T00:00:00Z"},
        },
    )

    preview = card_domain.materialize_main_invocation({
        "projectId": "docs",
        "deckId": "deck-one",
        "conversationId": "conversation-one",
        "parentRunId": "run-parent",
        "assignment": "Document the exact bounded context path.",
        "nativeReferences": [{
            "authority": "KnowGraph",
            "nativeId": "episode-one",
            "reason": "selected sourced fact",
            "asOf": "2026-08-17T00:00:00Z",
            "required": True,
        }],
    })

    manifest = preview["projectContextManifest"]
    assert manifest["identity"] == {
        "project": {
            "id": "00000000-0000-0000-0000-000000000001",
            "name": "Documentation Project",
            "code": "docs",
            "type": "agent",
            "status": "active",
        },
        "deck": {
            "id": "deck-one",
            "name": "Documentation Deck",
            "revision": "deck-revision-one",
            "savedAt": "2026-08-17T00:00:00Z",
        },
        "mainCard": {
            "id": "main",
            "revisionId": "revision-1",
            "revision": 1,
            "revisionSha256": "sha-1",
        },
        "conversationId": "conversation-one",
        "parentRunId": "run-parent",
    }
    assert manifest["agentTopology"]["directFlowTargets"] == [
        {"cardId": "helper", "title": "helper", "runtimeBinding": "hermes_steward"},
        {"cardId": "coder", "title": "coder", "runtimeBinding": "local_coder"},
    ]
    assert manifest["agentTopology"]["magenticControlTargetIds"] == ["mag"]
    assert manifest["agentTopology"]["magenticOptionRelationships"] == [edges[3]]
    layers = {item["authority"]: item for item in manifest["authorityLayers"]}
    assert layers["ThinkGraph"]["availability"] == "direct_tool_grant"
    assert layers["KnowGraph"]["viaCardIds"] == ["helper"]
    assert layers["KnowGraph"]["selectedReferences"][0]["nativeId"] == "episode-one"
    assert layers["CodeGraph"]["viaCardIds"] == ["coder"]
    assert layers["CodeGraph"]["nativeIdentity"]["state"] == "query_at_use_time"
    assert layers["AgentGraph"]["provenance"]["deckRevision"] == "deck-revision-one"
    assert layers["HermesContinuity"]["nativeIdentity"]["profileHomeRef"] == "hermes-profile:default"
    assert all("prompt" not in json.dumps(layer).lower() for layer in manifest["authorityLayers"])
    islands = validate_idf_islands(preview["exactIdf"])
    rendered_manifests = [
        json.loads(item["content"])
        for item in islands["JSON"]
        if json.loads(item["content"]).get("type") == "project-context-manifest"
    ]
    assert rendered_manifests == [manifest]


def test_saved_idf_inspection_reads_the_exact_body_without_rebuilding_it() -> None:
    context = {
        "cardId": "card-one",
        "title": "One",
        "prompt": "stable",
        "runtimeType": "assistant_agent",
        "runtimeBinding": "research_agent",
        "provider": "openrouter",
        "modelKey": "model",
        "providerModelId": "model",
        "accessMode": "openrouter-api",
        "tools": [],
    }
    exact = render_content_markdown(
        system_text="stable system",
        user_text="repeatable assignment",
        card_context=context,
        dynamic_context_markdown="",
        native_references=[],
    )
    inspection = card_domain._inspect_saved_idf(exact)
    assert inspection["assignment"] == "repeatable assignment"
    assert inspection["cardContext"] == context
    assert inspection["providerProjection"]["message"] == exact
