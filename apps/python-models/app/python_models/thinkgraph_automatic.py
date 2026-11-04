"""Automatic completed-Main-turn intake through existing Hermes and Engraphis owners."""

# Graph + less = more: less code that does the same work as more code is more useful.
# Entity names the feature; Relationship explains why this file belongs and what it contributes.
# Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
# Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
# Entity: ThinkGraph
# Relationship: Supplies both conversation bodies from one committed Hermes admission, delivers the saved Engraphis chunks once to the authorized ThinkGraph Card, and settles its actual result.

from __future__ import annotations

from datetime import datetime, timezone
import json
import logging
import os
from pathlib import Path
import re
import subprocess
import sys
from typing import Any
from uuid import NAMESPACE_URL, uuid5


_LOGGER = logging.getLogger(__name__)
_REPO_ROOT = Path(__file__).resolve().parents[4]
_HERMES_ROOT = _REPO_ROOT / "HermesLatest"
_HERMES_PROFILES = _HERMES_ROOT / ".hermes" / "profiles"
_HERMES_PYTHON = _HERMES_ROOT / ".venv" / (
    "Scripts/python.exe" if os.name == "nt" else "bin/python"
)
_DECK_ID = "deck_builder"
_THINKGRAPH_CARD_ID = "card_thinkgraph"
_PROFILE = re.compile(r"[a-z0-9][a-z0-9_-]{0,63}")
_ADMISSION_REFERENCE = re.compile(
    r"hermes:([a-z0-9][a-z0-9_-]{0,63}):admission:([0-9a-f]{32})",
    re.I,
)
_DELIVERY_TIMEOUT_SECONDS = 1_800.0


class AutomaticThinkGraphError(RuntimeError):
    """One specific automatic-intake contract failed."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _required_text(value: Any, code: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise AutomaticThinkGraphError(code)
    return text


def _profile_home(profile: str) -> Path:
    profile = _required_text(profile, "thinkgraph_profile_missing").lower()
    if not _PROFILE.fullmatch(profile):
        raise AutomaticThinkGraphError("thinkgraph_profile_invalid")
    home = (_HERMES_PROFILES / profile).resolve()
    if home.parent != _HERMES_PROFILES.resolve() or not (home / "state.db").is_file():
        raise AutomaticThinkGraphError("thinkgraph_profile_state_unavailable")
    return home


def _bridge_request(payload: dict[str, Any], *, timeout: float) -> dict[str, Any]:
    """Run only the installed Hermes state/relay contracts in Hermes's own environment."""
    if not _HERMES_PYTHON.is_file():
        raise AutomaticThinkGraphError("hermes_runtime_unavailable")
    env = {
        **os.environ,
        "PYTHONPATH": str(_HERMES_ROOT),
        "PYTHONUTF8": "1",
        "HERMES_HOME": str(_HERMES_ROOT / ".hermes"),
    }
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0
    try:
        completed = subprocess.run(
            [str(_HERMES_PYTHON), "-X", "utf8", str(Path(__file__).resolve()), "--hermes-bridge"],
            input=json.dumps(payload, ensure_ascii=False),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            cwd=str(_HERMES_ROOT),
            env=env,
            timeout=timeout,
            check=False,
            creationflags=creationflags,
        )
    except subprocess.TimeoutExpired as error:
        raise AutomaticThinkGraphError("hermes_completion_timeout") from error
    if completed.returncode != 0:
        _LOGGER.error("[automatic-thinkgraph] Hermes bridge failed: %s", completed.stderr[-2_000:])
        raise AutomaticThinkGraphError("hermes_bridge_failed")
    try:
        result = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        _LOGGER.error("[automatic-thinkgraph] Hermes bridge returned invalid JSON: %s", completed.stdout[-2_000:])
        raise AutomaticThinkGraphError("hermes_bridge_response_invalid") from error
    if not isinstance(result, dict) or result.get("ok") is not True:
        code = str(result.get("error") or "hermes_bridge_failed") if isinstance(result, dict) else "hermes_bridge_failed"
        raise AutomaticThinkGraphError(code)
    return result


def _speaker(message: dict[str, Any], kind: str) -> dict[str, Any] | None:
    field = "speaker" if kind == "conversation_speaker" else "target"
    if isinstance(message.get(field), dict):
        return message[field]
    return next(
        (
            activity for activity in message.get("visibleActivities", [])
            if isinstance(activity, dict) and activity.get("kind") == kind
        ),
        None,
    )


def _saved_authority(project: str, saved: list[dict[str, Any]], *, require_target: bool = True) -> dict[str, Any] | None:
    """Resolve the exact saved Main and its flow-connected ThinkGraph Card in Python."""
    assistants = [item for item in saved if item.get("role") == "assistant"]
    users = [item for item in saved if item.get("role") == "user"]
    if len(assistants) != 1 or not users:
        return None
    assistant = assistants[0]
    assistant_speaker = _speaker(assistant, "conversation_speaker")
    first_target = _speaker(users[0], "conversation_target")
    if not assistant_speaker or not first_target:
        return None

    from .saved_cards import load_deck
    from .agentgraph_topology import direct_orchestrator_targets

    loaded = load_deck(project, _DECK_ID)
    nodes = loaded.get("deck", {}).get("nodes", [])
    edges = loaded.get("deck", {}).get("edges", [])
    cards = {
        str(card.get("id") or ""): card
        for card in nodes
        if isinstance(card, dict) and card.get("enabled") is not False
    }
    mains = [
        card for card in cards.values()
        if isinstance(card.get("runtime"), dict)
        and card["runtime"].get("kind") == "hermes"
        and card["runtime"].get("mode") == "main"
    ]
    if len(mains) != 1:
        raise AutomaticThinkGraphError("saved_main_identity_invalid")
    main = mains[0]
    main_runtime = main["runtime"]
    main_id = _required_text(main.get("id"), "saved_main_identity_invalid")
    main_profile = _required_text(main_runtime.get("profile"), "saved_main_identity_invalid")
    if (
        assistant_speaker.get("cardId") != main_id
        or assistant_speaker.get("profile") != main_profile
        or first_target.get("cardId") != main_id
        or first_target.get("profile") != main_profile
    ):
        return None  # Builder and every other Card keep the existing conversation-only path.

    if not require_target:
        return {"mainCardId": main_id, "mainProfile": main_profile,
                "assistant": assistant, "users": users}

    targets = direct_orchestrator_targets(main_id, cards, edges)
    matches = [
        target for target in targets
        if target.get("cardId") == _THINKGRAPH_CARD_ID
        and str(target.get("profile") or "").lower() == "thinkgraph"
    ]
    if len(matches) != 1:
        raise AutomaticThinkGraphError("saved_thinkgraph_connection_unavailable")
    target = matches[0]
    return {
        "mainCardId": main_id,
        "mainProfile": main_profile,
        "thinkGraphCardId": target["cardId"],
        "thinkGraphProfile": target["profile"],
        "thinkGraphRevisionId": _required_text(
            target.get("cardRevisionId"), "saved_thinkgraph_revision_unavailable"
        ),
        "assistant": assistant,
        "users": users,
    }


def _source_reference(saved: list[dict[str, Any]], authority: dict[str, Any]) -> dict[str, Any]:
    first = authority["users"][0]
    provider = _required_text(first.get("providerMessageId"), "main_admission_reference_missing")
    match = _ADMISSION_REFERENCE.fullmatch(provider)
    if not match or match.group(1).lower() != authority["mainProfile"].lower():
        raise AutomaticThinkGraphError("main_admission_reference_invalid")
    session_id = _required_text(first.get("providerContinuationRef"), "main_session_reference_missing")
    if any(item.get("providerContinuationRef") != session_id for item in saved):
        raise AutomaticThinkGraphError("main_session_reference_mismatch")
    return {
        "profile": authority["mainProfile"],
        "admissionId": match.group(2).lower(),
        "sessionId": session_id,
        "conversationId": _required_text(first.get("conversationId"), "conversation_id_invalid"),
        "assistantMessageId": str(authority["assistant"].get("messageId") or ""),
    }


def database_turn_writes(project: str, arguments: dict[str, Any]) -> list[dict[str, Any]] | None:
    """Use transport identity only; every stored body comes from the committed Hermes turn."""
    writes = arguments.get("messages")
    if not isinstance(writes, list) or not any(
        str(item.get("providerMessageId") or "").startswith("hermes:")
        and ":admission:" in str(item.get("providerMessageId") or "")
        for item in writes if isinstance(item, dict)
    ):
        return None
    candidates = [{**item, "conversationId": arguments["conversationId"]} for item in writes]
    authority = _saved_authority(project, candidates, require_target=False)
    if authority is None:
        return None
    reference = _source_reference(candidates, authority)
    source = _bridge_request({
        "operation": "read_turn",
        "profileHome": str(_profile_home(reference["profile"])),
        "sessionId": reference["sessionId"],
        "admissionId": reference["admissionId"],
    }, timeout=30.0)
    if source.get("completed") is False:
        return []  # Interrupted/failed turns never become completed source pairs.
    if source["requestId"] != authority["users"][0].get("messageId"):
        raise AutomaticThinkGraphError("main_submission_reference_mismatch")
    user_template = authority["users"][0]
    answer_template = authority["assistant"]
    records = []
    for row in [*source["userRows"], source["assistantRow"]]:
        role = row["role"]
        original = user_template if role == "user" else answer_template
        provider = (f"hermes:{reference['profile']}:admission:{row['platformMessageId']}"
                    if role == "user" else f"hermes:{reference['profile']}:row:{row['rowId']}")
        records.append({
            **original,
            "messageId": (source["requestId"] if row is source["userRows"][0] else
                original.get("messageId") if role == "assistant" and original.get("messageId") else
                "msg_" + str(uuid5(NAMESPACE_URL,
                    f"{project}:{reference['profile']}:{reference['sessionId']}:{row['rowId']}"))),
            "role": role, "content": row["content"], "status": "complete",
            "providerMessageId": provider,
            "_hermesSource": {"profile": reference["profile"],
                              "admissionId": reference["admissionId"], "rowId": row["rowId"]},
            "_savedAt": datetime.fromtimestamp(row["timestamp"], timezone.utc).isoformat(
                timespec="milliseconds").replace("+00:00", "Z"),
        })
    _LOGGER.info("[automatic-thinkgraph] source admission=%s user_rows=%s assistant_row=%s",
                 reference["admissionId"], [r["rowId"] for r in source["userRows"]],
                 source["assistantRow"]["rowId"])
    return records

def _delivery_message(prepared: dict[str, Any]) -> str:
    preparation = prepared["preparation"]
    sections = [
        "AUTOMATIC THINKGRAPH EXTRACTION",
        "This is application-produced post-turn input. Return only the required structured output.",
    ]
    sections.extend([
        "EXTRACTION PROMPT:",
        str(preparation["enrichmentPrompt"]),
        "OUTPUT SCHEMA:",
        json.dumps(preparation["enrichmentSchema"], ensure_ascii=False, separators=(",", ":")),
    ])
    return "\n\n".join(sections)


def _automatic_run(project: str, arguments: dict[str, Any], saved: list[dict[str, Any]]) -> dict[str, Any]:
    authority = _saved_authority(project, saved)
    if authority is None:
        return {"status": "skipped", "reason": "not_main", "changed": False}
    reference = _source_reference(saved, authority)

    from .engraphis_operations import private_operation

    prepared = private_operation(project, "prepare_conversation_pair", {
        "conversationId": reference["conversationId"],
        "userMessageIds": [item["messageId"] for item in authority["users"]],
        "assistantMessageId": reference["assistantMessageId"],
    })
    preparation = prepared["preparation"]
    if preparation.get("structuredExtractionRequired") is not True:
        return {
            "status": "completed", "operation": "noop", "changed": False,
            "pairReference": preparation.get("pairReference"),
        }

    _LOGGER.info("[automatic-thinkgraph] prepared project=%s pair=%s",
                 project, preparation["pairReference"])
    delivery_id = _required_text(
        preparation.get("pairReference"), "thinkgraph_pair_reference_missing"
    ).removeprefix("pair_")
    delivered = _bridge_request(
        {
            "operation": "deliver",
            "profileHome": str(_profile_home(authority["thinkGraphProfile"])),
            "profile": authority["thinkGraphProfile"],
            "deliveryId": delivery_id,
            "message": _delivery_message(prepared),
            "timeoutSeconds": _DELIVERY_TIMEOUT_SECONDS,
        },
        timeout=_DELIVERY_TIMEOUT_SECONDS + 30.0,
    )
    try:
        structured_output = json.loads(delivered["finalResponse"])
    except (KeyError, json.JSONDecodeError, TypeError) as error:
        raise AutomaticThinkGraphError("thinkgraph_structured_output_invalid") from error

    from .thinkgraph_completed_pair_settlement import settle_completed_pair

    settled = settle_completed_pair({
        **prepared["source"],
        "pairReference": preparation["pairReference"],
        "structuredOutput": structured_output,
        "cardRun": {
            "runId": delivered["admissionId"],
            "cardId": authority["thinkGraphCardId"],
            "revisionId": authority["thinkGraphRevisionId"],
            "profile": authority["thinkGraphProfile"],
            "hermesSessionId": delivered["sessionId"],
            "resolvedProvider": delivered["provider"],
            "resolvedModel": delivered["model"],
        },
    })
    _LOGGER.info("[automatic-thinkgraph] settled project=%s admission=%s thinks=%s",
                 project, delivered["admissionId"], settled.get("thinkMemoryIds", []))
    return {
        "status": "completed",
        "operation": settled.get("intakeOperation"),
        "changed": settled.get("revisionChanged") is True,
        "pairReference": preparation["pairReference"],
        "admissionId": delivered["admissionId"],
        "thinkMemoryIds": settled.get("thinkMemoryIds", []),
    }


def process_completed_conversation(
    project: str,
    arguments: dict[str, Any],
    saved: list[dict[str, Any]],
) -> dict[str, Any]:
    """Run automatic ThinkGraph after the existing conversation transaction committed."""
    try:
        return _automatic_run(project, arguments, saved)
    except AutomaticThinkGraphError as error:
        _LOGGER.error(
            "[automatic-thinkgraph] project=%s conversation=%s failed=%s",
            project,
            arguments.get("conversationId"),
            error.code,
        )
        return {"status": "failed", "error": error.code, "changed": False}
    except Exception:
        _LOGGER.exception(
            "[automatic-thinkgraph] project=%s conversation=%s failed unexpectedly",
            project,
            arguments.get("conversationId"),
        )
        return {"status": "failed", "error": "automatic_thinkgraph_failed", "changed": False}


def _bridge_read_turn(payload: dict[str, Any]) -> dict[str, Any]:
    from hermes_state import SessionDB
    from hermes_state_runtime import get_session_admission
    from gateway.session_results import admission_result

    home = Path(_required_text(payload.get("profileHome"), "main_profile_home_missing")).resolve()
    session_id = _required_text(payload.get("sessionId"), "main_session_reference_missing")
    admission_id = _required_text(payload.get("admissionId"), "main_admission_reference_missing")
    db = SessionDB(db_path=home / "state.db", read_only=True)
    try:
        admission = get_session_admission(db, admission_id=admission_id)
        if admission is None or admission.get("target_session_id") != session_id:
            raise AutomaticThinkGraphError("main_admission_not_found")
        if admission.get("status") != "terminal" or admission.get("outcome") != "completed":
            return {"ok": True, "completed": False}
        saved = admission_result(db, admission_id)
        result = saved.get("result") if isinstance(saved, dict) else None
        if not isinstance(result, dict):
            raise AutomaticThinkGraphError("main_execution_result_unavailable")
        if (
            result.get("completed") is not True
            or result.get("failed") is True
            or result.get("interrupted") is True
            or result.get("partial") is True
        ):
            raise AutomaticThinkGraphError("main_execution_not_completed")
        receipt = result.get("persisted_turn")
        if not isinstance(receipt, dict):
            raise AutomaticThinkGraphError("main_source_identity_unavailable")
        user_ids = receipt.get("user_row_ids")
        final_id = receipt.get("final_assistant_row_id")
        if (
            not isinstance(user_ids, list)
            or not user_ids
            or any(type(value) is not int or value <= 0 for value in user_ids)
            or len(set(user_ids)) != len(user_ids)
            or type(final_id) is not int
            or final_id <= 0
        ):
            raise AutomaticThinkGraphError("main_source_identity_unavailable")
        identifiers = [*user_ids, final_id]
        if user_ids != sorted(user_ids) or max(user_ids) >= final_id:
            raise AutomaticThinkGraphError("main_source_order_invalid")
        # The receipt selects the whole unit. No transcript/history or latest-row scan.
        with db._read_ctx() as connection:
            rows = connection.execute(
                "SELECT id,role,content,tool_calls,display_kind,platform_message_id,timestamp "
                "FROM messages WHERE id IN (" + ",".join("?" for _ in identifiers) + ")",
                identifiers,
            ).fetchall()
        by_id = {row["id"]: dict(row) for row in rows}
        if set(by_id) != set(identifiers):
            raise AutomaticThinkGraphError("main_source_rows_unavailable")
        users = [by_id[identifier] for identifier in user_ids]
        assistant = by_id[final_id]
        if any(
            row.get("role") != "user"
            or row.get("display_kind") == "hidden"
            or not str(row.get("content") or "").strip()
            for row in users
        ):
            raise AutomaticThinkGraphError("main_source_user_invalid")
        if (
            assistant.get("role") != "assistant"
            or assistant.get("tool_calls") not in (None, "", [])
            or not str(assistant.get("content") or "").strip()
        ):
            raise AutomaticThinkGraphError("main_source_assistant_invalid")
        return {
            "ok": True,
            "admissionId": admission_id,
            "sessionId": session_id,
            "completed": True,
            "requestId": admission["request_id"],
            "persistedTurnComplete": receipt.get("complete") is True,
            "userRows": [{
                "rowId": row["id"], "role": "user", "timestamp": row["timestamp"],
                "content": row["content"],
                "platformMessageId": row.get("platform_message_id"),
                "messageUid": row.get("message_uid"),
            } for row in users],
            "assistantRow": {
                "rowId": assistant["id"], "role": "assistant", "timestamp": assistant["timestamp"],
                "content": assistant["content"],
                "messageUid": assistant.get("message_uid"),
            },
        }
    finally:
        db.close()


def _bridge_deliver(payload: dict[str, Any]) -> dict[str, Any]:
    from hermes_state import SessionDB
    from gateway.session_results import admission_result
    from tools.bot_live_delivery import authority_delivery, await_delivery

    home = Path(_required_text(payload.get("profileHome"), "thinkgraph_profile_home_missing")).resolve()
    profile = _required_text(payload.get("profile"), "thinkgraph_profile_missing")
    delivery_id = _required_text(payload.get("deliveryId"), "thinkgraph_delivery_id_missing")
    message = _required_text(payload.get("message"), "thinkgraph_delivery_message_missing")
    timeout = float(payload.get("timeoutSeconds") or _DELIVERY_TIMEOUT_SECONDS)
    receipt = authority_delivery(home, {
        "id": delivery_id,
        "profile": profile,
        "message": message,
    })
    if receipt.get("status") in {"queued", "claimed", "canonical"}:
        receipt = await_delivery(home, delivery_id, timeout)
    if not isinstance(receipt, dict) or receipt.get("status") != "settled":
        raise AutomaticThinkGraphError("thinkgraph_delivery_not_completed")
    admission_id = str(receipt.get("retry_admission_id") or receipt.get("admission_id") or "")
    session_id = _required_text(receipt.get("session_id"), "thinkgraph_session_unavailable")
    if not admission_id:
        raise AutomaticThinkGraphError("thinkgraph_admission_unavailable")
    db = SessionDB(db_path=home / "state.db", read_only=True)
    try:
        saved = admission_result(db, admission_id)
        result = saved.get("result") if isinstance(saved, dict) else None
        if not isinstance(result, dict):
            raise AutomaticThinkGraphError("thinkgraph_execution_result_unavailable")
        if (
            result.get("completed") is not True
            or result.get("failed") is True
            or result.get("interrupted") is True
            or result.get("partial") is True
        ):
            raise AutomaticThinkGraphError("thinkgraph_execution_not_completed")
        final = _required_text(result.get("final_response"), "thinkgraph_final_response_missing")
        return {
            "ok": True,
            "deliveryId": delivery_id,
            "admissionId": admission_id,
            "sessionId": session_id,
            "finalResponse": final,
            "provider": _required_text(result.get("provider"), "thinkgraph_provider_missing"),
            "model": _required_text(result.get("model"), "thinkgraph_model_missing"),
        }
    finally:
        db.close()


def _bridge_main() -> int:
    try:
        payload = json.loads(sys.stdin.read())
        if not isinstance(payload, dict):
            raise AutomaticThinkGraphError("hermes_bridge_input_invalid")
        operation = payload.get("operation")
        if operation == "read_turn":
            result = _bridge_read_turn(payload)
        elif operation == "deliver":
            result = _bridge_deliver(payload)
        else:
            raise AutomaticThinkGraphError("hermes_bridge_operation_invalid")
        sys.stdout.write(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
        return 0
    except AutomaticThinkGraphError as error:
        sys.stdout.write(json.dumps({"ok": False, "error": error.code}, separators=(",", ":")))
        return 0
    except Exception as error:
        sys.stderr.write(f"{type(error).__name__}: {error}\n")
        return 1


if __name__ == "__main__" and "--hermes-bridge" in sys.argv:
    raise SystemExit(_bridge_main())
