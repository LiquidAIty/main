from __future__ import annotations

import copy

import pytest

from app.python_models import card_domain
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
