from __future__ import annotations

import pytest

from app.python_models import (
    card_run_auto_model,
    card_run_auto_tools,
    card_run_jev,
    card_run_selection_context,
)


def _candidate(model: str, **overrides):
    value = {
        "id": f"openai:chatgpt-account:{model}",
        "provider": "openai",
        "accessMode": "chatgpt-account",
        "modelKey": model,
        "providerModelId": model,
        "label": model,
        "eligible": True,
        "contextWindow": 200_000,
        "supportsTools": True,
        "inputModalities": ["text", "image"],
        "reasoningEfforts": ["low", "medium", "high"],
        "taskFit": "Authored configured-model fit facts.",
    }
    value.update(overrides)
    return value


def _context():
    return card_run_selection_context.selection_context(
        current_request="Use the selected graph record.",
        instructions="Saved instructions.",
        output_contract="Return JSON.",
        graph_records=[{
            "cbmQualifiedName": "project.module.symbol",
            "provenance": {"repository": "LiquidAIty"},
            "materializedRecord": {"large": "content must not travel"},
        }],
        attachments=[{
            "id": "attachment-one",
            "filename": "chart.png",
            "mimeType": "image/png",
            "sizeBytes": 42,
            "dataUrl": "data:image/png;base64,secret-bytes",
            "context": {"large": "content must not travel"},
        }],
        estimated_visible_tokens=1_200,
    )


def test_selection_context_keeps_only_reference_provenance_and_attachment_metadata():
    context = _context()

    assert context["current_request"] == "Use the selected graph record."
    assert context["selected_graph_references"] == [{
        "cbmQualifiedName": "project.module.symbol",
        "provenance": {"repository": "LiquidAIty"},
    }]
    assert context["attachment_metadata"] == [{
        "id": "attachment-one",
        "filename": "chart.png",
        "mimeType": "image/png",
        "sizeBytes": 42,
    }]
    assert "secret-bytes" not in str(context)
    assert "content must not travel" not in str(context)


def test_auto_tools_asks_one_exact_use_omit_choice_and_stores_selected_confidence(
    monkeypatch: pytest.MonkeyPatch,
):
    captured = {}

    def decide(body, *, prefix):
        captured["body"] = body
        captured["prefix"] = prefix
        question_ids = list(body["questions"])
        return {
            "id": "decision-tools-one",
            "answers": {
                question_ids[0]: {
                    "type": "choice", "choice": "USE",
                    "probabilities": {"USE": 0.8, "OMIT": 0.2},
                    "confidence": 0.75,
                },
                question_ids[1]: {
                    "type": "choice", "choice": "OMIT",
                    "probabilities": {"USE": 0.1, "OMIT": 0.9},
                    "confidence": 0.9,
                },
            },
        }

    monkeypatch.setattr(card_run_jev, "_post_jev", decide)
    selected, decision = card_run_auto_tools.select_auto_tools(
        baseline_tool_ids=["canvas.inspect", "graphiti.search_nodes"],
        tool_contracts=[
            {"canonicalId": "canvas.inspect", "inputSchema": {"type": "object"}},
            {"canonicalId": "graphiti.search_nodes", "inputSchema": {"type": "object"}},
        ],
        context=_context(),
    )

    assert selected == ["canvas.inspect"]
    assert decision == {
        "schemaVersion": "auto-tools-decision.v1",
        "status": "selected",
        "candidateCount": 2,
        "selectedToolIds": ["canvas.inspect"],
        "selectedConfidencePercentages": {"canvas.inspect": 75.0},
        "decisionId": "decision-tools-one",
        "errorCode": None,
    }
    assert captured["prefix"] == "auto_tools_jev"
    assert len(captured["body"]["questions"]) == 2
    assert all(
        set(question["criteria"]) == {"USE", "OMIT"}
        for question in captured["body"]["questions"].values()
    )


def test_auto_tools_malformed_response_uses_full_valid_baseline(monkeypatch):
    monkeypatch.setattr(
        card_run_jev,
        "_post_jev",
        lambda *_args, **_kwargs: {"id": "bad", "answers": {}},
    )
    selected, decision = card_run_auto_tools.select_auto_tools(
        baseline_tool_ids=["canvas.inspect"],
        tool_contracts=[{"canonicalId": "canvas.inspect"}],
        context=_context(),
    )

    assert selected == ["canvas.inspect"]
    assert decision["status"] == "unavailable"
    assert decision["errorCode"] == "auto_tools_jev_response_invalid"
    assert decision["selectedConfidencePercentages"] == {}


def test_auto_model_one_compatible_candidate_selects_without_jev(monkeypatch):
    monkeypatch.setattr(
        card_run_jev,
        "_post_jev",
        lambda *_args, **_kwargs: pytest.fail("one candidate must be deterministic"),
    )
    provider, decision = card_run_auto_model.select_auto_model(
        saved_provider={
            "provider": "openai", "accessMode": "chatgpt-account",
            "modelKey": "gpt-5.6-sol", "providerModelId": "gpt-5.6-sol",
        },
        raw_candidates=[_candidate("gpt-5.6-luna")],
        context=_context(),
        tools_required=True,
        images_required=True,
        reasoning_effort="high",
    )

    assert provider == {
        "provider": "openai", "accessMode": "chatgpt-account",
        "modelKey": "gpt-5.6-luna", "providerModelId": "gpt-5.6-luna",
    }
    assert decision["savedModelId"] == (
        "openai:chatgpt-account:gpt-5.6-sol"
    )
    assert decision["selectedModelId"] == (
        "openai:chatgpt-account:gpt-5.6-luna"
    )
    assert decision["status"] == "deterministic"
    assert decision["selectedConfidencePercentage"] is None
    assert decision["decisionId"] is None


def test_auto_model_multiple_candidates_requires_one_valid_jev_choice(monkeypatch):
    def decide(body, *, prefix):
        assert prefix == "auto_model_jev"
        ids = tuple(body["questions"]["model"]["criteria"])
        return {
            "id": "decision-model-one",
            "answers": {"model": {
                "type": "choice", "choice": ids[1],
                "probabilities": {ids[0]: 0.25, ids[1]: 0.75},
                "confidence": 0.8,
            }},
        }

    monkeypatch.setattr(card_run_jev, "_post_jev", decide)
    provider, decision = card_run_auto_model.select_auto_model(
        saved_provider={
            "provider": "openai", "accessMode": "chatgpt-account",
            "modelKey": "gpt-5.6-sol", "providerModelId": "gpt-5.6-sol",
        },
        raw_candidates=[
            _candidate("gpt-5.6-luna"),
            _candidate("gpt-5.6-sol"),
        ],
        context=_context(),
        tools_required=True,
        images_required=False,
        reasoning_effort="medium",
    )

    assert provider["modelKey"] == "gpt-5.6-sol"
    assert decision["decisionId"] == "decision-model-one"
    assert decision["selectedConfidencePercentage"] == 80.0


def test_auto_model_no_compatible_candidate_fails_with_bounded_decision():
    with pytest.raises(card_run_auto_model.AutoModelSelectionError) as captured:
        card_run_auto_model.select_auto_model(
            saved_provider={
                "provider": "openai", "accessMode": "chatgpt-account",
                "modelKey": "gpt-5.6-sol", "providerModelId": "gpt-5.6-sol",
            },
            raw_candidates=[_candidate(
                "gpt-5.6-luna", supportsTools=False,
            )],
            context=_context(),
            tools_required=True,
            images_required=False,
            reasoning_effort="",
        )

    assert captured.value.decision == {
        "schemaVersion": "auto-model-decision.v1",
        "status": "unavailable",
        "savedModelId": "openai:chatgpt-account:gpt-5.6-sol",
        "candidateCount": 0,
        "selectedModelId": None,
        "selectedConfidencePercentage": None,
        "decisionId": None,
        "errorCode": "auto_model_compatible_candidates_unavailable",
    }
