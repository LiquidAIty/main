"""Post-turn delivery through existing saved Card Runs, never a model runtime.

The Run correlation IDs are the durable deduplication boundary. No graph data,
transcripts, provider configuration or task ledger is stored here.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from app.control_plane import card_run_assistant_agent
from app.python_models.card_domain import load_deck, read_run, read_run_input_files

_log = logging.getLogger(__name__)
# Serialize delivery to the one saved ThinkGraph profile. Research is separate work.
_delivery_lock = asyncio.Lock()


async def deliver_completed_pair(
    context: dict[str, Any], *, read=read_run, read_input=read_run_input_files,
    read_deck=load_deck, invoke=card_run_assistant_agent,
) -> dict[str, Any]:
    """Advance once; an interrupted/failed/running child is never restarted."""
    identity = {key: str(context.get(key) or "").strip()
                for key in ("projectId", "deckId", "runId")}
    conversation_id = str(context.get("conversationId") or "").strip()
    if not all(identity.values()) or not conversation_id:
        raise ValueError("cognition_turn_identity_required")
    parent = (await asyncio.to_thread(read, identity)).get("run")
    if not parent or any(parent.get(key) != value for key, value in identity.items()):
        raise ValueError("cognition_parent_identity_mismatch")
    if (parent.get("state") != "completed" or parent.get("runtimeKind") != "hermes"
            or parent.get("runtimeMode") != "main"):
        return {"state": "ignored", "runId": identity["runId"]}
    if not parent.get("result"):
        raise ValueError("cognition_completed_response_missing")
    saved = await asyncio.to_thread(read_deck, identity["projectId"], identity["deckId"])
    cards = saved["deck"]["nodes"]
    matches = [card for card in cards if card.get("runtime") == {
        "kind": "hermes", "mode": "delegate", "profile": "thinkgraph",
    }]
    if len(matches) != 1:
        raise ValueError("cognition_profile_binding_required:thinkgraph")
    worker = matches[0]
    retained = await asyncio.to_thread(read_input, identity)
    if retained.get("available") is not True:
        raise ValueError("cognition_parent_input_unavailable")
    idf = retained["idf"]
    pair = {
        **identity, "conversationId": conversation_id,
        "mainCardId": parent["cardId"], "observedAt": parent.get("finishedAt"),
        "user": idf["dynamicContext"]["task"], "assistant": parent["result"],
    }
    scope = {"projectId": identity["projectId"], "deckId": identity["deckId"]}
    stage = "thinkgraph"
    async with _delivery_lock:
        correlation_id = f"cognition:{identity['runId']}:{stage}"
        prior = (await asyncio.to_thread(read, {**scope, "correlationId": correlation_id})).get("run")
        if prior:
            if prior.get("cardId") != worker["id"]:
                raise ValueError("cognition_stage_identity_mismatch")
            if prior.get("state") != "completed":
                return {"state": "halted", "stage": stage, "runId": prior["runId"],
                        "childState": prior.get("state")}
            output = prior.get("result")
        else:
            # Dynamic task input only. The receiving Card materializes its
            # own IDF and owns all prompts, models, grants and native execution.
            mission = json.dumps({
                "completedPair": pair,
                "selectedReferences": idf.get("actualGraphData", {}).get("selectedNativeReferences", []),
                "purpose": "Maintain ThinkGraph from this completed conversation using your saved role. Return compact native references.",
            }, ensure_ascii=False)
            if len(mission) > 100_000:
                raise ValueError("cognition_input_too_large")
            response = await invoke({
                **scope, "cardId": worker["id"], "correlationId": correlation_id,
                "conversationId": conversation_id, "originatingAgentId": parent["cardId"],
                "originatingRunId": identity["runId"], "input": mission,
            })
            result = response.get("result", {})
            if response.get("ok") is not True or result.get("state") != "completed":
                return {"state": "halted", "stage": stage, "runId": correlation_id,
                        "childState": result.get("state", "failed")}
            if result.get("runId") != correlation_id or result.get("cardId") != worker["id"]:
                raise ValueError("cognition_stage_identity_mismatch")
            output = result.get("output")
        if not isinstance(output, str) or not output.strip():
            raise ValueError("cognition_stage_result_missing")
    return {"state": "completed", "runId": correlation_id, "cardId": worker["id"]}


async def deliver_in_background(context: dict[str, Any]) -> None:
    try:
        result = await deliver_completed_pair(context)
        if result["state"] == "halted":
            _log.warning("Cognition delivery halted: %s", result)
    except Exception:
        # Main is already completed. Keep its successful answer intact; failures
        # remain in the affected child Run and service log, without replay.
        _log.exception("Cognition delivery failed for Run %s", context.get("runId"))
