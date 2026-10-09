from __future__ import annotations

from typing import Any

from app.python_models import card_run_jev


MAX_TOOL_QUESTIONS = 128


def _auto_tools_unavailable(
    baseline_tool_ids: list[str], error_code: str,
) -> tuple[list[str], dict[str, Any]]:
    return list(baseline_tool_ids), {
        "schemaVersion": "auto-tools-decision.v1",
        "status": "unavailable",
        "candidateCount": len(baseline_tool_ids),
        "selectedToolIds": list(baseline_tool_ids),
        "selectedConfidencePercentages": {},
        "decisionId": None,
        "errorCode": error_code,
    }


def select_auto_tools(
    *,
    baseline_tool_ids: list[str],
    tool_contracts: list[dict[str, Any]],
    context: dict[str, Any],
) -> tuple[list[str], dict[str, Any]]:
    """Ask one USE/OMIT Choice per exact ordinary baseline tool."""

    if not baseline_tool_ids:
        return [], {
            "schemaVersion": "auto-tools-decision.v1",
            "status": "selected",
            "candidateCount": 0,
            "selectedToolIds": [],
            "selectedConfidencePercentages": {},
            "decisionId": None,
            "errorCode": None,
        }
    if len(baseline_tool_ids) > MAX_TOOL_QUESTIONS:
        return _auto_tools_unavailable(baseline_tool_ids, "auto_tools_question_limit")
    by_id = {
        str(contract.get("canonicalId") or ""): contract
        for contract in tool_contracts
        if isinstance(contract, dict)
    }
    if (
        len(set(baseline_tool_ids)) != len(baseline_tool_ids)
        or len(tool_contracts) != len(baseline_tool_ids)
        or set(by_id) != set(baseline_tool_ids)
        or any(not tool_id or len(tool_id) > 512 for tool_id in baseline_tool_ids)
    ):
        return _auto_tools_unavailable(baseline_tool_ids, "auto_tools_contract_invalid")
    question_ids = {
        tool_id: card_run_jev._question_id("tool", tool_id) for tool_id in baseline_tool_ids
    }
    body = {
        "model": card_run_jev.JEV_MODEL,
        "state": {
            **context,
            "ordinary_tool_candidates": [by_id[tool_id] for tool_id in baseline_tool_ids],
        },
        "questions": {
            question_ids[tool_id]: {
                "type": "choice",
                "instructions": (
                    "Choose USE only when this exact granted ordinary tool is useful for the "
                    "current request and supplied context. Otherwise choose OMIT. Do not invent "
                    "capabilities, widen grants, or treat prior conversation as context."
                ),
                "criteria": {
                    "USE": f"Present the exact ordinary tool {tool_id} to the model.",
                    "OMIT": f"Do not present the exact ordinary tool {tool_id} to the model.",
                },
            }
            for tool_id in baseline_tool_ids
        },
    }
    try:
        response = card_run_jev._post_jev(
            card_run_jev._bounded_body(body, "auto_tools_input_limit"),
            prefix="auto_tools_jev",
        )
        if not isinstance(response.get("answers"), dict) or set(
            response["answers"]
        ) != set(question_ids.values()):
            raise ValueError("answers")
        decision_id = card_run_jev._decision_id(response)
        selected: list[str] = []
        confidence_percentages: dict[str, float] = {}
        for tool_id in baseline_tool_ids:
            winner, confidence = card_run_jev._choice_answer(
                response, question_ids[tool_id], ("USE", "OMIT"),
            )
            if winner == "USE":
                selected.append(tool_id)
                confidence_percentages[tool_id] = confidence
    except card_run_jev._JevSelectionError as error:
        return _auto_tools_unavailable(baseline_tool_ids, error.error_code)
    except (KeyError, TypeError, ValueError, OverflowError):
        return _auto_tools_unavailable(
            baseline_tool_ids, "auto_tools_jev_response_invalid",
        )
    return selected, {
        "schemaVersion": "auto-tools-decision.v1",
        "status": "selected",
        "candidateCount": len(baseline_tool_ids),
        "selectedToolIds": selected,
        "selectedConfidencePercentages": confidence_percentages,
        "decisionId": decision_id,
        "errorCode": None,
    }
