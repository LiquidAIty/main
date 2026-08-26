from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)


def _error(code: str) -> str:
    return json.dumps(
        {
            "ok": False,
            "error": code,
        }
    )


def _anchors(value: Any) -> list[dict[str, Any]]:
    if value is None:
        return []

    if not isinstance(value, list):
        raise ValueError("dataAnchors_must_be_array")

    result: list[dict[str, Any]] = []

    for index, raw in enumerate(value):
        if not isinstance(raw, dict):
            raise ValueError("dataAnchor_must_be_object")

        authority = str(raw.get("authority") or "").strip()
        native_id = str(raw.get("nativeId") or "").strip()
        reason = str(raw.get("reason") or "").strip()

        if authority not in {"ThinkGraph", "KnowGraph", "CodeGraph"}:
            raise ValueError("dataAnchor_authority_invalid")

        if not native_id:
            raise ValueError("dataAnchor_nativeId_required")

        if not reason:
            raise ValueError("dataAnchor_reason_required")

        bounded = int(raw.get("boundedExpansion", 0))
        if bounded < 0 or bounded > 3:
            raise ValueError("dataAnchor_boundedExpansion_invalid")

        limit = int(raw.get("resultLimit", 24))
        if limit < 1 or limit > 24:
            raise ValueError("dataAnchor_resultLimit_invalid")

        result.append(
            {
                "authority": authority,
                "nativeId": native_id,
                "reason": reason,
                "priority": int(raw.get("priority", -index)),
                "boundedExpansion": bounded,
                "resultLimit": limit,
                "required": raw.get("required") is not False,
            }
        )

    return result


def autogen_task(ctx, args: dict[str, Any], **kwargs: Any) -> str:
    try:
        mode = str(args.get("mode") or "").strip()
        goal = str(args.get("goal") or "").strip()

        if mode not in {"single", "magentic_one"}:
            return _error("autogen_task_mode_invalid")

        if not goal:
            return _error("autogen_task_goal_required")

        anchors = _anchors(args.get("dataAnchors"))

        if mode == "single":
            target_card_id = str(args.get("targetCardId") or "").strip()

            if not target_card_id:
                return _error("autogen_task_targetCardId_required")

            payload: dict[str, Any] = {
                "cardId": target_card_id,
                "input": goal,
            }

            if anchors:
                payload["dataAnchors"] = anchors

            result = ctx.dispatch_tool(
                "card.run_assistant_agent",
                payload,
            )

            return result if isinstance(result, str) else json.dumps(result)

        payload = {
            "input": goal,
            "dataAnchors": anchors,
        }

        result = ctx.dispatch_tool(
            "run_mag_one",
            payload,
        )

        return result if isinstance(result, str) else json.dumps(result)

    except Exception as exc:
        logger.exception("autogen_task failed")
        return json.dumps(
            {
                "ok": False,
                "error": "autogen_task_failed",
                "exceptionClass": exc.__class__.__name__,
            }
        )
