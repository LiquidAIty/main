"""Database-to-database automatic ThinkGraph intake for completed Main turns."""

# Entity: ThinkGraph
# Relationship: Reads one completed Main pair from Hermes state.db, hands it unchanged to Engraphis chunking, and exposes the prepared/settle halves used by the Hermes plugin LLM call.

from __future__ import annotations

import json
from pathlib import Path
import re
import sqlite3
from typing import Any


_REPO_ROOT = Path(__file__).resolve().parents[4]
_HERMES_PROFILES = _REPO_ROOT / "HermesLatest" / ".hermes" / "profiles"
_PROFILE = re.compile(r"[a-z0-9][a-z0-9_-]{0,63}")
_DECK_ID = "deck_builder"
_MAIN_CARD_ID = "card_main_chat"


class AutomaticThinkGraphError(RuntimeError):
    """One exact automatic-intake contract failed."""


def _required_text(value: Any, code: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise AutomaticThinkGraphError(code)
    return text


def _profile_database(profile: str) -> Path:
    profile = _required_text(profile, "thinkgraph_profile_missing").lower()
    if not _PROFILE.fullmatch(profile):
        raise AutomaticThinkGraphError("thinkgraph_profile_invalid")
    home = (_HERMES_PROFILES / profile).resolve()
    database = (home / "state.db").resolve()
    if home.parent != _HERMES_PROFILES.resolve() or database.parent != home or not database.is_file():
        raise AutomaticThinkGraphError("thinkgraph_profile_state_unavailable")
    return database


def _completed_pair(
    profile: str,
    session_id: str,
    user_row_id: int,
    assistant_row_id: int,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Read the exact hook-captured visible user/final-assistant rows once."""

    session_id = _required_text(session_id, "main_session_reference_missing")
    database = _profile_database(profile)
    connection = sqlite3.connect(f"file:{database.as_posix()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        rows = [dict(row) for row in connection.execute(
            "SELECT id,role,content,tool_calls,timestamp,display_kind "
            "FROM messages WHERE session_id=? AND active=1 AND id IN (?,?) "
            "AND role IN ('user','assistant') AND COALESCE(display_kind,'')='' "
            "ORDER BY id",
            (session_id, user_row_id, assistant_row_id),
        ).fetchall()]
    finally:
        connection.close()
    user = next((row for row in rows if row["id"] == user_row_id), None)
    assistant = next((row for row in rows if row["id"] == assistant_row_id), None)
    if (
        user is None
        or assistant is None
        or user["role"] != "user"
        or assistant["role"] != "assistant"
        or user["id"] >= assistant["id"]
        or not str(user.get("content") or "").strip()
        or not str(assistant.get("content") or "").strip()
        or assistant.get("tool_calls") not in (None, "", "[]")
    ):
        raise AutomaticThinkGraphError("main_completed_pair_invalid")
    return user, assistant


def _completed_source(
    project: str,
    profile: str,
    session_id: str,
    user_row_id: int,
    assistant_row_id: int,
) -> dict[str, Any]:
    from .conversations import read_pair, record_state_db_pair

    user_row, assistant_row = _completed_pair(
        profile, session_id, user_row_id, assistant_row_id,
    )
    saved = record_state_db_pair(
        project,
        profile=profile,
        session_id=session_id,
        user_row=user_row,
        assistant_row=assistant_row,
    )
    users = [item for item in saved if item["role"] == "user"]
    assistants = [item for item in saved if item["role"] == "assistant"]
    if len(users) != 1 or len(assistants) != 1:
        raise AutomaticThinkGraphError("main_completed_pair_invalid")
    source = read_pair(
        project,
        session_id,
        [users[0]["messageId"]],
        assistants[0]["messageId"],
    )
    return {
        **source,
        "deckId": _DECK_ID,
        "runId": f"state-db:{profile}:{assistant_row['id']}",
        "cardId": _MAIN_CARD_ID,
    }


def prepare_completed_turn(
    project: str,
    profile: str,
    session_id: str,
    user_row_id: int,
    assistant_row_id: int,
) -> dict[str, Any]:
    """Prepare every completed pair for the plugin's out-of-band structured call."""

    from .conversations import completed_pair_settlement, register_source_pair
    from .thinkgraph_completed_pair_preparation import prepare_completed_pair

    source = _completed_source(
        project, profile, session_id, user_row_id, assistant_row_id,
    )
    prepared = prepare_completed_pair(source)
    pair_reference = prepared["pairReference"]
    reference = source["sourceReferences"][0]
    register_source_pair(project, pair_reference, reference)
    settled = completed_pair_settlement(project, pair_reference)
    if settled is not None:
        return {
            "ok": True,
            "status": "already_settled",
            "projectId": project,
            "pairReference": pair_reference,
            "thinkMemoryIds": settled.get("thinkMemoryIds", []),
        }
    if prepared["structuredExtractionRequired"] is not True:
        return {
            "ok": True,
            "status": "already_settled",
            "projectId": project,
            "pairReference": pair_reference,
            "thinkMemoryIds": prepared.get("thinkMemoryIds", []),
        }
    return {
        "ok": True,
        "status": "ready",
        "projectId": project,
        "pairReference": pair_reference,
        "instructions": prepared["enrichmentPrompt"],
        "input": [{
            "type": "text",
            "text": "Process every supplied source chunk as one completed Main exchange.",
        }],
        "jsonSchema": prepared["enrichmentSchema"],
    }


def _source_for_pair(project: str, pair_reference: str) -> dict[str, Any]:
    from .conversations import conversation_operation, read_pair
    from .engraphis import get_service, project_id

    project = project_id(project)
    service = get_service(project)
    workspace = service.store.conn.execute(
        "SELECT id FROM workspaces WHERE name=?",
        (project,),
    ).fetchone()
    if workspace is None:
        raise AutomaticThinkGraphError("thinkgraph_pair_not_found")
    row = service.store.conn.execute(
        "SELECT content FROM events WHERE workspace_id=? AND kind='conversation_pair' "
        "AND json_extract(content,'$.pairReference')=?",
        (workspace["id"], pair_reference),
    ).fetchone()
    if row is None:
        raise AutomaticThinkGraphError("thinkgraph_pair_not_found")
    reference = json.loads(row["content"])
    source = read_pair(
        project,
        reference["conversationId"],
        reference["userMessageIds"],
        reference["assistantMessageId"],
    )
    messages = conversation_operation(
        project, "read", {"conversationId": reference["conversationId"]},
    )
    assistant = next(
        (item for item in messages if item["messageId"] == reference["assistantMessageId"]),
        None,
    )
    match = re.fullmatch(
        r"hermes:([a-z0-9][a-z0-9_-]{0,63}):row:([1-9][0-9]*)",
        str((assistant or {}).get("providerMessageId") or ""),
        re.I,
    )
    if match is None:
        raise AutomaticThinkGraphError("thinkgraph_pair_source_identity_invalid")
    return source | {
        "deckId": _DECK_ID,
        "runId": f"state-db:{match.group(1).lower()}:{match.group(2)}",
        "cardId": _MAIN_CARD_ID,
    }


def settle_completed_turn(
    project: str,
    pair_reference: str,
    structured_output: dict[str, Any],
    *,
    provider: str,
    model: str,
) -> dict[str, Any]:
    """Give the plugin result to Engraphis for validation and atomic settlement."""

    from .conversations import register_pair_settlement
    from .thinkgraph_completed_pair_settlement import settle_completed_pair

    source = _source_for_pair(project, pair_reference)
    result = settle_completed_pair({
        **source,
        "pairReference": pair_reference,
        "structuredOutput": structured_output,
        "modelRun": {
            "provider": _required_text(provider, "thinkgraph_provider_missing"),
            "model": _required_text(model, "thinkgraph_model_missing"),
            "task": "thinkgraph",
            "purpose": "automatic_completed_main_pair",
        },
    })
    register_pair_settlement(
        project,
        pair_reference,
        {
            "thinkMemoryIds": list(result.get("thinkMemoryIds") or []),
            "status": "completed",
        },
    )
    return result
